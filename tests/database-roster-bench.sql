-- Full transaction lifecycle; all fixtures and financial mutations roll back.
begin;
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000094'),('00000000-0000-0000-0000-000000000095');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000094','Bench One'),('00000000-0000-0000-0000-000000000095','Bench Two');
insert into public.leagues(id,name) values('bsd-1','Bench League') on conflict do nothing;
insert into public.teams(id,name,league_id) values('bench-old','Old Club','bsd-1'),('bench-new','New Club','bsd-1'),('bench-away','Outside Club',null);
insert into public.players(id,name,position,team_id,provider) values
 ('bench-move','Transfer','GK','bench-old','bsd'),('bench-position','Position','MF','bench-old','bsd'),
 ('bench-expire','Expire','DF','bench-old','bsd'),('bench-future','Future','FW','bench-old','bsd'),
 ('bench-replacement','Replacement','GK','bench-new','bsd'),('bench-enrich','Enrich',null,null,'bsd');
insert into public.player_market_snapshots(id,price,pricing_rule_version)
 select id,50000,'prototype-v1' from public.players where id like 'bench-%';
create function pg_temp.bench_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected % from %',expected,command;
end $$;
create function pg_temp.bench_buy(id text) returns void language plpgsql as $$declare q jsonb;begin
 q:=public.kickx_quote(id,'buy');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000094';
select public.kickx_open_wallet();
select pg_temp.bench_buy('bench-move');
select pg_temp.bench_buy('bench-position');
select pg_temp.bench_buy('bench-expire');
select pg_temp.bench_buy('bench-future');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000095';
select public.kickx_open_wallet();select pg_temp.bench_buy('bench-move');
reset role;
-- Incomplete/initial metadata must not move a legacy holding to the bench.
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000094';
do $$declare q jsonb;begin
 q:=public.kickx_quote_base('bench-enrich','buy');perform public.kickx_trade_base((q->>'id')::uuid,gen_random_uuid());
end $$;
update public.players set team_id='bench-old',position='DF' where id='bench-enrich';
update public.players set country='Test' where id='bench-expire';
do $$begin if exists(select 1 from public.holdings where bench_started_at is not null) then raise exception 'Unconfirmed metadata created a bench';end if;end $$;
do $$declare q jsonb;begin
 q:=public.kickx_quote('bench-enrich','sell');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
end $$;
update public.player_market_snapshots set price=70000 where id='bench-move';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000094';
select set_config('bench.oldquote',public.kickx_quote('bench-move','sell')->>'id',true);
reset role;
update public.players set team_id='bench-new' where id='bench-move';
update public.players set position='FW' where id='bench-position';
select set_config('bench.started',(select bench_started_at::text from public.holdings where player_id='bench-move' limit 1),true);
update public.player_market_snapshots set price=99000 where id='bench-move';
-- A second change and an identical roster import cannot extend/reprice an existing bench.
update public.players set team_id='bench-away',position='DF' where id='bench-move';
update public.players set team_id=team_id,position=position where id='bench-move';
do $$begin
 if (select count(*) from public.holdings where player_id='bench-move' and bench_price=70000 and bench_reason='transfer' and bench_started_at=current_setting('bench.started')::timestamptz)<>2 then raise exception 'Freeze changed or multiple owners missed';end if;
 if exists(select 1 from public.squads s,unnest(s.slots) x where x in('bench-move','bench-position')) then raise exception 'Frozen player remains in active squad';end if;
 if (select bench_reason from public.holdings where player_id='bench-position')<>'position' then raise exception 'Position change not detected';end if;
 if kickx_private.expire_roster_bench()<>0 then raise exception 'Premature automatic sale';end if;
end $$;
set local role authenticated;
do $$declare m jsonb;q jsonb;begin
 m:=public.kickx_member_data();
 if (m->>'playerAssets')::bigint<>220000 then raise exception 'Portfolio did not retain frozen values: %',m->>'playerAssets';end if;
 if (select x->>'value' from jsonb_array_elements(m->'holdings') x where x->>'playerId'='bench-move')<>'70000' then raise exception 'Frozen value missing';end if;
 if (select (x#>>'{bench,expiresAt}')::timestamptz-(x#>>'{bench,startedAt}')::timestamptz from jsonb_array_elements(m->'holdings') x where x->>'playerId'='bench-move') is distinct from interval '168 hours' then raise exception 'Bench deadline must be seven days';end if;
 perform pg_temp.bench_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('bench.oldquote')),'PRICE_CHANGED');
 perform pg_temp.bench_error($q$select public.kickx_quote('bench-move','buy')$q$,'ALREADY_OWNED');
 perform pg_temp.bench_buy('bench-replacement');
 if (select slots[1] from public.squads where user_id=auth.uid())<>'bench-replacement' then raise exception 'Bench did not free GK capacity';end if;
 perform pg_temp.bench_error($q$select kickx_private.expire_roster_bench()$q$,'42501');
 perform pg_temp.bench_error($q$select kickx_private.bench_retention()$q$,'42501');
 perform pg_temp.bench_error($q$select kickx_private.bench_quote('00000000-0000-0000-0000-000000000095','bench-move')$q$,'42501');
end $$;
reset role;
do $$declare m jsonb:=public.kickx_member_data();begin
 if public.kickx_assets('00000000-0000-0000-0000-000000000094')<>(m->>'totalAssets')::bigint then raise exception 'Ranking valuation differs';end if;
 if public.kickx_assets_at('00000000-0000-0000-0000-000000000094',clock_timestamp())<>(m->>'totalAssets')::bigint then raise exception 'Historical ranking ignored freeze';end if;
end $$;
-- The protected sale must survive a global price change, paused trading and a live match.
insert into public.fixtures(id,provider,home_team_id,away_team_id,starts_at,status)
 values('bench-live','bsd','bench-away','bench-new',now()-interval '10 minutes','LIVE');
update public.players set trade_status='거래 중지' where id='bench-move';
select set_config('bench.historyAt',clock_timestamp()::text,true);
select set_config('bench.historyAssets',public.kickx_assets('00000000-0000-0000-0000-000000000094')::text,true);
set local role authenticated;
select set_config('bench.salequote',public.kickx_quote('bench-move','sell')->>'id',true);
select set_config('bench.request',gen_random_uuid()::text,true);
select set_config('bench.balance',(select balance::text from public.wallets where user_id=auth.uid()),true);
reset role;
update public.player_market_snapshots set price=120000 where id='bench-move';
set local role authenticated;
do $$declare t jsonb;begin
 t:=public.kickx_trade(current_setting('bench.salequote')::uuid,current_setting('bench.request')::uuid);
 if (t->>'price')::bigint<>70000 or (t->>'fee')::bigint<>1400 or (t->>'net')::bigint<>68600 or t->>'execution_reason'<>'bench_manual' then raise exception 'Manual frozen settlement wrong: %',t;end if;
 if public.kickx_trade(current_setting('bench.salequote')::uuid,current_setting('bench.request')::uuid)<>t then raise exception 'Manual retry not idempotent';end if;
 if public.kickx_trade(current_setting('bench.salequote')::uuid,gen_random_uuid())<>t then raise exception 'Quote retry not idempotent';end if;
 if (select balance from public.wallets where user_id=auth.uid())<>current_setting('bench.balance')::bigint+68600 then raise exception 'Wallet paid twice';end if;
 if exists(select 1 from public.holdings where player_id='bench-move') then raise exception 'Manual sale retained owner holding';end if;
 if (select count(*) from public.wallet_ledger where trade_id=(t->>'id')::uuid)<>1 then raise exception 'Ledger receipt duplicated';end if;
 if not exists(select 1 from jsonb_array_elements(public.kickx_member_data()->'transactions') x where x->>'status'='벤치 매각') then raise exception 'Sale reason not returned';end if;
 -- Selling a normal holding still respects its ordinary live match window.
 perform pg_temp.bench_error($q$select public.kickx_quote('bench-replacement','sell')$q$,'MATCH_TRADING_LOCKED');
end $$;
-- Another user cannot settle the quote, even if the quote ID is known.
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000095';
select pg_temp.bench_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('bench.salequote')),'QUOTE_NOT_FOUND');
reset role;
-- A future weekly/monthly calculation must retain the protected value after liquidation.
update public.trades set created_at=clock_timestamp() where quote_id=current_setting('bench.salequote')::uuid;
update public.wallet_ledger set created_at=clock_timestamp() where trade_id=(select id from public.trades where quote_id=current_setting('bench.salequote')::uuid);
do $$begin
 if public.kickx_assets_at('00000000-0000-0000-0000-000000000094',current_setting('bench.historyAt')::timestamptz)<>current_setting('bench.historyAssets')::bigint then raise exception 'Historical freeze disappeared after liquidation';end if;
end $$;
-- Exact manual cutoff, normal period preserved for a player changed later.
update public.players set position='MF' where id='bench-expire';
update public.players set position='MF' where id='bench-future';
update public.holdings set bench_started_at=clock_timestamp()-interval '167 hours' where player_id='bench-expire';
do $$declare q jsonb;begin
 q:=kickx_private.bench_quote('00000000-0000-0000-0000-000000000094','bench-expire');
 if (q->>'benchExpiresAt')::timestamptz<=clock_timestamp() then raise exception 'Seven-day quote expired early';end if;
 perform pg_temp.bench_error(format('select kickx_private.settle_bench(%L,%L,gen_random_uuid(),true)','00000000-0000-0000-0000-000000000094',q->>'id'),'BENCH_NOT_EXPIRED');
 if kickx_private.expire_roster_bench()<>0 then raise exception 'Sale before the seven-day cutoff';end if;
end $$;
update public.holdings set bench_started_at=clock_timestamp()-interval '168 hours 1 second'
 where player_id in('bench-move','bench-expire');
select set_config('bench.balance',(select balance::text from public.wallets where user_id='00000000-0000-0000-0000-000000000094'),true);
select set_config('bench.count',(select count(*)::text from public.trades),true);
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000094';
select pg_temp.bench_error($q$select public.kickx_quote('bench-expire','sell')$q$,'BENCH_EXPIRED');
reset role;
do $$declare result jsonb;begin
 result:=kickx_private.notification_tick();
 if (result->>'autoSold')::int<>2 then raise exception 'Minute tick did not settle expired holders: %',result;end if;
 if kickx_private.expire_roster_bench()<>0 then raise exception 'Expired liquidation repeated';end if;
 if (select count(*) from public.trades)<>current_setting('bench.count')::int+2 then raise exception 'Automatic sale duplicated';end if;
 if exists(select 1 from public.holdings where player_id in('bench-move','bench-expire')) then raise exception 'Expired holding retained';end if;
 if not exists(select 1 from public.holdings where player_id='bench-future' and bench_price=50000) then raise exception 'Future holding sold early';end if;
 if (select balance from public.wallets where user_id='00000000-0000-0000-0000-000000000094')<>current_setting('bench.balance')::bigint+49000 then raise exception 'Automatic net settlement wrong';end if;
 if (select count(*) from public.trades t join public.wallet_ledger l on l.trade_id=t.id where t.execution_reason='bench_expired')<>2 then raise exception 'Automatic sale not in financial ledger';end if;
 if exists(select 1 from public.squads s,unnest(s.slots) x where x in('bench-position','bench-future')) then raise exception 'Bench restored by sale sync';end if;
end $$;
set local role anon;
select pg_temp.bench_error($q$select kickx_private.expire_roster_bench()$q$,'42501');
rollback;
