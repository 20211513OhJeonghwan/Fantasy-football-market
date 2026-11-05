-- Quotas apply to holdings; quote and settlement both enforce them. No manual placement.
begin;
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000091');
insert into public.leagues(id,name) values('bsd-1','Test League') on conflict do nothing;
insert into public.teams(id,name,league_id) values('capacity-team','Capacity','bsd-1');
insert into public.profiles(id,nickname,team_id) values('00000000-0000-0000-0000-000000000091','Capacity','capacity-team');
insert into public.players(id,name,provider,position,team_id)
select 'capacity-'||p||'-'||n,'Capacity '||p||n,'bsd',p,'capacity-team'
from (values('GK',2),('DF',5),('MF',4),('FW',4)) as x(p,cap)
cross join lateral generate_series(1,cap) n;
insert into public.players(id,name,provider,team_id) values('capacity-unknown','Unknown','bsd','capacity-team');
insert into public.player_market_snapshots(id,price,pricing_rule_version)
select id,50000,'prototype-v1' from public.players where id like 'capacity-%';
create function pg_temp.capacity_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected %',expected;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000091';
do $$declare pos text;cap integer;i integer;q jsonb;pending jsonb;receipt jsonb;expected text;begin
 perform public.kickx_open_wallet();
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-unknown','buy')$q$,'POSITION_UNAVAILABLE');
 foreach pos in array array['GK','DF','MF','FW'] loop
  cap:=case pos when 'GK' then 1 when 'DF' then 4 else 3 end;
  pending:=public.kickx_quote('capacity-'||pos||'-'||(cap+1),'buy');
  for i in 1..cap loop
   q:=public.kickx_quote('capacity-'||pos||'-'||i,'buy');
   receipt:=public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
   if public.kickx_trade((q->>'id')::uuid,gen_random_uuid())<>receipt then raise exception 'Retry duplicated trade';end if;
  end loop;
  expected:=case when pos='FW' then 'SQUAD_FULL' else 'POSITION_FULL' end;
  perform pg_temp.capacity_error(format('select public.kickx_quote(%L,''buy'')','capacity-'||pos||'-'||(cap+1)),expected);
  perform pg_temp.capacity_error(format('select public.kickx_trade(%L,gen_random_uuid())',pending->>'id'),expected);
 end loop;
 if (select count(*) from public.holdings)<>11 then raise exception 'Holdings quotas failed';end if;
 if (select slots from public.squads)<>array['capacity-GK-1','capacity-DF-1','capacity-DF-2','capacity-DF-3','capacity-DF-4','capacity-MF-1','capacity-MF-2','capacity-MF-3','capacity-FW-1','capacity-FW-2','capacity-FW-3'] then raise exception 'Purchase not automatically placed';end if;
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-GK-1','buy')$q$,'ALREADY_OWNED');
 perform pg_temp.capacity_error(format('select public.kickx_save_squad(''4-3-3'',array_fill(null::text,array[11]),%s)',(select revision from public.squads)),'AUTO_SQUAD_MANAGED');
 q:=public.kickx_quote('capacity-GK-1','sell');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 if (select slots[1] from public.squads) is not null then raise exception 'Sale did not clear saved slot';end if;
 q:=public.kickx_quote('capacity-GK-2','buy');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 if (select slots[1] from public.squads)<>'capacity-GK-2' then raise exception 'Replacement not automatically placed';end if;
 perform pg_temp.capacity_error($q$select public.kickx_quote_base('capacity-GK-1','buy')$q$,'42501');
 perform pg_temp.capacity_error($q$select public.kickx_require_position_capacity('00000000-0000-0000-0000-000000000091','capacity-GK-1')$q$,'42501');
 perform pg_temp.capacity_error($q$select kickx_private.kickx_sync_owned_squad('00000000-0000-0000-0000-000000000091')$q$,'42501');
end $$;
reset role;
-- Existing excess holdings are not liquidated: block buys, permit sales, restore compliance.
do $$declare q jsonb;begin q:=public.kickx_quote_base('capacity-MF-4','buy');perform public.kickx_trade_base((q->>'id')::uuid,gen_random_uuid());end $$;
select kickx_private.kickx_sync_owned_squad('00000000-0000-0000-0000-000000000091');
set local role authenticated;
do $$declare q jsonb;begin
 if (select count(*) from public.holdings)<>12 then raise exception 'Legacy assets removed';end if;
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-GK-1','buy')$q$,'LEGACY_SQUAD_EXCESS');
 q:=public.kickx_quote('capacity-MF-4','sell');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 if (select count(*) from public.holdings)<>11 then raise exception 'Legacy excess sale failed';end if;
 if (select count(*) from public.squads s,unnest(s.slots) id where id is not null)<>11 then raise exception 'Legacy sale broke lineup';end if;
end $$;
rollback;
