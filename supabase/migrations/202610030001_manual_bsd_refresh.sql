-- Manual, resumable collection. No cron, trigger or background scheduler starts a run.
begin;
create table public.football_bulk_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'running' check(status in ('running','paused','completed','cancelled')),
  started_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz,
  total_tasks integer not null default 0, completed_tasks integer not null default 0,
  warnings integer not null default 0, requests integer not null default 0, rows_written integer not null default 0,
  error_code text, retry_at timestamptz, remaining integer,
  lease_token uuid, lease_until timestamptz, leased_task bigint, reserved_date date,
  next_request_at timestamptz
);
create unique index one_active_football_bulk_run on public.football_bulk_runs ((true)) where status in ('running','paused');
create table public.football_bulk_tasks (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.football_bulk_runs(id) on delete cascade,
  task_key text not null, kind text not null check(kind in ('league','teams','squad','players','fixtures','match')),
  priority integer not null, label text not null, payload jsonb not null,
  completed boolean not null default false, warning text, attempts integer not null default 0,
  unique(run_id,task_key)
);
create index football_bulk_pending on public.football_bulk_tasks(run_id,priority,id) where not completed;
create table public.football_bulk_daily_budget (
  day date primary key, requests integer not null default 0 check(requests>=0)
);
create table public.football_entity_sources (
  provider text not null default 'bsd' check(provider='bsd'),
  kind text not null check(kind in ('league','team','squad','player')),
  external_id bigint not null, raw jsonb not null, updated_at timestamptz not null default now(),
  primary key(provider,kind,external_id)
);
do $$ declare t text; begin
  foreach t in array array['football_bulk_runs','football_bulk_tasks','football_bulk_daily_budget','football_entity_sources'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence public.football_bulk_tasks_id_seq to service_role;

create function public.start_football_bulk(actor uuid, tasks jsonb) returns uuid
language plpgsql set search_path='' as $$
declare run uuid; item jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-bulk',0));
  select id into run from public.football_bulk_runs where status in ('running','paused') limit 1;
  if run is not null then return run; end if;
  if jsonb_array_length(tasks)<>5 then raise exception 'Five leagues required'; end if;
  insert into public.football_bulk_runs(requested_by,total_tasks) values(actor,5) returning id into run;
  for item in select value from jsonb_array_elements(tasks) loop
    if item->>'kind'<>'league' or (item#>>'{payload,league}')::integer not in (1,3,4,5,6) then raise exception 'Invalid initial task'; end if;
    insert into public.football_bulk_tasks(run_id,task_key,kind,priority,label,payload)
    values(run,item->>'key',item->>'kind',(item->>'priority')::integer,item->>'label',item->'payload');
  end loop;
  return run;
end $$;

create function public.claim_football_bulk(run uuid) returns jsonb
language plpgsql set search_path='' as $$
declare r public.football_bulk_runs; t public.football_bulk_tasks; token uuid;
  d date:=(now() at time zone 'UTC')::date; used integer;
begin
  select * into strict r from public.football_bulk_runs where id=run for update;
  if r.status<>'running' then return jsonb_build_object('state',r.status); end if;
  if r.lease_until>now() then return jsonb_build_object('state','busy'); end if;
  if r.next_request_at>now() then return jsonb_build_object('state','wait'); end if;
  if r.lease_token is not null then
    -- An abandoned reservation stays charged: its network requests may have happened.
    update public.football_bulk_runs set requests=requests+3 where id=run;
  end if;
  select * into t from public.football_bulk_tasks where run_id=run and not completed order by priority,id limit 1;
  if t.id is null then
    update public.football_bulk_runs set status='completed',finished_at=now(),updated_at=now(),lease_token=null,lease_until=null,leased_task=null where id=run;
    return jsonb_build_object('state','completed');
  end if;
  insert into public.football_bulk_daily_budget(day) values(d) on conflict do nothing;
  select requests into used from public.football_bulk_daily_budget where day=d for update;
  -- Reserve all three possible HTTP attempts before touching BSD. Leave room for other tools.
  if used+3>7000 then
    update public.football_bulk_runs set status='paused',error_code='LOCAL_DAILY_BUDGET',retry_at=(d+1)::timestamp at time zone 'UTC',lease_token=null,lease_until=null,leased_task=null,updated_at=now() where id=run;
    return jsonb_build_object('state','paused');
  end if;
  token:=gen_random_uuid();
  update public.football_bulk_daily_budget set requests=requests+3 where day=d;
  update public.football_bulk_tasks set attempts=attempts+1 where id=t.id;
  update public.football_bulk_runs set lease_token=token,lease_until=now()+interval '90 seconds',leased_task=t.id,reserved_date=d,updated_at=now(),error_code=null where id=run;
  return jsonb_build_object('state','claimed','token',token,'task',jsonb_build_object('id',t.id,'kind',t.kind,'payload',t.payload,'label',t.label),'today',to_char(r.started_at at time zone 'UTC','YYYY-MM-DD'));
end $$;

create function public.finish_football_bulk(run uuid, token uuid, outcome jsonb, request_count integer, quota_remaining integer) returns void
language plpgsql set search_path='' as $$
declare r public.football_bulk_runs; item jsonb; n integer:=0; added integer:=0; changed integer; is_done boolean;
begin
  select * into strict r from public.football_bulk_runs where id=run for update;
  if token is null or r.leased_task is null or r.lease_token is distinct from token or r.lease_until<now() or r.status<>'running' then raise exception 'STALE_BULK_LEASE'; end if;
  if request_count<0 or request_count>3 then raise exception 'Invalid request count'; end if;
  is_done:=(outcome->>'done')::boolean;
  if is_done is null then raise exception 'Invalid outcome'; end if;
  if outcome->'batch' is not null and outcome->'batch'<>'null'::jsonb then n:=public.apply_bsd_batch(outcome->'batch'); end if;
  for item in select value from jsonb_array_elements(coalesce(outcome->'entities','[]')) loop
    insert into public.football_entity_sources(kind,external_id,raw) values(item->>'kind',(item->>'external_id')::bigint,item->'raw')
    on conflict(provider,kind,external_id) do update set raw=excluded.raw,updated_at=now();
  end loop;
  -- Only a complete current roster/list can detach obsolete current membership. History remains.
  if jsonb_array_length(coalesce(outcome#>'{squadMembership,playerIds}','[]'))>0 then
    update public.players set team_id=null,updated_at=now() where provider='bsd' and team_id=outcome#>>'{squadMembership,teamId}'
      and not (id in(select jsonb_array_elements_text(outcome#>'{squadMembership,playerIds}')));
  end if;
  if jsonb_array_length(coalesce(outcome#>'{leagueMembership,teamIds}','[]'))>0 then
    update public.teams set league_id=null,updated_at=now() where provider='bsd' and league_id=outcome#>>'{leagueMembership,leagueId}'
      and not (id in(select jsonb_array_elements_text(outcome#>'{leagueMembership,teamIds}')));
  end if;
  for item in select value from jsonb_array_elements(coalesce(outcome->'children','[]')) loop
    insert into public.football_bulk_tasks(run_id,task_key,kind,priority,label,payload)
    values(run,item->>'key',item->>'kind',(item->>'priority')::integer,item->>'label',item->'payload') on conflict(run_id,task_key) do nothing;
    get diagnostics changed = row_count; added:=added+changed;
  end loop;
  update public.football_bulk_tasks set completed=is_done,warning=outcome->>'warning',payload=case when is_done then '{}'::jsonb else outcome->'payload' end where id=r.leased_task;
  update public.football_bulk_daily_budget set requests=requests-(3-request_count) where day=r.reserved_date;
  update public.football_bulk_runs set total_tasks=total_tasks+added,completed_tasks=completed_tasks+case when is_done then 1 else 0 end,
    warnings=warnings+case when outcome->>'warning' is null then 0 else 1 end,requests=requests+request_count,rows_written=rows_written+n,
    remaining=quota_remaining,lease_token=null,lease_until=null,leased_task=null,next_request_at=now()+interval '1100 milliseconds',updated_at=now() where id=run;
  if not exists(select 1 from public.football_bulk_tasks where run_id=run and not completed) then
    update public.football_bulk_runs set status='completed',finished_at=now() where id=run;
  elsif quota_remaining is not null and quota_remaining<10 then
    update public.football_bulk_runs set status='paused',error_code='DAILY_QUOTA_REACHED',retry_at=(((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC') where id=run;
  end if;
end $$;

create function public.fail_football_bulk(run uuid, token uuid, error_code text, request_count integer, retry_seconds integer) returns void
language plpgsql set search_path='' as $$
declare r public.football_bulk_runs;
begin
  select * into strict r from public.football_bulk_runs where id=run for update;
  if token is null or r.leased_task is null or r.lease_token is distinct from token then raise exception 'STALE_BULK_LEASE'; end if;
  if request_count<0 or request_count>3 or error_code !~ '^[A-Z0-9_]{1,80}$' then raise exception 'Invalid failure'; end if;
  update public.football_bulk_daily_budget set requests=requests-(3-request_count) where day=r.reserved_date;
  update public.football_bulk_runs set status='paused',error_code=fail_football_bulk.error_code,requests=requests+request_count,
    retry_at=case when fail_football_bulk.error_code='DAILY_QUOTA_REACHED' then (((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC')
      when retry_seconds is not null then now()+make_interval(secs=>least(greatest(retry_seconds,1),86400)) else null end,
    lease_token=null,lease_until=null,leased_task=null,updated_at=now() where id=run;
end $$;

create function public.control_football_bulk(run uuid, action text) returns text
language plpgsql set search_path='' as $$
declare r public.football_bulk_runs;
begin
  select * into strict r from public.football_bulk_runs where id=run for update;
  if action not in ('pause','resume','cancel') then raise exception 'Invalid action'; end if;
  if r.status in ('completed','cancelled') then return r.status; end if;
  if r.lease_until>now() then return 'busy'; end if;
  if action='resume' and r.retry_at>now() then return 'cooldown'; end if;
  update public.football_bulk_runs set status=case action when 'resume' then 'running' when 'pause' then 'paused' else 'cancelled' end,
    error_code=case when action='resume' then null else error_code end,updated_at=now(),finished_at=case when action='cancel' then now() else null end where id=run;
  return case action when 'resume' then 'running' when 'pause' then 'paused' else 'cancelled' end;
end $$;

revoke all on function public.start_football_bulk(uuid,jsonb),public.claim_football_bulk(uuid),public.finish_football_bulk(uuid,uuid,jsonb,integer,integer),public.fail_football_bulk(uuid,uuid,text,integer,integer),public.control_football_bulk(uuid,text) from public,anon,authenticated;
grant execute on function public.start_football_bulk(uuid,jsonb),public.claim_football_bulk(uuid),public.finish_football_bulk(uuid,uuid,jsonb,integer,integer),public.fail_football_bulk(uuid,uuid,text,integer,integer),public.control_football_bulk(uuid,text) to service_role;
commit;
