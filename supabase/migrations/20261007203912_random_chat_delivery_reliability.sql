-- Keep retries idempotent without persisting chat text or transcripts.
alter table private.random_chat_limits
  add column last_client_message_id uuid,
  add column last_message_created_at timestamptz;

create or replace function public.random_chat_can_send(p_topic text, p_event text, p_payload jsonb)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select public.is_active_member()) and p_event = 'random:message' and exists (
    select 1
    from public.random_chat_sessions s
    join private.random_chat_limits l on l.user_id = (select auth.uid())
    where s.status = 'ACTIVE'
      and p_topic = 'random-chat:' || s.session_key::text
      and p_payload ->> 'session_key' = s.session_key::text
      and p_payload ->> 'sender_id' = (select auth.uid())::text
      and p_payload ->> 'broadcast_ticket' = l.last_broadcast_ticket::text
      and p_payload ->> 'client_message_id' = l.last_client_message_id::text
      and l.last_session_key = s.session_key
      and l.last_sent_at > now() - interval '30 seconds'
      and p_payload -> 'sender_profile' = case when (select auth.uid()) = s.user_a_id then s.profile_a else s.profile_b end
      and char_length(p_payload ->> 'body') between 1 and 500
      and md5(p_payload ->> 'body') = l.last_body_hash
      and (p_payload ->> 'body') !~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m[0-9]{10,}\M|(?:instagram|snapchat|phone|number)\s*[:=])'
  );
$$;

drop function public.random_chat_send(uuid, text);
create function public.random_chat_send(
  p_session_key uuid,
  p_body text,
  p_client_message_id uuid default gen_random_uuid()
)
returns table(body text, sender_id uuid, sender_profile jsonb, created_at timestamptz,
  broadcast_ticket uuid, client_message_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  room public.random_chat_sessions%rowtype;
  clean_body text := btrim(p_body);
  body_hash text := md5(btrim(p_body));
  sent_at timestamptz := clock_timestamp();
  ticket uuid := gen_random_uuid();
  profile jsonb;
  limiter private.random_chat_limits%rowtype;
begin
  if me is null or not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  if p_client_message_id is null then raise exception 'message id is required' using errcode = '22023'; end if;
  if clean_body is null or char_length(clean_body) not between 1 and 500 then
    raise exception 'message must be 1 to 500 characters' using errcode = '22023';
  end if;
  if clean_body ~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m[0-9]{10,}\M|(?:instagram|snapchat|phone|number)\s*[:=])' then
    raise exception 'please keep personal contact information out of Random Chat' using errcode = '22023';
  end if;
  select * into room from public.random_chat_sessions s
    where s.session_key = p_session_key and s.status = 'ACTIVE' and me in (s.user_a_id, s.user_b_id);
  if not found then raise exception 'this chat has ended' using errcode = 'P0002'; end if;
  profile := case when me = room.user_a_id then room.profile_a else room.profile_b end;

  insert into private.random_chat_limits(user_id, window_started_at, message_count)
    values (me, sent_at, 0) on conflict (user_id) do nothing;
  select * into limiter from private.random_chat_limits where user_id = me for update;

  if limiter.last_client_message_id = p_client_message_id then
    if limiter.last_session_key is distinct from p_session_key or limiter.last_body_hash is distinct from body_hash then
      raise exception 'message retry does not match the original message' using errcode = '22023';
    end if;
    sent_at := coalesce(limiter.last_message_created_at, limiter.last_sent_at, sent_at);
    update private.random_chat_limits set last_broadcast_ticket = ticket, last_sent_at = clock_timestamp()
      where user_id = me;
  elsif limiter.window_started_at < sent_at - interval '1 minute' then
    update private.random_chat_limits set window_started_at = sent_at, message_count = 1,
      last_body_hash = body_hash, last_sent_at = sent_at, last_broadcast_ticket = ticket,
      last_session_key = p_session_key, last_client_message_id = p_client_message_id,
      last_message_created_at = sent_at
      where user_id = me;
  elsif limiter.message_count >= 20 then
    raise exception 'slow down before sending another message' using errcode = 'P0001';
  elsif limiter.last_body_hash = body_hash and limiter.last_sent_at > sent_at - interval '2 seconds' then
    raise exception 'please wait before repeating a message' using errcode = 'P0001';
  else
    update private.random_chat_limits set message_count = message_count + 1,
      last_body_hash = body_hash, last_sent_at = sent_at, last_broadcast_ticket = ticket,
      last_session_key = p_session_key, last_client_message_id = p_client_message_id,
      last_message_created_at = sent_at
      where user_id = me;
  end if;

  return query select clean_body, me, profile, sent_at, ticket, p_client_message_id;
end;
$$;
revoke all on function public.random_chat_send(uuid, text, uuid) from public, anon;
grant execute on function public.random_chat_send(uuid, text, uuid) to authenticated;

create or replace function public.random_chat_end(p_session_key uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); room public.random_chat_sessions%rowtype;
begin
  update public.random_chat_sessions s set status = 'ENDED', ended_at = now(),
    expires_at = case when s.moderation_hold then null else now() + interval '30 days' end
  where s.session_key = p_session_key and s.status = 'ACTIVE' and me in (s.user_a_id, s.user_b_id)
  returning * into room;
  if not found then return false; end if;
  delete from public.random_chat_messages where session_id = room.id;
  delete from public.random_chat_queue where user_id in (room.user_a_id, room.user_b_id);
  update private.random_chat_limits set last_body_hash = null, last_sent_at = null,
    last_broadcast_ticket = null, last_session_key = null, last_client_message_id = null,
    last_message_created_at = null where user_id in (room.user_a_id, room.user_b_id);
  perform realtime.send(jsonb_build_object('session_key', room.session_key, 'reason', 'ended'),
    'random:ended', 'user:' || room.user_a_id::text, true);
  perform realtime.send(jsonb_build_object('session_key', room.session_key, 'reason', 'ended'),
    'random:ended', 'user:' || room.user_b_id::text, true);
  return true;
end;
$$;

-- Serialize queue cancellation with matching, and close a session if matching
-- completed just before the cancellation reached the database.
create or replace function public.random_chat_cancel()
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); active_session_key uuid;
begin
  if me is null then return false; end if;
  perform pg_advisory_xact_lock(781235901);
  select s.session_key into active_session_key from public.random_chat_sessions s
    where s.status = 'ACTIVE' and me in (s.user_a_id, s.user_b_id) limit 1 for update;
  if active_session_key is not null then return public.random_chat_end(active_session_key); end if;
  delete from public.random_chat_queue where user_id = me;
  return found;
end;
$$;

notify pgrst, 'reload schema';
