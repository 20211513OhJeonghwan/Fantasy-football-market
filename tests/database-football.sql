-- Disposable role and ingestion integrity checks. Every row is rolled back.
begin;
set local role service_role;
select public.apply_football_batch('{"leagues":[{"id":"af-39","external_id":39,"name":"CI league"}],"teams":[{"id":"af-1","external_id":1,"name":"CI home","league_id":"af-39"},{"id":"af-2","external_id":2,"name":"CI away","league_id":"af-39"}],"players":[{"id":"af-9","external_id":9,"name":"CI player","team_id":"af-1"}],"fixtures":[{"id":"af-10","external_id":10,"league_id":"af-39","season":2025,"home_team_id":"af-1","away_team_id":"af-2","starts_at":"2025-08-01T12:00:00Z","status":"FT","home_score":0,"away_score":0}]}'::jsonb);
select public.apply_football_batch('{"players":[{"id":"af-9","external_id":9,"name":"CI player"}],"seasons":[{"player_id":"af-9","league_id":"af-39","team_id":"af-1","season":2025,"stats":{"goals":{"total":0,"assists":null},"games":{"minutes":90}}}],"matches":[{"player_id":"af-9","fixture_id":"af-10","team_id":"af-1","stats":{"games":{"minutes":90,"rating":"7.5"},"goals":{"total":0,"assists":null}}}]}'::jsonb);
select public.apply_football_batch('{"players":[{"id":"af-9","external_id":9,"name":"CI player"}],"seasons":[{"player_id":"af-9","league_id":"af-39","team_id":"af-1","season":2025,"stats":{"goals":{"total":0,"assists":null},"games":{"minutes":90}}}],"matches":[{"player_id":"af-9","fixture_id":"af-10","team_id":"af-1","stats":{"games":{"minutes":90,"rating":"7.5"},"goals":{"total":0,"assists":null}}}]}'::jsonb);
do $$ begin
  if (select count(*) from public.players where id='af-9')<>1 then raise exception 'Player ingestion duplicates'; end if;
  if (select team_id from public.players where id='af-9')<>'af-1' then raise exception 'Historical import erased squad'; end if;
  if (select count(*) from public.football_match_stats)<>1 then raise exception 'Match ingestion duplicates'; end if;
  if (select count(*) from public.player_match_records)<>1 then raise exception 'Match record duplicates'; end if;
  if (select minutes from public.player_season_summaries where id='af-9')<>90 then raise exception 'Repeated import accumulates totals'; end if;
  if (select assists from public.player_season_summaries where id='af-9') is not null then raise exception 'Unknown assists became zero'; end if;
  if exists(select 1 from public.player_match_records where performance is not null) then raise exception 'Provider rating became Performance'; end if;
  if exists(select 1 from public.player_market_snapshots) then raise exception 'Import fabricated market values'; end if;
  begin
    perform public.apply_football_batch('{"players":[{"id":"bad-batch-player","external_id":555,"name":"Rollback test"}],"seasons":[{"player_id":"bad-batch-player","league_id":"missing-league","team_id":"af-1","season":2025,"stats":{}}]}'::jsonb);
    raise exception 'Invalid dependency accepted';
  exception when foreign_key_violation then null; end;
  if exists(select 1 from public.players where id='bad-batch-player') then raise exception 'Failed batch partly committed'; end if;
end $$;
select public.apply_football_batch('{"players":[{"id":"af-11","external_id":11,"name":"CI unassigned"}],"seasons":[{"player_id":"af-11","league_id":"af-39","team_id":"af-1","season":2025,"stats":{"goals":{"total":1},"games":{"minutes":0}}}]}'::jsonb);
do $$ begin
  if not exists(select 1 from public.player_catalog where id='af-11' and team_id is null and league_ids @> array['af-39']) then raise exception 'Unassigned season player lost league search'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  if (select goals from public.player_catalog where id='af-9')<>0 then raise exception 'Public summary missing'; end if;
  if (select count(*) from public.fixture_catalog)<>1 then raise exception 'Public fixture catalog missing'; end if;
  begin perform * from public.football_match_stats; raise exception 'Raw supplier JSON exposed'; exception when insufficient_privilege then null; end;
  begin perform public.apply_football_batch('{}'); raise exception 'Guest can ingest'; exception when insufficient_privilege then null; end;
  begin perform public.watched_player_catalog(); raise exception 'Guest can query private relation'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into auth.users values('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into public.watchlists(user_id,player_id) values('00000000-0000-0000-0000-000000000004','af-9');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$ begin
  if (select count(*) from public.watched_player_catalog())<>0 then raise exception 'Other member watchlist leaked'; end if;
  begin perform public.apply_football_batch('{}'); raise exception 'Member can ingest'; exception when insufficient_privilege then null; end;
  begin perform * from public.football_sync_jobs; raise exception 'Member can read private jobs'; exception when insufficient_privilege then null; end;
end $$;
insert into public.watchlists(user_id,player_id) values('00000000-0000-0000-0000-000000000003','af-9');
do $$ begin
  if (select count(*) from public.watched_player_catalog())<>1 then raise exception 'Own watchlist query failed'; end if;
end $$;
reset role;
rollback;
