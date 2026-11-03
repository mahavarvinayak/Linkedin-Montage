-- ============================================================================
-- 0005_account_isolation.sql
--
-- Fixes cross-account token leakage introduced with multi-profile support.
--
--   1. public.admin_get_account_tokens never returns another account's token.
--      The legacy `linkedin_oauth_tokens` secret is only used when the caller
--      asks for the primary account (or does not name an account at all).
--   2. public.admin_store_account_tokens only mirrors the token into the legacy
--      primary secret when the account being written is the primary account.
--   3. public.admin_primary_account_urn() helper so callers can compare without
--      re-implementing the settings parsing.
--   4. Index to speed up "destinations for this account by state".
--
-- Deploy order: run after 0004, before redeploying the web app/Edge Functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Primary account helper
-- ----------------------------------------------------------------------------

create or replace function public.admin_primary_account_urn()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'urn:li:person:' || replace(s.linkedin_member_id, 'urn:li:person:', '')
  from public.settings s
  where s.id = 1
    and nullif(trim(s.linkedin_member_id), '') is not null
  limit 1;
$$;

revoke all on function public.admin_primary_account_urn() from public, anon, authenticated;
grant execute on function public.admin_primary_account_urn() to service_role;

-- ----------------------------------------------------------------------------
-- 2. Token read: strict per-account isolation
-- ----------------------------------------------------------------------------

create or replace function public.admin_get_account_tokens(p_member_urn text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
  v_primary text;
begin
  if p_member_urn is not null and length(trim(p_member_urn)) > 0 then
    select decrypted_secret::jsonb into v_res
    from vault.decrypted_secrets
    where name = 'linkedin_token_' || p_member_urn
    limit 1;

    if v_res is not null then
      return v_res;
    end if;

    -- Backwards compatibility for the account that owns the legacy secret.
    -- Any other account must never inherit the primary token.
    v_primary := public.admin_primary_account_urn();
    if v_primary is not null and v_primary = p_member_urn then
      select decrypted_secret::jsonb into v_res
      from vault.decrypted_secrets
      where name = 'linkedin_oauth_tokens'
      limit 1;
    end if;

    return v_res;
  end if;

  -- Caller did not name an account: use the legacy primary secret.
  select decrypted_secret::jsonb into v_res
  from vault.decrypted_secrets
  where name = 'linkedin_oauth_tokens'
  limit 1;

  return v_res;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Token write: legacy secret only for the primary account
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
  v_primary text;
begin
  if p_member_urn is null or length(trim(p_member_urn)) = 0 then
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

  -- Only the primary account may overwrite the legacy shared secret, otherwise
  -- connecting a second profile would silently replace the first profile's token.
  v_primary := public.admin_primary_account_urn();
  if v_primary is not null and v_primary = p_member_urn then
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
  end if;
end;
$$;

revoke all on function public.admin_store_account_tokens(text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.admin_get_account_tokens(text)
  from public, anon, authenticated;

grant execute on function public.admin_store_account_tokens(text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.admin_get_account_tokens(text)
  to service_role;

-- ----------------------------------------------------------------------------
-- 4. Lookup index for per-account destination state
-- ----------------------------------------------------------------------------

create index if not exists linkedin_destinations_account_status_idx
  on public.linkedin_destinations (account_urn, status);
