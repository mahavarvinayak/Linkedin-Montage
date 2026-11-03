-- ============================================================================
-- 0004_multi_accounts.sql
--
-- Adds multi-profile account management:
--   1. public.linkedin_accounts table (tracks multiple connected LinkedIn profiles)
--   2. account_urn column on public.linkedin_destinations
--   3. Vault RPCs to store/retrieve tokens per account URN
--   4. Updates public.admin_claim_due_jobs to return destination_account_urn
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Connected LinkedIn Accounts
-- ----------------------------------------------------------------------------

create table if not exists public.linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  member_urn text not null unique,
  name text not null,
  picture text,
  email text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'error', 'disconnected')),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linkedin_accounts enable row level security;

drop policy if exists "admins read linkedin_accounts" on public.linkedin_accounts;
create policy "admins read linkedin_accounts"
  on public.linkedin_accounts for select to authenticated
  using (public.is_admin());

drop policy if exists "admins insert linkedin_accounts" on public.linkedin_accounts;
create policy "admins insert linkedin_accounts"
  on public.linkedin_accounts for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins update linkedin_accounts" on public.linkedin_accounts;
create policy "admins update linkedin_accounts"
  on public.linkedin_accounts for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete linkedin_accounts" on public.linkedin_accounts;
create policy "admins delete linkedin_accounts"
  on public.linkedin_accounts for delete to authenticated
  using (public.is_admin());

revoke all on public.linkedin_accounts from anon;
grant select, insert, update, delete on public.linkedin_accounts to authenticated;
grant all on public.linkedin_accounts to service_role;

drop trigger if exists linkedin_accounts_touch_updated_at on public.linkedin_accounts;
create trigger linkedin_accounts_touch_updated_at
  before update on public.linkedin_accounts
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Add account_urn to destinations
-- ----------------------------------------------------------------------------

alter table public.linkedin_destinations
  add column if not exists account_urn text;

create index if not exists linkedin_destinations_account_idx
  on public.linkedin_destinations (account_urn);

-- Backfill personal profile destinations: their author_urn is their account_urn
update public.linkedin_destinations
set account_urn = author_urn
where destination_type = 'personal_profile'
  and account_urn is null;

-- Backfill existing organization destinations to current settings member if available
update public.linkedin_destinations d
set account_urn = (
  select 'urn:li:person:' || replace(s.linkedin_member_id, 'urn:li:person:', '')
  from public.settings s
  where s.id = 1 and s.linkedin_member_id is not null
  limit 1
)
where d.account_urn is null;

-- Backfill linkedin_accounts from existing settings row
insert into public.linkedin_accounts (
  member_urn, name, picture, token_expires_at, scopes, status, connected_at
)
select
  'urn:li:person:' || replace(s.linkedin_member_id, 'urn:li:person:', ''),
  coalesce(nullif(trim(s.linkedin_member_name), ''), 'Personal profile'),
  s.linkedin_member_picture,
  s.linkedin_token_expires_at,
  s.linkedin_scopes,
  case when s.linkedin_connected then 'connected' else 'disconnected' end,
  coalesce(s.linkedin_connected_at, now())
from public.settings s
where s.id = 1
  and s.linkedin_member_id is not null
on conflict (member_urn) do update set
  name = excluded.name,
  picture = excluded.picture,
  token_expires_at = excluded.token_expires_at,
  scopes = excluded.scopes,
  status = excluded.status;

-- ----------------------------------------------------------------------------
-- 3. Vault RPCs for multi-account tokens
-- ----------------------------------------------------------------------------

create or replace function public.admin_store_account_tokens(
  p_member_urn text,
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
  v_secret_name text;
  v_payload jsonb;
  v_secret_id uuid;
begin
  if p_member_urn is null or length(p_member_urn) = 0 then
    raise exception 'member_urn is required';
  end if;
  if p_access_token is null or length(p_access_token) = 0 then
    raise exception 'access_token is required';
  end if;

  v_secret_name := 'linkedin_token_' || p_member_urn;
  v_payload := jsonb_build_object(
    'member_urn', p_member_urn,
    'access_token', p_access_token,
    'refresh_token', p_refresh_token,
    'expires_at', p_expires_at,
    'scope', p_scope,
    'updated_at', now()
  );

  -- 1. Store account-specific secret
  select id into v_secret_id
  from vault.secrets
  where name = v_secret_name
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_payload::text,
      v_secret_name,
      'LinkedIn OAuth tokens for ' || p_member_urn
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_payload::text,
      v_secret_name,
      'LinkedIn OAuth tokens for ' || p_member_urn
    );
  end if;

  -- 2. Also keep legacy linkedin_oauth_tokens in sync so existing cron/helpers continue to work
  select id into v_secret_id
  from vault.secrets
  where name = 'linkedin_oauth_tokens'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_payload::text,
      'linkedin_oauth_tokens',
      'LinkedIn OAuth tokens (primary)'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_payload::text,
      'linkedin_oauth_tokens',
      'LinkedIn OAuth tokens (primary)'
    );
  end if;
end;
$$;

create or replace function public.admin_get_account_tokens(p_member_urn text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  if p_member_urn is not null and length(p_member_urn) > 0 then
    select decrypted_secret::jsonb into v_res
    from vault.decrypted_secrets
    where name = 'linkedin_token_' || p_member_urn
    limit 1;

    if v_res is not null then
      return v_res;
    end if;
  end if;

  -- Fallback to default secret
  select decrypted_secret::jsonb into v_res
  from vault.decrypted_secrets
  where name = 'linkedin_oauth_tokens'
  limit 1;

  return v_res;
end;
$$;

create or replace function public.admin_delete_account_tokens(p_member_urn text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'linkedin_token_' || p_member_urn;
end;
$$;

revoke all on function public.admin_store_account_tokens(text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.admin_get_account_tokens(text)
  from public, anon, authenticated;
revoke all on function public.admin_delete_account_tokens(text)
  from public, anon, authenticated;

grant execute on function public.admin_store_account_tokens(text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.admin_get_account_tokens(text)
  to service_role;
grant execute on function public.admin_delete_account_tokens(text)
  to service_role;

-- ----------------------------------------------------------------------------
-- 4. Update admin_claim_due_jobs to return destination_account_urn
-- ----------------------------------------------------------------------------

drop function if exists public.admin_claim_due_jobs(integer, uuid, uuid);

create or replace function public.admin_claim_due_jobs(
  p_limit integer default 5,
  p_post_id uuid default null,
  p_job_id uuid default null
)
returns table (
  id uuid,
  post_id uuid,
  destination_id uuid,
  author_urn text,
  destination_name text,
  destination_type text,
  destination_account_urn text,
  job_status text,
  attempts integer,
  max_attempts integer,
  lock_token uuid,
  scheduled_at timestamptz,
  post_caption text,
  post_hashtags text,
  post_media_type text,
  post_media_paths jsonb,
  post_created_at timestamptz,
  media_retention_hours integer
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select j.id
    from public.publishing_jobs j
    join public.posts p on p.id = j.post_id
    where j.status = 'scheduled'
      and p.status in ('scheduled', 'publishing')
      and (p_post_id is null or j.post_id = p_post_id)
      and (p_job_id is null or j.id = p_job_id)
      and coalesce(j.next_attempt_at, j.scheduled_at) <= now()
    order by coalesce(j.next_attempt_at, j.scheduled_at) asc
    limit greatest(1, least(p_limit, 25))
    for update of j skip locked
  ),
  claimed as (
    update public.publishing_jobs j
    set
      status = 'publishing',
      locked_at = now(),
      lock_token = gen_random_uuid(),
      last_attempt_at = now(),
      attempts = j.attempts + 1
    from due
    where j.id = due.id
    returning
      j.id,
      j.post_id,
      j.destination_id,
      j.author_urn,
      j.status as job_status,
      j.attempts,
      j.max_attempts,
      j.lock_token,
      j.scheduled_at
  )
  select
    c.id,
    c.post_id,
    c.destination_id,
    c.author_urn,
    d.name as destination_name,
    d.destination_type,
    d.account_urn as destination_account_urn,
    c.job_status,
    c.attempts,
    c.max_attempts,
    c.lock_token,
    c.scheduled_at,
    p.caption as post_caption,
    p.hashtags as post_hashtags,
    p.media_type as post_media_type,
    p.media_paths as post_media_paths,
    p.created_at as post_created_at,
    coalesce(s.media_retention_hours, 48) as media_retention_hours
  from claimed c
  join public.posts p on p.id = c.post_id
  join public.linkedin_destinations d on d.id = c.destination_id
  cross join public.settings s
  where s.id = 1;
$$;

revoke all on function public.admin_claim_due_jobs(integer, uuid, uuid) from public, anon;
grant execute on function public.admin_claim_due_jobs(integer, uuid, uuid) to service_role;

