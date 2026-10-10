begin;

-- The enum value migrations run in separate files so these labels are committed
-- before any constraint or function below references them.
do $$ begin
  create type public.crush_status as enum ('published', 'hidden', 'deleted');
exception when duplicate_object then null; end $$;

-- The reaction RPC below references this field, so add it before defining the RPC.
alter table public.crushes add column status public.crush_status not null default 'published';

-- Anonymous Supabase sessions may browse, but all mutations require a real
-- active campus account. Keep the existing read policies intact.
create or replace function public.set_post_like(p_post_public_id uuid, p_liked boolean)
returns table(liked boolean, likes_count integer)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_profile_id uuid;
begin
  if current_user_id is null or not public.is_active_member() then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts p where p.public_id = p_post_public_id
    and p.status = 'approved' and p.expires_at > now()) then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  select p.id into current_profile_id from public.profiles p where p.id = current_user_id;
  if p_liked then
    insert into public.likes(post_public_id, user_id, actor_key)
    values (p_post_public_id, current_profile_id, current_user_id::text) on conflict do nothing;
  else
    delete from public.likes where post_public_id = p_post_public_id and actor_key = current_user_id::text;
  end if;
  return query select exists (
    select 1 from public.likes l where l.post_public_id = p_post_public_id and l.actor_key = current_user_id::text
  ), p.likes_count from public.posts p where p.public_id = p_post_public_id;
end;
$$;

create or replace function public.set_poll_vote(p_poll_public_id uuid, p_option_id uuid)
returns table(total_votes integer, selected_option_id uuid)
language plpgsql security definer set search_path = '' as $$
declare current_actor_id uuid := auth.uid();
begin
  if current_actor_id is null or not public.is_active_member() then
    raise exception 'active account required to vote' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.polls p where p.public_id = p_poll_public_id
      and p.status = 'published' and p.expires_at > now()
  ) then
    raise exception 'poll not found' using errcode = 'P0002';
  end if;
  insert into public.poll_votes(poll_public_id, option_id, actor_id, actor_key)
  select p_poll_public_id, p_option_id, current_actor_id, current_actor_id::text
  where exists (select 1 from public.poll_options o where o.id = p_option_id and o.poll_public_id = p_poll_public_id)
  on conflict (poll_public_id, actor_key) do nothing;
  if not found then
    if not exists (select 1 from public.poll_options o where o.id = p_option_id and o.poll_public_id = p_poll_public_id) then
      raise exception 'poll option not found' using errcode = '23503';
    end if;
    raise exception 'already voted' using errcode = '23505';
  end if;
  return query select p.total_votes, v.option_id from public.polls p
    join public.poll_votes v on v.poll_public_id = p.public_id and v.actor_key = current_actor_id::text
    where p.public_id = p_poll_public_id;
end;
$$;

create or replace function public.increment_crush_reaction(p_crush_public_id uuid, p_kind text)
returns table(ships integer, blushes integer)
language plpgsql security definer set search_path = '' as $$
declare current_actor_id uuid := auth.uid();
begin
  if current_actor_id is null or not public.is_active_member() then
    raise exception 'active account required to react' using errcode = '42501';
  end if;
  if p_kind not in ('ship', 'blush') then raise exception 'invalid reaction' using errcode = '22023'; end if;
  if not exists (select 1 from public.crushes c where c.public_id = p_crush_public_id
    and c.status = 'published' and c.expires_at > now()) then
    raise exception 'spotted post not found' using errcode = 'P0002';
  end if;
  insert into public.crush_reactions(crush_public_id, actor_id, kind)
  values (p_crush_public_id, current_actor_id, p_kind) on conflict do nothing;
  return query select c.ships_count, c.blushes_count from public.crushes c where c.public_id = p_crush_public_id;
end;
$$;

-- Make the RPC checks authoritative even if a client calls the tables directly.
drop policy if exists comments_delete_owner on public.comments;
create policy comments_delete_owner on public.comments for delete to authenticated
  using (actor_id = (select auth.uid()) and (select public.is_active_member()));

drop policy if exists likes_insert_owner on public.likes;
drop policy if exists likes_delete_owner on public.likes;
create policy likes_insert_owner on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_active_member()) and public.is_public_post(post_public_id));
create policy likes_delete_owner on public.likes for delete to authenticated
  using (user_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_active_member()));

drop policy if exists poll_votes_select_own on public.poll_votes;
drop policy if exists poll_votes_insert_own on public.poll_votes;
drop policy if exists poll_votes_delete_own on public.poll_votes;
create policy poll_votes_select_own on public.poll_votes for select to authenticated
  using (actor_id = (select auth.uid()) or (select public.is_admin()));
create policy poll_votes_insert_own on public.poll_votes for insert to authenticated
  with check (actor_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_active_member()) and public.is_public_poll(poll_public_id));
create policy poll_votes_delete_own on public.poll_votes for delete to authenticated
  using (actor_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_active_member()));

drop policy if exists crush_reactions_select_own on public.crush_reactions;
drop policy if exists crush_reactions_insert_own on public.crush_reactions;
drop policy if exists crush_reactions_delete_own on public.crush_reactions;
create policy crush_reactions_select_own on public.crush_reactions for select to authenticated
  using (actor_id = (select auth.uid()));
create policy crush_reactions_insert_own on public.crush_reactions for insert to authenticated
  with check (actor_id = (select auth.uid()) and (select public.is_active_member()));
create policy crush_reactions_delete_own on public.crush_reactions for delete to authenticated
  using (actor_id = (select auth.uid()) and (select public.is_active_member()));

-- Report targets are exclusive. Existing post/comment/account reports keep their
-- meaning while poll and spotted reports gain their own public IDs.
alter table public.reports
  add column poll_public_id uuid references public.polls(public_id) on delete cascade,
  add column crush_public_id uuid references public.crushes(public_id) on delete cascade;
alter table public.reports drop constraint if exists reports_check;
alter table public.reports drop constraint if exists reports_target_shape_check;
alter table public.reports add constraint reports_target_shape_check check (
  (target_type = 'post' and post_public_id is not null and comment_id is null and reported_user_id is null
    and poll_public_id is null and crush_public_id is null) or
  (target_type = 'comment' and post_public_id is not null and comment_id is not null and reported_user_id is null
    and poll_public_id is null and crush_public_id is null) or
  (target_type = 'account' and post_public_id is not null and comment_id is null and reported_user_id is not null
    and poll_public_id is null and crush_public_id is null) or
  (target_type = 'poll' and post_public_id is null and comment_id is null and reported_user_id is null
    and poll_public_id is not null and crush_public_id is null) or
  (target_type = 'crush' and post_public_id is null and comment_id is null and reported_user_id is null
    and poll_public_id is null and crush_public_id is not null)
);
drop index if exists public.reports_actor_target_idx;
create unique index reports_actor_target_idx on public.reports
  (reporter_auth_id, target_type,
   coalesce(post_public_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(reported_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(poll_public_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(crush_public_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where reporter_auth_id is not null;

drop policy if exists reports_insert_valid_target on public.reports;
create policy reports_insert_valid_target on public.reports for insert to authenticated
  with check (reporter_user_id = (select auth.uid()) and reporter_auth_id = (select auth.uid())
    and (select public.is_active_member()) and (
      (target_type = 'post' and exists (select 1 from public.posts p where p.public_id = post_public_id
        and p.status = 'approved' and p.expires_at > now())) or
      (target_type = 'comment' and exists (select 1 from public.comments c join public.posts p on p.public_id = c.post_public_id
        where c.id = comment_id and c.post_public_id = reports.post_public_id and c.status = 'approved'
          and p.status = 'approved' and p.expires_at > now())) or
      (target_type = 'account' and reported_user_id is not null and exists (
        select 1 from public.posts p where p.public_id = post_public_id and p.owner_user_id = reported_user_id
          and p.status = 'approved' and p.expires_at > now())) or
      (target_type = 'poll' and exists (select 1 from public.polls p where p.public_id = poll_public_id
        and p.status = 'published' and p.expires_at > now())) or
      (target_type = 'crush' and exists (select 1 from public.crushes c where c.public_id = crush_public_id
        and c.status = 'published' and c.expires_at > now()))
    ));

create or replace function public.submit_report(
  p_post_public_id uuid,
  p_target_type public.report_target_type,
  p_comment_public_id uuid,
  p_poll_public_id uuid,
  p_crush_public_id uuid,
  p_reason text,
  p_detail text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_profile_id uuid;
  target_comment public.comments%rowtype;
  target_post public.posts%rowtype;
  target_poll public.polls%rowtype;
  target_crush public.crushes%rowtype;
  target_account_id uuid;
  new_report_id uuid := gen_random_uuid();
  target_post_id uuid;
  target_comment_id uuid;
  target_poll_id uuid;
  target_crush_id uuid;
begin
  if actor_id is null or not public.is_active_member() then
    raise exception 'active account required to report' using errcode = '42501';
  end if;
  if p_reason not in ('Harassment / Bullying', 'Spam / Irrelevant', 'Personal Info (Doxxing)', 'Harassment',
    'Bullying', 'Hate / abusive content', 'Sexual content', 'Threat', 'Personal information', 'Impersonation', 'Other') then
    raise exception 'invalid report reason' using errcode = '22023';
  end if;
  if (select count(*) from public.reports r where r.reporter_auth_id = actor_id
      and r.created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'report limit reached' using errcode = 'P0001';
  end if;
  select p.id into actor_profile_id from public.profiles p where p.id = actor_id;

  if p_target_type = 'post' then
    select * into target_post from public.posts p where p.public_id = p_post_public_id
      and p.status = 'approved' and p.expires_at > now();
    if not found then raise exception 'post not found' using errcode = 'P0002'; end if;
    target_post_id := target_post.public_id;
  elsif p_target_type = 'comment' then
    select c.* into target_comment from public.comments c join public.posts p on p.public_id = c.post_public_id
      where c.public_id = p_comment_public_id and c.post_public_id = p_post_public_id
        and c.status = 'approved' and p.status = 'approved' and p.expires_at > now();
    if not found then raise exception 'comment not found' using errcode = 'P0002'; end if;
    target_post_id := target_comment.post_public_id;
    target_comment_id := target_comment.id;
  elsif p_target_type = 'account' then
    select * into target_post from public.posts p where p.public_id = p_post_public_id
      and p.status = 'approved' and p.expires_at > now();
    if not found then raise exception 'post not found' using errcode = 'P0002'; end if;
    target_account_id := target_post.owner_user_id;
    if target_account_id is null then raise exception 'account is not available to report' using errcode = 'P0002'; end if;
    target_post_id := target_post.public_id;
  elsif p_target_type = 'poll' then
    select * into target_poll from public.polls p where p.public_id = p_poll_public_id
      and p.status = 'published' and p.expires_at > now();
    if not found then raise exception 'poll not found' using errcode = 'P0002'; end if;
    target_poll_id := target_poll.public_id;
  elsif p_target_type = 'crush' then
    select * into target_crush from public.crushes c where c.public_id = p_crush_public_id
      and c.status = 'published' and c.expires_at > now();
    if not found then raise exception 'spotted post not found' using errcode = 'P0002'; end if;
    target_crush_id := target_crush.public_id;
  else
    raise exception 'invalid report target' using errcode = '22023';
  end if;

  if exists (select 1 from public.reports r where r.reporter_auth_id = actor_id
    and r.target_type = p_target_type
    and r.post_public_id is not distinct from target_post_id
    and r.comment_id is not distinct from target_comment_id
    and r.reported_user_id is not distinct from target_account_id
    and r.poll_public_id is not distinct from target_poll_id
    and r.crush_public_id is not distinct from target_crush_id) then
    raise exception 'report already exists' using errcode = '23505';
  end if;

  insert into public.reports(id, target_type, post_public_id, comment_id, reported_user_id,
    poll_public_id, crush_public_id, reporter_user_id, reporter_auth_id, reason, detail)
  values (new_report_id, p_target_type, target_post_id, target_comment_id, target_account_id,
    target_poll_id, target_crush_id, actor_profile_id, actor_id, p_reason, left(coalesce(p_detail, ''), 1000));
  return new_report_id;
end;
$$;

-- Keep the old RPC signature working until all deployed clients send the new
-- poll/crush arguments. It delegates to the same authenticated implementation.
create or replace function public.submit_report(
  p_post_public_id uuid,
  p_target_type public.report_target_type,
  p_comment_public_id uuid,
  p_reason text,
  p_detail text default null
)
returns uuid language sql security definer set search_path = '' as $$
  select public.submit_report(p_post_public_id, p_target_type, p_comment_public_id, null, null, p_reason, p_detail);
$$;

-- Input constraints cover direct writes, while the RPC checks give callers a
-- clear validation error before a row is inserted.
alter table public.posts add constraint posts_location_length_check
  check (location is null or char_length(location) <= 60);
alter table public.posts add constraint posts_branch_length_check
  check (branch is null or char_length(branch) <= 60);
alter table public.crushes add constraint crushes_location_length_check
  check (location is null or char_length(location) <= 120);
create index crushes_status_feed_idx on public.crushes (status, created_at desc, public_id desc)
  where status = 'published';

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
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 500 then
    raise exception 'post text must be 1 to 500 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_location, '')) > 60 then
    raise exception 'location must be 60 characters or fewer' using errcode = '22023';
  end if;
  if char_length(coalesce(p_branch, '')) > 60 then
    raise exception 'branch must be 60 characters or fewer' using errcode = '22023';
  end if;

  select * into current_identity from public.anonymous_identities where user_id = current_user_id;
  if not found then raise exception 'anonymous identity is unavailable' using errcode = '23503'; end if;
  insert into public.daily_post_usage(user_id, usage_day, post_count)
  values (current_user_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, usage_day) do update
    set post_count = public.daily_post_usage.post_count + 1, updated_at = now()
    where public.daily_post_usage.post_count < 5
  returning post_count into usage;
  if usage is null then raise exception 'daily post limit reached' using errcode = 'P0001'; end if;

  insert into public.posts(public_id, owner_user_id, identity_id, author_name, author_emoji, author_color,
    category, body, location, branch)
  values (new_public_id, current_user_id, current_identity.id, current_identity.display_name,
    current_identity.emoji, current_identity.color, p_category, trim(p_body),
    nullif(trim(p_location), ''), nullif(trim(p_branch), ''));

  if p_media_public_id is not null then
    update public.media as media_row set post_public_id = new_public_id
    where media_row.public_id = p_media_public_id and media_row.owner_user_id = current_user_id
      and media_row.post_public_id is null;
    if not found then raise exception 'image upload is unavailable' using errcode = '42501'; end if;
  end if;
  return query select new_public_id, usage;
end;
$$;

create or replace function public.create_crush(p_recipient text, p_location text, p_message text)
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
  if char_length(trim(coalesce(p_recipient, ''))) not between 1 and 120 or char_length(coalesce(p_message, '')) > 500 then
    raise exception 'invalid spotted post' using errcode = '22023';
  end if;
  if char_length(coalesce(p_location, '')) > 120 then
    raise exception 'location must be 120 characters or fewer' using errcode = '22023';
  end if;
  select * into current_identity from public.anonymous_identities where user_id = current_user_id;
  if not found then raise exception 'anonymous identity is unavailable' using errcode = '23503'; end if;
  insert into public.daily_post_usage(user_id, usage_day, post_count)
  values (current_user_id, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, usage_day) do update
    set post_count = public.daily_post_usage.post_count + 1, updated_at = now()
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

-- The unique-name generator serializes allocation. Only registered active
-- members may create the durable anonymous identity used by campus posts.
create or replace function public.ensure_anonymous_identity()
returns table(display_name text, emoji text, color text, ghost_id text)
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  current_identity public.anonymous_identities%rowtype;
  generated_identity record;
begin
  if current_user_id is null or not public.is_active_member() then
    raise exception 'active account required' using errcode = '42501';
  end if;
  select * into current_identity from public.anonymous_identities i where i.user_id = current_user_id;
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

-- Drop identity rows belonging to anonymous Auth sessions. Their public posts
-- retain the already-snapshotted author display name and emoji.
delete from public.anonymous_identities i
using auth.users u
where u.id = i.user_id and coalesce(u.is_anonymous, false)
  and not exists (select 1 from public.profiles p where p.id = u.id);

-- Redact moderation events, restrict post events to meaningful content changes,
-- and make every campus feed broadcast private. There is intentionally no
-- realtime.messages INSERT policy for the public feed topic.
create or replace function public.broadcast_post_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; event_name text;
begin
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('id', old.public_id, 'status', 'deleted'),
      'post:deleted', 'unseen:feed', true);
    return old;
  end if;
  if new.status <> 'approved' then
    perform realtime.send(jsonb_build_object('id', new.public_id, 'status', new.status),
      'post:moderated', 'unseen:feed', true);
    return new;
  end if;
  row_data := jsonb_build_object(
    'id', new.public_id, 'cat', new.category, 'content', new.body,
    'author', new.author_name, 'emoji', new.author_emoji, 'color', new.author_color,
    'createdAt', new.created_at, 'likes', new.likes_count, 'commentsCount', new.comments_count,
    'status', new.status,
    'imagePath', (select m.storage_path from public.media m where m.post_public_id = new.public_id)
  );
  event_name := case when tg_op = 'INSERT' then 'post:new' else 'post:updated' end;
  perform realtime.send(row_data, event_name, 'unseen:feed', true);
  return new;
end;
$$;
drop trigger if exists posts_realtime_trigger on public.posts;
create trigger posts_realtime_trigger after insert or delete or update of status, body, category on public.posts
  for each row execute function public.broadcast_post_change();

create or replace function public.broadcast_like_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_post_public_id uuid;
begin
  target_post_public_id := case when tg_op = 'DELETE' then old.post_public_id else new.post_public_id end;
  perform realtime.send(
    jsonb_build_object('id', target_post_public_id,
      'likes', (select p.likes_count from public.posts p where p.public_id = target_post_public_id)),
    'like:change', 'unseen:feed', true
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.broadcast_media_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_post_id uuid; target_path text;
begin
  if tg_op = 'DELETE' then target_post_id := old.post_public_id; target_path := null;
  else target_post_id := new.post_public_id; target_path := new.storage_path; end if;
  if target_post_id is not null then
    perform realtime.send(jsonb_build_object('id', target_post_id, 'imagePath', target_path),
      'post:updated', 'unseen:feed', true);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.broadcast_comment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb;
  event_name text;
  target_post_id uuid;
  absolute_count integer;
begin
  target_post_id := case when tg_op = 'DELETE' then old.post_public_id else new.post_public_id end;
  select p.comments_count into absolute_count from public.posts p where p.public_id = target_post_id;
  absolute_count := coalesce(absolute_count, 0);
  if tg_op = 'DELETE' then
    row_data := jsonb_build_object('id', old.public_id, 'postId', target_post_id, 'commentsCount', absolute_count);
    perform realtime.send(row_data, 'comment:deleted', 'unseen:feed', true);
    return old;
  end if;
  if new.status <> 'approved' then
    row_data := jsonb_build_object('id', new.public_id, 'postId', target_post_id,
      'status', new.status, 'commentsCount', absolute_count);
    perform realtime.send(row_data, 'comment:updated', 'unseen:feed', true);
    return new;
  end if;
  row_data := jsonb_build_object(
    'id', new.public_id, 'postId', target_post_id, 'author', new.author_name,
    'emoji', new.author_emoji, 'text', new.body, 'createdAt', new.created_at,
    'status', new.status, 'commentsCount', absolute_count
  );
  event_name := case when tg_op = 'INSERT' then 'comment:new' else 'comment:updated' end;
  perform realtime.send(row_data, event_name, 'unseen:feed', true);
  return new;
end;
$$;

create or replace function public.broadcast_poll_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare poll_id uuid; event_name text;
begin
  poll_id := case when tg_op = 'DELETE' then old.public_id else new.public_id end;
  event_name := case when tg_op = 'INSERT' then 'poll:new' when tg_op = 'DELETE' then 'poll:deleted' else 'poll:update' end;
  perform realtime.send(jsonb_build_object('id', poll_id), event_name, 'unseen:feed', true);
  return coalesce(new, old);
end;
$$;

create or replace function public.broadcast_crush_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; event_name text;
begin
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('id', old.public_id, 'status', 'deleted'),
      'crush:deleted', 'unseen:feed', true);
    return old;
  end if;
  if new.status <> 'published' then
    perform realtime.send(jsonb_build_object('id', new.public_id, 'status', new.status),
      'crush:moderated', 'unseen:feed', true);
    return new;
  end if;
  row_data := jsonb_build_object('id', new.public_id, 'to', new.recipient, 'loc', new.location,
    'msg', new.message, 'author', new.author_name, 'emoji', new.author_emoji, 'color', new.author_color,
    'ship', new.ships_count, 'blush', new.blushes_count, 'createdAt', new.created_at, 'status', new.status);
  event_name := case when tg_op = 'INSERT' then 'crush:new' else 'crush:update' end;
  perform realtime.send(row_data, event_name, 'unseen:feed', true);
  return new;
end;
$$;

drop trigger if exists comments_realtime_trigger on public.comments;
create trigger comments_realtime_trigger after insert or update or delete on public.comments
  for each row execute function public.broadcast_comment_change();
drop trigger if exists likes_realtime_trigger on public.likes;
create trigger likes_realtime_trigger after insert or delete on public.likes
  for each row execute function public.broadcast_like_change();
drop trigger if exists media_realtime_trigger on public.media;
create trigger media_realtime_trigger after insert or update of post_public_id or delete on public.media
  for each row execute function public.broadcast_media_link();
drop trigger if exists polls_realtime_trigger on public.polls;
create trigger polls_realtime_trigger after insert or update or delete on public.polls
  for each row execute function public.broadcast_poll_change();
drop trigger if exists crushes_realtime_trigger on public.crushes;
create trigger crushes_realtime_trigger after insert or update or delete on public.crushes
  for each row execute function public.broadcast_crush_change();

drop policy if exists crushes_read_public on public.crushes;
create policy crushes_read_public on public.crushes for select to anon, authenticated
  using (status = 'published' and expires_at > now());

-- A media object is limited to its uploader's folder and ten uploads per rolling
-- day. The SECURITY DEFINER helper can count owner objects without exposing the
-- storage.objects table to the client.
create or replace function public.can_upload_media_object(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and (storage.foldername(object_path))[1] = (select auth.uid())::text
    and (select public.is_active_member())
    and (select count(*) from storage.objects o
      where o.bucket_id = 'unseen-media'
        and o.owner_id = (select auth.uid())::text
        and o.created_at >= now() - interval '24 hours') < 10;
$$;
revoke all on function public.can_upload_media_object(text) from public, anon, authenticated;
grant execute on function public.can_upload_media_object(text) to authenticated;
drop policy if exists unseen_media_upload on storage.objects;
create policy unseen_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'unseen-media' and owner_id = (select auth.uid())::text
    and public.can_upload_media_object(name));

-- Rename and index the auth limiter's table. Cleanup is sampled so ordinary
-- authentication requests no longer scan/delete old rows on every call.
alter table private.migration_login_attempts rename to auth_attempts;
create index auth_attempts_window_started_at_idx on private.auth_attempts (window_started_at);
create or replace function public.take_auth_attempt(p_attempt_key text, p_max_attempts integer default 10)
returns boolean language plpgsql security definer set search_path = '' as $$
declare new_count integer;
begin
  insert into private.auth_attempts(attempt_key, window_started_at, attempt_count)
  values (p_attempt_key, now(), 1)
  on conflict (attempt_key) do update set
    window_started_at = case when private.auth_attempts.window_started_at < now() - interval '15 minutes'
      then now() else private.auth_attempts.window_started_at end,
    attempt_count = case when private.auth_attempts.window_started_at < now() - interval '15 minutes'
      then 1 else private.auth_attempts.attempt_count + 1 end
  returning attempt_count into new_count;
  if random() < 0.01 then
    delete from private.auth_attempts where window_started_at < now() - interval '1 day';
  end if;
  return new_count <= greatest(1, least(p_max_attempts, 20));
end;
$$;

-- Used by the admin Edge Function after checking the caller's account. The
-- transaction lock serializes all role/status/deletion changes and the audit
-- record is written in the same transaction as the change.
create or replace function public.admin_manage_user(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_role public.account_role default null,
  p_status public.account_moderation_status default null,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.profiles%rowtype;
  admin_identity text;
  active_admin_count integer;
  action_label text;
begin
  if coalesce((select auth.jwt())->>'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('set-user-role', 'set-user-status', 'delete-user') then
    raise exception 'invalid account action' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(741623814125::bigint);
  if not exists (select 1 from public.profiles a where a.id = p_admin_user_id
    and a.role = 'ADMIN' and a.moderation_status = 'ACTIVE') then
    raise exception 'active administrator required' using errcode = '42501';
  end if;
  select p.* into target from public.profiles p where p.id = p_target_user_id for update;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  select i.display_name into admin_identity from public.anonymous_identities i where i.user_id = p_admin_user_id;

  if p_action = 'set-user-role' then
    if p_role is null then raise exception 'role is required' using errcode = '22023'; end if;
    if target.role = 'ADMIN' and target.moderation_status = 'ACTIVE' and p_role <> 'ADMIN' then
      select count(*) into active_admin_count from public.profiles p
        where p.role = 'ADMIN' and p.moderation_status = 'ACTIVE';
      if active_admin_count <= 1 then raise exception 'final active administrator cannot be demoted' using errcode = '23514'; end if;
    end if;
    update public.profiles set role = p_role, updated_at = now() where id = p_target_user_id;
    action_label := case when p_role = 'ADMIN' then 'ADMIN_PROMOTED_USER' else 'ADMIN_DEMOTED_USER' end;
    insert into public.admin_actions(admin_user_id, admin_identity, action, target_type, target_id, reason, metadata)
    values (p_admin_user_id, coalesce(admin_identity, 'Admin'), action_label, 'user', p_target_user_id::text,
      left(coalesce(p_reason, ''), 500), jsonb_build_object('role', p_role));
  elsif p_action = 'set-user-status' then
    if p_status is null then raise exception 'status is required' using errcode = '22023'; end if;
    if target.role = 'ADMIN' and target.moderation_status = 'ACTIVE' and p_status <> 'ACTIVE' then
      select count(*) into active_admin_count from public.profiles p
        where p.role = 'ADMIN' and p.moderation_status = 'ACTIVE';
      if active_admin_count <= 1 then raise exception 'final active administrator cannot be restricted' using errcode = '23514'; end if;
    end if;
    update public.profiles set moderation_status = p_status,
      moderation_reason = nullif(left(coalesce(p_reason, ''), 500), ''),
      suspended_at = case when p_status = 'ACTIVE' then null else now() end,
      updated_at = now()
      where id = p_target_user_id;
    action_label := 'ADMIN_' || p_status::text || '_USER';
    insert into public.admin_actions(admin_user_id, admin_identity, action, target_type, target_id, reason, metadata)
    values (p_admin_user_id, coalesce(admin_identity, 'Admin'), action_label, 'user', p_target_user_id::text,
      left(coalesce(p_reason, ''), 500), jsonb_build_object('status', p_status));
  else
    if target.role = 'ADMIN' and target.moderation_status = 'ACTIVE' then
      select count(*) into active_admin_count from public.profiles p
        where p.role = 'ADMIN' and p.moderation_status = 'ACTIVE';
      if active_admin_count <= 1 then raise exception 'final active administrator cannot be deleted' using errcode = '23514'; end if;
    end if;
    insert into public.admin_actions(admin_user_id, admin_identity, action, target_type, target_id, reason, metadata)
    values (p_admin_user_id, coalesce(admin_identity, 'Admin'), 'ADMIN_DELETED_USER', 'user', p_target_user_id::text,
      left(coalesce(p_reason, ''), 500), '{}'::jsonb);
    delete from auth.users where id = p_target_user_id;
    if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('success', true, 'targetId', p_target_user_id, 'action', p_action);
end;
$$;
revoke all on function public.admin_manage_user(uuid, uuid, text, public.account_role, public.account_moderation_status, text)
  from public, anon, authenticated;
grant execute on function public.admin_manage_user(uuid, uuid, text, public.account_role, public.account_moderation_status, text)
  to service_role;

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare revoked_count integer := 0; changed integer;
begin
  if coalesce((select auth.jwt())->>'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  get diagnostics changed = row_count;
  revoked_count := revoked_count + changed;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics changed = row_count;
  revoked_count := revoked_count + changed;
  return revoked_count;
end;
$$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

create or replace function public.feed_top_liked_posts(p_limit integer default 3)
returns table(public_id uuid, category public.post_category, body text, author_name text, author_emoji text,
  author_color text, location text, branch text, created_at timestamptz, likes_count integer,
  comments_count integer, viewer_liked boolean, viewer_owned boolean, viewer_bookmarked boolean,
  storage_path text, mime_type text, image_width integer, image_height integer)
language sql stable security definer set search_path = '' as $$
  select p.public_id, p.category, p.body, p.author_name, p.author_emoji, p.author_color,
    p.location, p.branch, p.created_at, p.likes_count, p.comments_count,
    exists (select 1 from public.likes l where l.post_public_id = p.public_id and l.actor_key = (select auth.uid())::text),
    p.owner_user_id = (select auth.uid()),
    exists (select 1 from public.bookmarks b where b.post_public_id = p.public_id and b.user_id = (select auth.uid())),
    m.storage_path, m.mime_type, m.width, m.height
  from public.posts p left join public.media m on m.post_public_id = p.public_id
  where p.status = 'approved' and p.expires_at > now()
  order by p.likes_count desc, p.created_at desc, p.public_id desc
  limit greatest(1, least(coalesce(p_limit, 3), 50));
$$;
revoke all on function public.feed_top_liked_posts(integer) from public, anon, authenticated;
grant execute on function public.feed_top_liked_posts(integer) to anon, authenticated;

-- Cleanup claims paths before making Storage API calls. Rows are removed only
-- after the Edge Function confirms Storage deletion, so an expired post cannot
-- cascade away the only copy of its object path.
alter table public.media add column cleanup_claimed_until timestamptz;
create index media_cleanup_claim_idx on public.media (cleanup_claimed_until, created_at);

create or replace function public.claim_expired_media_cleanup(p_limit integer default 100)
returns table(storage_path text)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt())->>'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select m.id from public.media m
    left join public.posts p on p.public_id = m.post_public_id
    where (
      (m.post_public_id is null and m.created_at <= now() - interval '2 hours') or
      (p.public_id is not null and (p.status = 'deleted' or p.expires_at <= now()))
    ) and (m.cleanup_claimed_until is null or m.cleanup_claimed_until <= now())
    order by m.created_at, m.id
    for update of m skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ), claimed as (
    update public.media m set cleanup_claimed_until = now() + interval '15 minutes'
    from candidates c where m.id = c.id
    returning m.storage_path
  )
  select claimed.storage_path from claimed;
end;
$$;

create or replace function public.release_expired_media_cleanup(p_storage_paths text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if coalesce((select auth.jwt())->>'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.media set cleanup_claimed_until = null
  where storage_path = any(coalesce(p_storage_paths, array[]::text[]));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.complete_expired_media_cleanup(p_storage_paths text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if coalesce((select auth.jwt())->>'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.media where storage_path = any(coalesce(p_storage_paths, array[]::text[]));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.delete_expired_content()
returns bigint language plpgsql security definer set search_path = '' as $$
declare affected bigint := 0; changed bigint;
begin
  if coalesce((select auth.jwt())->>'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.posts p where (p.expires_at <= now() or p.status = 'deleted')
    and not exists (select 1 from public.media m where m.post_public_id = p.public_id);
  get diagnostics changed = row_count; affected := affected + changed;
  delete from public.polls p where p.expires_at <= now() or p.status = 'deleted';
  get diagnostics changed = row_count; affected := affected + changed;
  delete from public.crushes c where c.expires_at <= now() or c.status = 'deleted';
  get diagnostics changed = row_count; affected := affected + changed;
  return affected;
end;
$$;

create or replace function public.prune_inactive_anonymous_users()
returns bigint language plpgsql security definer set search_path = '' as $$
declare affected bigint;
begin
  if coalesce((select auth.jwt())->>'role', '') <> 'service_role'
    and current_user <> 'postgres' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  with stale_users as (
    select u.id from auth.users u
    where coalesce(u.is_anonymous, false)
      and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '30 days'
      and not exists (select 1 from public.profiles p where p.id = u.id)
    order by coalesce(u.last_sign_in_at, u.created_at)
    for update skip locked
    limit 1000
  )
  delete from auth.users u using stale_users s where u.id = s.id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.claim_expired_media_cleanup(integer) from public, anon, authenticated;
revoke all on function public.release_expired_media_cleanup(text[]) from public, anon, authenticated;
revoke all on function public.complete_expired_media_cleanup(text[]) from public, anon, authenticated;
revoke all on function public.delete_expired_content() from public, anon, authenticated;
revoke all on function public.prune_inactive_anonymous_users() from public, anon, authenticated;
grant execute on function public.claim_expired_media_cleanup(integer) to service_role;
grant execute on function public.release_expired_media_cleanup(text[]) to service_role;
grant execute on function public.complete_expired_media_cleanup(text[]) to service_role;
grant execute on function public.delete_expired_content() to service_role;
grant execute on function public.prune_inactive_anonymous_users() to service_role;

-- Vault secrets are provisioned by the operator after this migration. The
-- scheduled helper silently waits until both values exist.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.invoke_expired_media_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
declare project_url text; cron_secret text;
begin
  select d.decrypted_secret into project_url from vault.decrypted_secrets d
    where d.name = 'unseen_project_url' limit 1;
  select d.decrypted_secret into cron_secret from vault.decrypted_secrets d
    where d.name = 'unseen_cron_secret' limit 1;
  if coalesce(project_url, '') = '' or coalesce(cron_secret, '') = '' then return; end if;
  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := jsonb_build_object('source', 'pg_cron')
  );
end;
$$;
revoke all on function private.invoke_expired_media_cleanup() from public, anon, authenticated, service_role;

do $$
declare existing_job record;
begin
  for existing_job in select j.jobid from cron.job j
    where j.jobname in ('unseen-expired-media-cleanup', 'unseen-prune-anonymous-auth-users')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule('unseen-expired-media-cleanup', '0 * * * *', 'select private.invoke_expired_media_cleanup();');
  perform cron.schedule('unseen-prune-anonymous-auth-users', '17 3 * * *', 'select public.prune_inactive_anonymous_users();');
end;
$$;

revoke all on function public.submit_report(uuid, public.report_target_type, uuid, uuid, uuid, text, text)
  from public, anon;
revoke all on function public.submit_report(uuid, public.report_target_type, uuid, text, text)
  from public, anon;
grant execute on function public.submit_report(uuid, public.report_target_type, uuid, uuid, uuid, text, text)
  to authenticated;
grant execute on function public.submit_report(uuid, public.report_target_type, uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
