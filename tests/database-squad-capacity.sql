-- Disposable CI only: all four limits, stale quotes, retries, sells and unsupported formations.
begin;
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000091');
insert into public.teams(id,name) values('capacity-team','Capacity');
insert into public.profiles(id,nickname,team_id) values('00000000-0000-0000-0000-000000000091','Capacity','capacity-team');
insert into public.players(id,name,provider,position,team_id)
select 'capacity-'||p||'-'||n,'Capacity '||p||n,'bsd',p,'capacity-team'
from (values('GK',2),('DF',5),('MF',4),('FW',4)) as x(p,cap)
cross join lateral generate_series(1,cap) n;
insert into public.players(id,name,provider,team_id) values('capacity-unknown','Unknown','bsd','capacity-team');
insert into public.player_market_snapshots(id,price,pricing_rule_version)
select id,100000,'prototype-v1' from public.players where id like 'capacity-%';
create function pg_temp.capacity_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected %',expected;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000091';
do $$declare pos text;cap integer;i integer;q jsonb;waiting jsonb;receipt jsonb;before_state jsonb;after_state jsonb;begin
 perform public.kickx_open_wallet();
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-unknown','buy')$q$,'POSITION_UNAVAILABLE');
 foreach pos in array array['GK','DF','MF','FW'] loop
  cap:=case pos when 'GK' then 1 when 'DF' then 4 else 3 end;
  for i in 1..cap-1 loop
   q:=public.kickx_quote('capacity-'||pos||'-'||i,'buy');
   perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
  end loop;
  -- Both quotes were valid before the final available place was filled.
  q:=public.kickx_quote('capacity-'||pos||'-'||cap,'buy');
  waiting:=public.kickx_quote('capacity-'||pos||'-'||(cap+1),'buy');
  receipt:=public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
  if public.kickx_trade((q->>'id')::uuid,gen_random_uuid())<>receipt then raise exception 'Retry blocked at full capacity';end if;
  select jsonb_build_object('balance',(select balance from public.wallets),'trades',(select count(*) from public.trades),'ledger',(select count(*) from public.wallet_ledger),'holdings',(select count(*) from public.holdings)) into before_state;
  perform pg_temp.capacity_error(format('select public.kickx_quote(%L,%L)','capacity-'||pos||'-'||(cap+1),'buy'),'POSITION_FULL');
  perform pg_temp.capacity_error(format('select public.kickx_trade(%L,gen_random_uuid())',waiting->>'id'),'POSITION_FULL');
  select jsonb_build_object('balance',(select balance from public.wallets),'trades',(select count(*) from public.trades),'ledger',(select count(*) from public.wallet_ledger),'holdings',(select count(*) from public.holdings)) into after_state;
  if before_state<>after_state then raise exception 'Capacity rejection mutated finance';end if;
 end loop;
 if (select count(*) from public.holdings)<>11 then raise exception 'Wrong fixed squad capacity';end if;
 -- An empty lineup must not reopen purchase capacity.
 perform public.kickx_save_squad('4-3-3',array_fill(null::text,array[11]),0);
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-GK-2','buy')$q$,'POSITION_FULL');
 foreach pos in array array['4-4-2','3-5-2','3-4-3','4-5-1','4-2-3-1'] loop
  perform pg_temp.capacity_error(format('select public.kickx_save_squad(%L,array_fill(null::text,array[11]),1)',pos),'INVALID_SQUAD');
 end loop;
 -- Selling frees only that position; another still-full position stays blocked.
 q:=public.kickx_quote('capacity-GK-1','sell');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 q:=public.kickx_quote('capacity-GK-2','buy');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-MF-4','buy')$q$,'POSITION_FULL');
 perform pg_temp.capacity_error($q$select public.kickx_quote_base('capacity-GK-1','buy')$q$,'42501');
 perform pg_temp.capacity_error($q$select public.kickx_require_position_capacity('00000000-0000-0000-0000-000000000091','capacity-GK-1')$q$,'42501');
end $$;
rollback;
