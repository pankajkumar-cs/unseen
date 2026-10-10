create or replace function public.feed_post_by_id(p_public_id uuid)
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
  where p.public_id = p_public_id and p.status = 'approved' and p.expires_at > now()
  limit 1;
$$;
revoke all on function public.feed_post_by_id(uuid) from public;
grant execute on function public.feed_post_by_id(uuid) to anon, authenticated;

create or replace function public.feed_saved_posts(p_limit integer default 100)
returns table(public_id uuid, category public.post_category, body text, author_name text, author_emoji text,
  author_color text, location text, branch text, created_at timestamptz, likes_count integer,
  comments_count integer, viewer_liked boolean, viewer_owned boolean, viewer_bookmarked boolean,
  storage_path text, mime_type text, image_width integer, image_height integer)
language sql stable security definer set search_path = '' as $$
  select p.public_id, p.category, p.body, p.author_name, p.author_emoji, p.author_color,
    p.location, p.branch, p.created_at, p.likes_count, p.comments_count,
    exists (select 1 from public.likes l where l.post_public_id = p.public_id and l.actor_key = (select auth.uid())::text),
    p.owner_user_id = (select auth.uid()),
    true,
    m.storage_path, m.mime_type, m.width, m.height
  from public.bookmarks b
  join public.posts p on p.public_id = b.post_public_id
  left join public.media m on m.post_public_id = p.public_id
  where b.user_id = (select auth.uid()) and p.status = 'approved' and p.expires_at > now()
  order by b.created_at desc, p.created_at desc, p.public_id desc
  limit greatest(1, least(coalesce(p_limit, 100), 100));
$$;
revoke all on function public.feed_saved_posts(integer) from public, anon;
grant execute on function public.feed_saved_posts(integer) to authenticated;

notify pgrst, 'reload schema';
