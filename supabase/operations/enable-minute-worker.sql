-- Run as the Supabase SQL Editor owner after 202610170001.
-- No credentials are pasted here: the existing GitHub Secrets configure Vault.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.kickx_configure_minute_worker(p_bsd_key text,p_service_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item record;secret_id uuid;old_value text;begin
 if p_bsd_key is null or char_length(p_bsd_key) not between 8 and 512 or p_service_key is null or char_length(p_service_key) not between 20 and 2048 then raise exception 'INVALID_INPUT';end if;
 for item in select 'kickx_bsd_key' as name,p_bsd_key as value union all select 'kickx_worker_service_key',p_service_key loop
  select id,decrypted_secret into secret_id,old_value from vault.decrypted_secrets where name=item.name;
  if secret_id is null then perform vault.create_secret(item.value,item.name);
  elsif old_value is distinct from item.value then perform vault.update_secret(secret_id,item.value);end if;
 end loop;
 return jsonb_build_object('configured',true);
end $$;
revoke all on function public.kickx_configure_minute_worker(text,text) from public,anon,authenticated;
grant execute on function public.kickx_configure_minute_worker(text,text) to service_role;

create or replace function public.kickx_dispatch_minute_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare service_key text;bsd_key text;request_id bigint;begin
 -- An idle DB checks calendars every 15 minutes, with no BSD calls on other ticks.
 if not exists(select 1 from public.realtime_worker_state where singleton and coalesce(lease_until,'-infinity')<=now()) then return null;end if;
 if not exists(select 1 from public.kickx_realtime_due_fixtures(now()))
 and not exists(select 1 from public.realtime_fixture_tasks where retry_at<=now())
 and not exists(select 1 from public.calculation_queue where retry_at<=now())
 and extract(minute from now())::int % 15<>0 then return null;end if;
 select decrypted_secret into service_key from vault.decrypted_secrets where name='kickx_worker_service_key';
 select decrypted_secret into bsd_key from vault.decrypted_secrets where name='kickx_bsd_key';
 if service_key is null or bsd_key is null then return null;end if;
 -- Fixed trusted origin: never forward either secret to a caller-selected URL.
 select net.http_post(url:='https://kick-x-test.vercel.app/api/internal/football',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key),body:=jsonb_build_object('bsdKey',bsd_key),timeout_milliseconds:=65000) into request_id;
 return request_id;
end $$;
revoke all on function public.kickx_dispatch_minute_worker() from public,anon,authenticated;
-- Named cron.schedule replaces its own schedule instead of creating duplicates.
select cron.schedule('kickx-football-minute','* * * * *','select public.kickx_dispatch_minute_worker();');
notify pgrst,'reload schema';
commit;
