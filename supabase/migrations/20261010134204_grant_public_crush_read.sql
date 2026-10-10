-- Expose only the columns used by the public Spotted feed. RLS still limits
-- visible rows to published, unexpired items.
grant select (public_id, recipient, location, message, author_name, author_emoji,
  author_color, ships_count, blushes_count, created_at, expires_at, status)
  on public.crushes to anon, authenticated;
