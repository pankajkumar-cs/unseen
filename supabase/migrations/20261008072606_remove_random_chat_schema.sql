-- Remove the random chat feature and all of its server-side storage/API.
-- Existing random chat sessions, queue entries, reports, and message rows are deleted.

drop policy if exists random_chat_broadcast_member_send on realtime.messages;
drop policy if exists random_chat_presence_member_read on realtime.messages;
drop policy if exists random_chat_presence_member_write on realtime.messages;

alter policy realtime_user_moderation on realtime.messages
  using (
    extension = 'broadcast'
    and topic = 'user:'::text || (select auth.uid())::text
  );

create or replace function public.delete_expired_content()
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  affected bigint := 0;
  changed bigint;
begin
  delete from public.posts where expires_at <= now();
  get diagnostics changed = row_count;
  affected := affected + changed;

  delete from public.polls where expires_at <= now();
  get diagnostics changed = row_count;
  affected := affected + changed;

  delete from public.crushes where expires_at <= now();
  get diagnostics changed = row_count;
  affected := affected + changed;

  return affected;
end;
$function$;

drop function if exists public.random_chat_block(uuid);
drop function if exists public.random_chat_can_access_topic(text);
drop function if exists public.random_chat_can_send(text, text, jsonb);
drop function if exists public.random_chat_cancel();
drop function if exists public.random_chat_current();
drop function if exists public.random_chat_end(uuid);
drop function if exists public.random_chat_heartbeat();
drop function if exists public.random_chat_report(uuid, text, text);
drop function if exists public.random_chat_send(uuid, text, uuid);
drop function if exists public.random_chat_start();

drop table if exists
  public.random_chat_queue_exclusions,
  public.random_chat_reports,
  public.random_chat_blocks,
  public.random_chat_messages,
  public.random_chat_queue,
  public.random_chat_sessions,
  private.random_chat_limits
cascade;

drop type if exists public.random_chat_status cascade;
drop type if exists public.random_chat_report_status cascade;

notify pgrst, 'reload schema';
