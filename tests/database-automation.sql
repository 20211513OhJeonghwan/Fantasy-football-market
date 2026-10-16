-- Isolated rollback: automatic execution, queue CAS, names, rankings and member restrictions.
begin;
-- Historical fixture imports in this test were observed over ten minutes ago.
alter table public.fixtures alter column finished_observed_at set default (now()-interval '11 minutes');
update public.kickx_policy set version='prototype-v1';
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000001','Member'),('00000000-0000-0000-0000-000000000002','Admin');
insert into public.user_roles values('00000000-0000-0000-0000-000000000002','admin');
insert into public.teams(id,name) values('bsd-1','Home'),('bsd-2','Away');
insert into public.players(id,name,provider,position,birth_date) values('bsd-10','Son Heung-min','bsd',null,'1992-07-08');
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected % from %',expected,command;
end $$;
set local role service_role;
do $$declare q jsonb;begin
 if public.kickx_auto_initialize_market()<>1 then raise exception 'Unknown-position player not initialized';end if;
 if public.kickx_auto_initialize_market()<>0 or (select price from public.player_market_snapshots where id='bsd-10')<>100000 then raise exception 'Base duplicated or wrong';end if;
 q:=public.kickx_automation_claim();perform set_config('kickx.test.lease',q->>'token',true);
 if public.kickx_automation_claim()<>jsonb_build_object('busy',true) then raise exception 'Lease overlap';end if;
 perform public.kickx_automatic_daily_start((q->>'token')::uuid,'[{"key":"first","kind":"league","priority":0,"payload":{"phase":"detail"},"label":"first"}]');
 perform public.kickx_automatic_daily_finish_task((q->>'token')::uuid,'first','{"done":false,"payload":{"phase":"seasons"},"children":[]}');
 if (select payload->>'phase' from public.automation_daily_tasks where key='first')<>'seasons' then raise exception 'Daily checkpoint lost';end if;
 perform public.kickx_automatic_daily_finish_task((q->>'token')::uuid,'first','{"done":true,"children":[{"key":"child","kind":"teams","priority":10,"payload":{},"label":"child"}]}');
 if not exists(select 1 from public.automation_daily_tasks where key='first' and completed) or not exists(select 1 from public.automation_daily_tasks where key='child' and not completed) then raise exception 'Children/checkpoint not atomic';end if;
 perform public.kickx_automation_finish((q->>'token')::uuid,true,'{}');
 q:=public.kickx_automation_claim();if (q->>'daily')::boolean then raise exception 'Completed daily rerun';end if;
 perform public.kickx_automation_finish((q->>'token')::uuid,false,'{}');
 perform pg_temp.expect_error(format('select public.kickx_automation_finish(%L,false,%L)',current_setting('kickx.test.lease'),'{}'),'STALE_AUTOMATION_LEASE');
end $$;
-- Daily budget is shared across jobs, reserved before HTTP, and cannot exceed its cap.
insert into public.football_bulk_daily_budget(day,requests) values((now() at time zone 'UTC')::date,6999) on conflict(day) do update set requests=6999;
select public.kickx_reserve_provider_request();
select pg_temp.expect_error('select public.kickx_reserve_provider_request()','LOCAL_DAILY_BUDGET');
do $$declare old uuid;begin
 select revision into old from public.calculation_queue where player_id='bsd-10';perform public.kickx_queue_player('bsd-10');
 perform public.kickx_ack_calculation('bsd-10',old,null);
 if not exists(select 1 from public.calculation_queue where player_id='bsd-10') then raise exception 'Old ack erased new source';end if;
 select revision into old from public.calculation_queue where player_id='bsd-10';perform public.kickx_ack_calculation('bsd-10',old,'CALCULATION_WITHHELD');
 if not exists(select 1 from public.calculation_queue where player_id='bsd-10' and retry_at>=now()+interval '23 hours') then raise exception 'Withheld hot loop';end if;
end $$;
-- Automatic mappings preserve raw names and verified manual edits.
do $$declare expected jsonb;begin
 expected:='{"name":"Son Heung-min","english":null,"birth_date":"1992-07-08"}';
 if not public.kickx_apply_automatic_name('bsd-10','손흥민',array['Son'],'Q439722',expected) then raise exception 'Automatic name failed';end if;
 if public.kickx_apply_automatic_name('bsd-10','잘못된 이름','{}','Q439722',jsonb_set(expected,'{name}','"Changed"')) then raise exception 'Name CAS ignored';end if;
 if (select name from public.players where id='bsd-10')<>'Son Heung-min' then raise exception 'Raw name overwritten';end if;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select public.kickx_save_player_name('bsd-10','검수한 이름',array['별명']);
reset role;
set local role service_role;
do $$begin
 if public.kickx_apply_automatic_name('bsd-10','자동 이름','{}','Q439722','{"name":"Son Heung-min","english":null,"birth_date":"1992-07-08"}') then raise exception 'Manual name overwritten';end if;
 if (select source from public.player_names where player_id='bsd-10')<>'manual' then raise exception 'Manual source not saved';end if;
end $$;
reset role;
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,provider) values('bsd-100','bsd-1','bsd-2',now()-interval '1 day','FT','bsd');
insert into public.football_event_sources(fixture_id,detail,lineups) values('bsd-100','{}','{}');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats) values('bsd-10','bsd-100','bsd-1','{}');
do $$declare r uuid;begin
 select revision into r from public.calculation_queue where player_id='bsd-10';update public.football_event_sources set detail='{"list_metadata":true}' where fixture_id='bsd-100';
 if (select revision from public.calculation_queue where player_id='bsd-10')<>r then raise exception 'Metadata-only update queued';end if;
 update public.football_event_sources set lineups='{"changed":true}' where fixture_id='bsd-100';
 if (select revision from public.calculation_queue where player_id='bsd-10')=r then raise exception 'Lineup update not queued';end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select public.kickx_open_wallet();
select public.kickx_trade((public.kickx_quote('bsd-10','buy')->>'id')::uuid,gen_random_uuid());
reset role;
-- Trusted automatic publication updates holder assets and rankings after all settlement writes.
set local role service_role;
do $$declare expected jsonb;r jsonb;ranked jsonb;begin
 select jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at)) into expected from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id join public.football_event_sources s on s.fixture_id=f.id where m.player_id='bsd-10';
 r:=public.kickx_publish_calculation(null,'bsd-10','auto-hash',expected,'[{"fixtureId":"bsd-100","score":9,"status":"provisional","position":"FW","breakdown":[],"warnings":[]}]');
 if (r->>'price')::bigint<>105000 then raise exception 'Null-actor publication failed';end if;
 select rows into ranked from public.ranking_snapshots where period='weekly' order by calculated_at desc limit 1;
 if (ranked#>>'{0,assets}')::bigint<>1305000 or (ranked#>>'{0,returnRate}')::numeric<>round(5000*100.0/1300000,4) then raise exception 'Automatic ranking missed final assets';end if;
 if public.kickx_auto_initialize_market()<>0 or (select price from public.player_market_snapshots where id='bsd-10')<>105000 then raise exception 'Initializer erased changed value';end if;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error('select public.kickx_auto_refresh_rankings()','42501');
select pg_temp.expect_error('select public.kickx_publish_calculation(null,null,null,null,null)','42501');
select pg_temp.expect_error($q$select public.kickx_restrict_member('00000000-0000-0000-0000-000000000002',7,'bad behavior')$q$,'ADMIN_REQUIRED');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($q$select public.kickx_restrict_member('00000000-0000-0000-0000-000000000002',7,'bad behavior')$q$,'PROTECTED_ADMIN');
select public.kickx_restrict_member('00000000-0000-0000-0000-000000000001',7,'Repeated abuse');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$select public.kickx_quote('bsd-10','sell')$q$,'MEMBER_SUSPENDED');
select pg_temp.expect_error($q$select public.kickx_save_squad('4-3-3',array_fill(null::text,array[11]),0)$q$,'MEMBER_SUSPENDED');
select pg_temp.expect_error($q$select public.kickx_community_write('create','{}')$q$,'MEMBER_SUSPENDED');
select pg_temp.expect_error($q$update public.profiles set nickname='Changed' where id=auth.uid()$q$,'MEMBER_SUSPENDED');
select public.kickx_member_data(); -- Restricted members retain access to their balances/history.
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select public.kickx_restrict_member('00000000-0000-0000-0000-000000000001',0,'Review complete');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select public.kickx_quote('bsd-10','sell');
select pg_temp.expect_error('select * from public.member_restrictions','42501');
reset role;
set local role anon;
select pg_temp.expect_error('select * from public.calculation_queue','42501');
select pg_temp.expect_error('select public.kickx_automation_claim()','42501');
reset role;
rollback;
