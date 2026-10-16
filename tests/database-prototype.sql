-- Disposable transaction only: economic invariants, RLS, historical rankings and correction replay.
begin;
-- Historical fixture imports in this test were observed over ten minutes ago.
alter table public.fixtures alter column finished_observed_at set default (now()-interval '11 minutes');
update public.kickx_policy set version='prototype-v1';
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into public.teams(id,name) values('bsd-1','Home'),('bsd-2','Away');
insert into public.profiles(id,nickname,team_id) values('00000000-0000-0000-0000-000000000001','Member','bsd-1'),('00000000-0000-0000-0000-000000000002','Admin','bsd-2'),('00000000-0000-0000-0000-000000000003','Other','bsd-2');
insert into public.user_roles values('00000000-0000-0000-0000-000000000002','admin');
insert into public.players(id,name,provider,position,team_id,shirt_number) values('bsd-10','First Player','bsd','GK','bsd-1',1),('bsd-11','Second Player','bsd','DF','bsd-1',4),('bsd-12','Expensive','bsd','FW','bsd-2',9);
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected % from %',expected,command;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select public.kickx_initialize_market();
select public.kickx_initialize_market();
select public.kickx_save_player_name('bsd-10','한글 선수',array['별명','검색별칭']);
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$declare q jsonb;t jsonb;r jsonb;req uuid:=gen_random_uuid();slots text[]:=array_fill(null::text,array[11]);begin
 perform public.kickx_open_wallet();perform public.kickx_open_wallet();
 if (select balance from public.wallets)<>1300000 or (select count(*) from public.wallet_ledger)<>1 then raise exception 'Initial grant duplicated';end if;
 if (select count(*) from public.price_history)<>3 then raise exception 'Initialization duplicated';end if;
 if not exists(select 1 from public.player_catalog where search_text like '%검색별칭%' and name='First Player') then raise exception 'Name override lost original or search';end if;
 perform pg_temp.expect_error('select public.kickx_initialize_market()','ADMIN_REQUIRED');
 perform pg_temp.expect_error('select public.kickx_publish_calculation(null,null,null,null,null)','42501');
 perform pg_temp.expect_error('update public.wallets set balance=9999999','42501');
 q:=public.kickx_quote('bsd-10','buy');t:=public.kickx_trade((q->>'id')::uuid,req);
 if public.kickx_trade((q->>'id')::uuid,req)<>t then raise exception 'Retry changed receipt';end if;
 if public.kickx_trade((q->>'id')::uuid,gen_random_uuid())<>t then raise exception 'Quote executed twice';end if;
 if (select balance from public.wallets)<>1200000 or (select count(*) from public.holdings)<>1 or (select count(*) from public.trades)<>1 then raise exception 'Buy not atomic';end if;
 perform pg_temp.expect_error($q$select public.kickx_quote('bsd-10','buy')$q$,'ALREADY_OWNED');
 slots[1]:='bsd-10';r:=public.kickx_save_squad('4-3-3',slots,0);
 perform pg_temp.expect_error(format('select public.kickx_save_squad(%L,%L,0)','4-3-3',slots),'STALE_REVISION');
 slots[2]:='bsd-10';perform pg_temp.expect_error(format('select public.kickx_save_squad(%L,%L,1)','4-3-3',slots),'DUPLICATE_PLAYER');
 slots[1]:=null;perform pg_temp.expect_error(format('select public.kickx_save_squad(%L,%L,1)','4-3-3',slots),'INVALID_SQUAD_PLAYER');
 slots[2]:='bsd-11';perform pg_temp.expect_error(format('select public.kickx_save_squad(%L,%L,1)','4-3-3',slots),'INVALID_SQUAD_PLAYER');
 if (public.kickx_member_data()->>'totalAssets')::bigint<>1300000 then raise exception 'Assets after buy wrong';end if;
 if jsonb_array_length(public.kickx_member_data()->'ownedPlayers')<>1 then raise exception 'Owned catalog missing';end if;
 q:=public.kickx_quote('bsd-10','sell');perform pg_temp.expect_error(format('select public.kickx_trade(%L,%L)',q->>'id',req),'REQUEST_REUSED');if (q->>'fee')::bigint<>2000 then raise exception 'Fee not 2 percent';end if;
 t:=public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 if (select balance from public.wallets)<>1298000 or exists(select 1 from public.holdings) then raise exception 'Sell not atomic';end if;
 if (select s.slots[1] from public.squads s) is not null or (select revision from public.squads)<>2 then raise exception 'Sold player remains in squad';end if;
 if (select volume from public.player_market_snapshots where id='bsd-10')<>2 then raise exception 'Trade volume not persisted';end if;
 if (select value from public.asset_snapshots order by recorded_at desc limit 1)<>1298000 then raise exception 'Snapshot does not include settled trade';end if;
 if (public.kickx_member_data()->>'realizedProfit')::bigint<>-2000 then raise exception 'Realized profit excludes fee';end if;
 perform pg_temp.expect_error($q$select public.kickx_quote('bsd-10','sell')$q$,'NOT_OWNED');
 perform set_config('kickx.test.buy',t->>'id',true);
 q:=public.kickx_quote('bsd-11','buy');perform set_config('kickx.test.quote',q->>'id',true);
end $$;
-- A different member cannot execute the first member's quote or read their finance.
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$begin
 if exists(select 1 from public.wallets) or exists(select 1 from public.trades) or exists(select 1 from public.holdings) then raise exception 'RLS leak';end if;
 perform pg_temp.expect_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('kickx.test.quote')),'QUOTE_NOT_FOUND');
 perform public.kickx_open_wallet();
end $$;
reset role;
update public.player_market_snapshots set price=price+1,updated_at=clock_timestamp() where id='bsd-11';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('kickx.test.quote')),'PRICE_CHANGED');
select set_config('kickx.test.quote',(public.kickx_quote('bsd-11','buy')->>'id'),true);
reset role;
update public.trade_quotes set expires_at=clock_timestamp()-interval '1 second' where id=current_setting('kickx.test.quote')::uuid;
update public.player_market_snapshots set price=2000000 where id='bsd-12';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('kickx.test.quote')),'QUOTE_EXPIRED');
select set_config('kickx.test.quote',public.kickx_quote('bsd-12','buy')->>'id',true);
select pg_temp.expect_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('kickx.test.quote')),'INSUFFICIENT_POINTS');
reset role;
do $$begin
 if (select count(*) from public.trades)<>2 or (select count(*) from public.wallet_ledger)<>4 then raise exception 'Failed trade mutated ledger';end if;
 if public.kickx_assets_at('00000000-0000-0000-0000-000000000001',clock_timestamp())<>1298000 then raise exception 'Historical asset sequence wrong';end if;
end $$;
-- Calculation publication compares source revisions, replays from base, and retains incomplete corrections.
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,provider) values('bsd-100','bsd-1','bsd-2','2026-09-20T12:00:00Z','FT','bsd');
insert into public.football_event_sources(fixture_id,detail) values('bsd-100','{}');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats) values('bsd-10','bsd-100','bsd-1','{}');
do $$declare expected jsonb;result jsonb; r jsonb;begin
 select jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at) order by m.fixture_id) into expected from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id join public.football_event_sources s on s.fixture_id=f.id where m.player_id='bsd-10';
 result:='[{"fixtureId":"bsd-100","score":9,"status":"provisional","position":"GK","breakdown":[],"warnings":[]}]';
 r:=public.kickx_publish_calculation('00000000-0000-0000-0000-000000000002','bsd-10','hash1',expected,result);
 if (r->>'price')::bigint<>105000 then raise exception 'Price formula wrong';end if;
 r:=public.kickx_publish_calculation('00000000-0000-0000-0000-000000000002','bsd-10','hash1',expected,result);
 if not (r->>'unchanged')::boolean or (select count(*) from public.calculation_revisions)<>1 then raise exception 'Calculation replay duplicated';end if;
 result:=jsonb_set(result,'{0,score}','4');r:=public.kickx_publish_calculation('00000000-0000-0000-0000-000000000002','bsd-10','hash2',expected,result);
 if (r->>'price')::bigint<>100000 then raise exception 'Correction applied twice instead of replay';end if;
 result:=jsonb_set(jsonb_set(result,'{0,score}','null'),'{0,status}','"blocked"');r:=public.kickx_publish_calculation('00000000-0000-0000-0000-000000000002','bsd-10','hash3',expected,result);
 if not (r->>'withheld')::boolean or (select price from public.player_market_snapshots where id='bsd-10')<>100000 then raise exception 'Incomplete correction erased price';end if;
 perform pg_temp.expect_error(format('select public.kickx_publish_calculation(%L,%L,%L,%L::jsonb,%L::jsonb)','00000000-0000-0000-0000-000000000002','bsd-10','hash4','[]',result),'SOURCE_CHANGED');
end $$;
set local role authenticated;
reset role;
-- Existing user predates this period; initial ledger supplies the actual baseline.
update public.wallets set created_at=date_trunc('month',now())-interval '40 days' where user_id='00000000-0000-0000-0000-000000000001';
update public.wallet_ledger set created_at=date_trunc('month',now())-interval '40 days' where user_id='00000000-0000-0000-0000-000000000001' and kind='initial';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select public.kickx_refresh_rankings();
do $$declare r jsonb;begin
 select rows into r from public.ranking_snapshots where period='weekly' order by calculated_at desc limit 1;
 if jsonb_array_length(r)<>2 or r#>>'{0,userId}'<>'00000000-0000-0000-0000-000000000003' or (r#>>'{0,rank}')::int<>1 or (r#>>'{0,returnRate}')::numeric<>0 then raise exception 'Ranking/new user baseline wrong';end if;
 if (r#>>'{1,baseline}')::bigint<>1300000 or (r#>>'{1,returnRate}')::numeric<>round(-2000*100.0/1300000,4) then raise exception 'Historical period baseline wrong';end if;
 if not exists(select 1 from public.ranking_snapshots where period='weekly' and extract(isodow from starts_at at time zone 'Asia/Seoul')=1 and (starts_at at time zone 'Asia/Seoul')::time='00:00') then raise exception 'KST week boundary wrong';end if;
end $$;
reset role;
set local role anon;
select pg_temp.expect_error('select public.kickx_open_wallet()','42501');
select pg_temp.expect_error('select * from public.operation_audit','42501');
select pg_temp.expect_error('select public.kickx_assets(null)','42501');
reset role;
rollback;
