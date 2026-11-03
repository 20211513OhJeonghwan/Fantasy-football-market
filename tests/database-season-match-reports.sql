begin;
update public.kickx_policy set version='report-v3';
insert into public.teams(id,name)values('season-report-home','Home'),('season-report-away','Away');
insert into public.players(id,name,position)values('season-report-player','Player','MF');
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,home_score,away_score)
 values('season-report-match','season-report-home','season-report-away','2026-11-01','FT',1,0);
insert into public.player_match_records(player_id,fixture_id,played_at,opponent,minutes,performance,rule_version)
 values('season-report-player','season-report-match','2026-11-01','Away',90,8,'report-v3');
insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,breakdown,warnings)
 values('season-report-player','season-report-match',8,'provisional','report-v3','same-source','[{"metric":"minutes","value":90,"points":2}]','[]');
insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
 values('season-report-player','season-report-match','report-v3','2026-11-01',100000,102000,120000,7,2,'["previous-1","previous-2","previous-3","previous-4","previous-5","season-report-match"]','same-source');
do $$declare facts jsonb;begin
 facts:=public.kickx_match_report_context('season-report-player','season-report-match');
 if facts is null or (facts->>'windowSize')::integer<>6 then raise exception 'Cumulative report rejected six appearances';end if;
 if public.kickx_read_match_report('season-report-player','season-report-match')->>'status'<>'missing'then raise exception 'Eligible report not available for generation';end if;
end $$;
update public.player_price_results set input_hash='stale-source'where player_id='season-report-player';
do $$begin if public.kickx_match_report_context('season-report-player','season-report-match')is not null then raise exception 'Stale price/score pairing accepted';end if;end $$;
update public.player_price_results set input_hash='same-source',window_fixture_ids='["foreign"]'where player_id='season-report-player';
do $$begin if public.kickx_match_report_context('season-report-player','season-report-match')is not null then raise exception 'Foreign price window accepted';end if;end $$;
rollback;
