-- UNSEEN relational schema. Apply to a Supabase project before importing data.
-- Public content uses opaque UUIDs and anonymous-profile snapshots. Account IDs,
-- usernames, ghost IDs, and moderation data stay behind RLS/column grants.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$ begin
  create type public.account_role as enum ('USER', 'ADMIN');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.account_moderation_status as enum ('ACTIVE', 'SUSPENDED', 'BANNED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.post_category as enum ('Confessions', 'Memes', 'Rants', 'Spotted', 'Placements');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.post_moderation_status as enum ('pending', 'approved', 'hidden', 'removed', 'deleted');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.report_status as enum ('open', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.report_target_type as enum ('post', 'comment', 'account');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.poll_status as enum ('published', 'hidden', 'removed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.random_chat_status as enum ('ACTIVE', 'ENDED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.random_chat_report_status as enum ('OPEN', 'REVIEWED', 'DISMISSED');
exception when duplicate_object then null; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9_]{3,20}$'),
  role public.account_role not null default 'USER',
  moderation_status public.account_moderation_status not null default 'ACTIVE',
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 500),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.anonymous_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  legacy_ghost_id text unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  emoji text not null default '👻',
  color text not null default '#EDE9FE',
  created_at timestamptz not null default now()
);

create table public.invitation_codes (
  id uuid primary key default gen_random_uuid(),
  code_digest text not null unique,
  digest_algorithm text not null default 'sha256' check (digest_algorithm in ('sha256', 'legacy_hmac_sha256')),
  status text not null default 'UNUSED' check (status in ('UNUSED', 'CLAIMED', 'REVOKED')),
  created_by uuid references public.profiles(id) on delete set null,
  claimed_by uuid unique references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  identity_id uuid references public.anonymous_identities(id) on delete set null,
  author_name text not null default 'Anonymous Ghost',
  author_emoji text not null default '👻',
  author_color text not null default '#EDE9FE',
  category public.post_category not null,
  body text not null check (char_length(body) between 1 and 500),
  location text,
  branch text,
  status public.post_moderation_status not null default 'approved',
  likes_count integer not null default 0 check (likes_count >= 0),
  comments_count integer not null default 0 check (comments_count >= 0),
  reports_count integer not null default 0 check (reports_count >= 0),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  deletion_reason text check (deletion_reason is null or char_length(deletion_reason) <= 500),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  post_public_id uuid not null references public.posts(public_id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Anonymous Ghost',
  author_emoji text not null default '👻',
  body text not null check (char_length(body) between 1 and 500),
  status public.post_moderation_status not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.likes (
  post_public_id uuid not null references public.posts(public_id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  actor_key text not null,
  created_at timestamptz not null default now(),
  primary key (post_public_id, actor_key)
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  identity_id uuid references public.anonymous_identities(id) on delete set null,
  author_name text not null default 'Anonymous Ghost',
  author_emoji text not null default '👻',
  author_color text not null default '#EDE9FE',
  tag text not null default 'Campus',
  question text not null check (char_length(question) between 1 and 200),
  status public.poll_status not null default 'published',
  total_votes integer not null default 0 check (total_votes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_public_id uuid not null references public.polls(public_id) on delete cascade,
  position smallint not null check (position between 0 and 5),
  label text not null check (char_length(label) between 1 and 80),
  emoji text,
  color text,
  vote_count integer not null default 0 check (vote_count >= 0),
  unique (poll_public_id, position),
  unique (id, poll_public_id)
);

create table public.poll_votes (
  poll_public_id uuid not null references public.polls(public_id) on delete cascade,
  option_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_key text not null,
  created_at timestamptz not null default now(),
  primary key (poll_public_id, actor_key),
  foreign key (option_id, poll_public_id) references public.poll_options(id, poll_public_id) on delete cascade
);

create table public.crushes (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  identity_id uuid references public.anonymous_identities(id) on delete set null,
  author_name text not null default 'Anonymous Ghost',
  author_emoji text not null default '👻',
  author_color text not null default '#FCE7F3',
  recipient text not null check (char_length(recipient) between 1 and 120),
  location text,
  message text check (message is null or char_length(message) <= 500),
  ships_count integer not null default 0 check (ships_count >= 0),
  blushes_count integer not null default 0 check (blushes_count >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table public.crush_reactions (
  crush_public_id uuid not null references public.crushes(public_id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ship', 'blush')),
  created_at timestamptz not null default now(),
  primary key (crush_public_id, actor_id, kind)
);

create table public.mailbox_messages (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  recipient_identity_id uuid references public.anonymous_identities(id) on delete cascade,
  sender_identity_id uuid references public.anonymous_identities(id) on delete cascade,
  recipient_name text not null default 'Anonymous Ghost',
  sender_name text not null default 'Anonymous Ghost',
  sender_emoji text not null default '👻',
  sender_color text not null default '#EDE9FE',
  preview text not null default '',
  body text not null check (char_length(body) between 1 and 1000),
  is_sealed boolean not null default true,
  burned_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  post_public_id uuid unique references public.posts(public_id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 5242880),
  width integer check (width is null or width between 1 and 12000),
  height integer check (height is null or height between 1 and 12000),
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type public.report_target_type not null,
  post_public_id uuid references public.posts(public_id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reporter_user_id uuid references public.profiles(id) on delete set null,
  reporter_auth_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 120),
  detail text check (detail is null or char_length(detail) <= 1000),
  status public.report_status not null default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  moderation_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (target_type = 'post' and post_public_id is not null and comment_id is null and reported_user_id is null) or
    (target_type = 'comment' and comment_id is not null) or
    (target_type = 'account' and reported_user_id is not null and comment_id is null)
  )
);

create unique index reports_actor_target_idx on public.reports
  (reporter_auth_id, target_type, coalesce(post_public_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(reported_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where reporter_auth_id is not null;

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles(id) on delete set null,
  admin_identity text not null default 'Admin',
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text not null default '' check (char_length(reason) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  post_public_id uuid references public.posts(public_id) on delete set null,
  account_id uuid references public.profiles(id) on delete set null,
  action text not null,
  admin_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.daily_post_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_day date not null,
  post_count integer not null default 0 check (post_count between 0 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_day)
);

create table public.bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_public_id uuid not null references public.posts(public_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_public_id)
);

create table public.random_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key uuid not null unique default gen_random_uuid(),
  user_a_id uuid not null references public.profiles(id) on delete cascade,
  user_b_id uuid not null references public.profiles(id) on delete cascade,
  profile_a jsonb not null,
  profile_b jsonb not null,
  status public.random_chat_status not null default 'ACTIVE',
  moderation_hold boolean not null default false,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz,
  check (user_a_id <> user_b_id),
  check (user_a_id < user_b_id)
);

create table public.random_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.random_chat_sessions(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_profile jsonb not null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table public.random_chat_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'WAITING' check (status in ('WAITING', 'MATCHING')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.random_chat_queue_exclusions (
  user_id uuid not null references public.random_chat_queue(user_id) on delete cascade,
  excluded_user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (user_id, excluded_user_id),
  check (user_id <> excluded_user_id)
);

create table public.random_chat_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.random_chat_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.random_chat_sessions(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 120),
  detail text not null default '' check (char_length(detail) <= 1000),
  status public.random_chat_report_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  unique (session_id, reporter_id),
  check (reporter_id <> reported_id)
);

-- Migration-only mappings and bcrypt hashes never enter the API-exposed schema.
create table private.legacy_import_map (
  source_collection text not null,
  source_id text not null,
  target_id uuid not null,
  imported_at timestamptz not null default now(),
  primary key (source_collection, source_id)
);
create table private.legacy_auth_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  bcrypt_hash text not null,
  created_at timestamptz not null default now()
);
create table private.random_chat_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  message_count integer not null default 0,
  last_body_hash text,
  last_sent_at timestamptz
);

create table private.migration_login_attempts (
  attempt_key text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null default 1
);

create index posts_feed_idx on public.posts (created_at desc, public_id desc) where status = 'approved';
create index posts_category_feed_idx on public.posts (category, created_at desc, public_id desc) where status = 'approved';
create index posts_owner_idx on public.posts (owner_user_id, created_at desc);
create index posts_expiry_idx on public.posts (expires_at);
create index comments_feed_idx on public.comments (post_public_id, created_at asc) where status = 'approved';
create index comments_owner_idx on public.comments (owner_user_id, created_at desc);
create index reports_queue_idx on public.reports (status, created_at desc);
create index reports_post_idx on public.reports (post_public_id) where post_public_id is not null;
create index media_post_idx on public.media (post_public_id) where post_public_id is not null;
create index polls_feed_idx on public.polls (created_at desc) where status = 'published';
create index polls_expiry_idx on public.polls (expires_at);
create index crushes_feed_idx on public.crushes (created_at desc);
create index mailbox_recipient_idx on public.mailbox_messages (recipient_identity_id, created_at desc);
create index mailbox_expiry_idx on public.mailbox_messages (burned_at);
create index admin_actions_feed_idx on public.admin_actions (created_at desc);
create index admin_actions_target_idx on public.admin_actions (target_type, target_id, created_at desc);
create index random_chat_sessions_status_idx on public.random_chat_sessions (status, created_at desc);
create unique index random_chat_active_user_a_idx on public.random_chat_sessions (user_a_id) where status = 'ACTIVE';
create unique index random_chat_active_user_b_idx on public.random_chat_sessions (user_b_id) where status = 'ACTIVE';
create index random_chat_messages_session_idx on public.random_chat_messages (session_id, created_at);
create index random_chat_messages_expiry_idx on public.random_chat_messages (expires_at) where expires_at is not null;
create index random_chat_queue_pick_idx on public.random_chat_queue (status, created_at) where status = 'WAITING';
create index random_chat_reports_queue_idx on public.random_chat_reports (status, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger posts_touch_updated_at before update on public.posts for each row execute function public.touch_updated_at();
create trigger comments_touch_updated_at before update on public.comments for each row execute function public.touch_updated_at();
create trigger polls_touch_updated_at before update on public.polls for each row execute function public.touch_updated_at();
create trigger reports_touch_updated_at before update on public.reports for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.moderation_status = 'ACTIVE'
  );
$$;

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.moderation_status = 'ACTIVE'
  );
$$;

create or replace function public.is_valid_voter()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.is_active_member()), false)
    or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false);
$$;

create or replace function public.get_my_profile()
returns table(username text, role public.account_role, moderation_status public.account_moderation_status,
  display_name text, emoji text, color text, ghost_id text)
language sql stable security definer set search_path = '' as $$
  select p.username, p.role, p.moderation_status, i.display_name, i.emoji, i.color, i.legacy_ghost_id
  from public.profiles p join public.anonymous_identities i on i.user_id = p.id
  where p.id = (select auth.uid());
$$;

create or replace function public.legacy_auth_record(p_username text)
returns table(user_id uuid, password_hash text, moderation_status public.account_moderation_status)
language sql stable security definer set search_path = '' as $$
  select p.id, c.bcrypt_hash, p.moderation_status
  from public.profiles p join private.legacy_auth_credentials c on c.user_id = p.id
  where p.username = lower(trim(p_username));
$$;

create or replace function public.legacy_import_target(p_source_collection text, p_source_id text)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.target_id from private.legacy_import_map m
  where m.source_collection = p_source_collection and m.source_id = p_source_id;
$$;

create or replace function public.legacy_import_targets(p_source_collection text, p_source_ids text[])
returns table(source_id text, target_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.source_id, m.target_id from private.legacy_import_map m
  where m.source_collection = p_source_collection and m.source_id = any(coalesce(p_source_ids, array[]::text[]));
$$;

create or replace function public.record_legacy_import(p_source_collection text, p_source_id text, p_target_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if length(p_source_collection) not between 1 and 80 or length(p_source_id) not between 1 and 200 then
    raise exception 'invalid migration mapping' using errcode = '22023';
  end if;
  insert into private.legacy_import_map(source_collection, source_id, target_id)
  values (p_source_collection, p_source_id, p_target_id)
  on conflict (source_collection, source_id) do update set target_id = excluded.target_id;
  return p_target_id;
end;
$$;

create or replace function public.record_legacy_password(p_user_id uuid, p_username text, p_password_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_password_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'invalid legacy password hash' using errcode = '22023';
  end if;
  insert into private.legacy_auth_credentials(user_id, username, bcrypt_hash)
  values (p_user_id, lower(trim(p_username)), p_password_hash)
  on conflict (user_id) do update set username = excluded.username, bcrypt_hash = excluded.bcrypt_hash;
  return true;
end;
$$;

create or replace function public.clear_legacy_auth_record(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from private.legacy_auth_credentials where user_id = p_user_id;
  return found;
end;
$$;

create or replace function public.take_auth_attempt(p_attempt_key text, p_max_attempts integer default 10)
returns boolean language plpgsql security definer set search_path = '' as $$
declare new_count integer;
begin
  insert into private.migration_login_attempts(attempt_key, window_started_at, attempt_count)
  values (p_attempt_key, now(), 1)
  on conflict (attempt_key) do update set
    window_started_at = case when private.migration_login_attempts.window_started_at < now() - interval '15 minutes' then now() else private.migration_login_attempts.window_started_at end,
    attempt_count = case when private.migration_login_attempts.window_started_at < now() - interval '15 minutes' then 1 else private.migration_login_attempts.attempt_count + 1 end
  returning attempt_count into new_count;
  delete from private.migration_login_attempts where window_started_at < now() - interval '1 day';
  return new_count <= greatest(1, least(p_max_attempts, 20));
end;
$$;

create or replace function public.claim_invited_account(p_user_id uuid, p_username text,
  p_code_digest text, p_legacy_code_digest text, p_display_name text, p_emoji text,
  p_color text, p_ghost_id text)
returns table(username text, display_name text, emoji text, color text, ghost_id text)
language plpgsql security definer set search_path = '' as $$
declare claimed_invitation_id uuid;
begin
  if p_username <> lower(trim(p_username)) or p_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username' using errcode = '22023';
  end if;
  update public.invitation_codes i set status = 'CLAIMED', claimed_by = p_user_id, claimed_at = now()
  where i.status = 'UNUSED' and (
    (i.digest_algorithm = 'sha256' and i.code_digest = p_code_digest) or
    (i.digest_algorithm = 'legacy_hmac_sha256' and p_legacy_code_digest is not null and i.code_digest = p_legacy_code_digest)
  ) returning i.id into claimed_invitation_id;
  if claimed_invitation_id is null then raise exception 'invalid or used invitation' using errcode = 'P0001'; end if;
  insert into public.profiles(id, username) values (p_user_id, p_username);
  insert into public.anonymous_identities(user_id, legacy_ghost_id, display_name, emoji, color)
  values (p_user_id, p_ghost_id, p_display_name, p_emoji, p_color);
  return query select p_username, p_display_name, p_emoji, p_color, p_ghost_id;
end;
$$;

create or replace function public.can_read_media(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media m
    left join public.posts p on p.public_id = m.post_public_id
    where m.storage_path = object_path
      and (
        m.owner_user_id = (select auth.uid())
        or public.is_admin()
        or (p.status = 'approved' and p.expires_at > now())
      )
  );
$$;

-- RLS predicates read moderation and ownership fields that are intentionally
-- not exposed through the PostgREST column grants below.
create or replace function public.is_public_post(p_public_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posts p
    where p.public_id = p_public_id and p.status = 'approved' and p.expires_at > now()
  );
$$;

create or replace function public.can_read_comment(p_comment_public_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comments c join public.posts p on p.public_id = c.post_public_id
    where c.public_id = p_comment_public_id and c.status = 'approved'
      and p.status = 'approved' and p.expires_at > now()
  );
$$;

create or replace function public.can_read_post(p_public_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posts p
    where p.public_id = p_public_id
      and ((p.status = 'approved' and p.expires_at > now())
        or p.owner_user_id = (select auth.uid())
        or (select public.is_admin()))
  );
$$;

create or replace function public.is_public_poll(p_public_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.polls p
    where p.public_id = p_public_id and p.status = 'published' and p.expires_at > now()
  );
$$;

create or replace function public.owns_uploaded_media_object(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id = 'unseen-media' and o.name = object_path
      and o.owner_id = (select auth.uid())::text
      and coalesce(o.metadata->>'mimetype', '') in ('image/jpeg', 'image/png', 'image/webp')
      and coalesce((o.metadata->>'size')::bigint, 0) between 1 and 5242880
  );
$$;

create or replace function public.bump_comment_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'approved' then
    update public.posts set comments_count = comments_count + 1 where public_id = new.post_public_id;
  elsif tg_op = 'DELETE' and old.status = 'approved' then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where public_id = old.post_public_id;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    update public.posts set comments_count = greatest(comments_count +
      (case when new.status = 'approved' then 1 else 0 end) -
      (case when old.status = 'approved' then 1 else 0 end), 0)
    where public_id = new.post_public_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger comments_count_trigger after insert or update of status or delete on public.comments
for each row execute function public.bump_comment_count();

create or replace function public.bump_like_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where public_id = new.post_public_id;
  else
    update public.posts set likes_count = greatest(likes_count - 1, 0) where public_id = old.post_public_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger likes_count_trigger after insert or delete on public.likes
for each row execute function public.bump_like_count();

create or replace function public.broadcast_like_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_post_public_id uuid;
begin
  target_post_public_id := case when tg_op = 'DELETE' then old.post_public_id else new.post_public_id end;
  perform realtime.send(
    jsonb_build_object('id', target_post_public_id,
      'likes', (select p.likes_count from public.posts p where p.public_id = target_post_public_id)),
    'like:change', 'unseen:feed', false
  );
  return coalesce(new, old);
end;
$$;
create trigger likes_realtime_trigger after insert or delete on public.likes
for each row execute function public.broadcast_like_change();

create or replace function public.bump_poll_vote_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
    update public.polls set total_votes = total_votes + 1 where public_id = new.poll_public_id;
  elsif tg_op = 'DELETE' then
    update public.poll_options set vote_count = greatest(vote_count - 1, 0) where id = old.option_id;
    update public.polls set total_votes = greatest(total_votes - 1, 0) where public_id = old.poll_public_id;
  elsif old.option_id is distinct from new.option_id then
    update public.poll_options set vote_count = greatest(vote_count - 1, 0) where id = old.option_id;
    update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger poll_votes_count_trigger after insert or update of option_id or delete on public.poll_votes
for each row execute function public.bump_poll_vote_count();

create or replace function public.bump_crush_reaction_count()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_id uuid; target_kind text; delta integer;
begin
  target_id := case when tg_op = 'DELETE' then old.crush_public_id else new.crush_public_id end;
  target_kind := case when tg_op = 'DELETE' then old.kind else new.kind end;
  delta := case when tg_op = 'DELETE' then -1 else 1 end;
  if target_kind = 'ship' then
    update public.crushes set ships_count = greatest(ships_count + delta, 0) where public_id = target_id;
  else
    update public.crushes set blushes_count = greatest(blushes_count + delta, 0) where public_id = target_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger crush_reaction_count_trigger after insert or delete on public.crush_reactions
for each row execute function public.bump_crush_reaction_count();

-- Broadcast only anonymous, public-safe content. Realtime payloads never carry account IDs.
create or replace function public.broadcast_post_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; event_name text;
begin
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('id', old.public_id), 'post:deleted', 'unseen:feed', false);
    return old;
  end if;
  row_data := jsonb_build_object(
    'id', new.public_id, 'cat', new.category, 'content', new.body,
    'author', new.author_name, 'emoji', new.author_emoji, 'color', new.author_color,
    'createdAt', new.created_at, 'likes', new.likes_count, 'commentsCount', new.comments_count,
    'status', new.status, 'imagePath', (select m.storage_path from public.media m where m.post_public_id = new.public_id)
  );
  event_name := case when tg_op = 'INSERT' then 'post:new' else 'post:updated' end;
  if new.status in ('hidden', 'removed', 'deleted') then event_name := 'post:moderated'; end if;
  perform realtime.send(row_data, event_name, 'unseen:feed', false);
  return new;
end;
$$;
create trigger posts_realtime_trigger after insert or update or delete on public.posts
for each row execute function public.broadcast_post_change();

create or replace function public.broadcast_media_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_post_id uuid; target_path text;
begin
  if tg_op = 'DELETE' then
    target_post_id := old.post_public_id;
    target_path := null;
  else
    target_post_id := new.post_public_id;
    target_path := new.storage_path;
  end if;
  if target_post_id is not null then
    perform realtime.send(jsonb_build_object('id', target_post_id, 'imagePath', target_path),
      'post:updated', 'unseen:feed', false);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists media_realtime_trigger on public.media;
create trigger media_realtime_trigger after insert or update of post_public_id or delete on public.media
for each row execute function public.broadcast_media_link();

create or replace function public.broadcast_comment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; event_name text;
begin
  if tg_op = 'DELETE' then
    row_data := jsonb_build_object('id', old.public_id, 'postId', old.post_public_id);
    perform realtime.send(row_data, 'comment:deleted', 'unseen:feed', false);
    return old;
  end if;
  row_data := jsonb_build_object(
    'id', new.public_id, 'postId', new.post_public_id, 'author', new.author_name,
    'emoji', new.author_emoji, 'text', new.body, 'createdAt', new.created_at, 'status', new.status
  );
  event_name := case when tg_op = 'INSERT' then 'comment:new' else 'comment:updated' end;
  perform realtime.send(row_data, event_name, 'unseen:feed', false);
  return new;
end;
$$;
create trigger comments_realtime_trigger after insert or update or delete on public.comments
for each row execute function public.broadcast_comment_change();

create or replace function public.broadcast_admin_action()
returns trigger language plpgsql security definer set search_path = '' as $$
declare admin_row record;
begin
  for admin_row in select p.id from public.profiles p where p.role = 'ADMIN' and p.moderation_status = 'ACTIVE' loop
    perform realtime.send(
      jsonb_build_object('id', new.id, 'action', new.action, 'targetType', new.target_type,
        'targetId', new.target_id, 'createdAt', new.created_at),
      'admin:action', 'admin:' || admin_row.id::text, true
    );
  end loop;
  return new;
end;
$$;
create trigger admin_actions_realtime_trigger after insert on public.admin_actions
for each row execute function public.broadcast_admin_action();

create or replace function public.broadcast_poll_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare poll_id uuid; event_name text;
begin
  poll_id := case when tg_op = 'DELETE' then old.public_id else new.public_id end;
  event_name := case when tg_op = 'INSERT' then 'poll:new' when tg_op = 'DELETE' then 'poll:deleted' else 'poll:update' end;
  perform realtime.send(jsonb_build_object('id', poll_id), event_name, 'unseen:feed', false);
  return coalesce(new, old);
end;
$$;
create trigger polls_realtime_trigger after insert or update or delete on public.polls
for each row execute function public.broadcast_poll_change();

create or replace function public.broadcast_crush_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; event_name text;
begin
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('id', old.public_id), 'crush:deleted', 'unseen:feed', false);
    return old;
  end if;
  row_data := jsonb_build_object('id', new.public_id, 'to', new.recipient, 'loc', new.location,
    'msg', new.message, 'author', new.author_name, 'emoji', new.author_emoji, 'color', new.author_color,
    'ship', new.ships_count, 'blush', new.blushes_count, 'createdAt', new.created_at);
  event_name := case when tg_op = 'INSERT' then 'crush:new' else 'crush:update' end;
  perform realtime.send(row_data, event_name, 'unseen:feed', false);
  return new;
end;
$$;
create trigger crushes_realtime_trigger after insert or update or delete on public.crushes
for each row execute function public.broadcast_crush_change();

create or replace function public.broadcast_moderation_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.moderation_status is distinct from new.moderation_status then
    perform realtime.send(jsonb_build_object('status', new.moderation_status), 'user:status', 'user:' || new.id::text, true);
  end if;
  return new;
end;
$$;
create trigger profiles_moderation_realtime_trigger after update of moderation_status on public.profiles
for each row execute function public.broadcast_moderation_change();

create or replace function public.bump_report_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.post_public_id is not null then
    update public.posts set reports_count = reports_count + 1 where public_id = new.post_public_id;
  end if;
  return new;
end;
$$;
create trigger reports_count_trigger after insert on public.reports
for each row execute function public.bump_report_count();

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
  values (current_user_id, (now() at time zone 'utc')::date, 1)
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

create or replace function public.ensure_anonymous_identity()
returns table(display_name text, emoji text, color text, ghost_id text)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_identity public.anonymous_identities%rowtype;
  identity_index integer; animal_names text[] := array['Panda','Owl','Fox','Frog','Tiger','Peacock','Wolf','Cat'];
  animal_emojis text[] := array['🐼','🦉','🦊','🐸','🐯','🦚','🐺','🐱'];
  animal_colors text[] := array['#FEF3C7','#EDE9FE','#FFEDD5','#DCFCE7','#FFEDD5','#CCFBF1','#E0E7FF','#FCE7F3'];
begin
  if current_user_id is null or (not public.is_active_member()
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false)) then
    raise exception 'active account required' using errcode = '42501';
  end if;
  select * into current_identity from public.anonymous_identities i where i.user_id = current_user_id;
  if not found then
    identity_index := floor(random() * array_length(animal_names, 1))::integer + 1;
    insert into public.anonymous_identities(user_id, display_name, emoji, color)
    values (current_user_id,
      'Anonymous ' || animal_names[identity_index] || ' #' || (100 + floor(random() * 900)::integer)::text,
      animal_emojis[identity_index], animal_colors[identity_index])
    returning * into current_identity;
  end if;
  return query select current_identity.display_name, current_identity.emoji,
    current_identity.color, current_identity.legacy_ghost_id;
end;
$$;

create or replace function public.create_comment(p_post_public_id uuid, p_body text)
returns table(public_id uuid, post_public_id uuid, author_name text, author_emoji text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_identity public.anonymous_identities%rowtype;
begin
  if current_user_id is null or not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  if char_length(trim(p_body)) not between 1 and 500 then raise exception 'comment must be 1 to 500 characters' using errcode = '22023'; end if;
  perform public.ensure_anonymous_identity();
  select * into current_identity from public.anonymous_identities where user_id = current_user_id;
  if not found then raise exception 'anonymous identity is unavailable' using errcode = '23503'; end if;
  return query
    insert into public.comments(post_public_id, owner_user_id, actor_id, author_name, author_emoji, body)
    select p.public_id, current_user_id, current_user_id,
      current_identity.display_name, current_identity.emoji, trim(p_body)
    from public.posts p where p.public_id = p_post_public_id and p.status = 'approved' and p.expires_at > now()
    returning comments.public_id, comments.post_public_id, comments.author_name, comments.author_emoji, comments.body, comments.created_at;
  if not found then raise exception 'post not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.delete_comment(p_comment_public_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'active account required' using errcode = '42501';
  end if;
  delete from public.comments c
  where c.public_id = p_comment_public_id and c.actor_id = (select auth.uid());
  if not found then raise exception 'comment not found or you cannot remove it' using errcode = 'P0002'; end if;
  return true;
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
  values (current_user_id, (now() at time zone 'utc')::date, 1)
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

create or replace function public.set_poll_vote(p_poll_public_id uuid, p_option_id uuid)
returns table(total_votes integer, selected_option_id uuid)
language plpgsql security definer set search_path = '' as $$
declare current_actor_id uuid := auth.uid();
begin
  if current_actor_id is null or not public.is_valid_voter() then raise exception 'sign in required to vote' using errcode = '42501'; end if;
  if not exists (select 1 from public.polls p where p.public_id = p_poll_public_id and p.status = 'published' and p.expires_at > now()) then
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

create or replace function public.my_poll_vote(p_poll_public_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select v.option_id from public.poll_votes v where v.poll_public_id = p_poll_public_id and v.actor_key = (select auth.uid())::text;
$$;

create or replace function public.feed_polls_page(p_limit integer default 30)
returns table(public_id uuid, tag text, question text, author_name text, author_emoji text, author_color text,
  total_votes integer, options jsonb, my_option_id uuid, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.public_id, p.tag, p.question, p.author_name, p.author_emoji, p.author_color,
    p.total_votes,
    coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'emoji', o.emoji, 'color', o.color, 'votes', o.vote_count) order by o.position)
      from public.poll_options o where o.poll_public_id = p.public_id), '[]'::jsonb),
    (select v.option_id from public.poll_votes v where v.poll_public_id = p.public_id and v.actor_key = (select auth.uid())::text),
    p.created_at, p.expires_at
  from public.polls p
  where p.status = 'published' and p.expires_at > now()
  order by p.created_at desc, p.public_id desc limit greatest(1, least(coalesce(p_limit, 30), 50));
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
  values (current_user_id, (now() at time zone 'utc')::date, 1)
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

create or replace function public.set_post_like(p_post_public_id uuid, p_liked boolean)
returns table(liked boolean, likes_count integer)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_profile_id uuid;
begin
  if current_user_id is null or not public.is_valid_voter() then raise exception 'sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.posts where public_id = p_post_public_id and status = 'approved' and expires_at > now()) then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  select p.id into current_profile_id from public.profiles p where p.id = current_user_id;
  if p_liked then
    insert into public.likes(post_public_id, user_id, actor_key)
    values (p_post_public_id, current_profile_id, current_user_id::text) on conflict do nothing;
  else
    delete from public.likes where post_public_id = p_post_public_id and actor_key = current_user_id::text;
  end if;
  return query select exists(select 1 from public.likes l where l.post_public_id = p_post_public_id and l.actor_key = current_user_id::text),
    p.likes_count from public.posts as p where p.public_id = p_post_public_id;
end;
$$;

create or replace function public.has_liked_post(p_post_public_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.likes l where l.post_public_id = p_post_public_id and l.actor_key = (select auth.uid())::text);
$$;

create or replace function public.feed_posts_page(p_before_created_at timestamptz default null,
  p_before_public_id uuid default null, p_category public.post_category default null, p_limit integer default 20)
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
    and (p_category is null or p.category = p_category)
    and (p_before_created_at is null or (p.created_at, p.public_id) < (p_before_created_at, p_before_public_id))
  order by p.created_at desc, p.public_id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create or replace function public.delete_own_post(p_post_public_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'active account required' using errcode = '42501';
  end if;
  update public.posts p set status = 'deleted', deleted_at = now(),
    deleted_by = (select auth.uid()), deletion_reason = 'Removed by author'
  where p.public_id = p_post_public_id and p.owner_user_id = (select auth.uid())
    and p.status in ('approved', 'pending', 'hidden');
  if not found then raise exception 'post not found or you cannot remove it' using errcode = 'P0002'; end if;
  return true;
end;
$$;

create or replace function public.feed_comments_page(p_post_public_id uuid, p_before_created_at timestamptz default null,
  p_limit integer default 50)
returns table(public_id uuid, author_name text, author_emoji text, body text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select c.public_id, c.author_name, c.author_emoji, c.body, c.created_at, c.actor_id = (select auth.uid())
  from public.comments c join public.posts p on p.public_id = c.post_public_id
  where c.post_public_id = p_post_public_id and c.status = 'approved'
    and p.status = 'approved' and p.expires_at > now()
    and (p_before_created_at is null or c.created_at > p_before_created_at)
  order by c.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.feed_pulse_stats()
returns table(secrets_today bigint, confessions bigint, memes bigint, rants bigint, spotted bigint, total_secrets bigint)
language sql stable security definer set search_path = '' as $$
  select
    count(*) filter (where p.created_at >= now() - interval '24 hours'),
    count(*) filter (where p.category = 'Confessions' and p.created_at >= now() - interval '24 hours'),
    count(*) filter (where p.category = 'Memes' and p.created_at >= now() - interval '24 hours'),
    count(*) filter (where p.category = 'Rants' and p.created_at >= now() - interval '24 hours'),
    count(*) filter (where p.category = 'Spotted' and p.created_at >= now() - interval '24 hours') +
      (select count(*) from public.crushes c where c.created_at >= now() - interval '24 hours' and c.expires_at > now()),
    count(*)
  from public.posts p
  where p.status = 'approved' and p.expires_at > now();
$$;

create or replace function public.get_post_usage()
returns table(used integer, daily_limit integer, remaining integer, usage_day date)
language sql stable security definer set search_path = '' as $$
  select coalesce(u.post_count, 0), 5, greatest(0, 5 - coalesce(u.post_count, 0)), (now() at time zone 'utc')::date
  from (select (select auth.uid()) as user_id) viewer
  left join public.daily_post_usage u on u.user_id = viewer.user_id and u.usage_day = (now() at time zone 'utc')::date;
$$;

create or replace function public.send_mailbox_message(p_recipient_ghost_id text, p_body text)
returns table(public_id uuid, sender_name text, sender_emoji text, sender_color text, preview text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); sender public.anonymous_identities%rowtype;
  recipient public.anonymous_identities%rowtype; message_id uuid := gen_random_uuid();
begin
  if current_user_id is null or not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  if char_length(trim(p_body)) not between 1 and 1000 then raise exception 'message must be 1 to 1000 characters' using errcode = '22023'; end if;
  select * into sender from public.anonymous_identities where user_id = current_user_id;
  select * into recipient from public.anonymous_identities where legacy_ghost_id = p_recipient_ghost_id;
  if not found or recipient.user_id = current_user_id or not exists (
    select 1 from public.profiles p where p.id = recipient.user_id and p.moderation_status = 'ACTIVE'
  ) then raise exception 'recipient is unavailable' using errcode = 'P0002'; end if;
  insert into public.mailbox_messages(public_id, recipient_identity_id, sender_identity_id, recipient_name,
    sender_name, sender_emoji, sender_color, preview, body)
  values (message_id, recipient.id, sender.id, recipient.display_name, sender.display_name,
    sender.emoji, sender.color, left(trim(p_body), 30), trim(p_body));
  return query select message_id, sender.display_name, sender.emoji, sender.color, left(trim(p_body), 30), now();
end;
$$;

create or replace function public.list_mailbox_messages()
returns table(public_id uuid, sender_name text, sender_emoji text, sender_color text, preview text,
  body text, is_sealed boolean, sent boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.public_id, m.sender_name, m.sender_emoji, m.sender_color, m.preview,
    case when m.sender_identity_id = i.id or not m.is_sealed then m.body else null end,
    case when m.sender_identity_id = i.id then false else m.is_sealed end,
    m.sender_identity_id = i.id, m.created_at
  from public.mailbox_messages m join public.anonymous_identities i
    on i.user_id = (select auth.uid()) and (i.id = m.recipient_identity_id or i.id = m.sender_identity_id)
  where m.burned_at > now()
  order by m.created_at desc limit 100;
$$;

create or replace function public.open_mailbox_message(p_public_id uuid)
returns table(public_id uuid, sender_name text, sender_emoji text, sender_color text, preview text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare opened public.mailbox_messages%rowtype;
begin
  update public.mailbox_messages m set is_sealed = false
  where m.public_id = p_public_id and m.burned_at > now() and exists (
    select 1 from public.anonymous_identities i where i.id = m.recipient_identity_id and i.user_id = (select auth.uid())
  ) returning m.* into opened;
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  return query select opened.public_id, opened.sender_name, opened.sender_emoji, opened.sender_color,
    opened.preview, opened.body, opened.created_at;
end;
$$;

create or replace function public.active_ghost_profiles()
returns table(ghost_id text, display_name text, emoji text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_member() then raise exception 'active account required' using errcode = '42501'; end if;
  return query select i.legacy_ghost_id, i.display_name, i.emoji
    from public.anonymous_identities i join public.profiles p on p.id = i.user_id
    where p.moderation_status = 'ACTIVE' and i.user_id <> (select auth.uid())
    order by p.updated_at desc limit 50;
end;
$$;

-- Random Chat is account-only. Queue matching is transactional and serialized
-- so concurrent joins cannot create duplicate or self-matched rooms.
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
      coalesce((select jsonb_agg(jsonb_build_object('body', m.body, 'sender_id', m.sender_id,
        'sender_profile', m.sender_profile, 'created_at', m.created_at) order by m.created_at)
        from (select rm.* from public.random_chat_messages rm where rm.session_id = active.id
          and (rm.expires_at is null or rm.expires_at > now()) order by rm.created_at desc limit 100) m), '[]'::jsonb);
    return;
  end if;
  if exists(select 1 from public.random_chat_queue q where q.user_id = me and q.status = 'WAITING' and q.expires_at > now()) then
    return query select 'searching'::text, null::uuid, null::uuid, null::jsonb, '[]'::jsonb;
  else
    return query select 'idle'::text, null::uuid, null::uuid, null::jsonb, '[]'::jsonb;
  end if;
end;
$$;

create or replace function public.random_chat_start()
returns table(state text, session_id uuid, session_key uuid, partner jsonb)
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); candidate uuid; own_identity public.anonymous_identities%rowtype;
  other_identity public.anonymous_identities%rowtype; left_user uuid; right_user uuid;
  left_profile jsonb; right_profile jsonb; new_session public.random_chat_sessions%rowtype;
begin
  if me is null or not public.is_active_member() then raise exception 'registered active account required for Random Chat' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(781235901);
  if exists(select 1 from public.random_chat_sessions s where s.status = 'ACTIVE' and me in (s.user_a_id, s.user_b_id)) then
    return query select c.state,c.session_id,c.session_key,c.partner from public.random_chat_current() c; return;
  end if;
  insert into public.random_chat_queue(user_id,status,created_at,expires_at)
    values(me,'WAITING',now(),now()+interval '60 seconds')
    on conflict(user_id) do update set status='WAITING',created_at=now(),expires_at=now()+interval '60 seconds';
  select q.user_id into candidate from public.random_chat_queue q
    join public.profiles p on p.id=q.user_id and p.moderation_status='ACTIVE'
    where q.user_id<>me and q.status='WAITING' and q.expires_at>now()
      and not exists(select 1 from public.random_chat_blocks b where (b.blocker_id=me and b.blocked_id=q.user_id) or (b.blocker_id=q.user_id and b.blocked_id=me))
      and not exists(select 1 from public.random_chat_queue_exclusions e where e.user_id=me and e.excluded_user_id=q.user_id)
      and not exists(select 1 from public.random_chat_queue_exclusions e where e.user_id=q.user_id and e.excluded_user_id=me)
      and not exists(select 1 from public.random_chat_sessions s where s.created_at>now()-interval '120 seconds'
        and ((s.user_a_id=me and s.user_b_id=q.user_id) or (s.user_b_id=me and s.user_a_id=q.user_id)))
      and not exists(select 1 from public.random_chat_sessions s where s.status='ACTIVE' and q.user_id in (s.user_a_id,s.user_b_id))
    order by q.created_at,q.user_id limit 1 for update of q skip locked;
  if candidate is null then
    return query select 'searching'::text,null::uuid,null::uuid,null::jsonb; return;
  end if;
  select * into own_identity from public.anonymous_identities where user_id=me;
  select * into other_identity from public.anonymous_identities where user_id=candidate;
  if own_identity.id is null or other_identity.id is null then
    delete from public.random_chat_queue where user_id in (me,candidate);
    raise exception 'anonymous profile unavailable' using errcode = 'P0002';
  end if;
  left_user := least(me,candidate); right_user := greatest(me,candidate);
  if left_user=me then
    left_profile:=jsonb_build_object('name',own_identity.display_name,'emoji',own_identity.emoji,'color',own_identity.color);
    right_profile:=jsonb_build_object('name',other_identity.display_name,'emoji',other_identity.emoji,'color',other_identity.color);
  else
    left_profile:=jsonb_build_object('name',other_identity.display_name,'emoji',other_identity.emoji,'color',other_identity.color);
    right_profile:=jsonb_build_object('name',own_identity.display_name,'emoji',own_identity.emoji,'color',own_identity.color);
  end if;
  insert into public.random_chat_sessions(user_a_id,user_b_id,profile_a,profile_b)
    values(left_user,right_user,left_profile,right_profile) returning * into new_session;
  delete from public.random_chat_queue where user_id in (me,candidate);
  perform realtime.send(jsonb_build_object('session_id',new_session.id,'session_key',new_session.session_key,
    'partner',case when me=left_user then right_profile else left_profile end),
    'random:matched','user:'||me::text,true);
  perform realtime.send(jsonb_build_object('session_id',new_session.id,'session_key',new_session.session_key,
    'partner',case when candidate=left_user then right_profile else left_profile end),
    'random:matched','user:'||candidate::text,true);
  return query select 'matched'::text,new_session.id,new_session.session_key,
    case when me=left_user then right_profile else left_profile end;
end;
$$;

create or replace function public.random_chat_heartbeat()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_member() then return false; end if;
  update public.random_chat_queue set expires_at=now()+interval '60 seconds'
    where user_id=(select auth.uid()) and status='WAITING';
  return found;
end;
$$;

create or replace function public.random_chat_cancel()
returns boolean language plpgsql security definer set search_path = '' as $$
begin delete from public.random_chat_queue where user_id=(select auth.uid()); return found; end;
$$;

create or replace function private.broadcast_random_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare room public.random_chat_sessions%rowtype; event_body jsonb;
begin
  select * into room from public.random_chat_sessions where id=new.session_id;
  event_body:=jsonb_build_object('session_key',room.session_key,'body',new.body,
    'sender_id',new.sender_id,'sender_profile',new.sender_profile,'created_at',new.created_at);
  perform realtime.send(event_body,'random:message','user:'||room.user_a_id::text,true);
  perform realtime.send(event_body,'random:message','user:'||room.user_b_id::text,true);
  return new;
end;
$$;
create trigger random_chat_message_broadcast after insert on public.random_chat_messages
  for each row execute function private.broadcast_random_message();

create or replace function public.random_chat_send(p_session_key uuid,p_body text)
returns table(body text,sender_id uuid,sender_profile jsonb,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare me uuid:=auth.uid(); room public.random_chat_sessions%rowtype; clean_body text:=btrim(p_body);
  limiter private.random_chat_limits%rowtype; body_hash text:=md5(btrim(p_body)); new_message public.random_chat_messages%rowtype;
begin
  if me is null or not public.is_active_member() then raise exception 'active account required' using errcode='42501'; end if;
  if char_length(clean_body) not between 1 and 500 then raise exception 'message must be 1 to 500 characters' using errcode='22023'; end if;
  if clean_body ~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m[0-9]{10,}\M|(?:instagram|snapchat|phone|number)\s*[:=])' then
    raise exception 'please keep personal contact information out of Random Chat' using errcode='22023';
  end if;
  select * into room from public.random_chat_sessions s where s.session_key=p_session_key and s.status='ACTIVE' and me in(s.user_a_id,s.user_b_id);
  if not found then raise exception 'this chat has ended' using errcode='P0002'; end if;
  insert into private.random_chat_limits(user_id,window_started_at,message_count,last_body_hash,last_sent_at)
    values(me,now(),1,body_hash,now()) on conflict(user_id) do nothing;
  select * into limiter from private.random_chat_limits where user_id=me for update;
  if limiter.window_started_at<now()-interval '1 minute' then
    update private.random_chat_limits set window_started_at=now(),message_count=1,last_body_hash=body_hash,last_sent_at=now() where user_id=me;
  elsif limiter.message_count>=20 then raise exception 'slow down before sending another message' using errcode='P0001';
  elsif limiter.last_body_hash=body_hash and limiter.last_sent_at>now()-interval '2 seconds' then
    raise exception 'please wait before repeating a message' using errcode='P0001';
  else update private.random_chat_limits set message_count=message_count+1,last_body_hash=body_hash,last_sent_at=now() where user_id=me;
  end if;
  insert into public.random_chat_messages(session_id,sender_id,sender_profile,body)
    values(room.id,me,case when me=room.user_a_id then room.profile_a else room.profile_b end,clean_body)
    returning * into new_message;
  return query select new_message.body,new_message.sender_id,new_message.sender_profile,new_message.created_at;
end;
$$;

create or replace function public.random_chat_end(p_session_key uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid:=auth.uid(); room public.random_chat_sessions%rowtype;
begin
  update public.random_chat_sessions s set status='ENDED',ended_at=now(),
    expires_at=case when s.moderation_hold then null else now()+interval '30 days' end
  where s.session_key=p_session_key and s.status='ACTIVE' and me in(s.user_a_id,s.user_b_id)
  returning * into room;
  if not found then return false; end if;
  if not room.moderation_hold then update public.random_chat_messages set expires_at=now()+interval '1 day'
    where session_id=room.id and expires_at is null; end if;
  delete from public.random_chat_queue where user_id in(room.user_a_id,room.user_b_id);
  perform realtime.send(jsonb_build_object('session_key',room.session_key,'reason','ended'),'random:ended','user:'||room.user_a_id::text,true);
  perform realtime.send(jsonb_build_object('session_key',room.session_key,'reason','ended'),'random:ended','user:'||room.user_b_id::text,true);
  return true;
end;
$$;

create or replace function public.random_chat_block(p_session_key uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid:=auth.uid(); room public.random_chat_sessions%rowtype; peer uuid;
begin
  select * into room from public.random_chat_sessions s where s.session_key=p_session_key and s.status='ACTIVE' and me in(s.user_a_id,s.user_b_id) for update;
  if not found then raise exception 'this chat has ended' using errcode='P0002'; end if;
  peer:=case when room.user_a_id=me then room.user_b_id else room.user_a_id end;
  insert into public.random_chat_blocks(blocker_id,blocked_id) values(me,peer) on conflict do nothing;
  return public.random_chat_end(p_session_key);
end;
$$;

create or replace function public.random_chat_report(p_session_key uuid,p_reason text,p_detail text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid:=auth.uid(); room public.random_chat_sessions%rowtype; peer uuid; report_id uuid:=gen_random_uuid();
begin
  if me is null or not public.is_active_member() then raise exception 'active account required' using errcode='42501'; end if;
  if p_reason not in ('Harassment','Bullying','Threat','Sexual/explicit content','Spam','Hate/abuse','Asking for personal information','Sharing inappropriate content','Other') then
    raise exception 'choose a report reason' using errcode='22023';
  end if;
  select * into room from public.random_chat_sessions s where s.session_key=p_session_key and me in(s.user_a_id,s.user_b_id);
  if not found then raise exception 'chat not found' using errcode='P0002'; end if;
  peer:=case when room.user_a_id=me then room.user_b_id else room.user_a_id end;
  insert into public.random_chat_reports(id,session_id,reporter_id,reported_id,reason,detail)
    values(report_id,room.id,me,peer,p_reason,left(coalesce(p_detail,''),1000));
  update public.random_chat_sessions set moderation_hold=true where id=room.id;
  if room.status='ACTIVE' then perform public.random_chat_end(p_session_key); end if;
  return report_id;
end;
$$;

create or replace function public.submit_report(p_post_public_id uuid, p_target_type public.report_target_type,
  p_comment_public_id uuid, p_reason text, p_detail text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor_profile_id uuid; target_comment public.comments%rowtype;
  target_post public.posts%rowtype; target_account_id uuid; new_report_id uuid := gen_random_uuid();
begin
  if actor_id is null or not public.is_valid_voter() then raise exception 'sign in required to report' using errcode = '42501'; end if;
  if p_reason not in ('Harassment / Bullying', 'Spam / Irrelevant', 'Personal Info (Doxxing)', 'Harassment',
    'Bullying', 'Hate / abusive content', 'Sexual content', 'Threat', 'Personal information', 'Impersonation', 'Other') then
    raise exception 'invalid report reason' using errcode = '22023';
  end if;
  if (select count(*) from public.reports r where r.reporter_auth_id = actor_id and r.created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'report limit reached' using errcode = 'P0001';
  end if;
  select * into target_post from public.posts p where p.public_id = p_post_public_id and p.status = 'approved' and p.expires_at > now();
  if not found then raise exception 'post not found' using errcode = 'P0002'; end if;
  select p.id into actor_profile_id from public.profiles p where p.id = actor_id;
  if p_target_type = 'comment' then
    select * into target_comment from public.comments c where c.public_id = p_comment_public_id
      and c.post_public_id = p_post_public_id and c.status = 'approved';
    if not found then raise exception 'comment not found' using errcode = 'P0002'; end if;
    target_account_id := target_comment.owner_user_id;
  elsif p_target_type = 'account' then
    target_account_id := target_post.owner_user_id;
    if target_account_id is null then raise exception 'account is not available to report' using errcode = 'P0002'; end if;
  elsif p_target_type <> 'post' then
    raise exception 'invalid report target' using errcode = '22023';
  end if;
  if exists (select 1 from public.reports r where r.reporter_auth_id = actor_id and r.target_type = p_target_type
    and r.post_public_id = p_post_public_id
    and (p_target_type <> 'comment' or r.comment_id = target_comment.id)
    and (p_target_type <> 'account' or r.reported_user_id = target_account_id)) then
    raise exception 'report already exists' using errcode = '23505';
  end if;
  insert into public.reports(id, target_type, post_public_id, comment_id, reported_user_id,
    reporter_user_id, reporter_auth_id, reason, detail)
  values (new_report_id, p_target_type, p_post_public_id,
    case when p_target_type = 'comment' then target_comment.id else null end,
    case when p_target_type in ('comment', 'account') then target_account_id else null end,
    actor_profile_id, actor_id, p_reason, left(coalesce(p_detail, ''), 1000));
  return new_report_id;
end;
$$;

create or replace function public.increment_crush_reaction(p_crush_public_id uuid, p_kind text)
returns table(ships integer, blushes integer)
language plpgsql security definer set search_path = '' as $$
declare current_actor_id uuid := auth.uid();
begin
  if current_actor_id is null or not public.is_valid_voter() then raise exception 'sign in required to react' using errcode = '42501'; end if;
  if p_kind not in ('ship', 'blush') then raise exception 'invalid reaction' using errcode = '22023'; end if;
  insert into public.crush_reactions(crush_public_id, actor_id, kind)
  values (p_crush_public_id, current_actor_id, p_kind) on conflict do nothing;
  return query select c.ships_count, c.blushes_count from public.crushes c where c.public_id = p_crush_public_id;
end;
$$;

create or replace function public.delete_expired_content()
returns bigint language plpgsql security definer set search_path = '' as $$
declare affected bigint := 0; changed bigint;
begin
  delete from public.posts where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.polls where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.crushes where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.mailbox_messages where burned_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.random_chat_messages where expires_at <= now(); get diagnostics changed = row_count; affected := affected + changed;
  delete from public.random_chat_queue where expires_at <= now();
  return affected;
end;
$$;

create or replace function private.reject_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'audit records are append-only'; end;
$$;
create trigger admin_actions_immutable before update or delete on public.admin_actions
for each row execute function private.reject_audit_mutation();

alter table public.profiles enable row level security;
alter table public.anonymous_identities enable row level security;
alter table public.invitation_codes enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.crushes enable row level security;
alter table public.crush_reactions enable row level security;
alter table public.mailbox_messages enable row level security;
alter table public.media enable row level security;
alter table public.reports enable row level security;
alter table public.admin_actions enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.daily_post_usage enable row level security;
alter table public.bookmarks enable row level security;
alter table public.random_chat_sessions enable row level security;
alter table public.random_chat_messages enable row level security;
alter table public.random_chat_queue enable row level security;
alter table public.random_chat_queue_exclusions enable row level security;
alter table public.random_chat_blocks enable row level security;
alter table public.random_chat_reports enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant select (id, username, role, moderation_status, created_at, updated_at) on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;
grant select (legacy_ghost_id, display_name, emoji, color) on public.anonymous_identities to authenticated;
grant select (public_id, category, body, location, branch, author_name, author_emoji, author_color,
  likes_count, comments_count, reports_count, created_at, updated_at, expires_at) on public.posts to anon, authenticated;
grant select (public_id, post_public_id, author_name, author_emoji, body, created_at) on public.comments to anon, authenticated;
grant delete on public.comments to authenticated;
grant select (public_id, tag, question, author_name, author_emoji, author_color, total_votes, status, created_at, expires_at) on public.polls to anon, authenticated;
grant select (id, poll_public_id, position, label, emoji, color, vote_count) on public.poll_options to anon, authenticated;
grant select (public_id, recipient, location, message, author_name, author_emoji, author_color, ships_count, blushes_count, created_at, expires_at) on public.crushes to anon, authenticated;
grant select (public_id, post_public_id, storage_path, mime_type, file_size_bytes, width, height, created_at) on public.media to anon, authenticated;
grant insert (public_id, owner_user_id, storage_path, mime_type, file_size_bytes, width, height) on public.media to authenticated;
grant delete on public.media to authenticated;
grant select (user_id, usage_day, post_count) on public.daily_post_usage to authenticated;
grant insert (user_id, post_public_id) on public.bookmarks to authenticated;
grant delete on public.bookmarks to authenticated;
grant select (user_id, post_public_id, created_at) on public.bookmarks to authenticated;
grant select (id, action, target_type, target_id, reason, metadata, created_at, admin_identity) on public.admin_actions to authenticated;

grant usage on schema public to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_active_member() to anon, authenticated;
grant execute on function public.is_valid_voter() to authenticated;
grant execute on function public.can_read_media(text) to anon, authenticated;
grant execute on function public.is_public_post(uuid) to anon, authenticated;
grant execute on function public.can_read_comment(uuid) to anon, authenticated;
grant execute on function public.can_read_post(uuid) to anon, authenticated;
grant execute on function public.is_public_poll(uuid) to anon, authenticated;
grant execute on function public.owns_uploaded_media_object(text) to authenticated;
grant execute on function public.create_post(public.post_category, text, text, text, uuid) to authenticated;
grant execute on function public.delete_own_post(uuid) to authenticated;
grant execute on function public.create_comment(uuid, text) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.ensure_anonymous_identity() to authenticated;
grant execute on function public.create_poll(text, text, jsonb) to authenticated;
grant execute on function public.set_poll_vote(uuid, uuid) to authenticated;
grant execute on function public.my_poll_vote(uuid) to authenticated;
grant execute on function public.feed_posts_page(timestamptz, uuid, public.post_category, integer) to anon, authenticated;
grant execute on function public.feed_comments_page(uuid, timestamptz, integer) to anon, authenticated;
grant execute on function public.feed_polls_page(integer) to anon, authenticated;
grant execute on function public.feed_pulse_stats() to anon, authenticated;
grant execute on function public.random_chat_current() to authenticated;
grant execute on function public.random_chat_start() to authenticated;
grant execute on function public.random_chat_heartbeat() to authenticated;
grant execute on function public.random_chat_cancel() to authenticated;
grant execute on function public.random_chat_send(uuid, text) to authenticated;
grant execute on function public.random_chat_end(uuid) to authenticated;
grant execute on function public.random_chat_block(uuid) to authenticated;
grant execute on function public.random_chat_report(uuid, text, text) to authenticated;
grant execute on function public.get_post_usage() to authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.send_mailbox_message(text, text) to authenticated;
grant execute on function public.list_mailbox_messages() to authenticated;
grant execute on function public.open_mailbox_message(uuid) to authenticated;
grant execute on function public.active_ghost_profiles() to authenticated;
grant execute on function public.set_post_like(uuid, boolean) to authenticated;
grant execute on function public.has_liked_post(uuid) to authenticated;
grant execute on function public.create_crush(text, text, text) to authenticated;
grant execute on function public.increment_crush_reaction(uuid, text) to authenticated;
grant execute on function public.submit_report(uuid, public.report_target_type, uuid, text, text) to authenticated;
grant execute on function public.delete_expired_content() to service_role;
grant execute on function public.legacy_auth_record(text) to service_role;
grant execute on function public.legacy_import_target(text, text) to service_role;
grant execute on function public.legacy_import_targets(text, text[]) to service_role;
grant execute on function public.record_legacy_import(text, text, uuid) to service_role;
grant execute on function public.record_legacy_password(uuid, text, text) to service_role;
grant execute on function public.clear_legacy_auth_record(uuid) to service_role;
grant execute on function public.take_auth_attempt(text, integer) to service_role;
grant execute on function public.claim_invited_account(uuid, text, text, text, text, text, text, text) to service_role;

create policy profiles_read_self_or_admin on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active_member()))
  with check (id = (select auth.uid()) and (select public.is_active_member()));

create policy identity_read_self_or_admin on public.anonymous_identities for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy posts_read_public_or_owner on public.posts for select to anon, authenticated
  using (public.can_read_post(public_id));
create policy comments_read_visible on public.comments for select to anon, authenticated
  using (public.can_read_comment(public_id));
create policy comments_insert_active_owner on public.comments for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and actor_id = (select auth.uid())
    and (select public.is_active_member()) and status = 'approved'
    and public.is_public_post(post_public_id));
create policy comments_delete_owner on public.comments for delete to authenticated
  using (actor_id = (select auth.uid()) and (select public.is_valid_voter()));

create policy polls_read_public on public.polls for select to anon, authenticated
  using (public.is_public_poll(public_id));
create policy poll_options_read_public on public.poll_options for select to anon, authenticated
  using (public.is_public_poll(poll_public_id));
create policy crushes_read_public on public.crushes for select to anon, authenticated
  using (expires_at > now());

create policy media_read_allowed on public.media for select to anon, authenticated
  using (public.can_read_media(storage_path));
create policy media_insert_owner on public.media for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and (select public.is_active_member()) and post_public_id is null
    and public.owns_uploaded_media_object(storage_path));
create policy media_delete_unattached_owner on public.media for delete to authenticated
  using (owner_user_id = (select auth.uid()) and post_public_id is null and (select public.is_active_member()));

create policy likes_insert_owner on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_valid_voter()) and public.is_public_post(post_public_id));
create policy likes_delete_owner on public.likes for delete to authenticated
  using (user_id = (select auth.uid()) and actor_key = (select auth.uid())::text and (select public.is_valid_voter()));

create policy poll_votes_select_own on public.poll_votes for select to authenticated
  using (actor_id = (select auth.uid()) or (select public.is_admin()));
create policy poll_votes_insert_own on public.poll_votes for insert to authenticated
  with check (actor_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_valid_voter()) and public.is_public_poll(poll_public_id));
create policy poll_votes_delete_own on public.poll_votes for delete to authenticated
  using (actor_id = (select auth.uid()) and actor_key = (select auth.uid())::text and (select public.is_valid_voter()));
create policy crush_reactions_select_own on public.crush_reactions for select to authenticated
  using (actor_id = (select auth.uid()));
create policy crush_reactions_insert_own on public.crush_reactions for insert to authenticated
  with check (actor_id = (select auth.uid()) and (select public.is_valid_voter()));
create policy crush_reactions_delete_own on public.crush_reactions for delete to authenticated
  using (actor_id = (select auth.uid()) and (select public.is_valid_voter()));

create policy mailbox_read_recipient on public.mailbox_messages for select to authenticated
  using (exists (select 1 from public.anonymous_identities i where i.id = recipient_identity_id and i.user_id = (select auth.uid())) or (select public.is_admin()));
create policy mailbox_insert_active_sender on public.mailbox_messages for insert to authenticated
  with check ((select public.is_active_member()) and exists (
    select 1 from public.anonymous_identities i where i.id = sender_identity_id and i.user_id = (select auth.uid())
  ));
create policy mailbox_update_recipient on public.mailbox_messages for update to authenticated
  using (exists (select 1 from public.anonymous_identities i where i.id = recipient_identity_id and i.user_id = (select auth.uid())))
  with check (exists (select 1 from public.anonymous_identities i where i.id = recipient_identity_id and i.user_id = (select auth.uid())));

create policy reports_insert_valid_target on public.reports for insert to anon, authenticated
  with check ((reporter_user_id is null or reporter_user_id = (select auth.uid())) and (
    (target_type = 'post' and exists (select 1 from public.posts p where p.public_id = post_public_id and p.status = 'approved' and p.expires_at > now())) or
    (target_type = 'comment' and exists (select 1 from public.comments c join public.posts p on p.public_id = c.post_public_id
      where c.id = comment_id and c.status = 'approved' and p.status = 'approved' and p.expires_at > now())) or
    (target_type = 'account' and reported_user_id is not null)
  ));
create policy reports_read_admin on public.reports for select to authenticated using ((select public.is_admin()));
create policy admin_actions_read_admin on public.admin_actions for select to authenticated using ((select public.is_admin()));
create policy usage_read_own on public.daily_post_usage for select to authenticated using (user_id = (select auth.uid()));
create policy bookmarks_read_own on public.bookmarks for select to authenticated using (user_id = (select auth.uid()));
create policy bookmarks_insert_own on public.bookmarks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));
create policy bookmarks_delete_own on public.bookmarks for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()));

create policy random_sessions_member_read on public.random_chat_sessions for select to authenticated
  using ((select auth.uid()) in (user_a_id, user_b_id) or (select public.is_admin()));
create policy random_messages_member_read on public.random_chat_messages for select to authenticated
  using (exists (select 1 from public.random_chat_sessions s where s.id = session_id and
    ((select auth.uid()) in (s.user_a_id, s.user_b_id) or (select public.is_admin()))));
create policy random_messages_member_insert on public.random_chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and (select public.is_active_member()) and exists (
    select 1 from public.random_chat_sessions s where s.id = session_id and s.status = 'ACTIVE' and (select auth.uid()) in (s.user_a_id, s.user_b_id)
  ));
create policy random_queue_read_own on public.random_chat_queue for select to authenticated using (user_id = (select auth.uid()));
create policy random_queue_write_own on public.random_chat_queue for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member()))
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));
create policy random_blocks_read_own on public.random_chat_blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy random_blocks_insert_own on public.random_chat_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()) and (select public.is_active_member()));
create policy random_reports_insert_reporter on public.random_chat_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and (select public.is_active_member()) and exists (
    select 1 from public.random_chat_sessions s where s.id = session_id and (select auth.uid()) in (s.user_a_id, s.user_b_id)
  ));
create policy random_reports_read_admin on public.random_chat_reports for select to authenticated using ((select public.is_admin()));

-- Public feeds use anonymous snapshots; account IDs and identity mappings are never readable publicly.
create policy realtime_public_feed on realtime.messages for select to anon, authenticated
  using (topic = 'unseen:feed');
create policy realtime_admin_actions on realtime.messages for select to authenticated
  using (topic = 'admin:' || (select auth.uid())::text and (select public.is_admin()));
create policy realtime_user_moderation on realtime.messages for select to authenticated
  using (topic = 'user:' || (select auth.uid())::text);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('unseen-media', 'unseen-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy unseen_media_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'unseen-media' and public.can_read_media(name));
create policy unseen_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'unseen-media' and owner_id = (select auth.uid())::text and (select public.is_active_member()));
create policy unseen_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'unseen-media' and (
    (owner_id = (select auth.uid())::text and not exists (select 1 from public.media m where m.storage_path = name and m.post_public_id is not null))
    or (select public.is_admin())
  ));

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.delete_expired_content() from public, anon, authenticated;
revoke all on function public.bump_comment_count() from public, anon, authenticated;
revoke all on function public.bump_like_count() from public, anon, authenticated;
revoke all on function public.broadcast_like_change() from public, anon, authenticated;
revoke all on function public.bump_crush_reaction_count() from public, anon, authenticated;
revoke all on function public.broadcast_post_change() from public, anon, authenticated;
revoke all on function public.broadcast_comment_change() from public, anon, authenticated;
revoke all on function public.broadcast_admin_action() from public, anon, authenticated;
revoke all on function private.reject_audit_mutation() from public, anon, authenticated;
revoke all on function private.broadcast_random_message() from public, anon, authenticated;

commit;
