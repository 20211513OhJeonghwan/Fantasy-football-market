begin;
-- Historical fixture imports in this test were observed over ten minutes ago.
alter table public.fixtures alter column finished_observed_at set default (now()-interval '11 minutes');
update public.kickx_policy set club_competitions_enabled=true,version='form-v2',pricing_reference_at='2026-08-01T00:00:00Z',pricing_reference_season=2026;
insert into public.leagues(id,name,provider,external_id) values('bsd-1','Premier League','bsd',1),('bsd-7','Champions League','bsd',7) on conflict(id) do nothing;
insert into public.teams(id,name,provider,external_id,league_id) values('bsd-4401','Club home','bsd',4401,'bsd-1'),('bsd-4402','Foreign opponent','bsd',4402,null);
insert into public.players(id,name,provider,team_id,position) values('bsd-4400','Market player','bsd','bsd-4401','FW'),('bsd-4499','Opponent player','bsd',null,'FW');
insert into public.fixtures(id,home_team_id,away_team_id,league_id,starts_at,status,provider,season,penalties_home,penalties_away) values
 ('bsd-4501','bsd-4401','bsd-4402','bsd-7','2026-08-02T12:00:00Z','AET','bsd',2026,null,null),
 ('bsd-4502','bsd-4401','bsd-4402','bsd-1','2026-08-03T12:00:00Z','FT','bsd',2026,null,null),
 ('bsd-4503','bsd-4401','bsd-4402','bsd-7','2026-08-04T12:00:00Z','FT','bsd',2026,null,null);
insert into public.football_event_sources(fixture_id,detail) values('bsd-4501','{"extra_time_score":{"home":0,"away":0}}'),('bsd-4502','{}'),('bsd-4503','{}');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats) values('bsd-4400','bsd-4501','bsd-4401','{"minutes_played":120}'),('bsd-4400','bsd-4502','bsd-4401','{"minutes_played":90}'),('bsd-4400','bsd-4503','bsd-4401','{"minutes_played":90}');
create function pg_temp.cup_expect(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected %',expected;
end $$;
create function pg_temp.cup_results() returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('fixtureId',fixture_id,'ruleVersion','form-v2','scoringRevision','club-competitions-v1','score',case when fixture_id='bsd-4501' then 65 when fixture_id='bsd-4502' then 50 else null end,'position','FW','status',case when fixture_id='bsd-4503' then 'blocked' else 'provisional' end,'breakdown','[]'::jsonb,'warnings','[]'::jsonb) order by fixture_id) from public.football_match_stats where player_id='bsd-4400'
$$;
create function pg_temp.cup_publish(h text,r jsonb) returns jsonb language plpgsql as $$declare expected jsonb;begin
 select jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at) order by m.fixture_id) into expected from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id join public.football_event_sources s on s.fixture_id=f.id where m.player_id='bsd-4400';
 return public.kickx_publish_calculation(null,'bsd-4400',h,expected,r);
end $$;
set local role service_role;
select public.kickx_auto_initialize_market();
select pg_temp.cup_publish('first-cup',pg_temp.cup_results());
reset role;
do $$begin
 if (select pricing_status from public.player_market_snapshots where id='bsd-4400')<>'ready' then raise exception 'new incomplete cup blocked valid league pricing';end if;
 if exists(select 1 from public.player_market_snapshots where id='bsd-4499') then raise exception 'foreign opponent initialized in market';end if;
 if (select count(*) from public.player_price_results where player_id='bsd-4400')<>2 then raise exception '120-minute match missing from pricing';end if;
 if (select reflection_status from public.fixture_catalog where id='bsd-4503')<>'withheld' then raise exception 'missing cup status not disclosed';end if;
end $$;
select pg_temp.cup_expect($q$update public.football_match_stats set stats='{"minutes_played":121}' where fixture_id='bsd-4501'; select pg_temp.cup_publish('bad-minutes',pg_temp.cup_results())$q$,'INVALID_INPUT');
-- Fixture-only metadata and current rosters cannot be reclassified by a cup import.
select public.apply_bsd_batch('{"provider":"bsd","teams":[{"id":"bsd-4401","external_id":4401,"name":"Club home","league_id":"bsd-7"}],"players":[{"id":"bsd-4400","external_id":4400,"name":"Market player","position":"DF"}]}');
do $$begin
 if (select league_id from public.teams where id='bsd-4401')<>'bsd-1' or (select team_id from public.players where id='bsd-4400')<>'bsd-4401' or (select position from public.players where id='bsd-4400')<>'FW' then raise exception 'cup overwrote current membership';end if;
end $$;
-- Already reflected data becoming invalid must preserve its price and pause trading.
select pg_temp.cup_publish('cup-correction',(select jsonb_agg(case when x->>'fixtureId'='bsd-4501' then x||'{"status":"blocked","score":null}'::jsonb else x end) from jsonb_array_elements(pg_temp.cup_results()) x));
do $$begin
 if (select pricing_status from public.player_market_snapshots where id='bsd-4400')<>'pending' then raise exception 'priced source correction not protected';end if;
end $$;
-- A completion marker cannot commit while any checkpoint from its league is incomplete.
update public.automation_state set lease='00000000-0000-0000-0000-000000000099',lease_until=now()+interval '45 minutes';
select public.kickx_club_seed('00000000-0000-0000-0000-000000000099','[{"key":"club:league:7","kind":"league","priority":0,"label":"cup","payload":{"league":7}}]');
select public.kickx_club_finish('00000000-0000-0000-0000-000000000099','club:league:7','{"done":true,"children":[{"key":"club:test-match","kind":"match","priority":40,"label":"match","payload":{"eventId":4501,"context":{"league":7}}},{"key":"club:test-complete","kind":"club-complete","priority":99,"label":"complete","payload":{"context":{"league":7,"seasonId":1112}}}]}');
select pg_temp.cup_expect($q$select public.kickx_club_finish('00000000-0000-0000-0000-000000000099','club:test-complete','{"done":true,"completedSeason":{"leagueId":"bsd-7","seasonId":1112}}')$q$,'CLUB_BACKFILL_PENDING');
select public.kickx_club_finish('00000000-0000-0000-0000-000000000099','club:test-match','{"done":true}');
select public.kickx_club_finish('00000000-0000-0000-0000-000000000099','club:test-complete','{"done":true,"completedSeason":{"leagueId":"bsd-7","seasonId":1112}}');
do $$begin if not exists(select 1 from public.club_competition_backfills where league_id='bsd-7' and season_id=1112) then raise exception 'backfill completion missing';end if;end $$;
insert into auth.users values('00000000-0000-0000-0000-000000000098');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000098','Cup Member');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000098',true);
select pg_temp.cup_expect($q$select public.kickx_quote('bsd-4499','buy')$q$,'OUTSIDE_MARKET_SCOPE');
select pg_temp.cup_expect($q$select public.kickx_club_seed('00000000-0000-0000-0000-000000000099','[]')$q$,'42501');
reset role;
rollback;
