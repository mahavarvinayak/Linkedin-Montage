-- ============================================================================
-- Cadence — LinkedIn Studio
-- 0001_init.sql
--
-- Creates the private schema for a single-admin LinkedIn publishing dashboard:
-- posts, publishing logs, settings, admin allowlist, token storage (Vault),
-- atomic publishing claims, RLS policies and a private media bucket.
--
-- Run with:  supabase db push   (or supabase db reset for local development)
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Vault is enabled by default on Supabase projects. If the extension is not
-- available, the token RPCs below will raise a clear error at runtime. See the
-- README for the one-line enable command.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    begin
      create extension if not exists supabase_vault with schema vault;
    exception
      when others then
        raise notice 'Could not enable Supabase Vault automatically: %', sqlerrm;
    end;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- The allowlist of dashboard administrators. A user authenticated by Supabase
-- Auth is only an admin when their email appears here.
create table if not exists public.app_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- Used by every RLS policy below. Security definer avoids recursive RLS
-- checks on app_admins.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- Run once from the Supabase SQL editor as the postgres role:
--   select public.bootstrap_admin('you@example.com');
create or replace function public.bootstrap_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email is null or position('@' in p_email) < 2 then
    raise exception 'A valid email address is required';
  end if;

  insert into public.app_admins (email)
  values (lower(trim(p_email)))
  on conflict (email) do nothing;
end;
$$;

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(text) to service_role;

drop policy if exists "admins can read their own allowlist row" on public.app_admins;
create policy "admins can read their own allowlist row"
  on public.app_admins
  for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

revoke all on public.app_admins from anon, authenticated;
grant select on public.app_admins to authenticated;

-- ----------------------------------------------------------------------------
-- Settings (one row, metadata only — OAuth tokens live in Vault)
-- ----------------------------------------------------------------------------

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  linkedin_member_id text,
  linkedin_member_name text,
  linkedin_member_picture text,
  linkedin_connected boolean not null default false,
  linkedin_connected_at timestamptz,
  linkedin_token_expires_at timestamptz,
  linkedin_scopes text[] not null default '{}',
  linkedin_last_error text,
  telegram_enabled boolean not null default true,
  telegram_chat_id text,
  media_retention_hours integer not null default 48
    check (media_retention_hours between 1 and 720),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.settings (id)
values (1)
on conflict (id) do nothing;

alter table public.settings enable row level security;

drop policy if exists "admins read settings" on public.settings;
create policy "admins read settings"
  on public.settings for select to authenticated
  using (public.is_admin());

drop policy if exists "admins update settings" on public.settings;
create policy "admins update settings"
  on public.settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.settings from anon;
grant select, update on public.settings to authenticated;
grant all on public.settings to service_role;

drop trigger if exists settings_touch_updated_at on public.settings;
create trigger settings_touch_updated_at
  before update on public.settings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Posts
-- ----------------------------------------------------------------------------

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  caption text not null default '',
  hashtags text not null default '',
  media_type text not null default 'none'
    check (media_type in ('none', 'image', 'images', 'video')),
  media_paths jsonb not null default '[]'::jsonb
    check (jsonb_typeof(media_paths) = 'array'),
  scheduled_at timestamptz,
  status text not null default 'draft'
    check (status in (
      'draft', 'scheduled', 'publishing', 'published',
      'failed', 'cancelled', 'manual_required'
    )),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  linkedin_post_id text,
  permalink text,
  last_error text,
  published_at timestamptz,
  media_delete_after timestamptz,
  media_deleted_at timestamptz,
  locked_at timestamptz,
  lock_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.posts enable row level security;

drop policy if exists "admins manage posts" on public.posts;
create policy "admins manage posts"
  on public.posts for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.posts from anon;
grant select, insert, update, delete on public.posts to authenticated;
grant all on public.posts to service_role;

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

create index if not exists posts_due_idx
  on public.posts (status, next_attempt_at, scheduled_at);

create index if not exists posts_published_idx
  on public.posts (published_at desc)
  where status = 'published';

create index if not exists posts_media_cleanup_idx
  on public.posts (media_delete_after)
  where status = 'published' and media_deleted_at is null;

-- ----------------------------------------------------------------------------
-- Publishing logs
-- ----------------------------------------------------------------------------

create table if not exists public.publishing_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts (id) on delete set null,
  event_type text not null,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.publishing_logs enable row level security;

drop policy if exists "admins read publishing logs" on public.publishing_logs;
create policy "admins read publishing logs"
  on public.publishing_logs for select to authenticated
  using (public.is_admin());

drop policy if exists "admins write publishing logs" on public.publishing_logs;
create policy "admins write publishing logs"
  on public.publishing_logs for insert to authenticated
  with check (public.is_admin());

revoke all on public.publishing_logs from anon;
grant select, insert on public.publishing_logs to authenticated;
grant all on public.publishing_logs to service_role;

create index if not exists publishing_logs_created_idx
  on public.publishing_logs (created_at desc);

create index if not exists publishing_logs_post_idx
  on public.publishing_logs (post_id, created_at desc);

-- ----------------------------------------------------------------------------
-- OAuth token storage (Supabase Vault, service-role only)
--
-- Tokens never touch the browser and are never readable through the public
-- PostgREST API: the RPCs are executable by service_role only.
-- ----------------------------------------------------------------------------

create or replace function public.admin_store_linkedin_tokens(
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scope text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_secret_id uuid;
begin
  if p_access_token is null or length(p_access_token) = 0 then
    raise exception 'access token is required';
  end if;

  v_payload := jsonb_build_object(
    'access_token', p_access_token,
    'refresh_token', p_refresh_token,
    'expires_at', p_expires_at,
    'scope', p_scope,
    'updated_at', now()
  );

  select id into v_secret_id
  from vault.secrets
  where name = 'linkedin_oauth_tokens'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_payload::text,
      'linkedin_oauth_tokens',
      'LinkedIn OAuth tokens for the private dashboard'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_payload::text,
      'linkedin_oauth_tokens',
      'LinkedIn OAuth tokens for the private dashboard'
    );
  end if;
end;
$$;

create or replace function public.admin_get_linkedin_tokens()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret::jsonb
  from vault.decrypted_secrets
  where name = 'linkedin_oauth_tokens'
  limit 1;
$$;

create or replace function public.admin_delete_linkedin_tokens()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'linkedin_oauth_tokens';
end;
$$;

revoke all on function public.admin_store_linkedin_tokens(text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.admin_get_linkedin_tokens()
  from public, anon, authenticated;
revoke all on function public.admin_delete_linkedin_tokens()
  from public, anon, authenticated;

grant execute on function public.admin_store_linkedin_tokens(text, text, timestamptz, text)
  to service_role;
grant execute on function public.admin_get_linkedin_tokens()
  to service_role;
grant execute on function public.admin_delete_linkedin_tokens()
  to service_role;

-- ----------------------------------------------------------------------------
-- Atomic scheduler primitives
--
-- Claims are made with SELECT ... FOR UPDATE SKIP LOCKED so two overlapping
-- cron invocations can never publish the same post twice.
-- ----------------------------------------------------------------------------

create or replace function public.admin_claim_due_posts(
  p_limit integer default 3,
  p_post_id uuid default null
)
returns setof public.posts
language sql
security definer
set search_path = ''
as $$
  with due as (
    select p.id
    from public.posts p
    where p.status = 'scheduled'
      and (p_post_id is null or p.id = p_post_id)
      and coalesce(p.next_attempt_at, p.scheduled_at) <= now()
    order by coalesce(p.next_attempt_at, p.scheduled_at) asc
    limit greatest(1, least(p_limit, 20))
    for update skip locked
  )
  update public.posts p
  set status = 'publishing',
      attempts = p.attempts + 1,
      last_attempt_at = now(),
      locked_at = now(),
      lock_token = gen_random_uuid(),
      updated_at = now()
  from due
  where p.id = due.id
  returning p.*;
$$;

-- A worker that crashed mid-publish leaves an uncertain outcome. Never retry
-- that automatically: surface it for a human to verify on LinkedIn instead.
create or replace function public.admin_recover_stale_publishing(
  p_minutes integer default 10
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.posts
  set status = 'manual_required',
      last_error = 'Publishing outcome unknown: the worker stopped mid-publish. Check LinkedIn before retrying.',
      next_attempt_at = null,
      locked_at = null,
      lock_token = null,
      updated_at = now()
  where status = 'publishing'
    and locked_at is not null
    and locked_at < now() - make_interval(mins => greatest(1, p_minutes));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_claim_due_posts(integer, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_recover_stale_publishing(integer)
  from public, anon, authenticated;
grant execute on function public.admin_claim_due_posts(integer, uuid) to service_role;
grant execute on function public.admin_recover_stale_publishing(integer) to service_role;

-- ----------------------------------------------------------------------------
-- Private media bucket
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins read media" on storage.objects;
create policy "admins read media"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins update media" on storage.objects;
create policy "admins update media"
  on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());

-- ----------------------------------------------------------------------------
-- Seed the admin allowlist from a database setting, if one is configured:
--   alter database postgres set app.admin_email = 'you@example.com';
-- Otherwise run: select public.bootstrap_admin('you@example.com');
-- ----------------------------------------------------------------------------

do $$
declare
  v_email text := current_setting('app.admin_email', true);
begin
  if v_email is not null and length(v_email) > 3 then
    insert into public.app_admins (email)
    values (lower(trim(v_email)))
    on conflict (email) do nothing;
  end if;
end
$$;
