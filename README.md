# UNSEEN

UNSEEN is an anonymous campus community for Dumka Engineering College. The React app keeps the existing product areas and visual identity while Supabase provides authentication, PostgreSQL, realtime, private media storage, and trusted moderation operations.

## Stack

- React 19, TypeScript, Vite, and Tailwind CSS 4
- Supabase Auth, PostgreSQL with row-level security, Realtime, and private Storage
- Edge Functions for invitation-based account creation, account deletion, and admin actions

The deployed Supabase project is `algcvetinldkumqsdxgu`. The database starts empty; old MongoDB records and uploaded media are not imported.

## Local development

1. Install Node.js 22.12 or newer and pnpm 11.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
3. Enable anonymous sign-ins in Supabase under **Authentication → Sign In / Providers**. The app needs this for anonymous browsing and posts.
4. Run `pnpm install --frozen-lockfile` and `pnpm dev`.

The first account is created with the one-time administrator invitation supplied during project setup. When the database has no profiles, that first registration receives the admin role; later registrations receive the regular user role. Admins can issue further invitations from the in-app admin panel.

## Features

The app includes the campus feed, anonymous profiles, image posts and uploads, likes, comments, reports, polls, spotted messages, moderation, and an admin panel. Feed pages are fetched incrementally; media is compressed in the browser and stored in the private `unseen-media` bucket. Realtime subscriptions update affected content without polling.

Privileged operations stay in the `auth`, `account`, and `admin` Edge Functions. Database and Storage access remains protected by RLS. Never put a Supabase secret or service-role key in a `VITE_*` variable.

## Build and deployment

- `pnpm dev` starts the Vite development server.
- `pnpm typecheck` checks the TypeScript application.
- `pnpm build` type-checks and builds the static site into `dist/`.
- `pnpm preview` serves the production build locally.

Netlify publishes `dist/` and rewrites app routes to `index.html`. Configure any other static host to build with `pnpm install --frozen-lockfile && pnpm build` and publish `dist/`.

The previous MongoDB database and its data are left untouched. The old Express/Mongoose backend and vanilla frontend are no longer part of this application or deployment build.
