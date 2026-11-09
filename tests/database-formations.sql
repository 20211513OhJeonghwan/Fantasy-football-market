-- All mutation scenarios run in an isolated transaction, never against real holdings.
begin;
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000096'),('00000000-0000-0000-0000-000000000097');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000096','Formation One'),('00000000-0000-0000-0000-000000000097','Formation Two');
insert into public.leagues(id,name) values('bsd-1','Formation League') on conflict do nothing;
insert into public.teams(id,name,league_id) values('formation-team','Formation Club','bsd-1'),('formation-away','Opponent','bsd-1');
insert into public.players(id,name,provider,position,team_id)
 select 'form-'||p||'-'||n,'Formation '||p||n,'bsd',p,'formation-team'
 from (values('GK',2),('DF',5),('MF',6),('FW',4)) x(p,cap) cross join lateral generate_series(1,cap) n;
insert into public.player_market_snapshots(id,price,pricing_rule_version)
 select id,50000,'prototype-v1' from public.players where id like 'form-%';
create function pg_temp.formation_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected % from %',expected,command;
end $$;
create function pg_temp.formation_buy(id text) returns void language plpgsql as $$declare q jsonb;begin
 q:=public.kickx_quote(id,'buy');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000096';
select public.kickx_open_wallet();
select pg_temp.formation_buy('form-GK-1');
select pg_temp.formation_buy('form-DF-'||n) from generate_series(1,4) n;
select pg_temp.formation_buy('form-MF-'||n) from generate_series(1,3) n;
select pg_temp.formation_buy('form-FW-'||n) from generate_series(1,3) n;
select set_config('formation.before',public.kickx_member_data()->>'totalAssets',true);
reset role;
update public.player_market_snapshots set price=70000 where id='form-DF-4';
update public.player_market_snapshots set price=60000 where id='form-FW-3';
set local role authenticated;
select set_config('formation.balance',(select balance::text from public.wallets),true);
select set_config('formation.trades',(select count(*)::text from public.trades),true);
-- No arbitrary freezing, incorrect position selection, forged ownership or excluded formations.
do $$declare rev integer:=(select revision from public.squads);f text;begin
 foreach f in array array['4-6-0','3-6-1','3-3-3-1','invalid'] loop
  perform pg_temp.formation_error(format('select public.kickx_change_formation(%L,array[]::text[],%s)',f,rev),'INVALID_FORMATION');
 end loop;
 perform pg_temp.formation_error(format('select public.kickx_change_formation(''3-5-2'',array[]::text[],%s)',rev),'INVALID_BENCH_SELECTION');
 perform pg_temp.formation_error(format('select public.kickx_change_formation(''3-5-2'',array[''form-DF-4'',''form-DF-4''],%s)',rev),'INVALID_BENCH_SELECTION');
 perform pg_temp.formation_error(format('select public.kickx_change_formation(''3-5-2'',array[''form-DF-4'',''form-MF-1''],%s)',rev),'INVALID_BENCH_SELECTION');
 perform pg_temp.formation_error(format('select public.kickx_change_formation(''3-5-2'',array[''form-DF-5'',''form-FW-3''],%s)',rev),'INVALID_BENCH_SELECTION');
 perform pg_temp.formation_error(format('select public.kickx_change_formation(''3-5-2'',array[''form-DF-4'',''form-FW-3'',''form-GK-1''],%s)',rev),'INVALID_BENCH_SELECTION');
 perform pg_temp.formation_error(format('select public.kickx_change_formation(''4-3-3'',array[''form-DF-4''],%s)',rev),'INVALID_BENCH_SELECTION');
 perform pg_temp.formation_error($q$select public.kickx_change_formation('3-5-2',array['form-DF-4','form-FW-3'],99999)$q$,'STALE_REVISION');
end $$;
reset role;
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status)
 values('formation-locked','bsd-1','formation-team','formation-away',clock_timestamp()+interval '30 minutes','NS');
set local role authenticated;
do $$declare rev integer:=(select revision from public.squads);begin
 perform pg_temp.formation_error(format('select public.kickx_change_formation(''3-5-2'',array[''form-DF-4'',''form-FW-3''],%s)',rev),'MATCH_TRADING_LOCKED');
 if exists(select 1 from public.holdings where bench_started_at is not null) then raise exception 'Rejected request mutated holdings';end if;
end $$;
reset role;delete from public.fixtures where id='formation-locked';
set local role authenticated;
do $$declare s public.squads%rowtype;begin
 select * into s from public.squads;
 perform public.kickx_change_formation('3-5-2',array['form-DF-4','form-FW-3'],s.revision);
 if (select formation_id from public.squads)<>'3-5-2' then raise exception 'Formation was not saved';end if;
 if (select count(*) from public.holdings where bench_reason='formation')<>2 then raise exception 'Wrong number benched';end if;
 if (select bench_price from public.holdings where player_id='form-DF-4')<>70000 then raise exception 'Wrong freeze price';end if;
 if (select bench_price from public.holdings where player_id='form-FW-3')<>60000 then raise exception 'Wrong second freeze price';end if;
 if (select count(*) from public.holdings where bench_started_at is null)<>9 then raise exception 'Kept wrong active players';end if;
 if (select count(*) from public.squads sq,unnest(sq.slots) id where id is not null)<>9 then raise exception 'Remaining players not placed';end if;
 if (select balance from public.wallets)<>current_setting('formation.balance')::bigint or (select count(*) from public.trades)<>current_setting('formation.trades')::integer then raise exception 'Formation changed cash or trades';end if;
 perform pg_temp.formation_error($q$select public.kickx_quote('form-DF-4','buy')$q$,'ALREADY_OWNED');
 perform pg_temp.formation_error($q$select kickx_private.formation_positions('3-5-2')$q$,'42501');
 perform pg_temp.formation_error($q$select kickx_private.owned_squad_slots(auth.uid(),'3-5-2',null)$q$,'42501');
end $$;
select set_config('formation.started',(select bench_started_at::text from public.holdings where player_id='form-DF-4'),true);
-- A quote made under 3-5-2 must respect the capacity after returning to 4-3-3.
select set_config('formation.pending',public.kickx_quote('form-MF-4','buy')->>'id',true);
do $$declare s public.squads%rowtype;begin
 select * into s from public.squads;
 perform public.kickx_change_formation('4-3-3',array[]::text[],s.revision);
 perform pg_temp.formation_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('formation.pending')),'POSITION_FULL');
 select * into s from public.squads;
 perform public.kickx_change_formation('3-5-2',array[]::text[],s.revision);
 if (select bench_started_at from public.holdings where player_id='form-DF-4')<>current_setting('formation.started')::timestamptz then raise exception 'Existing deadline reset';end if;
 if exists(select 1 from public.squads sq,unnest(sq.slots) id where id in('form-DF-4','form-FW-3')) then raise exception 'Frozen holding returned';end if;
end $$;
select pg_temp.formation_buy('form-MF-4');
select pg_temp.formation_buy('form-MF-5');
do $$declare s public.squads%rowtype;slots text[];temp text;begin
 if (select formation_id from public.squads)<>'3-5-2' then raise exception 'Trade reset formation';end if;
 perform pg_temp.formation_error($q$select public.kickx_quote('form-MF-6','buy')$q$,'SQUAD_FULL');
 select * into s from public.squads;slots:=s.slots;temp:=slots[5];slots[5]:=slots[6];slots[6]:=temp;
 perform public.kickx_save_squad('3-5-2',slots,s.revision);
 if (select sq.slots from public.squads sq)<>slots then raise exception 'Manual placement was not saved';end if;
 perform pg_temp.formation_error(format('select public.kickx_save_squad(''3-5-2'',%L,%s)',slots,s.revision),'STALE_REVISION');
 select * into s from public.squads;
 perform pg_temp.formation_error(format('select public.kickx_save_squad(''4-3-3'',%L,%s)',slots,s.revision),'FORMATION_CHANGE_REQUIRED');
 perform pg_temp.formation_error(format('select public.kickx_save_squad(''3-5-2'',array_fill(null::text,array[11]),%s)',s.revision),'SQUAD_INCOMPLETE');
 slots[2]:='form-DF-4';
 perform pg_temp.formation_error(format('select public.kickx_save_squad(''3-5-2'',%L,%s)',slots,s.revision),'INVALID_SQUAD_PLAYER');
end $$;
reset role;
update public.player_market_snapshots set price=120000 where id in('form-DF-4','form-FW-3');
set local role authenticated;
do $$declare q jsonb;begin
 q:=public.kickx_quote('form-DF-4','sell');
 if (q->>'price')::bigint<>70000 or (q->>'fee')::bigint<>1400 or (q->>'settlement')::bigint<>68600 then raise exception 'Frozen sale does not match';end if;
end $$;
-- The second member can change among every supported system without affecting the first.
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000097';
select public.kickx_open_wallet();
do $$declare f text;rev integer;begin
 foreach f in array array['4-3-3','4-4-2','4-2-3-1','4-3-1-2','4-2-2-2','4-3-2-1','4-1-4-1','4-1-2-3','4-5-1','4-4-1-1','4-2-4','3-5-2','3-4-3','3-4-1-2','3-4-2-1','3-2-4-1','5-3-2','5-4-1','5-2-3'] loop
  select coalesce((select revision from public.squads),0) into rev;
  perform public.kickx_change_formation(f,array[]::text[],rev);
  if (select cardinality(slots) from public.squads)<>11 then raise exception 'Invalid slot count for %',f;end if;
 end loop;
 if (select balance from public.wallets)<>1300000 then raise exception 'Empty formation modified wallet';end if;
end $$;
reset role;
do $$declare sold integer;begin
 update public.holdings set bench_started_at=clock_timestamp()-interval '336 hours'
  where user_id='00000000-0000-0000-0000-000000000096' and bench_reason='formation';
 sold:=kickx_private.expire_roster_bench();if sold<>2 then raise exception 'Formation benches did not auto sell: %',sold;end if;
 if kickx_private.expire_roster_bench()<>0 then raise exception 'Repeated automatic sale';end if;
 if (select balance from public.wallets where user_id='00000000-0000-0000-0000-000000000096')<>current_setting('formation.balance')::bigint-100000+127400 then raise exception 'Automatic net settlement mismatch';end if;
 if (select count(*) from public.trades where execution_reason='bench_expired')<>2 then raise exception 'Missing automatic receipts';end if;
 if (select formation_id from public.squads where user_id='00000000-0000-0000-0000-000000000096')<>'3-5-2' then raise exception 'Automatic sale reset formation';end if;
end $$;
set local role anon;
select pg_temp.formation_error($q$select public.kickx_change_formation('4-3-3',array[]::text[],0)$q$,'42501');
rollback;
