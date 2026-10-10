# UNSEEN

UNSEEN is an anonymous campus community for Dumka Engineering College. The React app uses Supabase for authentication, PostgreSQL, realtime updates, private image storage, and moderation.

## Stack

- React 19, TypeScript, Vite, and Tailwind CSS 4
- Supabase Auth, PostgreSQL with row-level security, Realtime, and private Storage
- Edge Functions for invitation-based accounts, account deletion, moderation, and scheduled cleanup

The Supabase project is `algcvetinldkumqsdxgu`. The database starts empty; MongoDB records and media are not imported.

## Local development

1. Install Node.js 22.12 or newer and pnpm 10.34.6.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
3. Enable anonymous sign-ins in Supabase under **Authentication → Sign In / Providers**. Anonymous sessions are for browsing and reading only. Posting, liking, commenting, voting, reacting, and reporting require a registered account.
4. Run `pnpm install --frozen-lockfile` and `pnpm dev`.

Accounts use invitations. The first account receives the administrator role only when the database has no profiles; administrators can create more invitations from the admin dashboard.

## Features

The app includes the campus feed, anonymous member names, image posts, likes, comments, reports, polls, spotted messages, moderation, and an admin dashboard. Feed pages load incrementally. Images are compressed in the browser and stored in the private `unseen-media` bucket. Realtime events update content and moderation views.

Privileged operations stay in the `auth`, `account`, `admin`, and `cleanup` Edge Functions. Database and Storage access is protected by row-level security. Never put a Supabase secret or service-role key in a `VITE_*` variable.

## Database and Supabase deployment

Review the SQL files before applying them. The hardening and feed migrations added for this release are:

- `20261010123043_add_poll_report_target.sql`
- `20261010123049_add_crush_report_target.sql`
- `20261010123056_add_deleted_poll_status.sql`
- `20261010123103_phase1_database_hardening.sql`
- `20261010124516_phase2_feed_lookup.sql`

Link the CLI to the project and apply migrations when ready:

```sh
supabase login
supabase link --project-ref algcvetinldkumqsdxgu
supabase db push
```

The hardening migration enables `pg_cron` and `pg_net` and schedules the cleanup jobs. Before applying it, confirm those extensions are available and that Supabase Vault is enabled. Add these two Vault secrets in the dashboard:

- `unseen_project_url` — `https://algcvetinldkumqsdxgu.supabase.co`
- `unseen_cron_secret` — the same randomly generated secret used for the `CRON_SECRET` Edge Function secret

Set the Edge Function secret without committing it:

```sh
supabase secrets set CRON_SECRET=<same-random-secret>
```

Deploy the functions after migrations:

```sh
supabase functions deploy auth
supabase functions deploy account
supabase functions deploy admin
supabase functions deploy cleanup
```

The migration schedules `unseen-expired-media-cleanup` hourly and `unseen-prune-anonymous-auth-users` daily at 03:17 UTC. The cleanup endpoint checks the `x-cron-secret` header, removes expired image files, then deletes expired content. Keep `CRON_SECRET` out of source control and rotate its Edge Function and Vault copies together.

Regenerate the local public-schema TypeScript types after applying migrations:

```sh
supabase gen types typescript --linked --schema public > client/src/types/database.generated.ts
```

## Build and deployment

- `pnpm dev` starts the Vite development server.
- `pnpm typecheck` checks the TypeScript application.
- `pnpm build` type-checks and builds the static site into `dist/`.
- `pnpm build:web` builds the static site into `dist/`.
- `pnpm preview` serves the production build locally.

Netlify publishes `dist/`, rewrites app routes to `index.html`, sends the security headers from `netlify.toml`, and gives hashed `/assets/*` files a one-year immutable cache. Other static hosts should build with `pnpm install --frozen-lockfile && pnpm build` and publish `dist/`, while applying equivalent security headers.

The previous MongoDB database and its data remain untouched. The old Express/Mongoose backend and vanilla frontend are not part of this application or its deployment build.
