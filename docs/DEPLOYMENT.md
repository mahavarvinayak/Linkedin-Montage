# Deployment and operations

This guide takes Cadence from a local checkout to a private production
deployment. The app needs three pieces:

1. **Next.js** on Vercel (or any Node 20+ host) for the UI and API routes.
2. **Supabase** for Auth, Postgres, private Storage, Vault and Edge Functions.
3. **pg_cron + pg_net** to call the publishing worker every minute and the
   cleanup worker every hour.

Links: [README](../README.md) · [LinkedIn setup](LINKEDIN_SETUP.md)

---

## 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Choose a strong database password and keep it in your password manager.
3. Note:
   - Project URL — `https://<ref>.supabase.co`
   - Anon/publishable key
   - Service role key (server only)
4. **Authentication → Providers → Email**:
   - Enable email provider.
   - Disable **Allow new users to sign up** (there is no public sign-up).
   - Decide whether email confirmation is required; for a single admin,
     creating the user with a confirmed email is simplest.
5. **Authentication → URL Configuration**:
   - Site URL: your production URL, e.g. `https://cadence.example.com`
   - Redirect URLs: `https://cadence.example.com/**`

The app does not use Supabase magic links, so the redirect list mostly matters
for account recovery flows you run from the Supabase dashboard.

## 2. Apply the database migrations

### Option A — Supabase CLI (recommended)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

This applies, in order:

- `supabase/migrations/0001_init.sql` — tables, RLS, Vault RPCs, atomic claim
  functions, the private `media` bucket and storage policies.
- `supabase/migrations/0002_cron.sql` — pg_cron jobs (only if the Vault secrets
  below already exist; otherwise it raises a notice and skips them).

### Option B — SQL editor

Open **SQL Editor** and run the files in order:

1. `0001_init.sql`
2. `0002_cron.sql`

Do not run `0002_cron.sql` until step 3 is complete, or it will skip job
creation. Re-run it after adding the Vault secrets.

### Verify

```sql
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
-- app_admins, posts, publishing_logs, settings

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'media';

select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname like 'admin_%';
```

## 3. Create the admin account

1. **Authentication → Users → Add user**.
2. Use the same email you will put in `ADMIN_EMAIL`.
3. Confirm the user (or use “Auto Confirm User”).
4. Copy the email exactly, then in the SQL editor:

```sql
select public.bootstrap_admin('you@example.com');
```

5. Confirm the allowlist:

```sql
select * from public.app_admins;
```

The app enforces both `ADMIN_EMAIL` and this table. A valid Supabase user who is
missing from either is rejected and signed out.

## 4. Store the cron secrets in Vault

`0002_cron.sql` reads two Vault secrets at runtime so the service role key is
not written into `cron.job`:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service-role-key>', 'service_role_key');
```

If the secrets already exist, update them instead:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'project_url'),
  'https://<project-ref>.supabase.co'
);
select vault.update_secret(
  (select id from vault.secrets where name = 'service_role_key'),
  '<service-role-key>'
);
```

Then re-run `0002_cron.sql` (or `npx supabase db push`) so the jobs are created.

> **Security note:** pg_cron runs as the `postgres` role and can decrypt Vault
> secrets. The service role key is powerful. Restrict dashboard access, rotate
> the key if it leaks, and prefer a dedicated external scheduler with its own
> secret if your threat model requires it. The worker additionally requires the
> exact `Authorization: Bearer <service_role_key>` header.

### Verify cron

```sql
select jobid, jobname, schedule, active from cron.job;

select jobname, status, return_message, start_time
from cron.job_run_details
order by start_time desc
limit 10;

select status_code, content, created
from net._http_response
order by created desc
limit 10;
```

Expected: `linkedin-publish-every-minute` runs every minute and
`linkedin-media-cleanup-hourly` runs at minute 5. A `200` response with
`skipped: "linkedin_not_connected"` is normal until LinkedIn is connected.

## 5. Deploy the Edge Functions

```bash
npx supabase functions deploy publish-scheduled
npx supabase functions deploy cleanup-media
```

Both functions are declared with `verify_jwt = true`; the service role key is a
valid JWT and also satisfies the function's own exact-key check.

### Function secrets

```bash
npx supabase secrets set \
  LINKEDIN_CLIENT_ID=... \
  LINKEDIN_CLIENT_SECRET=... \
  LINKEDIN_VERSION=202610 \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_CHAT_ID=... \
  TELEGRAM_NOTIFICATIONS_ENABLED=true \
  APP_URL=https://cadence.example.com
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are normally injected by the
Supabase runtime. If your project does not inject them, add them explicitly with
`npx supabase secrets set`.

Inspect:

```bash
npx supabase secrets list
```

Do not put these values in `NEXT_PUBLIC_*`.

### Invoke manually

```bash
curl -i -X POST \
  "https://<ref>.supabase.co/functions/v1/publish-scheduled" \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Use `-d '{"postId":"<uuid>"}'` to target one post. A missing/incorrect
Authorization header returns `401` even if the request reached the function.

## 6. Deploy Next.js

### Vercel

1. Import the repository.
2. Framework preset: **Next.js**. Node 20+.
3. Add environment variables:

   ```
   NEXT_PUBLIC_APP_URL=https://cadence.example.com
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ADMIN_EMAIL=you@example.com
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   LINKEDIN_REDIRECT_URI=https://cadence.example.com/api/linkedin/callback
   LINKEDIN_SCOPES=openid profile w_member_social
   LINKEDIN_VERSION=202610
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   TELEGRAM_NOTIFICATIONS_ENABLED=true
   MEDIA_RETENTION_HOURS=48
   ```

4. Deploy.
5. Add the production callback URL to the LinkedIn app's **Authorized redirect
   URLs**.
6. Open the site, sign in, and complete **Settings → LinkedIn**.

`SUPABASE_SERVICE_ROLE_KEY`, LinkedIn secrets and the Telegram bot token must
never be prefixed with `NEXT_PUBLIC_`.

### Other Node hosts

Run:

```bash
npm ci
npm run build
npm run start
```

Set the same environment variables. The host must allow server-side outbound
requests to `api.linkedin.com`, `www.linkedin.com`, `api.telegram.org` and your
Supabase project.

## 7. First production smoke test

1. **Login gate** — sign in with the admin. Try a second Supabase user that is
   not in `app_admins`; it must be rejected and signed out.
2. **Create a text post** — save as draft; confirm it appears in Content Queue.
3. **Schedule** — pick a time 2–3 minutes ahead (IST). Confirm the queue shows
   the right IST time.
4. **Worker** — watch `publishing_logs`, `cron.job_run_details` and the Edge
   Function logs. Expected: `publish_started` → `published`.
5. **LinkedIn** — open the permalink from Published Posts.
6. **Telegram** — confirm the success message with caption preview, scheduled
   time and link.
7. **Images** — create a two-image post and confirm the order matches the
   composer.
8. **Failure path** — disconnect LinkedIn, schedule a post, and confirm it
   surfaces as `manual_required`/`failed` without becoming a duplicate. Reconnect
   and use the confirmed retry flow.
9. **Cleanup** — in a staging copy, set a published post's `media_delete_after`
   to `now() - interval '1 minute'`, invoke `cleanup-media` manually, and confirm
   the storage objects are gone while the post row remains.

## 8. Operations

### Logs

- **Edge Functions → publish-scheduled → Logs** in the Supabase dashboard.
- SQL:

  ```sql
  select created_at, event_type, message, metadata
  from public.publishing_logs
  order by created_at desc
  limit 50;
  ```

- Cron: `cron.job_run_details`, `net._http_response`.
- Vercel: deployment and function logs.

### Rotating secrets

- **Supabase service role key**: rotate in Project Settings → API, update Vercel
  and the Edge Function secrets, and update the Vault `service_role_key` secret.
  Re-run `0002_cron.sql` only if the job command changes (it reads Vault at run
  time, so no re-run is strictly needed after updating Vault).
- **LinkedIn secret**: regenerate in the LinkedIn app, update Next.js and Edge
  Function secrets. Existing tokens usually remain valid until expiry; reconnect
  if refresh fails.
- **Telegram bot token**: revoke via BotFather, update both environments.
- **Admin email**: update `ADMIN_EMAIL`, `app_admins`, and the Supabase Auth
  user. Sign out and back in.

### Backups

Enable Supabase database backups for the project. Media retention means old
published media is intentionally deleted; export anything you need within the
retention window. The captions and permalinks remain in the database.

## 9. Local development with Edge Functions

```bash
npx supabase start
npx supabase db reset
npx supabase functions serve --env-file supabase/functions/.env
```

Create `supabase/functions/.env` with the same function secrets (never commit
it). Then invoke the worker:

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/publish-scheduled \
  -H "Authorization: Bearer <local-service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

The service role key is printed by `npx supabase status`.

LinkedIn accepts `http://localhost:3000/api/linkedin/callback` as a redirect URL,
so OAuth works locally without a tunnel. The hosted cron cannot reach your
laptop; run the worker manually while developing.

If you need cloud Edge Functions to call a local app, use a tunnel and update
`APP_URL`/redirect URLs accordingly. Do not expose the local service role key.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| Redirect loop on `/login` | `ADMIN_EMAIL` and `app_admins` contain the same lower-case email; the Supabase user exists and is confirmed |
| “Supabase is not configured” | `NEXT_PUBLIC_SUPABASE_URL` and anon key are present at build/runtime; redeploy after changing them |
| Settings shows database/storage errors | Migrations have run; service role key is correct; the `media` bucket exists |
| LinkedIn connect starts but returns to Settings with an error | Redirect URL exact match; client ID/secret; app products approved; browser allowed the state cookie |
| Worker returns 401 | The Authorization header must be exactly `Bearer <service-role-key>`; function secret matches the project key |
| Cron runs but nothing publishes | No due posts; status not `scheduled`; `next_attempt_at`/`scheduled_at` in the future; LinkedIn connection valid |
| `publishing` stuck | Stale claims are recovered after 10 minutes by the next worker run; check function logs for a crash |
| Duplicate concern | Never retry `manual_required` without checking LinkedIn. The UI requires explicit confirmation. |
| Media missing from the dashboard | Private bucket or service role key; signed URLs are generated server-side and expire after an hour |
| Cleanup not running | pg_cron/pg_net enabled; Vault secrets present; `cron.job` active; `media_delete_after` elapsed; status is `published` |
| Telegram silent | `TELEGRAM_BOT_TOKEN`, chat ID, `TELEGRAM_NOTIFICATIONS_ENABLED`, and the Settings toggle; use “Send test message” |

## 11. Security checklist

- [ ] Repository and `.env.local` are private; no secrets committed.
- [ ] Supabase sign-up disabled; only the admin user exists.
- [ ] `ADMIN_EMAIL` and `app_admins` match.
- [ ] RLS enabled on all public tables; no anon grants on posts/settings.
- [ ] Media bucket is private; no public URL is stored.
- [ ] LinkedIn tokens only in Vault; Vault RPCs executable only by `service_role`.
- [ ] Edge Functions verify the exact service role key.
- [ ] `robots` is `noindex, nofollow`.
- [ ] Production uses HTTPS.
- [ ] Service role key rotated after any exposure.
- [ ] LinkedIn app redirect list contains only intended URLs.
