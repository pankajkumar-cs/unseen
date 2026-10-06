-- Prefer a never-matched partner, but allow the most recent partner as a
-- fallback when no other eligible campus ghost is waiting.
create or replace function public.random_chat_start()
returns table(state text, session_id uuid, session_key uuid, partner jsonb)
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); candidate uuid; own_identity public.anonymous_identities%rowtype;
  other_identity public.anonymous_identities%rowtype; left_user uuid; right_user uuid;
  left_profile jsonb; right_profile jsonb; new_session public.random_chat_sessions%rowtype;
begin
  if me is null or not public.is_active_member() then raise exception 'registered active account required for Random Chat' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(781235901);
  if exists(select 1 from public.random_chat_sessions s where s.status = 'ACTIVE' and me in (s.user_a_id, s.user_b_id)) then
    return query select c.state,c.session_id,c.session_key,c.partner from public.random_chat_current() c; return;
  end if;
  insert into public.random_chat_queue(user_id,status,created_at,expires_at)
    values(me,'WAITING',now(),now()+interval '60 seconds')
    on conflict(user_id) do update set status='WAITING',created_at=now(),expires_at=now()+interval '60 seconds';
  select q.user_id into candidate from public.random_chat_queue q
    join public.profiles p on p.id=q.user_id and p.moderation_status='ACTIVE'
    where q.user_id<>me and q.status='WAITING' and q.expires_at>now()
      and not exists(select 1 from public.random_chat_blocks b where (b.blocker_id=me and b.blocked_id=q.user_id) or (b.blocker_id=q.user_id and b.blocked_id=me))
      and not exists(select 1 from public.random_chat_queue_exclusions e where e.user_id=me and e.excluded_user_id=q.user_id)
      and not exists(select 1 from public.random_chat_queue_exclusions e where e.user_id=q.user_id and e.excluded_user_id=me)
      and not exists(select 1 from public.random_chat_sessions s where s.status='ACTIVE' and q.user_id in (s.user_a_id,s.user_b_id))
    order by exists(select 1 from public.random_chat_sessions s where s.created_at>now()-interval '120 seconds'
        and ((s.user_a_id=me and s.user_b_id=q.user_id) or (s.user_b_id=me and s.user_a_id=q.user_id))),
      q.created_at,q.user_id
    limit 1 for update of q skip locked;
  if candidate is null then
    return query select 'searching'::text,null::uuid,null::uuid,null::jsonb; return;
  end if;
  select * into own_identity from public.anonymous_identities where user_id=me;
  select * into other_identity from public.anonymous_identities where user_id=candidate;
  if own_identity.id is null or other_identity.id is null then
    delete from public.random_chat_queue where user_id in (me,candidate);
    raise exception 'anonymous profile unavailable' using errcode = 'P0002';
  end if;
  left_user := least(me,candidate); right_user := greatest(me,candidate);
  if left_user=me then
    left_profile:=jsonb_build_object('name',own_identity.display_name,'emoji',own_identity.emoji,'color',own_identity.color);
    right_profile:=jsonb_build_object('name',other_identity.display_name,'emoji',other_identity.emoji,'color',other_identity.color);
  else
    left_profile:=jsonb_build_object('name',other_identity.display_name,'emoji',other_identity.emoji,'color',other_identity.color);
    right_profile:=jsonb_build_object('name',own_identity.display_name,'emoji',own_identity.emoji,'color',own_identity.color);
  end if;
  insert into public.random_chat_sessions(user_a_id,user_b_id,profile_a,profile_b)
    values(left_user,right_user,left_profile,right_profile) returning * into new_session;
  delete from public.random_chat_queue where user_id in (me,candidate);
  perform realtime.send(jsonb_build_object('session_id',new_session.id,'session_key',new_session.session_key,
    'partner',case when me=left_user then right_profile else left_profile end),
    'random:matched','user:'||me::text,true);
  perform realtime.send(jsonb_build_object('session_id',new_session.id,'session_key',new_session.session_key,
    'partner',case when candidate=left_user then right_profile else left_profile end),
    'random:matched','user:'||candidate::text,true);
  return query select 'matched'::text,new_session.id,new_session.session_key,
    case when me=left_user then right_profile else left_profile end;
end;
$$;
