begin;
insert into public.leagues(id,name)values('bsd-1','PL')on conflict do nothing;
insert into public.teams(id,name,league_id)values('summary-club','Club','bsd-1'),('summary-away','Away','bsd-1');
insert into public.players(id,name,team_id,position,provider)select 'summary-'||n,'Summary '||n,'summary-club','MF','bsd'from generate_series(1,4)n;
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status,stage,season,home_score,away_score)values('summary-game','bsd-1','summary-club','summary-away','2026-10-20T12:00Z','FT','league-phase',2026,0,0);
insert into public.performance_results(player_id,fixture_id,score,status,position,rule_version,input_hash,breakdown,warnings)
select 'summary-'||n,'summary-game',case when n<3 then 8 else null end,case when n<3 then 'ready'else 'not-played'end,'MF','report-v3','summary','[]','[]'from generate_series(1,4)n;
insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
select 'summary-'||n,'summary-game','report-v3','2026-10-20T14:00Z',case when n=4 then 10000 else 100000 end,case when n=1 then 105000 when n=2 then 95000 when n=3 then 98500 else 10000 end,100000,0,case when n=1 then 5 when n=2 then -5 when n=3 then -1.5 else 0 end,'["summary-game"]','summary'from generate_series(1,4)n;
insert into public.player_market_snapshots(id,price,change_percent,pricing_rule_version,pricing_status)
select player_id,price_after,change_percent,rule_version,'ready'from public.player_price_results where player_id like 'summary-%';
do $$declare s jsonb:=public.kickx_market_summary();begin
 if s->>'rising'<>'1'or s->>'falling'<>'1'or s->>'notPlayed'<>'2'then raise exception 'DNP double-counted in declines: %',s;end if;
 if(select count(*)from public.player_catalog where last_price_reason='not-played')<>2 then raise exception 'Catalog classification missing';end if;
end $$;
rollback;
