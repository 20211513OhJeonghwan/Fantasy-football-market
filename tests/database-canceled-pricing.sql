begin;
update public.kickx_policy set version='report-v3',club_competitions_enabled=false,
 pricing_reference_at='2026-10-14T15:00:00Z',pricing_reference_season=2026,
 report_parameters=report_parameters||'{"initialMin":100000,"initialMax":100000,"priceUnit":100000,"priceSensitivity":0.1,"valuationStartMs":1791990000000,"benchmarkCutoffMs":1791990000000,"pricingModel":"position-points","scoringRevision":"report-additive-20261106","positionBenchmarks":{"GK":8,"DF":8,"MF":8,"FW":8}}',
 report_reference='{"status":"ready","season":2025,"hash":"cancellation-test","groups":{"DF":{"mean":8,"lower":0,"upper":30,"baselines":[8]}},"players":{}}';
insert into public.leagues(id,name)values('bsd-1','Cancellation league')on conflict do nothing;
insert into public.teams(id,name,league_id)values('cancel-home','Home','bsd-1'),('cancel-away','Away','bsd-1');
insert into public.players(id,name,provider,position,team_id)values('cancel-player','Cancellation player','bsd','DF','cancel-home');
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,season,stage)values
 ('cancel-prelaunch','bsd-1','cancel-home','cancel-away','2026-10-01T12:00:00Z','FT',0,0,2026,'regular-season'),
 ('cancel-good','bsd-1','cancel-home','cancel-away','2026-10-16T12:00:00Z','FT',0,0,2026,'regular-season'),
 ('cancel-later','bsd-1','cancel-home','cancel-away','2026-10-17T12:00:00Z','FT',0,0,2026,'regular-season');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)
 select 'cancel-player',id,'cancel-home','{"minutes_played":90}'from public.fixtures where id like 'cancel-%';
insert into public.player_market_snapshots(id,price,pricing_rule_version,pricing_status)values('cancel-player',100000,'report-v3','pending');
create function pg_temp.cancel_result(f text,s text,points numeric)returns jsonb language sql as $$
 select jsonb_build_object('fixtureId',f,'position','DF','score',points,'status',s,'ruleVersion','report-v3','scoringRevision','report-additive-20261106','breakdown','[]'::jsonb,'warnings','[]'::jsonb)
$$;
do $$declare answer jsonb;results jsonb;good_price bigint;begin
 results:=jsonb_build_array(pg_temp.cancel_result('cancel-prelaunch','blocked',null),pg_temp.cancel_result('cancel-good','provisional',9),pg_temp.cancel_result('cancel-later','provisional',12));
 answer:=public.kickx_publish_calculation_delta(null,'cancel-player',public.kickx_calculation_token('cancel-player'),results);
 if answer->>'withheld'='true' or (select pricing_status from public.player_market_snapshots where id='cancel-player')<>'ready' then raise exception 'Pre-launch data blocked a valid current valuation: %',answer;end if;
 if (select count(*)from public.player_price_results where player_id='cancel-player')<>2 then raise exception 'Launch boundary changed';end if;
 select price_after into good_price from public.player_price_results where player_id='cancel-player'and fixture_id='cancel-good';
 -- A formerly published match is canceled: remove its derived score and price.
 update public.fixtures set status='CANC'where id='cancel-later';
 if (public.kickx_calculation_input('cancel-player',true)->>'total')::integer<>2 or exists(select 1 from public.kickx_calculation_sources('cancel-player')where fixture_id='cancel-later')then raise exception 'Canceled fixture remained in scoring input';end if;
 answer:=public.kickx_publish_calculation_delta(null,'cancel-player',public.kickx_calculation_token('cancel-player'),'[]');
 if answer->>'withheld'='true' or (answer->>'price')::bigint<>good_price then raise exception 'Canceled result blocked/repriced the wrong chain: %',answer;end if;
 if exists(select 1 from public.performance_results where fixture_id='cancel-later')or exists(select 1 from public.player_price_results where fixture_id='cancel-later')then raise exception 'Canceled derived results survived';end if;
 if (select count(*)from public.price_history where player_id='cancel-player')<>2 then raise exception 'Canceled chart point survived';end if;
 if not exists(select 1 from public.football_match_stats where fixture_id='cancel-later')then raise exception 'Canceled source evidence deleted';end if;
 begin
  perform public.kickx_publish_calculation_delta(null,'cancel-player',public.kickx_calculation_token('cancel-player'),jsonb_build_array(pg_temp.cancel_result('cancel-later','provisional',12)));
  raise exception 'Canceled input accepted';
 exception when others then if sqlerrm<>'INVALID_DELTA'then raise;end if;end;
 -- Genuine post-launch evidence regression must still block publication.
 results:=jsonb_build_array(pg_temp.cancel_result('cancel-good','blocked',null));
 answer:=public.kickx_publish_calculation_delta(null,'cancel-player',public.kickx_calculation_token('cancel-player'),results);
 if answer->>'withheld' is distinct from 'true'then raise exception 'Post-launch missing data was silently accepted';end if;
 -- A restored finished match is eligible again, without reusing canceled scores.
 update public.fixtures set status='FT'where id='cancel-later';
 if not exists(select 1 from public.kickx_calculation_sources('cancel-player')where fixture_id='cancel-later'and not cached)then raise exception 'Restored fixture failed to reenter scoring';end if;
end $$;
rollback;
