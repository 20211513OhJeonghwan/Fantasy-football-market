-- BSD snapshots are replayable, provider isolated and never publicly expose raw JSON.
begin;
set local role service_role;
-- Equal numeric IDs from the legacy provider must coexist, preserving its watchlist references.
select public.apply_football_batch('{"leagues":[{"id":"af-85","external_id":85,"name":"Legacy"}],"players":[{"id":"af-9","external_id":9,"name":"Legacy player"}]}'::jsonb);
select public.apply_bsd_batch('{"provider":"bsd","leagues":[{"id":"bsd-85","external_id":85,"name":"BSD league"}],"coverage":[{"league_id":"bsd-85","season":2026,"provider_season_id":12345,"coverage":{"season":{"name":"2026/27"}}}],"teams":[{"id":"bsd-1","external_id":1,"name":"Home","league_id":"bsd-85"},{"id":"bsd-2","external_id":2,"name":"Away","league_id":"bsd-85"}],"players":[{"id":"bsd-9","external_id":9,"name":"BSD player","team_id":"bsd-2","position":"GK","shirt_number":22,"photo":"https://sports.bzzoiro.com/img/player/9/"}],"fixtures":[{"id":"bsd-100","external_id":100,"league_id":"bsd-85","season":2026,"provider_season_id":12345,"home_team_id":"bsd-1","away_team_id":"bsd-2","starts_at":"2026-09-20T12:00:00Z","status":"FT","home_score":1,"away_score":0}],"sources":[{"fixture_id":"bsd-100","detail":{"id":100}}]}'::jsonb);
do $$ declare payload jsonb; begin
  payload:='{"provider":"bsd","players":[{"id":"bsd-9","external_id":9,"name":"BSD player","shirt_number":1,"position":"DF"}],"sources":[{"fixture_id":"bsd-100","detail":{"id":100},"player_stats":{"event_id":100,"count":1,"player_stats":[{"player_id":9}]},"lineups":{"lineup_status":"confirmed"},"incidents":{"incidents":[{"type":"goal"},{"type":"substitution"}]},"legacy_stats":[{"penalty_save":1}]}],"matches":[{"player_id":"bsd-9","fixture_id":"bsd-100","team_id":"bsd-1","stats":{"minutes_played":90,"goals":0,"rating":8.5},"legacy_stats":{"penalty_save":1},"normalized":{"version":"bsd-v1","values":{"minutes":90,"goals":null,"assists":1,"saves":4,"penalty_saves":1},"quality":{"goals":"unverified_zero"},"calculation_ready":false}}]}'::jsonb;
  perform public.apply_bsd_batch(payload);
  perform public.apply_bsd_batch(payload);
  if (select count(*) from public.players where external_id=9)<>2 then raise exception 'Providers collided'; end if;
  if (select team_id from public.players where id='bsd-9')<>'bsd-2' then raise exception 'Historical team overwrote current squad'; end if;
  if (select shirt_number from public.players where id='bsd-9')<>22 then raise exception 'Historical shirt overwrote current squad'; end if;
  if (select position from public.players where id='bsd-9')<>'GK' then raise exception 'Historical position overwrote current squad'; end if;
  if (select count(*) from public.football_match_stats where player_id='bsd-9')<>1 then raise exception 'Replay duplicated stats'; end if;
  if (select count(*) from public.player_match_records where player_id='bsd-9')<>1 then raise exception 'Replay duplicated public records'; end if;
  if (select minutes from public.player_season_summaries where id='bsd-9')<>90 then raise exception 'Replay accumulated minutes'; end if;
  if (select goals from public.player_season_summaries where id='bsd-9') is not null then raise exception 'Unknown zero became known zero'; end if;
  if not exists(select 1 from public.player_catalog where id='bsd-9' and photo like '%/9/' and stats_scope='imported_matches' and matches_imported=1 and season=2026) then raise exception 'Public mapping incomplete'; end if;
  if not exists(select 1 from public.football_match_stats where player_id='bsd-9' and stats->>'goals'='0' and normalized#>>'{values,penalty_saves}'='1') then raise exception 'Raw/normalized fields lost'; end if;
  if exists(select 1 from public.player_market_snapshots) or exists(select 1 from public.player_match_records where performance is not null) then raise exception 'Ingestion invented market values'; end if;
  -- Correction replaces, rather than increments, the public summary.
  payload:=jsonb_set(payload,'{matches,0,normalized,values,minutes}','75');
  perform public.apply_bsd_batch(payload);
  if (select minutes from public.player_season_summaries where id='bsd-9')<>75 then raise exception 'Correction did not replace minutes'; end if;
  -- A malformed complete snapshot must not erase existing records.
  begin
    perform public.apply_bsd_batch(jsonb_set(payload,'{matches}','[]'));
    raise exception 'Incomplete snapshot accepted';
  exception when raise_exception then
    if sqlerrm='Incomplete snapshot accepted' then raise; end if;
  end;
  if (select count(*) from public.player_match_records where player_id='bsd-9')<>1 then raise exception 'Incomplete snapshot erased data'; end if;
  -- An invalid team rolls back the entire batch, including preceding player upsert.
  begin
    perform public.apply_bsd_batch(jsonb_set(jsonb_set(payload,'{players,0,name}','"Wrong name"'),'{matches,0,team_id}','"bsd-999"'));
    raise exception 'Invalid team accepted';
  exception when raise_exception then
    if sqlerrm='Invalid team accepted' then raise; end if;
  end;
  if (select name from public.players where id='bsd-9')<>'BSD player' then raise exception 'Failed batch partly committed'; end if;
end $$;
-- Fixture-list refresh preserves all fetched sub-resources and updates result on score correction.
select public.apply_bsd_batch('{"provider":"bsd","fixtures":[{"id":"bsd-100","external_id":100,"league_id":"bsd-85","season":2026,"provider_season_id":12345,"home_team_id":"bsd-1","away_team_id":"bsd-2","starts_at":"2026-09-20T12:00:00Z","status":"FT","home_score":0,"away_score":1}],"sources":[{"fixture_id":"bsd-100","detail":{"id":100}}]}'::jsonb);
do $$ begin
  if (select result from public.player_match_records where player_id='bsd-9')<>'패' then raise exception 'Fixture correction left stale result'; end if;
  if (select lineups from public.football_event_sources where fixture_id='bsd-100') is null then raise exception 'List refresh erased lineup'; end if;
  if (select state from public.fixture_catalog where id='bsd-100')<>'finished' then raise exception 'BSD status not visible'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  if (select count(*) from public.player_catalog where id='bsd-9')<>1 then raise exception 'Public catalog missing'; end if;
  begin perform * from public.football_event_sources; raise exception 'Raw sources exposed'; exception when insufficient_privilege then null; end;
  begin perform public.apply_bsd_batch('{"provider":"bsd"}'); raise exception 'Guest can ingest'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform * from public.football_match_stats; raise exception 'Normalized/raw stats exposed'; exception when insufficient_privilege then null; end;
  begin perform public.apply_bsd_batch('{"provider":"bsd"}'); raise exception 'Member can ingest'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
