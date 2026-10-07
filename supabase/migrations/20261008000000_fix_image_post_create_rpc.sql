-- Qualify media columns because create_post exposes a public_id OUT column.
-- Without the table qualifier, PostgreSQL treats public_id in the UPDATE as
-- ambiguous when an image is attached to a post.
create or replace function public.create_post(
  p_category public.post_category,
  p_body text,
  p_location text default null,
  p_branch text default null,
  p_media_public_id uuid default null
)
returns table(public_id uuid, usage_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  current_identity public.anonymous_identities%rowtype;
  new_public_id uuid := gen_random_uuid();
  usage integer;
begin
  if current_user_id is null or not public.is_active_member() then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if char_length(trim(p_body)) not between 1 and 500 then
    raise exception 'post text must be 1 to 500 characters' using errcode = '22023';
  end if;

  select * into current_identity
  from public.anonymous_identities
  where user_id = current_user_id;
  if not found then
    raise exception 'anonymous identity is unavailable' using errcode = '23503';
  end if;

  insert into public.daily_post_usage(user_id, usage_day, post_count)
  values (current_user_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, usage_day) do update
    set post_count = public.daily_post_usage.post_count + 1,
        updated_at = now()
    where public.daily_post_usage.post_count < 5
  returning post_count into usage;
  if usage is null then
    raise exception 'daily post limit reached' using errcode = 'P0001';
  end if;

  insert into public.posts(
    public_id, owner_user_id, identity_id, author_name, author_emoji,
    author_color, category, body, location, branch
  )
  values (
    new_public_id, current_user_id, current_identity.id,
    current_identity.display_name, current_identity.emoji, current_identity.color,
    p_category, trim(p_body), nullif(trim(p_location), ''), nullif(trim(p_branch), '')
  );

  if p_media_public_id is not null then
    update public.media as media_row
    set post_public_id = new_public_id
    where media_row.public_id = p_media_public_id
      and media_row.owner_user_id = current_user_id
      and media_row.post_public_id is null;
    if not found then
      raise exception 'image upload is unavailable' using errcode = '42501';
    end if;
  end if;

  return query select new_public_id, usage;
end;
$$;
