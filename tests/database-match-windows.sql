-- Real PostgreSQL boundary, settlement, permission, and end-observation checks.
begin;
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
insert into auth.users values('00000000-0000-0000-0000-000000000051');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000051','Window Test');
insert into public.teams(id,name) values('bsd-81001','Home'),('bsd-81002','Away'),('bsd-81003','Other');
insert into public.players(id,name,provider,team_id,position) values('bsd-81001','Home Player','bsd','bsd-81001','FW'),('bsd-81002','Other Player','bsd','bsd-81003','FW');
insert into public.player_market_snapshots(id,price,pricing_rule_version) values('bsd-81001',100000,'prototype-v1'),('bsd-81002',100000,'prototype-v1');
insert into public.fixtures(id,provider,home_team_id,away_team_id,starts_at,status) values('bsd-81001','bsd','bsd-81001','bsd-81002',now()+interval '91 minutes','NS');
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected % from %',expected,command;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000051';
select set_config('window.quote',(public.kickx_quote('bsd-81001','buy')->>'id'),true);
select pg_temp.expect_error('select public.kickx_realtime_claim()','42501');
select pg_temp.expect_error($q$select public.kickx_quote_base('bsd-81001','buy')$q$,'42501');
reset role;
update public.fixtures set starts_at=now()+interval '90 minutes' where id='bsd-81001';
do $$declare start_at timestamptz;begin
 select starts_at into start_at from public.fixtures where id='bsd-81001';
 if (public.kickx_trade_window('bsd-81001',start_at-interval '90 minutes 0.001 seconds')->>'locked')::boolean then raise exception 'Pre-window locked';end if;
 if not (public.kickx_trade_window('bsd-81001',start_at-interval '90 minutes')->>'locked')::boolean then raise exception '90-minute boundary missed';end if;
 if (public.kickx_trade_window('bsd-81002',now())->>'locked')::boolean then raise exception 'Unrelated club locked';end if;
end $$;
set local role authenticated;
select pg_temp.expect_error($q$select public.kickx_quote('bsd-81001','buy')$q$,'MATCH_TRADING_LOCKED');
select pg_temp.expect_error(format('select public.kickx_trade(%L,gen_random_uuid())',current_setting('window.quote')),'MATCH_TRADING_LOCKED');
select public.kickx_quote('bsd-81002','buy');
reset role;
update public.fixtures set starts_at=now()-interval '150 minutes',status='LIVE' where id='bsd-81001';
do $$begin
 if not (public.kickx_trade_window('bsd-81001',now())->>'locked')::boolean then raise exception 'Long extra time incorrectly unlocked';end if;
end $$;
update public.fixtures set status='PEN' where id='bsd-81001';
do $$declare observed timestamptz;begin
 select finished_observed_at into observed from public.fixtures where id='bsd-81001';
 if observed is null then raise exception 'End not observed';end if;
 if not (public.kickx_trade_window('bsd-81001',observed+interval '9 minutes 59.999 seconds')->>'locked')::boolean then raise exception 'Post-end lock too short';end if;
 if (public.kickx_trade_window('bsd-81001',observed+interval '10 minutes')->>'locked')::boolean then raise exception 'Exact unlock boundary missed';end if;
 update public.fixtures set home_score=1 where id='bsd-81001';
 if (select finished_observed_at from public.fixtures where id='bsd-81001')<>observed then raise exception 'Re-poll reset post-end timer';end if;
end $$;
-- Postponement/cancellation releases the clock lock. A settled retry stays idempotent.
update public.fixtures set status='PST' where id='bsd-81001';
set local role authenticated;
select set_config('window.request',gen_random_uuid()::text,true);
select public.kickx_trade(current_setting('window.quote')::uuid,current_setting('window.request')::uuid);
reset role;
update public.fixtures set status='NS',starts_at=now()+interval '60 minutes' where id='bsd-81001';
set local role authenticated;
select public.kickx_trade(current_setting('window.quote')::uuid,current_setting('window.request')::uuid);
select pg_temp.expect_error($q$select public.kickx_quote('bsd-81001','sell')$q$,'MATCH_TRADING_LOCKED');
reset role;
do $$begin
 if (select count(*) from public.trades where user_id='00000000-0000-0000-0000-000000000051')<>1 then raise exception 'Retry duplicated trade';end if;
 if (select balance from public.wallets where user_id='00000000-0000-0000-0000-000000000051')<>1200000 then raise exception 'Rejected trade changed wallet';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='community_posts' and column_name='category') then raise exception 'Category still stored';end if;
end $$;
set local role service_role;
select set_config('window.lease',public.kickx_realtime_claim()->>'token',true);
do $$begin
 if public.kickx_realtime_claim()<>'{"busy":true}'::jsonb then raise exception 'Worker lease overlap';end if;
end $$;
select public.kickx_realtime_finish(current_setting('window.lease')::uuid,'{"checked":1}');
reset role;
set local role anon;
do $$begin
 if public.kickx_data_freshness()->>'lastCheckedAt' is null then raise exception 'Public actual check time missing';end if;
end $$;
select pg_temp.expect_error('select * from public.realtime_worker_state','42501');
rollback;
