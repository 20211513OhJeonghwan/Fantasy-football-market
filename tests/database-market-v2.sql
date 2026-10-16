-- Isolated v2 economic integration: role boundaries, cutoff, publication, DNP and corrections.
begin;
-- Historical fixture imports in this test were observed over ten minutes ago.
alter table public.fixtures alter column finished_observed_at set default (now()-interval '11 minutes');
update public.kickx_policy set version='form-v2',pricing_reference_at='2026-08-01T00:00:00Z',pricing_reference_season=2026;
insert into auth.users values('00000000-0000-0000-0000-000000000091');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000091','V2 Member');
insert into public.teams(id,name) values('bsd-9101','V2 Home'),('bsd-9102','V2 Away');
insert into public.players(id,name,provider,position) values('bsd-9100','V2 Player','bsd','FW');
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,provider,season)
select 'bsd-'||(9200+i),'bsd-9101','bsd-9102','2026-05-01T12:00:00Z'::timestamptz+i*interval '1 day','FT','bsd',2025 from generate_series(0,9) i;
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,provider,season) values
('bsd-9301','bsd-9101','bsd-9102','2026-08-02T12:00:00Z','FT','bsd',2026),('bsd-9302','bsd-9101','bsd-9102','2026-08-03T12:00:00Z','FT','bsd',2026);
insert into public.football_event_sources(fixture_id,detail) select id,'{}' from public.fixtures;
insert into public.football_match_stats(player_id,fixture_id,team_id,stats) select 'bsd-9100',id,'bsd-9101','{"minutes_played":90}' from public.fixtures;
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected % from %',expected,command;
end $$;
create function pg_temp.results() returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('fixtureId',fixture_id,'ruleVersion','form-v2','score',case when fixture_id='bsd-9301' then 100 when fixture_id='bsd-9302' then 60 when fixture_id='bsd-9303' then null else 80 end,'position','FW','status',case when fixture_id='bsd-9303' then 'not-played' else 'provisional' end,'breakdown','[]'::jsonb,'warnings','[]'::jsonb) order by fixture_id) from public.football_match_stats where player_id='bsd-9100'
$$;
create function pg_temp.publish(h text,results jsonb) returns jsonb language plpgsql as $$declare expected jsonb;begin
 select jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at) order by m.fixture_id) into expected from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id join public.football_event_sources s on s.fixture_id=f.id where m.player_id='bsd-9100';
 return public.kickx_publish_calculation(null,'bsd-9100',h,expected,results);
end $$;
set local role service_role;
select public.kickx_auto_initialize_market();
reset role;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000091';
select pg_temp.expect_error($q$select public.kickx_quote('bsd-9100','buy')$q$,'PRICE_RECALCULATING');
select pg_temp.expect_error($q$select public.kickx_market_plan('[]',now(),2026)$q$,'42501');
select pg_temp.expect_error($q$select public.kickx_publish_calculation(null,null,null,null,null)$q$,'42501');
select pg_temp.expect_error($q$update public.player_initial_values set detail='{}'$q$,'42501');
select pg_temp.expect_error($q$select public.kickx_quote_base('bsd-9100','buy')$q$,'42501');
reset role;
set local role service_role;
do $$declare p jsonb;begin
 p:=pg_temp.publish('v2-historical-window-incomplete',jsonb_set(jsonb_set(pg_temp.results(),'{9,status}','"blocked"'),'{9,score}','null'));
 if not (p->>'withheld')::boolean or exists(select 1 from public.player_initial_values) then raise exception 'Pre-reference missing game silently left rolling window';end if;
 p:=pg_temp.publish('v2-first',pg_temp.results());
 if (p->>'price')::bigint<>153653 or (p->>'initialPrice')::bigint<>140000 then raise exception 'V2 price/initial wrong: %',p;end if;
 if (p#>>'{pricing,baseline,source}')<>'previous-season' or (p#>>'{pricing,baseline,gameCount}')::integer<>10 then raise exception 'Past season not selected';end if;
 if (select count(*) from public.player_price_results)<>2 or (select price_before from public.player_price_results where fixture_id='bsd-9301')<>140000 then raise exception 'Per-match price evidence missing';end if;
 if (select count(*) from public.price_history)<>1 then raise exception 'Pending initial fallback became a market event';end if;
 p:=pg_temp.publish('v2-first',pg_temp.results());
 if not (p->>'unchanged')::boolean or (select count(*) from public.price_history)<>1 or (select count(*) from public.calculation_revisions)<>1 then raise exception 'Retry compounded price';end if;
 perform pg_temp.expect_error($q$select pg_temp.publish('bad','[]')$q$,'INVALID_INPUT');
 perform pg_temp.expect_error($q$select public.kickx_publish_calculation(null,'bsd-9100','bad','[]',pg_temp.results())$q$,'SOURCE_CHANGED');
end $$;
reset role;
set local role authenticated;
select set_config('v2.quote',(public.kickx_quote('bsd-9100','buy')->>'id'),true);
reset role;
-- A DNP must not invalidate an already issued quote or change published-price time.
select set_config('v2.market.at',(select updated_at::text from public.player_market_snapshots where id='bsd-9100'),true);
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,provider,season) values('bsd-9303','bsd-9101','bsd-9102','2026-08-04T12:00:00Z','FT','bsd',2026);
insert into public.football_event_sources(fixture_id,detail) values('bsd-9303','{}');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats) values('bsd-9100','bsd-9303','bsd-9101','{"minutes_played":0}');
set local role service_role;
do $$declare p jsonb;begin
 p:=pg_temp.publish('v2-dnp',pg_temp.results());
 if (p->>'price')::bigint<>153653 or (select count(*) from public.price_history)<>1 or (select count(*) from public.player_price_results)<>2 then raise exception 'DNP moved value/window';end if;
 if (select updated_at::text from public.player_market_snapshots where id='bsd-9100')<>current_setting('v2.market.at') then raise exception 'DNP invalidated quotes';end if;
end $$;
reset role;
set local role authenticated;
select set_config('v2.request',gen_random_uuid()::text,true);
select public.kickx_trade(current_setting('v2.quote')::uuid,current_setting('v2.request')::uuid);
reset role;
-- A historical correction replays once, updates assets/rankings and retains settled costs.
set local role service_role;
do $$declare p jsonb;r jsonb;begin
 r:=jsonb_set(pg_temp.results(),'{11,score}','40');p:=pg_temp.publish('v2-correction',r);
 if (p->>'price')::bigint<>148320 then raise exception 'Correction re-compounded instead of replaying: %',p;end if;
 if (select price from public.trades)<>153653 or (select cost from public.holdings)<>153653 or (select balance from public.wallets)<>1146347 then raise exception 'Correction rewrote settled assets';end if;
 if public.kickx_assets('00000000-0000-0000-0000-000000000091')<>1294667 then raise exception 'Current assets not updated';end if;
 if not exists(select 1 from public.ranking_snapshots where rows#>>'{0,assets}'='1294667') then raise exception 'Ranking missed final price';end if;
 r:=jsonb_set(jsonb_set(r,'{10,status}','"blocked"'),'{10,score}','null');p:=pg_temp.publish('v2-incomplete',r);
 if not (p->>'withheld')::boolean or (select price from public.player_market_snapshots where id='bsd-9100')<>148320 then raise exception 'Incomplete correction erased published value';end if;
 if (select count(*) from public.calculation_revisions)<>3 then raise exception 'Revision retention wrong';end if;
 if (select pricing_status from public.player_market_snapshots where id='bsd-9100')<>'pending' then raise exception 'Incomplete data remained tradeable';end if;
end $$;
reset role;
set local role authenticated;
select pg_temp.expect_error($q$select public.kickx_quote('bsd-9100','sell')$q$,'PRICE_RECALCULATING');
-- Retrying an already settled trade remains idempotent while a new valuation waits.
select public.kickx_trade(current_setting('v2.quote')::uuid,current_setting('v2.request')::uuid);
reset role;
set local role service_role;
do $$declare p jsonb;begin
 p:=pg_temp.publish('v2-correction',jsonb_set(pg_temp.results(),'{11,score}','40'));
 if (select pricing_status from public.player_market_snapshots where id='bsd-9100')<>'ready' or (p->>'price')::bigint<>148320 then raise exception 'Same-hash recovery stayed pending';end if;
 if (select count(*) from public.price_history)<>2 then raise exception 'Recovery duplicated price history';end if;
end $$;
reset role;
-- A confirmed correction to DNP is complete data, not a permanently blocked correction.
update public.football_match_stats set stats='{"minutes_played":0}' where fixture_id='bsd-9302';
set local role service_role;
do $$declare p jsonb;r jsonb;begin
 r:=jsonb_set(jsonb_set(pg_temp.results(),'{11,status}','"not-played"'),'{11,score}','null');
 p:=pg_temp.publish('v2-confirmed-dnp',r);
 if coalesce((p->>'withheld')::boolean,false) or (p->>'price')::bigint<>151200 or (select count(*) from public.player_price_results)<>1 then raise exception 'Verified DNP correction was withheld or still counted';end if;
end $$;
reset role;
set local role anon;
select * from public.player_initial_values;
select * from public.player_price_results;
select pg_temp.expect_error($q$delete from public.player_price_results$q$,'42501');
reset role;
rollback;
