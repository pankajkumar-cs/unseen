-- Keep anonymous display names recognizable while guaranteeing they never repeat.
-- Serialize name allocation and enforce uniqueness in the database so concurrent
-- signups cannot choose the same name.
lock table public.anonymous_identities in access exclusive mode;

create sequence if not exists private.anonymous_identity_name_suffix_seq
  as bigint start with 1000 increment by 1 minvalue 1000;

create or replace function private.generate_unique_anonymous_identity()
returns table(display_name text, emoji text, color text)
language plpgsql security definer set search_path = '' as $$
declare
  animal_names text[] := array['Panda','Owl','Fox','Frog','Tiger','Peacock','Wolf','Cat'];
  animal_emojis text[] := array['🐼','🦉','🦊','🐸','🐯','🦚','🐺','🐱'];
  animal_colors text[] := array['#FEF3C7','#EDE9FE','#FFEDD5','#DCFCE7','#FFEDD5','#CCFBF1','#E0E7FF','#FCE7F3'];
  identity_index integer;
  candidate text;
  attempt integer;
begin
  -- The unique index below is the final guard; this lock prevents normal signups
  -- from racing between checking a candidate and inserting it.
  perform pg_catalog.pg_advisory_xact_lock(741623814124::bigint);

  for attempt in 1..7200 loop
    identity_index := pg_catalog.floor(pg_catalog.random() * pg_catalog.array_length(animal_names, 1))::integer + 1;
    candidate := 'Anonymous ' || animal_names[identity_index] || ' #' ||
      (100 + pg_catalog.floor(pg_catalog.random() * 900)::integer)::text;
    if not exists (
      select 1 from public.anonymous_identities i
      where pg_catalog.lower(pg_catalog.btrim(i.display_name)) = pg_catalog.lower(pg_catalog.btrim(candidate))
    ) then
      return query select candidate, animal_emojis[identity_index], animal_colors[identity_index];
      return;
    end if;
  end loop;

  -- If all short animal/number combinations are occupied, grow the number
  -- instead of repeating a name or blocking account creation.
  identity_index := pg_catalog.floor(pg_catalog.random() * pg_catalog.array_length(animal_names, 1))::integer + 1;
  loop
    candidate := 'Anonymous ' || animal_names[identity_index] || ' #' ||
      pg_catalog.nextval('private.anonymous_identity_name_suffix_seq'::pg_catalog.regclass)::text;
    if not exists (
      select 1 from public.anonymous_identities i
      where pg_catalog.lower(pg_catalog.btrim(i.display_name)) = pg_catalog.lower(pg_catalog.btrim(candidate))
    ) then
      return query select candidate, animal_emojis[identity_index], animal_colors[identity_index];
      return;
    end if;
  end loop;
end;
$$;
revoke all on function private.generate_unique_anonymous_identity() from public, anon, authenticated, service_role;

-- If older data already contains duplicate names, keep the oldest and rename
-- the others before adding the unique index.
do $$
declare
  duplicate_identity record;
  replacement record;
begin
  for duplicate_identity in
    select identity_id from (
      select i.id as identity_id,
        pg_catalog.row_number() over (
          partition by pg_catalog.lower(pg_catalog.btrim(i.display_name))
          order by i.created_at, i.id
        ) as name_order
      from public.anonymous_identities i
    ) ranked
    where name_order > 1
    order by identity_id
  loop
    select * into replacement from private.generate_unique_anonymous_identity();
    update public.anonymous_identities
      set display_name = replacement.display_name,
          emoji = replacement.emoji,
          color = replacement.color
      where id = duplicate_identity.identity_id;
  end loop;
end;
$$;

create unique index if not exists anonymous_identities_display_name_unique_idx
  on public.anonymous_identities (pg_catalog.lower(pg_catalog.btrim(display_name)));

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
  generated_identity record;
begin
  if p_username <> lower(trim(p_username)) or p_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username' using errcode = '22023';
  end if;

  select i.id into claimed_invitation_id
    from public.invitation_codes as i
    where i.status = 'UNUSED'
      and i.digest_algorithm = 'sha256'
      and i.code_digest = p_code_digest
    for update;
  if claimed_invitation_id is null then
    raise exception 'invalid or used invitation' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(741623814123::bigint);
  select exists (select 1 from public.profiles) into already_has_profile;

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

  select * into generated_identity from private.generate_unique_anonymous_identity();
  insert into public.anonymous_identities(user_id, legacy_ghost_id, display_name, emoji, color)
    values (p_user_id, p_ghost_id, generated_identity.display_name, generated_identity.emoji, generated_identity.color);

  return query select p_username, generated_identity.display_name, generated_identity.emoji,
    generated_identity.color, p_ghost_id;
end;
$$;
revoke all on function public.claim_invited_account(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_invited_account(uuid, text, text, text, text, text, text) to service_role;

create or replace function public.ensure_anonymous_identity()
returns table(display_name text, emoji text, color text, ghost_id text)
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  current_identity public.anonymous_identities%rowtype;
  generated_identity record;
begin
  if current_user_id is null or (not public.is_active_member()
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)) then
    raise exception 'active account required' using errcode = '42501';
  end if;

  select * into current_identity
    from public.anonymous_identities i
    where i.user_id = current_user_id;
  if not found then
    select * into generated_identity from private.generate_unique_anonymous_identity();
    insert into public.anonymous_identities(user_id, display_name, emoji, color)
      values (current_user_id, generated_identity.display_name, generated_identity.emoji, generated_identity.color)
      returning * into current_identity;
  end if;

  return query select current_identity.display_name, current_identity.emoji,
    current_identity.color, current_identity.legacy_ghost_id;
end;
$$;
revoke all on function public.ensure_anonymous_identity() from public, anon;
grant execute on function public.ensure_anonymous_identity() to authenticated;

notify pgrst, 'reload schema';
