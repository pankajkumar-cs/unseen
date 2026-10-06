-- Likes are limited to registered, active accounts. Anonymous Supabase sessions
-- still use the authenticated database role, so guard both the RPC and table policies.
create or replace function public.set_post_like(p_post_public_id uuid, p_liked boolean)
returns table(liked boolean, likes_count integer)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); current_profile_id uuid;
begin
  if current_user_id is null or not public.is_active_member() then
    raise exception 'active account required' using errcode = '42501';
  end if;
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

drop policy if exists likes_insert_owner on public.likes;
create policy likes_insert_owner on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_active_member()) and public.is_public_post(post_public_id));

drop policy if exists likes_delete_owner on public.likes;
create policy likes_delete_owner on public.likes for delete to authenticated
  using (user_id = (select auth.uid()) and actor_key = (select auth.uid())::text
    and (select public.is_active_member()));

drop policy if exists comments_delete_owner on public.comments;
create policy comments_delete_owner on public.comments for delete to authenticated
  using (actor_id = (select auth.uid()) and (select public.is_active_member()));
