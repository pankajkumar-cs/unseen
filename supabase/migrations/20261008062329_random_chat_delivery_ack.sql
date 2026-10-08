-- Permit a receiver to acknowledge an ephemeral message on its active room.
-- Message bodies and acknowledgements travel over client Broadcast only; neither
-- is inserted into a Postgres message/history table.
-- Do not put auth user IDs in room payloads or Presence keys. The client uses
-- random per-chat tokens for echo detection; authorization comes from auth.uid().
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
      and p_payload ->> 'broadcast_ticket' = l.last_broadcast_ticket::text
      and p_payload ->> 'client_message_id' = l.last_client_message_id::text
      and p_payload ->> 'sender_token' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and l.last_session_key = s.session_key
      and l.last_sent_at > now() - interval '30 seconds'
      and p_payload -> 'sender_profile' = case when (select auth.uid()) = s.user_a_id then s.profile_a else s.profile_b end
      and char_length(p_payload ->> 'body') between 1 and 500
      and md5(p_payload ->> 'body') = l.last_body_hash
      and (p_payload ->> 'body') !~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m[0-9]{10,}\M|(?:instagram|snapchat|phone|number)\s*[:=])'
  );
$$;

create or replace function public.random_chat_can_ack(p_topic text, p_payload jsonb)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select public.is_active_member()) and exists (
    select 1
    from public.random_chat_sessions s
    where s.status = 'ACTIVE'
      and p_topic = 'random-chat:' || s.session_key::text
      and p_payload ->> 'session_key' = s.session_key::text
      and (select auth.uid()) in (s.user_a_id, s.user_b_id)
      and p_payload ->> 'ack_sender_token' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and p_payload ->> 'client_message_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );
$$;

revoke all on function public.random_chat_can_send(text, text, jsonb) from public, anon;
grant execute on function public.random_chat_can_send(text, text, jsonb) to authenticated;
revoke all on function public.random_chat_can_ack(text, jsonb) from public, anon;
grant execute on function public.random_chat_can_ack(text, jsonb) to authenticated;

drop policy if exists random_chat_broadcast_member_send on realtime.messages;
create policy random_chat_broadcast_member_send on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and (
      (select public.random_chat_can_send(topic, event, payload))
      or (event = 'random:message_ack' and (select public.random_chat_can_ack(topic, payload)))
    )
  );

notify pgrst, 'reload schema';
