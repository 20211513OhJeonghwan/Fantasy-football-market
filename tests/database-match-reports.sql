-- Rollback-only integration: sharing, leases, corrections, quotas, retention and roles.
begin;
update public.kickx_policy set version='form-v2',ai_report_usage='{}';
insert into auth.users values('00000000-0000-0000-0000-000000000081');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000081','Report Tester');
insert into public.teams(id,name) values('report-home','Report Home'),('report-away','Report Away');
insert into public.players(id,name,name_ko,position) values('report-player','Report Player','리포트 선수','FW');
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,home_score,away_score)
 values('report-fixture','report-home','report-away','2026-10-01T12:00:00Z','FT',1,0);
insert into public.player_match_records(player_id,fixture_id,played_at,opponent,minutes,goals,assists,performance,rule_version)
 values('report-player','report-fixture','2026-10-01T12:00:00Z','Report Away',90,1,0,57,'form-v2');
insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,breakdown,warnings)
 values('report-player','report-fixture',57,'provisional','form-v2','source-a','[{"metric":"minutes","value":90,"points":30},{"metric":"goals","value":1,"points":30},{"metric":"yellow_cards","value":1,"points":-3}]','["UNVERIFIED"]');
insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
 values('report-player','report-fixture','form-v2','2026-10-01T12:00:00Z',100000,92000,80000,40,-8,'["report-fixture"]','source-a');
-- A legacy row must survive the schema extension and remain independently readable.
insert into public.player_analyses(id,body,source_updated_at) values('report-player','Legacy player analysis',now());
create function pg_temp.report_assert(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception '%',message;end if;
end $$;
create function pg_temp.report_denied(command text) returns void language plpgsql as $$begin
 begin execute command;exception when insufficient_privilege then return;end;
 raise exception 'Unexpected privilege: %',command;
end $$;
set local role service_role;
do $$declare first jsonb;second jsonb;h text;t uuid;before_usage jsonb;begin
 select ai_report_usage into before_usage from public.kickx_policy;
 first:=public.kickx_read_match_report('report-player','report-fixture');
 perform pg_temp.report_assert(first->>'status'='missing' and first#>>'{facts,priceAfter}'='92000','Read must return stored pricing, without a write');
 perform pg_temp.report_assert((select ai_report_usage=before_usage from public.kickx_policy),'Read consumed quota');
 first:=public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081');
 perform pg_temp.report_assert(first->>'status'='claimed','Initial claim failed');
 h:=first->>'inputHash';t:=(first->>'claimToken')::uuid;
 second:=public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081');
 perform pg_temp.report_assert(second->>'status'='pending','Concurrent claim should reuse the in-flight lease');
 perform pg_temp.report_assert((select (ai_report_usage->>'daily')::integer=1 from public.kickx_policy),'Duplicate click consumed quota');
 perform pg_temp.report_assert(not public.kickx_finish_match_report('report-player','report-fixture',gen_random_uuid(),h,'{"performance":"득점과 출전이 가점에 반영되었습니다.","value":"목표 가격이 낮아 하락 방향으로 반영됐습니다."}','gemini-test'),'A wrong lease was accepted');
 perform pg_temp.report_assert(public.kickx_finish_match_report('report-player','report-fixture',t,h,'{"performance":"득점과 출전이 가점에 반영되었습니다.","value":"목표 가격이 낮아 하락 방향으로 반영됐습니다."}','gemini-test'),'Finalize failed');
 first:=public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081');
 perform pg_temp.report_assert(first->>'status'='ready','Completed reports were regenerated');
 -- A whole-player replay timestamp/hash change must not invalidate an unchanged match.
 update public.performance_results set input_hash='replay-b',calculated_at=now() where player_id='report-player';
 update public.player_price_results set input_hash='replay-b' where player_id='report-player';
 first:=public.kickx_read_match_report('report-player','report-fixture');
 perform pg_temp.report_assert(first->>'status'='ready' and first->>'inputHash'=h,'Unchanged replay invalidated a report');
 -- Real corrections hide the old text immediately, reuse the same row, and reject stale saves.
 update public.performance_results set score=60 where player_id='report-player';
 first:=public.kickx_read_match_report('report-player','report-fixture');
 perform pg_temp.report_assert(first->>'status'='missing' and not(first?'text'),'Old explanation leaked after correction');
 first:=public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081');
 t:=(first->>'claimToken')::uuid;h:=first->>'inputHash';
 update public.performance_results set score=61,input_hash='source-new' where player_id='report-player';
 perform pg_temp.report_assert((public.kickx_read_match_report('report-player','report-fixture'))->>'status'='unavailable','Withheld pricing was paired with a newer score');
 perform pg_temp.report_assert(not public.kickx_finish_match_report('report-player','report-fixture',t,h,'{"performance":"득점과 출전이 가점에 반영되었습니다.","value":"목표 가격이 낮아 하락 방향으로 반영됐습니다."}','gemini-test'),'Stale response overwrote corrected results');
 update public.player_price_results set input_hash='source-new' where player_id='report-player';
 first:=public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081');
 perform pg_temp.report_assert(first->>'status'='claimed','New facts must get their own retry budget');
 perform public.kickx_finish_match_report('report-player','report-fixture',(first->>'claimToken')::uuid,first->>'inputHash',null,'gemini-test','rate-limit');
 perform pg_temp.report_assert((public.kickx_read_match_report('report-player','report-fixture'))->>'status'='cooldown','Quota error did not back off');
 perform pg_temp.report_assert((select count(*)=1 from public.player_analyses where fixture_id='report-fixture'),'Corrections created extra cache rows');
end $$;
reset role;
-- A seeded historical match has no individual price step, not an unfinished game.
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status)
 values('report-history','report-home','report-away','2026-09-01T12:00:00Z','FT');
insert into public.player_initial_values(player_id,rule_version,detail,input_hash)
 values('report-player','form-v2','{"fixtures":["report-history"]}','initial-history');
set local role service_role;
select pg_temp.report_assert((public.kickx_read_match_report('report-player','report-history'))->>'unavailableReason'='baseline-history','Historical initial-price input was described as pending');
select pg_temp.report_assert((public.kickx_claim_match_report('report-player','report-history','00000000-0000-0000-0000-000000000081'))->>'status'='unavailable','Historical input consumed a generation claim');
select pg_temp.report_assert(not exists(select 1 from public.player_analyses where fixture_id='report-history'),'Historical input created a cache row');
select pg_temp.report_assert((public.kickx_read_match_report('report-player','unknown-fixture'))->>'unavailableReason'='awaiting-results','Missing results were described as initial-price history');
reset role;
set local role anon;
select pg_temp.report_assert((select count(id)=1 from public.player_analyses),'Guest can see private match rows, or legacy rows disappeared');
select pg_temp.report_denied('select requested_by from public.player_analyses');
select pg_temp.report_denied($q$select public.kickx_read_match_report('report-player','report-fixture')$q$);
select pg_temp.report_denied($q$select public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081')$q$);
reset role;
set local role authenticated;
select pg_temp.report_denied($q$update public.player_analyses set body='forged'$q$);
select pg_temp.report_denied($q$select public.kickx_finish_match_report('report-player','report-fixture',gen_random_uuid(),'x','{}','fake')$q$);
reset role;
-- Fixed-size global counters remain strict even after retries/corrections/eviction.
update public.performance_results set score=62 where player_id='report-player';
update public.kickx_policy set ai_report_usage=jsonb_build_object('day',to_char(now() at time zone 'UTC','YYYY-MM-DD'),'daily',100);
set local role service_role;
select pg_temp.report_assert((public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081'))->>'status'='limited','Daily limit not enforced');
reset role;
update public.kickx_policy set ai_report_usage=jsonb_build_object('day',to_char(now() at time zone 'UTC','YYYY-MM-DD'),'daily',0,'minute',to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI'),'perMinute',4);
set local role service_role;
select pg_temp.report_assert((public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081'))->>'status'='limited','Minute limit not enforced');
reset role;
-- Fill only the compact cache, not application/sample data; oldest report is evicted.
update public.kickx_policy set ai_report_usage='{}';
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status)
 select 'report-cache-'||n,'report-home','report-away','2026-10-01T12:00:00Z','FT' from generate_series(1,3000) n;
delete from public.player_analyses where fixture_id='report-fixture';
insert into public.player_analyses(id,fixture_id,body,source_updated_at)
 select 'report-player','report-cache-'||n,'{}',now()-interval '1 day' from generate_series(1,3000) n;
set local role service_role;
select pg_temp.report_assert((public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081'))->>'status'='claimed','Full cache could not evict an old entry');
select pg_temp.report_assert((select count(*)=3000 from public.player_analyses where fixture_id is not null),'Cache exceeded the hard row limit');
reset role;
-- Mark old entries expired and confirm gradual cleanup without deleting legacy analysis.
update public.player_analyses set source_updated_at=now()-interval '91 days' where fixture_id like 'report-cache-%';
update public.performance_results set score=63 where player_id='report-player';
set local role service_role;
select public.kickx_claim_match_report('report-player','report-fixture','00000000-0000-0000-0000-000000000081');
select pg_temp.report_assert((select count(*)=2900 from public.player_analyses where fixture_id is not null),'Expired cache entries were not cleaned in bounded batches');
reset role;
select pg_temp.report_assert((select count(*)=1 from public.player_analyses where fixture_id is null),'Legacy analysis was deleted');
rollback;
