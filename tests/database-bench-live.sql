begin;
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000198'),('00000000-0000-0000-0000-000000000199');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000198','Live Bench'),('00000000-0000-0000-0000-000000000199','Other Bench');
insert into public.leagues(id,name) values('bsd-1','Live Bench League') on conflict do nothing;
insert into public.teams(id,name,league_id) values('live-bench-club','Live Bench Club','bsd-1'),('live-bench-away','Live Bench Away','bsd-1'),('live-bench-outside','Outside',null);
insert into public.players(id,name,provider,position,team_id)
 select 'live-bench-'||p||'-'||n,'Live Bench '||p||n,'bsd',p,'live-bench-club'
 from (values('GK',1),('DF',4),('MF',5),('FW',3)) x(p,cap) cross join lateral generate_series(1,cap) n;
insert into public.player_market_snapshots(id,price,pricing_rule_version,pricing_status)
 select id,50000,'prototype-v1','ready' from public.players where id like 'live-bench-%';
create function pg_temp.live_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected % from %',expected,command;
end $$;
create function pg_temp.live_buy(id text) returns void language plpgsql as $$declare q jsonb;begin
 q:=public.kickx_quote(id,'buy');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000198';
select public.kickx_open_wallet();select pg_temp.live_buy('live-bench-GK-1');
select pg_temp.live_buy('live-bench-DF-'||n) from generate_series(1,4) n;
select pg_temp.live_buy('live-bench-MF-'||n) from generate_series(1,3) n;
select pg_temp.live_buy('live-bench-FW-'||n) from generate_series(1,3) n;
do $$declare rev integer:=(select revision from public.squads);begin
 perform public.kickx_change_formation('3-5-2',array['live-bench-DF-4','live-bench-FW-3'],rev);
end $$;
select pg_temp.live_buy('live-bench-MF-4');select pg_temp.live_buy('live-bench-MF-5');
do $$declare rev integer:=(select revision from public.squads);begin
 if (select count(*) from public.holdings)<>13 or (select count(*) from public.holdings where bench_started_at is null)<>11 then raise exception 'Bench must be separate from eleven active holdings';end if;
 perform pg_temp.live_error(format('select public.kickx_restore_bench(''live-bench-DF-4'',%s)',rev),'SQUAD_FULL');
 perform pg_temp.live_error($q$select * from kickx_private.bench_legacy_prices$q$,'42501');
end $$;
reset role;
update public.player_market_snapshots set price=80000 where id='live-bench-DF-4';
insert into public.price_history(player_id,value,recorded_at,rule_version) values('live-bench-DF-4',80000,clock_timestamp(),'prototype-v1');
do $$begin
 if public.kickx_assets('00000000-0000-0000-0000-000000000198')<>1330000 then raise exception 'Bench must follow current price';end if;
 if not exists(select 1 from public.user_notifications where user_id='00000000-0000-0000-0000-000000000198' and player_id='live-bench-DF-4' and kind='price') then raise exception 'Bench price alert missing';end if;
end $$;
set local role authenticated;
select set_config('live.cash',(select balance::text from public.wallets),true);
select set_config('live.trades',(select count(*)::text from public.trades),true);
do $$declare m jsonb:=public.kickx_member_data();rev integer:=(select revision from public.squads);begin
 if (m->>'playerAssets')::bigint<>680000 then raise exception 'Member assets disagree';end if;
 perform public.kickx_change_formation('4-3-3',array['live-bench-MF-4','live-bench-MF-5'],rev);
 select revision into rev from public.squads;
 perform pg_temp.live_error(format('select public.kickx_restore_bench(''live-bench-MF-4'',%s)',rev),'POSITION_FULL');
 perform pg_temp.live_error($q$select public.kickx_restore_bench('live-bench-DF-4',999999)$q$,'STALE_REVISION');
end $$;
reset role;update public.players set team_id='live-bench-outside' where id='live-bench-DF-4';
set local role authenticated;
do $$declare rev integer:=(select revision from public.squads);begin
 perform pg_temp.live_error(format('select public.kickx_restore_bench(''live-bench-DF-4'',%s)',rev),'OUTSIDE_MARKET_SCOPE');
end $$;
reset role;update public.players set team_id='live-bench-club' where id='live-bench-DF-4';
set local role authenticated;
do $$declare rev integer:=(select revision from public.squads);begin
 perform public.kickx_restore_bench('live-bench-DF-4',rev);
 select revision into rev from public.squads;perform public.kickx_restore_bench('live-bench-FW-3',rev);
 if (select count(*) from public.holdings where bench_started_at is null)<>11 then raise exception 'Restore did not fill active squad';end if;
 if (select count(*) from public.squads s,unnest(s.slots) x where x is not null)<>11 then raise exception 'Restore did not place player';end if;
 if exists(select 1 from public.holdings where player_id in('live-bench-DF-4','live-bench-FW-3') and (cost<>50000 or bench_price is not null or bench_started_at is not null or bench_reason is not null)) then raise exception 'Restore changed cost or deadline';end if;
 if (select balance from public.wallets)<>current_setting('live.cash')::bigint or (select count(*) from public.trades)<>current_setting('live.trades')::int then raise exception 'Restore generated cash or trade';end if;
 select revision into rev from public.squads;
 perform pg_temp.live_error(format('select public.kickx_restore_bench(''live-bench-DF-4'',%s)',rev),'NOT_BENCHED');
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000199';
select public.kickx_open_wallet();select public.kickx_change_formation('4-3-3',array[]::text[],0);
do $$declare rev integer:=(select revision from public.squads);begin
 perform pg_temp.live_error(format('select public.kickx_restore_bench(''live-bench-MF-4'',%s)',rev),'NOT_OWNED');
end $$;
reset role;
update public.trades set created_at=clock_timestamp()-interval '3 days' where player_id='live-bench-MF-4' and side='buy';
insert into kickx_private.bench_legacy_prices(trade_id,price,starts_at,ends_at)
 select trade_id,70000,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 hour'
 from public.holdings where player_id='live-bench-MF-4';
update public.player_market_snapshots set price=null where id='live-bench-MF-4';
do $$declare q jsonb;begin
 q:=kickx_private.bench_quote('00000000-0000-0000-0000-000000000198','live-bench-MF-4');
 if (q->>'price')::bigint<>50000 then raise exception 'Missing-price fallback failed';end if;
end $$;
update public.holdings set bench_started_at=clock_timestamp()-interval '168 hours 1 second' where player_id in('live-bench-MF-4','live-bench-MF-5');
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status)
 values('live-bench-locked','bsd-1','live-bench-club','live-bench-away',clock_timestamp()+interval '30 minutes','NS');
do $$begin if kickx_private.expire_roster_bench()<>0 then raise exception 'Automatic sale bypassed match lock';end if;end $$;
set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000198';
do $$declare rev integer:=(select revision from public.squads);begin
 perform pg_temp.live_error(format('select public.kickx_restore_bench(''live-bench-MF-4'',%s)',rev),'BENCH_EXPIRED');
end $$;
reset role;delete from public.fixtures where id='live-bench-locked';
update public.player_market_snapshots set price=110000 where id='live-bench-MF-4';
update public.player_market_snapshots set price=90000 where id='live-bench-MF-5';
do $$begin
 if kickx_private.expire_roster_bench()<>2 or kickx_private.expire_roster_bench()<>0 then raise exception 'Automatic sale skipped or duplicated';end if;
 if (select balance from public.wallets where user_id='00000000-0000-0000-0000-000000000198')<>current_setting('live.cash')::bigint+196000 then raise exception 'Automatic settlement wrong';end if;
 if public.kickx_assets_at('00000000-0000-0000-0000-000000000198',clock_timestamp()-interval '1 day')<>70000 then raise exception 'Historical legacy valuation lost';end if;
end $$;
set local role anon;select pg_temp.live_error($q$select public.kickx_restore_bench('live-bench-DF-4',0)$q$,'42501');
rollback;
