begin;
update public.kickx_policy set version='report-v3',report_parameters=report_parameters||'{"valuationStartMs":1791990000000}';
insert into public.leagues(id,name)values('bsd-1','PL')on conflict do nothing;
insert into public.teams(id,name,league_id)values('neutral-home','Home','bsd-1'),('neutral-away','Away','bsd-1');
insert into public.players(id,name,position,team_id,provider)values('neutral-player','Neutral player','FW','neutral-home','bsd'),('neutral-helper','Clock support','DF','neutral-home','bsd');
insert into public.player_initial_values(player_id,rule_version,detail,input_hash)values('neutral-player','report-v3','{"season":2025,"price":100000,"seedScore":4,"lower":0,"upper":20,"referenceHash":"frozen","fixtures":[]}', 'baseline');
insert into public.player_market_snapshots(id,price,pricing_status,pricing_rule_version)values('neutral-player',104040,'ready','report-v3');
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status,stage,season,home_score,away_score)values
 ('neutral-1','bsd-1','neutral-home','neutral-away','2026-10-16T10:00:00Z','FT','league-phase',2026,1,0),
 ('neutral-2','bsd-1','neutral-home','neutral-away','2026-10-18T10:00:00Z','FT','league-phase',2026,0,0);
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)values
 ('neutral-player','neutral-1','neutral-home','{"minutes_played":97}'),('neutral-player','neutral-2','neutral-home','{"minutes_played":97}');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)select 'neutral-helper',fixture_id,team_id,'{"minutes_played":96}' from public.football_match_stats where player_id='neutral-player';
update public.fixtures set finished_observed_at=starts_at+interval '116 minutes' where id='neutral-2';
insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,position,breakdown,warnings)values
 ('neutral-player','neutral-1',6,'provisional','report-v3','old-1','FW','[{"metric":"minutes","value":97,"points":2},{"metric":"goals","value":1,"points":4}]','[]'),
 ('neutral-player','neutral-2',1,'provisional','report-v3','old-2','FW','[{"metric":"minutes","value":97,"points":2},{"metric":"yellow_cards","value":1,"points":-1}]','[]');
insert into public.player_match_records(player_id,fixture_id,played_at,opponent,minutes,performance,rule_version)values
 ('neutral-player','neutral-1','2026-10-16T10:00Z','Away',97,6,'report-v3'),('neutral-player','neutral-2','2026-10-18T10:00Z','Away',97,1,'report-v3');
do $$declare answer jsonb;integrity jsonb:=public.kickx_valuation_integrity();begin
 answer:=public.kickx_apply_neutral_assessments(integrity);
 if answer->>'players'<>'1' or answer->>'priceSteps'<>'2' then raise exception 'Replay incomplete: %',answer;end if;
 if (select score from public.performance_results where fixture_id='neutral-1')<>8 then raise exception 'Goal game calibration';end if;
 if (select score from public.performance_results where fixture_id='neutral-2')<>5.3 then raise exception 'Booked game calibration';end if;
 if (select price_after from public.player_price_results where fixture_id='neutral-1')<>105000 then raise exception 'Goal game price';end if;
 if (select price_after from public.player_price_results where fixture_id='neutral-2')<>103163 then raise exception 'Booked game price';end if;
 if exists(select 1 from public.player_price_results where player_id='neutral-player' and played_at<>public.kickx_fixture_valuation_at(fixture_id)) then raise exception 'Bulk completion clock differs from normal publication';end if;
 if exists(select 1 from public.player_price_results p join public.performance_results r using(player_id,fixture_id)where (r.score<6 and p.price_after>p.price_before)or(r.score>6 and p.price_after<p.price_before))then raise exception 'Wrong price direction';end if;
 if public.kickx_match_report_context('neutral-player','neutral-2')is null then raise exception 'Repriced report hashes diverged';end if;
 if (select count(*)from public.price_history where player_id='neutral-player')<>3 then raise exception 'Replay chart mismatch';end if;
 if jsonb_array_length(public.kickx_player_value_history('neutral-player'))<>3 then raise exception 'Chart RPC mismatch';end if;
 if (public.kickx_apply_neutral_assessments(integrity)->>'unchanged')::boolean is distinct from true then raise exception 'Replay was not idempotent';end if;
 if (kickx_private.pack_valuation_checkpoint()->>'contentUnchanged')::boolean is distinct from true then raise exception 'Backup packing failed';end if;
 if (select count(*)from kickx_private.checkpoint_rows())<3 then raise exception 'Packed backup records missing';end if;
 if public.kickx_valuation_integrity()is distinct from integrity then raise exception 'Financial history was changed';end if;
end $$;
set local role authenticated;
do $$begin
 begin perform public.kickx_apply_neutral_assessments('{}');raise exception 'Replay exposed';exception when insufficient_privilege then null;end;
 begin perform 1 from kickx_private.valuation_checkpoint;raise exception 'Backup exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
