begin;
insert into public.leagues(id,name)values('bsd-1','Premier League')on conflict(id)do nothing;
update public.kickx_policy set version='report-v3',report_reference='{"status":"ready","season":2025,"hash":"frozen","groups":{"FW":{"mean":6,"lower":-10,"upper":30,"baselines":[6]}}}',report_parameters='{"lambda":5,"kappa":4,"beta":0.3,"s":1,"deviationLimit":1,"initialMin":50000,"initialMax":150000,"minPrice":10000,"maxPrice":1000000,"maxUp":0.1,"maxDown":0.1,"nonParticipationRate":0.015,"lowerQuantile":0.05,"upperQuantile":0.95,"valuationStartMs":1791990000000,"neutralScore":6,"pointRate":0.025,"scoringRevision":"neutral-six-20261106"}';
insert into public.teams(id,name,league_id)values('add-home','Add home','bsd-1'),('add-away','Add away','bsd-1');
insert into public.players(id,name,position,team_id,provider)select 'add-'||p,p,p,'add-home','bsd'from unnest(array['GK','DF','MF','FW'])p;
insert into public.player_initial_values(player_id,rule_version,detail,input_hash)select id,'report-v3','{"season":2025,"price":100000,"seedScore":6,"lower":-10,"upper":30,"referenceHash":"frozen","fixtures":[]}',id from public.players where id like 'add-%';
insert into public.player_market_snapshots(id,price,pricing_status,pricing_rule_version)select id,100000,'ready','report-v3'from public.players where id like 'add-%';
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status,stage,season,home_score,away_score,observed_duration_minutes)
select 'add-before-'||n,'bsd-1','add-home','add-away',timestamptz '2026-09-01T12:00Z'+n*interval '1 day','FT','league-phase',2026,0,0,90 from generate_series(0,29)n
union all select 'add-after-'||n,'bsd-1','add-home','add-away',timestamptz '2026-10-15T12:00Z'+n*interval '1 day','FT','league-phase',2026,3,0,90 from generate_series(0,2)n;
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)
select p.id,f.id,'add-home',case when f.id='add-after-2'then '{"minutes_played":0}'::jsonb else '{"minutes_played":90,"accurate_pass":40,"total_pass":50,"ball_recovery":4,"total_clearance":4,"won_contest":2,"outfielder_block":1,"was_fouled":2,"good_high_claim":1,"accurate_keeper_sweeper":1}'::jsonb end
from public.players p cross join public.fixtures f where p.id like 'add-%'and f.id like 'add-%';
insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,position,breakdown,warnings)
select m.player_id,m.fixture_id,case when m.fixture_id='add-after-2'then null else 10 end,case when m.fixture_id='add-after-2'then 'not-played'else 'provisional'end,'report-v3',m.player_id||m.fixture_id,case when m.fixture_id='add-after-2'then null else p.position end,
case when m.fixture_id='add-after-2'then '[]'::jsonb else '[{"metric":"minutes","value":90,"points":6,"evidence":"old"}]'::jsonb||case when p.position<>'FW'then jsonb_build_array(jsonb_build_object('metric','clean_sheet','value',1,'points',1))else '[]'::jsonb end||case when m.fixture_id='add-after-0'then '[{"metric":"goals","value":3,"points":6}]'::jsonb else '[]'::jsonb end||'[{"metric":"score_range","value":20,"points":-10}]'::jsonb end,'[]'
from public.football_match_stats m join public.players p on p.id=m.player_id where p.id like 'add-%';
insert into public.player_match_records(player_id,fixture_id,played_at,opponent,minutes,performance,rule_version)select m.player_id,m.fixture_id,f.starts_at,'Add away',(m.stats->>'minutes_played')::integer,r.score,'report-v3'from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id join public.performance_results r using(player_id,fixture_id)where m.player_id like 'add-%';
do $$declare answer jsonb;integrity jsonb:=public.kickx_valuation_integrity();before_refs jsonb;begin
 answer:=kickx_private.apply_additive_assessments(integrity);
 if answer#>>'{positionBenchmarks,DF}'<>'13.000000'or answer#>>'{positionBenchmarks,FW}'<>'9.000000'then raise exception 'Prelaunch benchmark incorrect: %',answer;end if;
 if(select score from public.performance_results where player_id='add-FW'and fixture_id='add-after-0')<>21 then raise exception 'High performance capped';end if;
 if(select performance from public.player_market_snapshots where id='add-FW')is not null then raise exception 'DNP shows old score';end if;
 if exists(select 1 from public.performance_results r where player_id like 'add-%'and score is not null and(score<>(select sum((b->>'points')::numeric)from jsonb_array_elements(r.breakdown)b)or breakdown @> '[{"metric":"score_range"}]'))then raise exception 'Additive breakdown inconsistent';end if;
 if exists(select 1 from public.price_history where player_id like 'add-%'and recorded_at<timestamptz '2026-10-14T15:00Z')then raise exception 'Prelaunch price event';end if;
 if(select count(*)from public.price_history where player_id='add-FW')<>4 then raise exception 'Launch/three game prices missing';end if;
 if exists(select 1 from public.player_price_results v join public.performance_results r using(player_id,fixture_id)where v.player_id like 'add-%'and r.score>20 and v.price_after<=v.price_before)then raise exception 'Strong game did not rise';end if;
 if exists(select 1 from public.kickx_calculation_sources('add-FW')where not cached)then raise exception 'Replay fingerprint differs from incremental ingestion';end if;
 -- The first ordinary automatic publication after replay must keep the latest DNP blank.
 perform public.kickx_publish_calculation_delta(null,'add-FW',public.kickx_calculation_token('add-FW'),'[]');
 if(select performance from public.player_market_snapshots where id='add-FW')is not null then raise exception 'Incremental publisher resurrected an old played-match score after DNP';end if;
 if(select last_price_reason from public.player_market_snapshots where id='add-FW')is distinct from 'not-played'then raise exception 'Incremental publisher lost DNP classification';end if;
 if public.kickx_match_report_context('add-FW','add-after-0')->>'referenceScore'<>'9.000000'then raise exception 'Report lacks actual reference';end if;
 if public.kickx_valuation_integrity()is distinct from integrity then raise exception 'Financial integrity changed';end if;
 if kickx_private.apply_additive_assessments(integrity)->>'unchanged'<>'true'then raise exception 'Replay duplicated';end if;
end $$;
rollback;
