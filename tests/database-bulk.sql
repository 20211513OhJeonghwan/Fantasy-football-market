-- Disposable DB only. A persisted lease protects manual browser and CLI workers equally.
begin;
set local role service_role;
do $$ declare r uuid; claimed jsonb; newer jsonb; used integer; original_count integer; payload jsonb;
  initial jsonb:='[{"key":"league:1","kind":"league","priority":0,"label":"EPL","payload":{"league":1}}, {"key":"league:3","kind":"league","priority":0,"label":"Liga","payload":{"league":3}}, {"key":"league:4","kind":"league","priority":0,"label":"Serie A","payload":{"league":4}}, {"key":"league:5","kind":"league","priority":0,"label":"Bundesliga","payload":{"league":5}}, {"key":"league:6","kind":"league","priority":0,"label":"Ligue 1","payload":{"league":6}}]';
begin
  r:=public.start_football_bulk(null,initial);
  if public.start_football_bulk(null,initial)<>r then raise exception 'Double click created two runs'; end if;
  claimed:=public.claim_football_bulk(r);
  if claimed->>'state'<>'claimed' then raise exception 'No lease acquired'; end if;
  if public.claim_football_bulk(r)->>'state'<>'busy' then raise exception 'Concurrent worker acquired lease'; end if;
  if public.control_football_bulk(r,'cancel')<>'busy' then raise exception 'Cancelled in-flight commit'; end if;
  used:=(select requests from public.football_bulk_daily_budget where day=(now() at time zone 'UTC')::date);
  if used<>3 then raise exception 'Retries not reserved before call'; end if;
  perform public.finish_football_bulk(r,(claimed->>'token')::uuid,'{"done":false,"payload":{"league":1,"phase":"seasons"},"children":[]}',1,7000);
  if (select completed_tasks from public.football_bulk_runs where id=r)<>0 then raise exception 'Partial checkpoint completed task'; end if;
  if (select requests from public.football_bulk_daily_budget where day=(now() at time zone 'UTC')::date)<>1 then raise exception 'Unused reservation not released'; end if;
  if not exists(select 1 from public.football_bulk_tasks where run_id=r and football_bulk_tasks.payload->>'phase'='seasons') then raise exception 'Resume checkpoint lost'; end if;
  begin
    perform public.finish_football_bulk(r,(claimed->>'token')::uuid,'{"done":true}',1,7000);
    raise exception 'Stale checkpoint accepted';
  exception when raise_exception then if sqlerrm<>'STALE_BULK_LEASE' then raise; end if; end;
  begin
    perform public.finish_football_bulk(r,null,'{"done":true}',1,7000);
    raise exception 'Missing lease accepted';
  exception when raise_exception then if sqlerrm<>'STALE_BULK_LEASE' then raise; end if; end;

  update public.football_bulk_runs set next_request_at=null where id=r;
  claimed:=public.claim_football_bulk(r);
  payload:='{"done":true,"batch":{"provider":"bsd","leagues":[{"id":"bsd-1","external_id":1,"name":"League"}],"teams":[{"id":"bsd-10","external_id":10,"name":"Club","league_id":"bsd-1"}],"players":[{"id":"bsd-20","external_id":20,"name":"Player","team_id":"bsd-10"}]},"entities":[{"kind":"squad","external_id":10,"raw":{"team_id":10}}],"children":[{"key":"squad:10","kind":"squad","priority":20,"label":"Club","payload":{"teamId":10}},{"key":"squad:10","kind":"squad","priority":20,"label":"Club","payload":{"teamId":10}}]}';
  perform public.finish_football_bulk(r,(claimed->>'token')::uuid,payload,1,6999);
  if (select total_tasks from public.football_bulk_runs where id=r)<>6 then raise exception 'Duplicate child tasks counted'; end if;
  if (select completed_tasks from public.football_bulk_runs where id=r)<>1 then raise exception 'Task not completed atomically'; end if;
  if not exists(select 1 from public.players where id='bsd-20') or not exists(select 1 from public.football_entity_sources where kind='squad' and external_id=10) then raise exception 'Checkpoint saved without data'; end if;

  update public.football_bulk_runs set next_request_at=null where id=r;
  claimed:=public.claim_football_bulk(r);
  original_count:=(select rows_written from public.football_bulk_runs where id=r);
  begin
    perform public.finish_football_bulk(r,(claimed->>'token')::uuid,jsonb_set(payload,'{batch,players,0,team_id}','"bsd-99999"'),1,6998);
    raise exception 'Invalid batch committed';
  exception when foreign_key_violation or raise_exception then if sqlerrm='Invalid batch committed' then raise; end if; end;
  if (select rows_written from public.football_bulk_runs where id=r)<>original_count or (select lease_token from public.football_bulk_runs where id=r) is null then raise exception 'Bad batch partly advanced queue'; end if;
  perform public.fail_football_bulk(r,(claimed->>'token')::uuid,'PROVIDER_RATE_LIMIT',1,60);
  if public.control_football_bulk(r,'resume')<>'cooldown' then raise exception 'Rate-limit cooldown ignored'; end if;
  update public.football_bulk_runs set retry_at=now()-interval '1 second' where id=r;
  if public.control_football_bulk(r,'resume')<>'running' then raise exception 'Resume failed'; end if;
  claimed:=public.claim_football_bulk(r);
  update public.football_bulk_runs set lease_until=now()-interval '1 second' where id=r;
  newer:=public.claim_football_bulk(r);
  if newer->>'state'<>'claimed' or newer->>'token'=claimed->>'token' then raise exception 'Abandoned lease not recoverable'; end if;
  begin
    perform public.finish_football_bulk(r,(claimed->>'token')::uuid,'{"done":true}',1,5000);
    raise exception 'Old worker overwrote new lease';
  exception when raise_exception then if sqlerrm<>'STALE_BULK_LEASE' then raise; end if; end;
  perform public.finish_football_bulk(r,(newer->>'token')::uuid,'{"done":true,"warning":"MATCH_STATS_UNAVAILABLE"}',1,5000);
  if (select warnings from public.football_bulk_runs where id=r)<>1 then raise exception 'Data gap not reported'; end if;

  -- Empty/partial rosters cannot detach. A complete replacement can; historical IDs remain.
  update public.football_bulk_runs set next_request_at=null where id=r;
  claimed:=public.claim_football_bulk(r);
  perform public.finish_football_bulk(r,(claimed->>'token')::uuid,'{"done":true,"squadMembership":{"teamId":"bsd-10","playerIds":[]}}',1,5000);
  if (select team_id from public.players where id='bsd-20') is null then raise exception 'Empty roster detached current member'; end if;
  update public.football_bulk_runs set next_request_at=null where id=r;
  claimed:=public.claim_football_bulk(r);
  perform public.finish_football_bulk(r,(claimed->>'token')::uuid,'{"done":true,"squadMembership":{"teamId":"bsd-10","playerIds":["bsd-21"]}}',1,5000);
  if (select team_id from public.players where id='bsd-20') is not null then raise exception 'Old membership survived complete roster'; end if;

  update public.football_bulk_runs set next_request_at=null where id=r;
  update public.football_bulk_daily_budget set requests=6998 where day=(now() at time zone 'UTC')::date;
  if public.claim_football_bulk(r)->>'state'<>'paused' then raise exception 'Exceeded daily budget'; end if;
  if (select error_code from public.football_bulk_runs where id=r)<>'LOCAL_DAILY_BUDGET' then raise exception 'Budget pause reason absent'; end if;
  if public.control_football_bulk(r,'cancel')<>'cancelled' then raise exception 'Cancellation failed'; end if;
  if not exists(select 1 from public.players where id='bsd-20') then raise exception 'Cancellation erased catalog'; end if;
  if public.start_football_bulk(null,initial)=r then raise exception 'Completed/cancelled run cannot be refreshed'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.football_bulk_runs; raise exception 'Guest read private runs'; exception when insufficient_privilege then null; end;
  begin perform public.start_football_bulk(null,'[]'); raise exception 'Guest started bulk'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform * from public.football_bulk_tasks; raise exception 'Member read raw checkpoints'; exception when insufficient_privilege then null; end;
  begin perform public.claim_football_bulk(gen_random_uuid()); raise exception 'Member acquired lease'; exception when insufficient_privilege then null; end;
  begin perform * from public.football_entity_sources; raise exception 'Member read raw profiles'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
