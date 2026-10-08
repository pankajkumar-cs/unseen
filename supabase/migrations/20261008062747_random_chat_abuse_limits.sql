-- Add small server-enforced cooldowns so a modified client cannot flood
-- matchmaking or reports. The existing per-user limits row is reused.
alter table private.random_chat_limits
  add column last_match_requested_at timestamptz,
  add column last_reported_at timestamptz;

create or replace function public.random_chat_start()
returns table(state text, session_id uuid, session_key uuid, partner jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  candidate uuid;
  own_identity public.anonymous_identities%rowtype;
  other_identity public.anonymous_identities%rowtype;
  left_user uuid;
  right_user uuid;
  left_profile jsonb;
  right_profile jsonb;
  new_session public.random_chat_sessions%rowtype;
  match_limiter private.random_chat_limits%rowtype;
  request_at timestamptz := clock_timestamp();
begin
  if me is null or not public.is_active_member() then
    raise exception 'registered active account required for Random Chat' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(781235901);
  if exists(select 1 from public.random_chat_sessions s where s.status = 'ACTIVE' and me in (s.user_a_id, s.user_b_id)) then
    return query select c.state, c.session_id, c.session_key, c.partner from public.random_chat_current() c;
    return;
  end if;
  if exists(select 1 from public.random_chat_queue q where q.user_id = me and q.status = 'WAITING' and q.expires_at > request_at) then
    return query select 'searching'::text, null::uuid, null::uuid, null::jsonb;
    return;
  end if;

  insert into private.random_chat_limits(user_id, window_started_at, message_count)
    values (me, request_at, 0) on conflict (user_id) do nothing;
  select * into match_limiter from private.random_chat_limits where user_id = me for update;
  if match_limiter.last_match_requested_at > request_at - interval '1 second' then
    raise exception 'please wait before starting another chat search' using errcode = 'P0001';
  end if;
  update private.random_chat_limits set last_match_requested_at = request_at where user_id = me;

  insert into public.random_chat_queue(user_id, status, created_at, expires_at)
    values (me, 'WAITING', request_at, request_at + interval '60 seconds')
    on conflict (user_id) do update set status = 'WAITING', created_at = excluded.created_at, expires_at = excluded.expires_at;
  select q.user_id into candidate
    from public.random_chat_queue q
    join public.profiles p on p.id = q.user_id and p.moderation_status = 'ACTIVE'
    where q.user_id <> me and q.status = 'WAITING' and q.expires_at > request_at
      and not exists(select 1 from public.random_chat_blocks b where (b.blocker_id = me and b.blocked_id = q.user_id) or (b.blocker_id = q.user_id and b.blocked_id = me))
      and not exists(select 1 from public.random_chat_queue_exclusions e where e.user_id = me and e.excluded_user_id = q.user_id)
      and not exists(select 1 from public.random_chat_queue_exclusions e where e.user_id = q.user_id and e.excluded_user_id = me)
      and not exists(select 1 from public.random_chat_sessions s where s.created_at > request_at - interval '120 seconds'
        and ((s.user_a_id = me and s.user_b_id = q.user_id) or (s.user_b_id = me and s.user_a_id = q.user_id)))
      and not exists(select 1 from public.random_chat_sessions s where s.status = 'ACTIVE' and q.user_id in (s.user_a_id, s.user_b_id))
    order by exists(select 1 from public.random_chat_sessions s where s.created_at > request_at - interval '120 seconds'
        and ((s.user_a_id = me and s.user_b_id = q.user_id) or (s.user_b_id = me and s.user_a_id = q.user_id))),
      q.created_at, q.user_id
    limit 1 for update of q skip locked;
  if candidate is null then
    return query select 'searching'::text, null::uuid, null::uuid, null::jsonb;
    return;
  end if;

  select * into own_identity from public.anonymous_identities where user_id = me;
  select * into other_identity from public.anonymous_identities where user_id = candidate;
  if own_identity.id is null or other_identity.id is null then
    delete from public.random_chat_queue where user_id in (me, candidate);
    raise exception 'anonymous profile unavailable' using errcode = 'P0002';
  end if;
  left_user := least(me, candidate);
  right_user := greatest(me, candidate);
  if left_user = me then
    left_profile := jsonb_build_object('name', own_identity.display_name, 'emoji', own_identity.emoji, 'color', own_identity.color);
    right_profile := jsonb_build_object('name', other_identity.display_name, 'emoji', other_identity.emoji, 'color', other_identity.color);
  else
    left_profile := jsonb_build_object('name', other_identity.display_name, 'emoji', other_identity.emoji, 'color', other_identity.color);
    right_profile := jsonb_build_object('name', own_identity.display_name, 'emoji', own_identity.emoji, 'color', own_identity.color);
  end if;
  insert into public.random_chat_sessions(user_a_id, user_b_id, profile_a, profile_b)
    values (left_user, right_user, left_profile, right_profile) returning * into new_session;
  delete from public.random_chat_queue where user_id in (me, candidate);
  perform realtime.send(jsonb_build_object('session_id', new_session.id, 'session_key', new_session.session_key,
    'partner', case when me = left_user then right_profile else left_profile end),
    'random:matched', 'user:' || me::text, true);
  perform realtime.send(jsonb_build_object('session_id', new_session.id, 'session_key', new_session.session_key,
    'partner', case when candidate = left_user then right_profile else left_profile end),
    'random:matched', 'user:' || candidate::text, true);
  return query select 'matched'::text, new_session.id, new_session.session_key,
    case when me = left_user then right_profile else left_profile end;
end;
$$;

create or replace function public.random_chat_report(p_session_key uuid, p_reason text, p_detail text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  room public.random_chat_sessions%rowtype;
  peer uuid;
  report_id uuid := gen_random_uuid();
  report_limiter private.random_chat_limits%rowtype;
  report_at timestamptz := clock_timestamp();
begin
  if me is null or not public.is_active_member() then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if p_reason not in ('Harassment', 'Bullying', 'Threat', 'Sexual/explicit content', 'Spam', 'Hate/abuse', 'Asking for personal information', 'Sharing inappropriate content', 'Other') then
    raise exception 'choose a report reason' using errcode = '22023';
  end if;
  select * into room from public.random_chat_sessions s where s.session_key = p_session_key and me in (s.user_a_id, s.user_b_id);
  if not found then raise exception 'chat not found' using errcode = 'P0002'; end if;
  peer := case when room.user_a_id = me then room.user_b_id else room.user_a_id end;

  insert into private.random_chat_limits(user_id, window_started_at, message_count)
    values (me, report_at, 0) on conflict (user_id) do nothing;
  select * into report_limiter from private.random_chat_limits where user_id = me for update;
  if report_limiter.last_reported_at > report_at - interval '5 seconds' then
    raise exception 'please wait before sending another report' using errcode = 'P0001';
  end if;
  insert into public.random_chat_reports(id, session_id, reporter_id, reported_id, reason, detail)
    values (report_id, room.id, me, peer, p_reason, left(coalesce(p_detail, ''), 1000));
  update private.random_chat_limits set last_reported_at = report_at where user_id = me;
  update public.random_chat_sessions set moderation_hold = true where id = room.id;
  if room.status = 'ACTIVE' then perform public.random_chat_end(p_session_key); end if;
  return report_id;
end;
$$;

revoke all on function public.random_chat_start() from public, anon;
revoke all on function public.random_chat_report(uuid, text, text) from public, anon;
grant execute on function public.random_chat_start() to authenticated;
grant execute on function public.random_chat_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
