begin;

create or replace function public.claim_invited_account(
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
  updated_invitation_id uuid;
  already_has_profile boolean;
begin
  if p_username <> lower(trim(p_username)) or p_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username' using errcode = '22023';
  end if;

  -- Lock the invitation before any writes so concurrent claims cannot reuse it.
  select i.id into claimed_invitation_id
    from public.invitation_codes as i
    where i.status = 'UNUSED'
      and i.digest_algorithm = 'sha256'
      and i.code_digest = p_code_digest
    for update;
  if claimed_invitation_id is null then
    raise exception 'invalid or used invitation' using errcode = 'P0001';
  end if;

  -- Serialize first-account creation so exactly one invite can bootstrap admin.
  perform pg_catalog.pg_advisory_xact_lock(741623814123::bigint);
  select exists (select 1 from public.profiles) into already_has_profile;

  -- claimed_by references profiles, so insert the profile before updating the invite.
  insert into public.profiles(id, username, role)
    values (
      p_user_id,
      p_username,
      case when already_has_profile then 'USER'::public.account_role else 'ADMIN'::public.account_role end
    );

  update public.invitation_codes as i
    set status = 'CLAIMED', claimed_by = p_user_id, claimed_at = now()
    where i.id = claimed_invitation_id and i.status = 'UNUSED'
    returning i.id into updated_invitation_id;
  if updated_invitation_id is null then
    raise exception 'invalid or used invitation' using errcode = 'P0001';
  end if;

  insert into public.anonymous_identities(user_id, legacy_ghost_id, display_name, emoji, color)
    values (p_user_id, p_ghost_id, p_display_name, p_emoji, p_color);

  return query select p_username, p_display_name, p_emoji, p_color, p_ghost_id;
end;
$$;

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
