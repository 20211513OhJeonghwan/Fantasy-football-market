begin;
insert into public.teams(id,name) values('reflection-home','Home'),('reflection-away','Away');
insert into public.players(id,name,team_id) values('reflection-a','A','reflection-home'),('reflection-b','B','reflection-away');
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status)
 values('reflection-match','reflection-home','reflection-away',now()-interval '2 hours','FT');
create function pg_temp.expect_reflection(expected text) returns void language plpgsql as $$
declare actual text;begin
 select reflection_status into actual from public.fixture_catalog where id='reflection-match';
 if actual is distinct from expected then raise exception 'Reflection expected %, got %',expected,actual;end if;
end $$;
set local role anon;
select pg_temp.expect_reflection('pending');
reset role;
insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,breakdown,warnings)
 values('reflection-a','reflection-match',70,'provisional','form-v2','reflection-a','[]','[]');
set local role anon;
select pg_temp.expect_reflection('reflected');
reset role;
insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,breakdown,warnings)
 values('reflection-b','reflection-match',null,'blocked','form-v2','reflection-b','[]','[]');
select pg_temp.expect_reflection('partial');
delete from public.performance_results where player_id='reflection-a';
select pg_temp.expect_reflection('withheld');
delete from public.performance_results where player_id='reflection-b';
insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,breakdown,warnings)
 values('reflection-a','reflection-match',70,'ready','form-v2','reflection-a','[]','[]');
insert into public.player_market_snapshots(id,price,pricing_rule_version,pricing_status)
 values('reflection-a',100000,'form-v2','pending');
select pg_temp.expect_reflection('pending');
update public.player_market_snapshots set pricing_status='ready' where id='reflection-a';
select pg_temp.expect_reflection('reflected');
update public.fixtures set status='PEN' where id='reflection-match';
set local role authenticated;
select pg_temp.expect_reflection('reflected');
reset role;
update public.fixtures set status='LIVE' where id='reflection-match';
select pg_temp.expect_reflection(null);
update public.fixtures set status='CANC' where id='reflection-match';
select pg_temp.expect_reflection(null);
rollback;
