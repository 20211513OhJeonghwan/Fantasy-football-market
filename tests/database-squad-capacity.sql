-- Holdings may exceed all 4-3-3 capacities; only the saved lineup is limited.
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
select id,50000,'prototype-v1' from public.players where id like 'capacity-%';
create function pg_temp.capacity_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected %',expected;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000091';
do $$declare pos text;cap integer;i integer;q jsonb;receipt jsonb;begin
 perform public.kickx_open_wallet();
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-unknown','buy')$q$,'POSITION_UNAVAILABLE');
 foreach pos in array array['GK','DF','MF','FW'] loop
  cap:=case pos when 'GK' then 2 when 'DF' then 5 else 4 end;
  for i in 1..cap loop
   q:=public.kickx_quote('capacity-'||pos||'-'||i,'buy');
   receipt:=public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
   if public.kickx_trade((q->>'id')::uuid,gen_random_uuid())<>receipt then raise exception 'Retry duplicated trade';end if;
  end loop;
 end loop;
 if (select count(*) from public.holdings)<>15 then raise exception 'Holding count remained limited';end if;
 perform pg_temp.capacity_error($q$select public.kickx_quote('capacity-GK-1','buy')$q$,'ALREADY_OWNED');
 perform public.kickx_save_squad('4-3-3',array['capacity-GK-1','capacity-DF-1','capacity-DF-2','capacity-DF-3','capacity-DF-4','capacity-MF-1','capacity-MF-2','capacity-MF-3','capacity-FW-1','capacity-FW-2','capacity-FW-3'],0);
 foreach pos in array array['4-4-2','3-5-2','3-4-3','4-5-1','4-2-3-1'] loop
  perform pg_temp.capacity_error(format('select public.kickx_save_squad(%L,array_fill(null::text,array[11]),1)',pos),'INVALID_SQUAD');
 end loop;
 q:=public.kickx_quote('capacity-GK-1','sell');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 if (select slots[1] from public.squads) is not null then raise exception 'Sale did not clear saved slot';end if;
 q:=public.kickx_quote('capacity-GK-1','buy');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 perform pg_temp.capacity_error($q$select public.kickx_quote_base('capacity-GK-1','buy')$q$,'42501');
 perform pg_temp.capacity_error($q$select public.kickx_require_position_capacity('00000000-0000-0000-0000-000000000091','capacity-GK-1')$q$,'42501');
end $$;
rollback;
