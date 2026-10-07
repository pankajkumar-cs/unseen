-- Send private, payload-free invalidations so every open admin dashboard can
-- refresh sensitive lists without exposing their contents to the public feed.
create or replace function public.broadcast_admin_dashboard_refresh()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare admin_row record;
begin
  for admin_row in
    select p.id from public.profiles p
    where p.role = 'ADMIN' and p.moderation_status = 'ACTIVE'
  loop
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'operation', tg_op),
      'admin:refresh', 'admin:' || admin_row.id::text, true
    );
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.broadcast_admin_dashboard_refresh() from public, anon, authenticated;

drop trigger if exists admin_dashboard_profiles_refresh on public.profiles;
create trigger admin_dashboard_profiles_refresh after insert or update or delete on public.profiles
for each row execute function public.broadcast_admin_dashboard_refresh();

drop trigger if exists admin_dashboard_reports_refresh on public.reports;
create trigger admin_dashboard_reports_refresh after insert or update or delete on public.reports
for each row execute function public.broadcast_admin_dashboard_refresh();

drop trigger if exists admin_dashboard_chat_reports_refresh on public.random_chat_reports;
create trigger admin_dashboard_chat_reports_refresh after insert or update or delete on public.random_chat_reports
for each row execute function public.broadcast_admin_dashboard_refresh();

drop trigger if exists admin_dashboard_sessions_refresh on public.random_chat_sessions;
create trigger admin_dashboard_sessions_refresh after insert or update or delete on public.random_chat_sessions
for each row execute function public.broadcast_admin_dashboard_refresh();

drop trigger if exists admin_dashboard_queue_refresh on public.random_chat_queue;
create trigger admin_dashboard_queue_refresh after insert or delete on public.random_chat_queue
for each row execute function public.broadcast_admin_dashboard_refresh();
drop trigger if exists admin_dashboard_queue_status_refresh on public.random_chat_queue;
create trigger admin_dashboard_queue_status_refresh after update of status, expires_at on public.random_chat_queue
for each row execute function public.broadcast_admin_dashboard_refresh();

drop trigger if exists admin_dashboard_invitations_refresh on public.invitation_codes;
create trigger admin_dashboard_invitations_refresh after insert or update or delete on public.invitation_codes
for each row execute function public.broadcast_admin_dashboard_refresh();

drop trigger if exists admin_dashboard_media_refresh on public.media;
create trigger admin_dashboard_media_refresh after insert or update or delete on public.media
for each row execute function public.broadcast_admin_dashboard_refresh();
