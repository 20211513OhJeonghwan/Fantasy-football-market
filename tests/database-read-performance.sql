-- Batch display locks must agree with the settlement's authoritative single check.
begin;
insert into public.teams(id,name) values ('read-home','Read Home'),('read-away','Read Away'),('read-other','Read Other');
insert into public.players(id,name,team_id) values
 ('read-home-player','Home','read-home'),('read-away-player','Away','read-away'),
 ('read-transferred-player','Transferred','read-other'),('read-unrelated-player','Unrelated','read-other');
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status)
 values('read-match','read-home','read-away',now()+interval '90 minutes','NS');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)
 values('read-transferred-player','read-match','read-home','{}');
create function pg_temp.check_batch(expected_locked boolean) returns void language plpgsql as $$
declare ids text[]:=array['read-home-player','read-away-player','read-transferred-player','read-unrelated-player'];
 result jsonb; player_id text;
begin
 result:=public.kickx_trade_windows(ids||array['read-home-player','read-missing']);
 foreach player_id in array ids loop
  if result->player_id is distinct from public.kickx_trade_window(player_id,now())
   then raise exception 'Batch differs from settlement for %',player_id;end if;
 end loop;
 if (result#>>'{read-home-player,locked}')::boolean<>expected_locked then raise exception 'Unexpected batch window';end if;
 if result?'read-missing' or (select count(*) from jsonb_object_keys(result))<>4 then raise exception 'Batch identities changed';end if;
end $$;
set local role anon;
select pg_temp.check_batch(true);
select pg_temp.check_batch(true);
reset role;
update public.fixtures set status='LIVE',starts_at=now()-interval '4 hours' where id='read-match';
select pg_temp.check_batch(true);
update public.fixtures set status='PEN' where id='read-match';
select pg_temp.check_batch(true);
update public.fixtures set status='PST' where id='read-match';
select pg_temp.check_batch(false);
update public.fixtures set status='NS',starts_at=now()+interval '91 minutes' where id='read-match';
select pg_temp.check_batch(false);
delete from public.football_match_stats where fixture_id='read-match';
delete from public.fixtures where id='read-match';
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status,finished_observed_at)
 values('read-match','read-home','read-away',now()-interval '2 hours','FT',now()-interval '10 minutes');
select pg_temp.check_batch(false);
do $$begin
 if public.kickx_trade_windows(array[]::text[])<>'{}'::jsonb
   or public.kickx_trade_windows(null)<>'{}'::jsonb then raise exception 'Empty batch failed';end if;
 begin
  perform public.kickx_trade_windows(array_fill('read-home-player'::text,array[101]));
  raise exception 'Large batch accepted';
 exception when others then if sqlerrm<>'INVALID_INPUT' then raise;end if;end;
end $$;
rollback;
