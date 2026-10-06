-- Keep message bodies in each participant's browser, never in the app database.
-- The private random_chat_limits row keeps only a short-lived body hash and a
-- broadcast ticket so the Realtime policy can accept only RPC-validated sends.
alter table private.random_chat_limits
  add column last_broadcast_ticket uuid,
  add column last_session_key uuid;

create or replace function public.random_chat_can_access_topic(p_topic text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select public.is_active_member()) and exists (
    select 1 from public.random_chat_sessions s
    where p_topic = 'random-chat:' || s.session_key::text
      and s.status = 'ACTIVE'
      and (select auth.uid()) in (s.user_a_id, s.user_b_id)
  );
$$;

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
      and l.last_session_key = s.session_key
      and l.last_sent_at > now() - interval '30 seconds'
      and p_payload -> 'sender_profile' = case when (select auth.uid()) = s.user_a_id then s.profile_a else s.profile_b end
      and char_length(p_payload ->> 'body') between 1 and 500
      and md5(p_payload ->> 'body') = l.last_body_hash
      and (p_payload ->> 'body') !~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m[0-9]{10,}\M|(?:instagram|snapchat|phone|number)\s*[:=])'
  );
$$;

revoke all on function public.random_chat_can_access_topic(text) from public, anon;
revoke all on function public.random_chat_can_send(text, text, jsonb) from public, anon;
grant execute on function public.random_chat_can_access_topic(text) to authenticated;
grant execute on function public.random_chat_can_send(text, text, jsonb) to authenticated;

drop policy if exists realtime_user_moderation on realtime.messages;
create policy realtime_user_moderation on realtime.messages for select to authenticated
  using (extension = 'broadcast' and (
    topic = 'user:' || (select auth.uid())::text
    or (select public.random_chat_can_access_topic(topic))
  ));
drop policy if exists random_chat_broadcast_member_send on realtime.messages;
create policy random_chat_broadcast_member_send on realtime.messages for insert to authenticated
  with check (extension = 'broadcast' and (select public.random_chat_can_send(topic, event, payload)));
drop policy if exists random_chat_presence_member_read on realtime.messages;
create policy random_chat_presence_member_read on realtime.messages for select to authenticated
  using (extension = 'presence' and (select public.random_chat_can_access_topic(topic)));
drop policy if exists random_chat_presence_member_write on realtime.messages;
create policy random_chat_presence_member_write on realtime.messages for insert to authenticated
  with check (extension = 'presence' and (select public.random_chat_can_access_topic(topic)));

drop policy if exists random_messages_member_insert on public.random_chat_messages;
revoke insert on public.random_chat_messages from anon, authenticated;
drop trigger if exists random_chat_message_broadcast on public.random_chat_messages;
drop function if exists private.broadcast_random_message();

create or replace function public.random_chat_current()
returns table(state text, session_id uuid, session_key uuid, partner jsonb, messages jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); active public.random_chat_sessions%rowtype; idx integer;
begin
  if me is null or not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  select s.* into active from public.random_chat_sessions s
    where s.status = 'ACTIVE' and me in (s.user_a_id, s.user_b_id) limit 1;
  if found then
    idx := case when active.user_a_id = me then 1 else 2 end;
    return query select 'matched'::text, active.id, active.session_key,
      case when idx = 1 then active.profile_b else active.profile_a end,
      '[]'::jsonb;
    return;
  end if;
  if exists(select 1 from public.random_chat_queue q where q.user_id = me and q.status = 'WAITING' and q.expires_at > now()) then
    return query select 'searching'::text, null::uuid, null::uuid, null::jsonb, '[]'::jsonb;
  else
    return query select 'idle'::text, null::uuid, null::uuid, null::jsonb, '[]'::jsonb;
  end if;
end;
$$;

drop function public.random_chat_send(uuid, text);
create function public.random_chat_send(p_session_key uuid,p_body text)
returns table(body text,sender_id uuid,sender_profile jsonb,created_at timestamptz,broadcast_ticket uuid)
language plpgsql security definer set search_path = '' as $$
declare me uuid:=auth.uid(); room public.random_chat_sessions%rowtype; clean_body text:=btrim(p_body);
  limiter private.random_chat_limits%rowtype; body_hash text:=md5(btrim(p_body));
  sent_at timestamptz:=clock_timestamp(); ticket uuid:=gen_random_uuid(); profile jsonb;
begin
  if me is null or not public.is_active_member() then raise exception 'active account required' using errcode='42501'; end if;
  if char_length(clean_body) not between 1 and 500 then raise exception 'message must be 1 to 500 characters' using errcode='22023'; end if;
  if clean_body ~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m[0-9]{10,}\M|(?:instagram|snapchat|phone|number)\s*[:=])' then
    raise exception 'please keep personal contact information out of Random Chat' using errcode='22023';
  end if;
  select * into room from public.random_chat_sessions s where s.session_key=p_session_key and s.status='ACTIVE' and me in(s.user_a_id,s.user_b_id);
  if not found then raise exception 'this chat has ended' using errcode='P0002'; end if;
  profile:=case when me=room.user_a_id then room.profile_a else room.profile_b end;
  insert into private.random_chat_limits(user_id,window_started_at,message_count,last_body_hash,last_sent_at,last_broadcast_ticket,last_session_key)
    values(me,sent_at,1,body_hash,sent_at,ticket,p_session_key) on conflict(user_id) do nothing;
  select * into limiter from private.random_chat_limits where user_id=me for update;
  if limiter.window_started_at<sent_at-interval '1 minute' then
    update private.random_chat_limits set window_started_at=sent_at,message_count=1,last_body_hash=body_hash,
      last_sent_at=sent_at,last_broadcast_ticket=ticket,last_session_key=p_session_key where user_id=me;
  elsif limiter.message_count>=20 then raise exception 'slow down before sending another message' using errcode='P0001';
  elsif limiter.last_body_hash=body_hash and limiter.last_sent_at>sent_at-interval '2 seconds' then
    raise exception 'please wait before repeating a message' using errcode='P0001';
  else update private.random_chat_limits set message_count=message_count+1,last_body_hash=body_hash,
    last_sent_at=sent_at,last_broadcast_ticket=ticket,last_session_key=p_session_key where user_id=me;
  end if;
  return query select clean_body,me,profile,sent_at,ticket;
end;
$$;
revoke all on function public.random_chat_send(uuid, text) from public, anon;
grant execute on function public.random_chat_send(uuid, text) to authenticated;

create or replace function public.random_chat_end(p_session_key uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid:=auth.uid(); room public.random_chat_sessions%rowtype;
begin
  update public.random_chat_sessions s set status='ENDED',ended_at=now(),
    expires_at=case when s.moderation_hold then null else now()+interval '30 days' end
  where s.session_key=p_session_key and s.status='ACTIVE' and me in(s.user_a_id,s.user_b_id)
  returning * into room;
  if not found then return false; end if;
  delete from public.random_chat_messages where session_id=room.id;
  update private.random_chat_limits set last_body_hash=null,last_sent_at=null,
    last_broadcast_ticket=null,last_session_key=null
    where user_id in(room.user_a_id,room.user_b_id);
  delete from public.random_chat_queue where user_id in(room.user_a_id,room.user_b_id);
  perform realtime.send(jsonb_build_object('session_key',room.session_key,'reason','ended'),'random:ended','user:'||room.user_a_id::text,true);
  perform realtime.send(jsonb_build_object('session_key',room.session_key,'reason','ended'),'random:ended','user:'||room.user_b_id::text,true);
  return true;
end;
$$;

-- Remove transcripts written by the previous database-backed chat version.
delete from public.random_chat_messages;
update private.random_chat_limits set last_body_hash=null,last_sent_at=null,
  last_broadcast_ticket=null,last_session_key=null;
notify pgrst, 'reload schema';
