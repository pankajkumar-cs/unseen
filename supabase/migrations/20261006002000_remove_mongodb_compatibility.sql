begin;

-- This project is starting with no imported MongoDB records. Remove the
-- private migration maps and password-hash bridge from the active schema.
drop function if exists public.legacy_auth_record(text);
drop function if exists public.legacy_import_target(text, text);
drop function if exists public.legacy_import_targets(text, text[]);
drop function if exists public.record_legacy_import(text, text, uuid);
drop function if exists public.record_legacy_password(uuid, text, text);
drop function if exists public.clear_legacy_auth_record(uuid);
drop table if exists private.legacy_auth_credentials;
drop table if exists private.legacy_import_map;

alter table public.invitation_codes
  drop constraint if exists invitation_codes_digest_algorithm_check;
alter table public.invitation_codes
  add constraint invitation_codes_digest_algorithm_check check (digest_algorithm = 'sha256');

drop function if exists public.claim_invited_account(uuid, text, text, text, text, text, text, text);

create function public.claim_invited_account(
  p_user_id uuid,
  p_username text,
  p_code_digest text,
  p_display_name text,
  p_emoji text,
  p_color text,
  p_ghost_id text
)
returns table(username text, display_name text, emoji text, color text, ghost_id text)
language plpgsql security definer set search_path = '' as $$
declare
  claimed_invitation_id uuid;
  already_has_profile boolean;
begin
  if p_username <> lower(trim(p_username)) or p_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username' using errcode = '22023';
  end if;

  update public.invitation_codes i
    set status = 'CLAIMED', claimed_by = p_user_id, claimed_at = now()
    where i.status = 'UNUSED'
      and i.digest_algorithm = 'sha256'
      and i.code_digest = p_code_digest
    returning i.id into claimed_invitation_id;
  if claimed_invitation_id is null then
    raise exception 'invalid or used invitation' using errcode = 'P0001';
  end if;

  -- Serialize first-account creation so exactly one invite can bootstrap admin.
  perform pg_catalog.pg_advisory_xact_lock(741623814123::bigint);
  select exists (select 1 from public.profiles) into already_has_profile;
  insert into public.profiles(id, username, role)
    values (
      p_user_id,
      p_username,
      case when already_has_profile then 'USER'::public.account_role else 'ADMIN'::public.account_role end
    );
  insert into public.anonymous_identities(user_id, legacy_ghost_id, display_name, emoji, color)
    values (p_user_id, p_ghost_id, p_display_name, p_emoji, p_color);

  return query select p_username, p_display_name, p_emoji, p_color, p_ghost_id;
end;
$$;

revoke all on function public.claim_invited_account(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_invited_account(uuid, text, text, text, text, text, text)
  to service_role;

commit;
