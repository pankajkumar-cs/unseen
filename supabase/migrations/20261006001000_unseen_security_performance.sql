begin;

-- These tables are intentionally unavailable to browser clients. Privileged
-- Edge Functions use service_role, which bypasses these policies by design.
create policy invitation_codes_deny_clients on public.invitation_codes
  for all to anon, authenticated using (false) with check (false);
create policy moderation_actions_deny_clients on public.moderation_actions
  for all to anon, authenticated using (false) with check (false);
create policy random_chat_queue_exclusions_deny_clients on public.random_chat_queue_exclusions
  for all to anon, authenticated using (false) with check (false);

-- The all-actions policy already restricts queue rows to the active owner, so
-- the separate SELECT policy only makes Postgres evaluate the same predicate twice.
drop policy random_queue_read_own on public.random_chat_queue;

-- Index foreign keys used in account deletion, moderation, and relationship joins.
create index if not exists admin_actions_admin_user_idx on public.admin_actions (admin_user_id);
create index if not exists bookmarks_post_idx on public.bookmarks (post_public_id);
create index if not exists comments_actor_idx on public.comments (actor_id);
create index if not exists crush_reactions_actor_idx on public.crush_reactions (actor_id);
create index if not exists crushes_identity_idx on public.crushes (identity_id);
create index if not exists crushes_owner_idx on public.crushes (owner_user_id);
create index if not exists invitation_codes_created_by_idx on public.invitation_codes (created_by);
create index if not exists likes_user_idx on public.likes (user_id);
create index if not exists mailbox_sender_identity_idx on public.mailbox_messages (sender_identity_id);
create index if not exists media_owner_idx on public.media (owner_user_id);
create index if not exists moderation_actions_account_idx on public.moderation_actions (account_id);
create index if not exists moderation_actions_admin_idx on public.moderation_actions (admin_user_id);
create index if not exists moderation_actions_post_idx on public.moderation_actions (post_public_id);
create index if not exists poll_votes_actor_idx on public.poll_votes (actor_id);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id, poll_public_id);
create index if not exists polls_identity_idx on public.polls (identity_id);
create index if not exists polls_owner_idx on public.polls (owner_user_id);
create index if not exists posts_deleted_by_idx on public.posts (deleted_by);
create index if not exists posts_hidden_by_idx on public.posts (hidden_by);
create index if not exists posts_identity_idx on public.posts (identity_id);
create index if not exists random_chat_blocks_blocked_idx on public.random_chat_blocks (blocked_id);
create index if not exists random_chat_messages_sender_idx on public.random_chat_messages (sender_id);
create index if not exists random_chat_queue_exclusions_excluded_idx on public.random_chat_queue_exclusions (excluded_user_id);
create index if not exists random_chat_reports_reported_idx on public.random_chat_reports (reported_id);
create index if not exists random_chat_reports_reporter_idx on public.random_chat_reports (reporter_id);
create index if not exists reports_comment_idx on public.reports (comment_id);
create index if not exists reports_reported_user_idx on public.reports (reported_user_id);
create index if not exists reports_reporter_user_idx on public.reports (reporter_user_id);
create index if not exists reports_reviewed_by_idx on public.reports (reviewed_by);

commit;
