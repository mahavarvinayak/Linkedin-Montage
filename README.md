# Cadence — LinkedIn Studio

A private, single-admin control room for LinkedIn publishing. Draft in peace,
schedule in IST, and publish to any mix of personal profiles, Company Pages and
Showcase Pages through LinkedIn's official Posts API.

Cadence is deliberately small: one admin, a handful of connected profiles, one
queue. There is no sign-up, no billing, no team management and no scraping.

---

## What it does

- **Compose** text posts with up to 9 ordered images, a live LinkedIn preview and
  a caption/hashtag character count.
- **Choose destinations dynamically.** Personal profiles and organization pages
  are discovered from LinkedIn, stored in `linkedin_destinations` and shown in a
  searchable multi-select. Nothing about page names, IDs or counts is hardcoded.
- **Schedule** in Asia/Kolkata (IST), with drafts, cancel, reschedule and publish
  now. One publishing job is created per (post, destination).
- **Publish** through LinkedIn OAuth and the versioned `/rest/posts` API. Each
  destination publishes with its own author URN and the token of the profile that
  owns it. Tokens stay in Supabase Vault and never reach the browser.
- **Isolate failures.** One destination failing never blocks the others. Every
  destination keeps its own status, attempt count, error and LinkedIn URN.
- **Recover safely** with bounded automatic retries, exponential backoff and an
  explicit `manual_required` state for uncertain or permission failures. An
  uncertain destination is never retried automatically.
- **Manage destinations** on a dedicated screen: refresh from LinkedIn, inspect
  missing permissions, disable a destination without deleting its history, or add
  an organization URN manually after LinkedIn confirms it exists. Disabling a
  destination also cancels its queued jobs so the worker cannot publish to it.
- **Notify** by Telegram per destination for success, failure, token problems and
  media cleanup.
- **Clean up** private media only after every destination on a post has finished
  and the retention window has elapsed.
- **Stay private** behind Supabase Auth, an `ADMIN_EMAIL` gate and a database
  allowlist (`public.app_admins`).

### Status model

Post status is derived from its jobs by `public.admin_refresh_post_status()`; the
per-destination truth lives in `public.publishing_jobs`.

| Status | Meaning | Automatic retry? |
| --- | --- | --- |
| `draft` | Work in progress, no schedule | No |
| `scheduled` | Waiting for `scheduled_at` / `next_attempt_at` | Yes, when due |
| `publishing` | At least one destination is claimed by the worker | No; stale claims become manual |
| `published` | Every destination finished (at least one published) | — |
| `failed` | Transient retries exhausted for a destination | Manual retry |
| `cancelled` | Cancelled; kept for restore or deletion | No |
| `manual_required` | Auth, permission, invalid input, media or uncertain outcome | Only after human confirmation |

A post with a published destination and a failed one shows `failed` until the
failed destination is retried or marked published manually.

---

## Stack

- Next.js 16 (App Router, `src/proxy.ts` for session refresh), React 19,
  TypeScript
- Tailwind CSS v4 with hand-built shadcn-style primitives
- Supabase: Postgres, Auth, private Storage, Vault, Edge Functions, pg_cron,
  pg_net
- LinkedIn OAuth 2.0 + versioned Posts API (`w_member_social`, and
  `w_organization_social` for organization pages with approved Community
  Management API access)
- Telegram Bot API
- Zod, Radix Dialog/Switch, Lucide, Sonner

No UI framework, no CSS-in-JS runtime, no public API surface.

---

## Quick start

### Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for the local Supabase stack)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A LinkedIn Developer App with the two products below

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in at least:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAIL=you@example.com
```

LinkedIn and Telegram values can be added later. The dashboard runs in a
limited mode without them and explains what is missing on **Settings**.

### 3. Start Supabase and migrate

```bash
npx supabase start
npx supabase db reset
```

`0001_init.sql` creates tables, RLS, Vault RPCs, atomic claim functions and the
private `media` bucket. `0002_cron.sql` schedules the workers if the project URL
and service role key are available in Vault. `0003_destinations.sql` adds
dynamic destinations and per-destination jobs; `0004_multi_accounts.sql` adds
multiple connected profiles and per-account tokens; `0005_account_isolation.sql`
makes per-account token reads and writes strictly isolated. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the deploy order.

Local `config.toml` disables public sign-up. Create the single admin user in
Studio (`http://127.0.0.1:54323`) under **Authentication → Users → Add user**,
then run in the SQL editor:

```sql
select public.bootstrap_admin('you@example.com');
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to
`/login`. Sign in with the admin user. If Supabase is not configured yet, the
login screen becomes a setup checklist.

### 5. Connect LinkedIn and Telegram

Open **Settings**. Add the LinkedIn client ID/secret and Telegram bot token to
`.env.local`, restart, then use **Connect LinkedIn** and **Send test message**.
The full walkthrough is in [docs/LINKEDIN_SETUP.md](docs/LINKEDIN_SETUP.md).

---

## Environment variables

| Variable | Required | Server only | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | No | Public URL; builds the OAuth redirect URI |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | No | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | No | Browser/server auth client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Yes** | Vault RPCs, signed media URLs, worker trigger |
| `ADMIN_EMAIL` | Yes | **Yes** | Single email gate; must also be in `app_admins` |
| `LINKEDIN_CLIENT_ID` | For publishing | **Yes** | LinkedIn OAuth app |
| `LINKEDIN_CLIENT_SECRET` | For publishing | **Yes** | LinkedIn OAuth app |
| `LINKEDIN_REDIRECT_URI` | Optional | **Yes** | Defaults to `${APP_URL}/api/linkedin/callback` |
| `LINKEDIN_SCOPES` | Optional | **Yes** | Defaults to `openid profile w_member_social`; add `r_organization_admin w_organization_social` after LinkedIn approves the organization products |
| `LINKEDIN_VERSION` | Optional | **Yes** | Versioned API header, default `202610` |
| `TELEGRAM_BOT_TOKEN` | Optional | **Yes** | Telegram bot |
| `TELEGRAM_CHAT_ID` | Optional | **Yes** | Default chat; Settings can override |
| `TELEGRAM_NOTIFICATIONS_ENABLED` | Optional | **Yes** | Set `false` to mute all messages |
| `MEDIA_RETENTION_HOURS` | Optional | **Yes** | Fallback retention; Settings stores the live value |

Only `NEXT_PUBLIC_*` values are exposed to the browser.

The Edge Functions need their own secrets in addition to the Vercel/server
environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINKEDIN_CLIENT_ID`,
`LINKEDIN_CLIENT_SECRET`, `LINKEDIN_VERSION`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `TELEGRAM_NOTIFICATIONS_ENABLED` and `APP_URL`.

---

## Scripts

```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run start        # Production server
npm run typecheck    # TypeScript, no emit
npm run supabase:start
npm run supabase:stop
npm run supabase:reset
npm run functions:serve
```

---

## Project layout

```
src/
  app/
    (dashboard)/          authenticated pages: overview, create, queue, published,
                          failed, destinations, settings
    api/                  auth, posts, media upload, destinations, LinkedIn OAuth,
                          Telegram
    login/                private sign-in and setup screen
  components/             app shell, composer, queue, settings, preview, UI kit
  lib/                    env, auth, IST helpers, queries, validation, Supabase
  proxy.ts                session refresh and route protection
supabase/
  migrations/             schema, RLS, Vault RPCs, claims, cron
  functions/
    publish-scheduled/    state machine and LinkedIn publishing worker
    cleanup-media/        retention window and orphan sweep
    _shared/              LinkedIn, Telegram and Supabase helpers
docs/
  LINKEDIN_SETUP.md
  DEPLOYMENT.md
```

---

## How publishing works

1. A post is stored with one `publishing_jobs` row per selected destination.
   Jobs are `pending` for drafts and `scheduled` with `scheduled_at` when the
   post is scheduled.
2. Every minute, pg_cron calls the `publish-scheduled` Edge Function with the
   service role key.
3. The worker recovers stale `publishing` claims (10+ minutes) as
   `manual_required`, then claims due jobs atomically with
   `SELECT … FOR UPDATE SKIP LOCKED`. Two cron runs can never claim the same job.
4. For each job, the worker loads the token of the profile that owns the
   destination (`destination_account_urn`). There is no fallback to another
   profile's token: a missing token fails only that destination.
5. Images are uploaded to LinkedIn first with the destination's author URN as
   owner; the post itself is created last with the same author URN.
6. Success stores the LinkedIn URN, permalink and `published_at` on the job, then
   recomputes the post summary. Transient errors return that job to `scheduled`
   with exponential backoff. Uncertain, auth, permission, invalid and media
   errors stop for a human.
7. Telegram receives a per-destination summary with caption preview, scheduled
   time, attempts, status and error.
8. An hourly cleanup function deletes media only when every job on the post is
   published/cancelled with at least one published, and the retention window has
   elapsed. It also removes orphaned uploads older than 24 hours.

The Next.js layer can trigger the worker immediately after “Publish now”, but
the cron run remains the source of truth. A failed trigger only delays the post
until the next minute.

---

## Security notes

- Tokens are written and read only through service-role-only Vault RPCs. Each
  connected profile has its own secret (`linkedin_token_<member_urn>`), and the
  legacy shared secret is only mirrored for the primary profile. An account can
  never read another account's token. Tokens are never placed in PostgREST
  tables, cookies, local storage or client props.
- Media lives in a private bucket; the dashboard renders short-lived signed URLs
  created server-side.
- `requireAdminPage()` protects layouts/pages server-side; every route handler
  independently calls `requireAdminApi()`. `src/proxy.ts` refreshes sessions and
  redirects unauthenticated navigation.
- The allowlist is enforced twice: `ADMIN_EMAIL` and `public.app_admins`.
- Uploads are checked by magic bytes, MIME type, file size and count.
- The worker verifies the exact `Authorization: Bearer <service_role_key>` in
  addition to Supabase's JWT gateway.
- `robots` is set to `noindex, nofollow`.
- There is no public signup, password login to LinkedIn, scraping or browser
  automation.

---

## Limitations

- Multiple personal profiles can be connected, but each organization destination
  is published through the profile that discovered it.
- Organization publishing needs LinkedIn's Community Management API approval and
  `w_organization_social`. Being a page administrator alone is not enough;
  Cadence shows the missing permission instead of pretending it will work.
- Text and up to 9 static images. Video is modelled in the schema (`media_type`)
  but deliberately not implemented in the composer or worker.
- LinkedIn cannot be polled for image processing status with posting scopes
  alone, so the Posts API is called immediately after upload. If LinkedIn rejects
  an image asynchronously, that destination appears in **Failed Posts**.
- A network timeout during post creation leaves an uncertain outcome. Cadence
  marks it `manual_required` rather than risking a duplicate.
- LinkedIn access tokens usually last 60 days. Refresh tokens are issued only
  when the app/product supports them; otherwise reconnect from Settings.

---

## Documentation

- [LinkedIn app setup](docs/LINKEDIN_SETUP.md)
- [Deployment and operations](docs/DEPLOYMENT.md)
