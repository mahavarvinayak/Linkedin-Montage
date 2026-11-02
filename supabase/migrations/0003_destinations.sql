-- ============================================================================
-- 0003_destinations.sql
--
-- Adds dynamic LinkedIn publishing destinations and per-destination jobs.
--
-- Mapping to the requested model:
--   linkedin_destinations  -> discovered personal / company / showcase authors
--   public.posts           -> the shared post content + schedule (scheduled_posts)
--   publishing_jobs        -> one row per (post, destination) pair
--
-- The existing posts table is preserved: it stays the single source of truth
-- for caption, media and schedule, and its `status` becomes a summary that is
-- derived from the jobs by public.admin_refresh_post_status().
--
-- Deploy order: run this migration, then redeploy the Edge Functions. The old
-- post-level claim functions are removed here, because two schedulers claiming
-- the same work would be unsafe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Destinations
-- ----------------------------------------------------------------------------

create table if not exists public.linkedin_destinations (
  id uuid primary key default gen_random_uuid(),
  -- LinkedIn author URN, e.g. urn:li:person:123 or urn:li:organization:456.
  -- This is the stable identity of a destination.
  author_urn text not null unique,
  organization_urn text,
  organization_id text,
  name text not null,
  destination_type text not null default 'unknown'
    check (destination_type in (
      'personal_profile', 'company_page', 'showcase_page', 'organization', 'unknown'
    )),
  -- Role the connected member holds on the organization, as reported by
  -- LinkedIn. Never used as proof of API publishing access.
  member_role text,
  -- Scope required to publish as this destination.
  publish_scope text not null default 'w_member_social',
  -- True only when the granted token actually contains publish_scope.
  publish_authorized boolean not null default false,
  status text not null default 'unverified'
    check (status in (
      'available', 'unavailable', 'permission_missing', 'unverified', 'error'
    )),
  status_detail text,
  source text not null default 'linkedin_sync'
    check (source in ('linkedin_sync', 'manual')),
  is_enabled boolean not null default true,
  last_seen_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linkedin_destinations enable row level security;

-- Destinations are never deleted by the dashboard: losing access marks a row
-- unavailable so historical jobs keep their destination name.
drop policy if exists "admins read destinations" on public.linkedin_destinations;
create policy "admins read destinations"
  on public.linkedin_destinations for select to authenticated
  using (public.is_admin());

drop policy if exists "admins add destinations" on public.linkedin_destinations;
create policy "admins add destinations"
  on public.linkedin_destinations for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins update destinations" on public.linkedin_destinations;
create policy "admins update destinations"
  on public.linkedin_destinations for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.linkedin_destinations from anon;
revoke delete on public.linkedin_destinations from authenticated;
grant select, insert, update on public.linkedin_destinations to authenticated;
grant all on public.linkedin_destinations to service_role;

drop trigger if exists linkedin_destinations_touch_updated_at on public.linkedin_destinations;
create trigger linkedin_destinations_touch_updated_at
  before update on public.linkedin_destinations
  for each row execute function public.touch_updated_at();

create index if not exists linkedin_destinations_selectable_idx
  on public.linkedin_destinations (status, is_enabled, destination_type);

-- ----------------------------------------------------------------------------
-- Sync metadata on the single settings row
-- ----------------------------------------------------------------------------

alter table public.settings
  add column if not exists destinations_synced_at timestamptz,
  add column if not exists destinations_last_error text,
  add column if not exists destinations_sync_notes jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- Publishing jobs
-- ----------------------------------------------------------------------------

create table if not exists public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  destination_id uuid not null references public.linkedin_destinations (id) on delete restrict,
  -- Snapshot of the author URN at job creation time, so an audit trail survives
  -- a destination being renamed.
  author_urn text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'scheduled', 'publishing', 'published',
      'failed', 'cancelled', 'manual_required'
    )),
  scheduled_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  published_at timestamptz,
  linkedin_post_id text,
  permalink text,
  last_error text,
  locked_at timestamptz,
  lock_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One job per post and destination. This is the primary duplicate guard.
  constraint publishing_jobs_post_destination_key unique (post_id, destination_id)
);

alter table public.publishing_jobs enable row level security;

drop policy if exists "admins manage publishing jobs" on public.publishing_jobs;
create policy "admins manage publishing jobs"
  on public.publishing_jobs for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.publishing_jobs from anon;
grant select, insert, update, delete on public.publishing_jobs to authenticated;
grant all on public.publishing_jobs to service_role;

drop trigger if exists publishing_jobs_touch_updated_at on public.publishing_jobs;
create trigger publishing_jobs_touch_updated_at
  before update on public.publishing_jobs
  for each row execute function public.touch_updated_at();

create index if not exists publishing_jobs_due_idx
  on public.publishing_jobs (next_attempt_at, scheduled_at)
  where status = 'scheduled';

create index if not exists publishing_jobs_post_idx
  on public.publishing_jobs (post_id, created_at);

create index if not exists publishing_jobs_destination_idx
  on public.publishing_jobs (destination_id, published_at desc);

-- A LinkedIn post URN may only ever be recorded once per destination.
create unique index if not exists publishing_jobs_destination_post_urn_key
  on public.publishing_jobs (destination_id, linkedin_post_id)
  where linkedin_post_id is not null;

-- ----------------------------------------------------------------------------
-- Backfill: the currently connected member becomes the first destination, and
-- existing posts keep working by inheriting one job each.
-- ----------------------------------------------------------------------------

insert into public.linkedin_destinations (
  author_urn, name, destination_type, publish_scope, publish_authorized,
  status, status_detail, source, last_seen_at, last_synced_at
)
select
  'urn:li:person:' || replace(s.linkedin_member_id, 'urn:li:person:', ''),
  coalesce(nullif(trim(s.linkedin_member_name), ''), 'Personal profile'),
  'personal_profile',
  'w_member_social',
  coalesce('w_member_social' = any (s.linkedin_scopes), false),
  case
    when coalesce('w_member_social' = any (s.linkedin_scopes), false) then 'available'
    else 'permission_missing'
  end,
  case
    when coalesce('w_member_social' = any (s.linkedin_scopes), false) then null
    else 'The stored token does not include w_member_social, so member publishing is not authorized.'
  end,
  'linkedin_sync',
  now(),
  now()
from public.settings s
where s.id = 1
  and s.linkedin_connected
  and s.linkedin_member_id is not null
on conflict (author_urn) do nothing;

insert into public.publishing_jobs (
  post_id, destination_id, author_urn, status, scheduled_at,
  attempts, max_attempts, last_attempt_at, published_at,
  linkedin_post_id, permalink, last_error
)
select
  p.id,
  d.id,
  d.author_urn,
  case p.status
    when 'draft' then 'pending'
    when 'scheduled' then 'scheduled'
    -- A post stuck mid-publish has an unknown outcome. Preserve that caution
    -- instead of inheriting a status that would retry automatically.
    when 'publishing' then 'manual_required'
    when 'published' then 'published'
    when 'failed' then 'failed'
    when 'manual_required' then 'manual_required'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end,
  case when p.status = 'scheduled' then p.scheduled_at else null end,
  p.attempts,
  p.max_attempts,
  p.last_attempt_at,
  p.published_at,
  case when p.status = 'published' then p.linkedin_post_id else null end,
  case when p.status = 'published' then p.permalink else null end,
  p.last_error
from public.posts p
join public.linkedin_destinations d
  on d.destination_type = 'personal_profile'
on conflict (post_id, destination_id) do nothing;

-- ----------------------------------------------------------------------------
-- Derive the post-level status and media lifecycle from its jobs.
--
-- Runs as the invoker: the scheduler calls it with the service role, and admin
-- server routes call it as the signed-in admin, where posts RLS still applies.
-- ----------------------------------------------------------------------------

create or replace function public.admin_refresh_post_status(p_post_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_post public.posts%rowtype;
  v_total integer;
  v_pending integer;
  v_scheduled integer;
  v_publishing integer;
  v_published integer;
  v_failed integer;
  v_manual integer;
  v_cancelled integer;
  v_status text;
  v_first_published timestamptz;
  v_urn text;
  v_permalink text;
  v_last_error text;
  v_next_attempt timestamptz;
  v_retention integer;
begin
  select * into v_post from public.posts where id = p_post_id;
  if not found then
    return;
  end if;

  -- Cancellation is an explicit admin decision and is never derived.
  if v_post.status = 'cancelled' then
    return;
  end if;

  select
    count(*),
    count(*) filter (where j.status = 'pending'),
    count(*) filter (where j.status = 'scheduled'),
    count(*) filter (where j.status = 'publishing'),
    count(*) filter (where j.status = 'published'),
    count(*) filter (where j.status = 'failed'),
    count(*) filter (where j.status = 'manual_required'),
    count(*) filter (where j.status = 'cancelled'),
    min(j.published_at) filter (where j.status = 'published'),
    min(coalesce(j.next_attempt_at, j.scheduled_at)) filter (where j.status = 'scheduled')
  into
    v_total, v_pending, v_scheduled, v_publishing, v_published,
    v_failed, v_manual, v_cancelled, v_first_published, v_next_attempt
  from public.publishing_jobs j
  where j.post_id = p_post_id;

  if v_total = 0 then
    return;
  end if;

  if v_publishing > 0 then
    v_status := 'publishing';
  elsif v_scheduled > 0 then
    v_status := 'scheduled';
  elsif v_manual > 0 then
    v_status := 'manual_required';
  elsif v_failed > 0 then
    v_status := 'failed';
  elsif v_published > 0 then
    v_status := 'published';
  elsif v_cancelled = v_total then
    v_status := 'cancelled';
  elsif v_pending = v_total then
    v_status := 'draft';
  else
    v_status := v_post.status;
  end if;

  if v_published > 0 then
    select j.linkedin_post_id, j.permalink
    into v_urn, v_permalink
    from public.publishing_jobs j
    where j.post_id = p_post_id
      and j.status = 'published'
      and j.linkedin_post_id is not null
    order by j.published_at asc nulls last
    limit 1;
  end if;

  select j.last_error
  into v_last_error
  from public.publishing_jobs j
  where j.post_id = p_post_id
    and j.status in ('failed', 'manual_required')
    and j.last_error is not null
  order by j.updated_at desc
  limit 1;

  select s.media_retention_hours into v_retention
  from public.settings s
  where s.id = 1;

  v_retention := coalesce(v_retention, 48);

  update public.posts p
  set
    status = v_status,
    published_at = coalesce(v_first_published, p.published_at),
    linkedin_post_id = coalesce(v_urn, p.linkedin_post_id),
    permalink = coalesce(v_permalink, p.permalink),
    last_error = case
      when v_status in ('failed', 'manual_required') then coalesce(v_last_error, p.last_error)
      else null
    end,
    next_attempt_at = case when v_status = 'scheduled' then v_next_attempt else null end,
    locked_at = null,
    lock_token = null,
    media_delete_after = case
      -- Media is shared by every job on the post. It may only be scheduled for
      -- deletion once every destination is finished and none can need it again.
      when v_published > 0
        and v_total = v_published + v_cancelled
        and p.media_deleted_at is null
        then coalesce(p.media_delete_after, now() + make_interval(hours => v_retention))
      when p.media_deleted_at is null then null
      else p.media_delete_after
    end
  where p.id = p_post_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Atomic job claiming. Two cron invocations can never claim the same job.
-- ----------------------------------------------------------------------------

drop function if exists public.admin_claim_due_posts(integer, uuid);
drop function if exists public.admin_recover_stale_publishing(integer);

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
    set status = 'publishing',
        attempts = j.attempts + 1,
        last_attempt_at = now(),
        locked_at = now(),
        lock_token = gen_random_uuid(),
        updated_at = now()
    from due
    where j.id = due.id
    returning j.*
  )
  select
    c.id,
    c.post_id,
    c.destination_id,
    c.author_urn,
    d.name,
    d.destination_type,
    c.status,
    c.attempts,
    c.max_attempts,
    c.lock_token,
    c.scheduled_at,
    p.caption,
    p.hashtags,
    p.media_type,
    p.media_paths,
    p.created_at,
    coalesce(
      (select s.media_retention_hours from public.settings s where s.id = 1),
      48
    )
  from claimed c
  join public.posts p on p.id = c.post_id
  join public.linkedin_destinations d on d.id = c.destination_id;
$$;

revoke all on function public.admin_claim_due_jobs(integer, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_claim_due_jobs(integer, uuid, uuid)
  to service_role;

-- A worker that stopped mid-publish leaves an unknown outcome. Never retry that
-- automatically; surface it per destination for a human to verify.
create or replace function public.admin_recover_stale_jobs(
  p_minutes integer default 10
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    update public.publishing_jobs
    set status = 'manual_required',
        last_error = 'Publishing outcome unknown: the worker stopped mid-publish. Check LinkedIn before retrying this destination.',
        next_attempt_at = null,
        locked_at = null,
        lock_token = null,
        updated_at = now()
    where status = 'publishing'
      and locked_at is not null
      and locked_at < now() - make_interval(mins => greatest(1, p_minutes))
    returning post_id
  loop
    v_count := v_count + 1;
    perform public.admin_refresh_post_status(r.post_id);
  end loop;

  return v_count;
end;
$$;

revoke all on function public.admin_recover_stale_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.admin_recover_stale_jobs(integer)
  to service_role;

revoke all on function public.admin_refresh_post_status(uuid) from public, anon;
grant execute on function public.admin_refresh_post_status(uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Refresh existing aggregates once, so the dashboard starts from a consistent
-- state after the upgrade.
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select distinct j.post_id
    from public.publishing_jobs j
  loop
    perform public.admin_refresh_post_status(r.post_id);
  end loop;
end
$$;
