-- ============================================================================
-- 0002_cron.sql
--
-- Schedules the publishing worker every minute and the media cleanup worker
-- every hour using pg_cron + pg_net.
--
-- The job command reads the project URL and service role key from Vault at run
-- time, so no secret is written into cron.job.
--
-- Before running (SQL editor):
--   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
--
-- Then re-run this file (or `supabase db push`) so the jobs are created.
-- ============================================================================

do $$
declare
  v_project_url text;
  v_service_key text;
begin
  -- pg_cron and pg_net are enabled by default on hosted Supabase projects.
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron is not available: %', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension if not exists pg_net;
    exception when others then
      raise notice 'pg_net is not available: %', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_project_url is null or v_service_key is null then
    raise notice
      'Skipping cron jobs: create Vault secrets "project_url" and "service_role_key", then re-run 0002_cron.sql.';
    return;
  end if;

  -- Publishing: every minute.
  if exists (select 1 from cron.job where jobname = 'linkedin-publish-every-minute') then
    perform cron.unschedule('linkedin-publish-every-minute');
  end if;

  perform cron.schedule(
    'linkedin-publish-every-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/publish-scheduled',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );

  -- Media cleanup: hourly at minute 5.
  if exists (select 1 from cron.job where jobname = 'linkedin-media-cleanup-hourly') then
    perform cron.unschedule('linkedin-media-cleanup-hourly');
  end if;

  perform cron.schedule(
    'linkedin-media-cleanup-hourly',
    '5 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/cleanup-media',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );

  raise notice 'Scheduled linkedin-publish-every-minute and linkedin-media-cleanup-hourly.';
end
$$;
