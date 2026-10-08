-- Remove the retired Secret Mailbox feature while preserving other campus data.
-- Dropping this table permanently deletes any remaining mailbox notes.

-- The scheduled/general expiry routine must no longer reference mailbox storage.
create or replace function public.delete_expired_content()
returns bigint language plpgsql security definer set search_path = '' as $$
declare affected bigint := 0; changed bigint;
begin
  delete from public.posts where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.polls where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.crushes where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.random_chat_messages where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.random_chat_queue where expires_at <= now();
  return affected;
end;
$$;

drop function if exists public.send_mailbox_message(text, text);
drop function if exists public.list_mailbox_messages();
drop function if exists public.open_mailbox_message(uuid);
drop function if exists public.active_ghost_profiles();

drop table if exists public.mailbox_messages;
