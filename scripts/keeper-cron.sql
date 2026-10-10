-- Viatik keeper trigger (Monad Testnet). Supabase Cron (pg_cron) calls
-- POST <production URL>/api/v1/keeper/run every 10 minutes through pg_net, with the
-- KEEPER_TRIGGER_TOKEN header value kept in Supabase Vault. The keeper pays the
-- scheduled payments that are due and tells Agency Admins about monthly payments on
-- their due day (src/server/keeper.ts). Each call works for about 20 seconds; a call
-- that finds another one running answers {"status":"busy"} and does nothing.
--
-- Run it ONCE on the production Supabase project at the Phase H switch, in the SQL
-- editor. It creates no table and touches none of Viatik's: only the pg_cron and pg_net
-- extensions, two Vault secrets and one cron job. Running it again replaces them.
--
-- Before running it:
--   1. Generate a token of at least 32 characters, e.g. `openssl rand -hex 32`.
--   2. Set it on the production host (Hostinger hPanel > the Node.js app > Environment
--      variables) as KEEPER_TRIGGER_TOKEN and redeploy: without it the route answers 404.
--   3. Replace <KEEPER_TRIGGER_TOKEN> and <PRODUCTION_URL> below with the exact URL that
--      answers without a redirect (no trailing slash, e.g. https://viatik.xyz): pg_net does
--      not follow redirects. Do not commit the edited copy.
--
-- Check it afterwards:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'viatik-keeper';
--   select status, return_message, start_time from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'viatik-keeper')
--     order by start_time desc limit 10;
--   select id, status_code, content::text, error_msg, created from net._http_response
--     order by created desc limit 10;
-- Stop it:
--   select cron.unschedule('viatik-keeper');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The token and the URL, encrypted at rest in Vault (created, or updated when they exist).
do $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'viatik_keeper_token';
  if existing is null then
    perform vault.create_secret(
      '<KEEPER_TRIGGER_TOKEN>',
      'viatik_keeper_token',
      'x-keeper-token for POST /api/v1/keeper/run (Viatik keeper)'
    );
  else
    perform vault.update_secret(existing, '<KEEPER_TRIGGER_TOKEN>');
  end if;

  select id into existing from vault.secrets where name = 'viatik_keeper_url';
  if existing is null then
    perform vault.create_secret('<PRODUCTION_URL>', 'viatik_keeper_url', 'Viatik production URL (keeper)');
  else
    perform vault.update_secret(existing, '<PRODUCTION_URL>');
  end if;
end
$$;

-- Replace an earlier job of the same name.
select cron.unschedule(jobid) from cron.job where jobname = 'viatik-keeper';

-- Every 10 minutes. pg_net is asynchronous (the job only queues the request); its
-- default timeout is far shorter than a keeper pass, so it is raised to 30 seconds.
select cron.schedule(
  'viatik-keeper',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'viatik_keeper_url')
      || '/api/v1/keeper/run',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-keeper-token', (select decrypted_secret from vault.decrypted_secrets where name = 'viatik_keeper_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
