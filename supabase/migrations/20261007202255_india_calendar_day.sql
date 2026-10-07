create or replace function public.create_post(
  p_category public.post_category,
  p_body text,
  p_location text default null,
  p_branch text default null,
  p_media_public_id uuid default null
)
returns table(public_id uuid, usage_count integer)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_identity public.anonymous_identities%rowtype;
  new_public_id uuid := gen_random_uuid(); usage integer;
begin
  if current_user_id is null or not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  if char_length(trim(p_body)) not between 1 and 500 then raise exception 'post text must be 1 to 500 characters' using errcode = '22023'; end if;
  select * into current_identity from public.anonymous_identities where user_id = current_user_id;
  if not found then raise exception 'anonymous identity is unavailable' using errcode = '23503'; end if;
  insert into public.daily_post_usage(user_id, usage_day, post_count)
  values (current_user_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, usage_day) do update set post_count = public.daily_post_usage.post_count + 1, updated_at = now()
  where public.daily_post_usage.post_count < 5
  returning post_count into usage;
  if usage is null then raise exception 'daily post limit reached' using errcode = 'P0001'; end if;
  insert into public.posts(public_id, owner_user_id, identity_id, author_name, author_emoji, author_color,
    category, body, location, branch)
  values (new_public_id, current_user_id, current_identity.id, current_identity.display_name,
    current_identity.emoji, current_identity.color, p_category, trim(p_body), nullif(trim(p_location), ''), nullif(trim(p_branch), ''));
  if p_media_public_id is not null then
    update public.media set post_public_id = new_public_id
    where public_id = p_media_public_id and owner_user_id = current_user_id and post_public_id is null;
    if not found then raise exception 'image upload is unavailable' using errcode = '42501'; end if;
  end if;
  return query select new_public_id, usage;
end;
$$;

create or replace function public.create_poll(p_question text, p_tag text, p_options jsonb)
returns table(public_id uuid, usage_count integer)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_identity public.anonymous_identities%rowtype;
  new_public_id uuid := gen_random_uuid(); usage integer; option_count integer;
begin
  if current_user_id is null or not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  if char_length(trim(p_question)) not between 8 and 200 or char_length(coalesce(p_tag, '')) > 40 then raise exception 'invalid poll text' using errcode = '22023'; end if;
  if jsonb_typeof(p_options) <> 'array' then raise exception 'options must be an array' using errcode = '22023'; end if;
  option_count := jsonb_array_length(p_options);
  if option_count not between 2 and 6 then raise exception 'polls need 2 to 6 options' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_options) option
    where char_length(trim(coalesce(option->>'label', ''))) not between 1 and 80) then
    raise exception 'poll options must be 1 to 160 characters' using errcode = '22023';
  end if;
  select * into current_identity from public.anonymous_identities where user_id = current_user_id;
  if not found then raise exception 'anonymous identity is unavailable' using errcode = '23503'; end if;
  insert into public.daily_post_usage(user_id, usage_day, post_count)
  values (current_user_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, usage_day) do update set post_count = public.daily_post_usage.post_count + 1, updated_at = now()
  where public.daily_post_usage.post_count < 5
  returning post_count into usage;
  if usage is null then raise exception 'daily post limit reached' using errcode = 'P0001'; end if;
  insert into public.polls(public_id, owner_user_id, identity_id, author_name, author_emoji, author_color, tag, question)
  values (new_public_id, current_user_id, current_identity.id, current_identity.display_name,
    current_identity.emoji, current_identity.color, coalesce(nullif(trim(p_tag), ''), 'Campus'), trim(p_question));
  insert into public.poll_options(poll_public_id, position, label, emoji, color)
  select new_public_id, ordinality::smallint - 1, trim(option->>'label'), nullif(option->>'emoji', ''), nullif(option->>'color', '')
  from jsonb_array_elements(p_options) with ordinality as options(option, ordinality)
  where char_length(trim(coalesce(option->>'label', ''))) between 1 and 80;
  if not found then raise exception 'invalid poll options' using errcode = '22023'; end if;
  return query select new_public_id, usage;
end;
$$;

create or replace function public.create_crush(p_recipient text, p_location text, p_message text)
returns table(public_id uuid, usage_count integer)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_identity public.anonymous_identities%rowtype;
  new_public_id uuid := gen_random_uuid(); usage integer;
begin
  if current_user_id is null or not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  if char_length(trim(p_recipient)) not between 1 and 120 or char_length(coalesce(p_message, '')) > 500 then raise exception 'invalid spotted post' using errcode = '22023'; end if;
  select * into current_identity from public.anonymous_identities where user_id = current_user_id;
  if not found then raise exception 'anonymous identity is unavailable' using errcode = '23503'; end if;
  insert into public.daily_post_usage(user_id, usage_day, post_count)
  values (current_user_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, usage_day) do update set post_count = public.daily_post_usage.post_count + 1, updated_at = now()
  where public.daily_post_usage.post_count < 5
  returning post_count into usage;
  if usage is null then raise exception 'daily post limit reached' using errcode = 'P0001'; end if;
  insert into public.crushes(public_id, owner_user_id, identity_id, author_name, author_emoji, author_color,
    recipient, location, message)
  values (new_public_id, current_user_id, current_identity.id, current_identity.display_name,
    current_identity.emoji, current_identity.color, trim(p_recipient), nullif(trim(p_location), ''), nullif(trim(p_message), ''));
  return query select new_public_id, usage;
end;
$$;

create or replace function public.get_post_usage()
returns table(used integer, daily_limit integer, remaining integer, usage_day date)
language sql stable security definer set search_path = '' as $$
  select coalesce(u.post_count, 0), 5, greatest(0, 5 - coalesce(u.post_count, 0)), (now() at time zone 'Asia/Kolkata')::date
  from (select (select auth.uid()) as user_id) viewer
  left join public.daily_post_usage u on u.user_id = viewer.user_id and u.usage_day = (now() at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.feed_pulse_stats()
returns table(secrets_today bigint, confessions bigint, memes bigint, rants bigint, spotted bigint, total_secrets bigint)
language sql stable security definer set search_path = '' as $$
  with india_day as (
    select (now() at time zone 'Asia/Kolkata')::date as india_date
  ), bounds as (
    select india_date::timestamp at time zone 'Asia/Kolkata' as start_at,
      (india_date + 1)::timestamp at time zone 'Asia/Kolkata' as end_at
    from india_day
  )
  select
    count(*) filter (where p.created_at >= bounds.start_at and p.created_at < bounds.end_at),
    count(*) filter (where p.category = 'Confessions' and p.created_at >= bounds.start_at and p.created_at < bounds.end_at),
    count(*) filter (where p.category = 'Memes' and p.created_at >= bounds.start_at and p.created_at < bounds.end_at),
    count(*) filter (where p.category = 'Rants' and p.created_at >= bounds.start_at and p.created_at < bounds.end_at),
    count(*) filter (where p.category = 'Spotted' and p.created_at >= bounds.start_at and p.created_at < bounds.end_at) +
      (select count(*) from public.crushes c where c.created_at >= bounds.start_at and c.created_at < bounds.end_at and c.expires_at > now()),
    count(*)
  from public.posts p cross join bounds
  where p.status = 'approved' and p.expires_at > now();
$$;
