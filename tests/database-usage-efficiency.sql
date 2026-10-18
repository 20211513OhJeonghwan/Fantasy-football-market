-- Repeated provider polls must not rewrite identical JSON or reset source CAS.
begin;
update public.kickx_policy set club_competitions_enabled=false;
insert into public.leagues(id,name,provider,external_id) values('bsd-92001','Usage league','bsd',92001);
insert into public.teams(id,name,provider,external_id,league_id)
 values('bsd-92001','Usage home','bsd',92001,'bsd-92001'),('bsd-92002','Usage away','bsd',92002,'bsd-92001');
insert into public.players(id,name,provider,external_id,team_id)
 values('bsd-92001','Usage player','bsd',92001,'bsd-92001');
insert into public.fixtures(id,provider,home_team_id,away_team_id,starts_at,status)
 values('bsd-92001','bsd','bsd-92001','bsd-92002',now()-interval '2 hours','FT');
insert into public.football_league_seasons(league_id,season,provider_season_id,coverage)
 values('bsd-92001',2026,92001,'{}');
insert into public.football_entity_sources(kind,external_id,raw) values('league',92001,'{"same":true}');
insert into public.football_event_sources(fixture_id,detail,lineups) values('bsd-92001','{"id":92001}','{}');
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)
 values('bsd-92001','bsd-92001','bsd-92001','{"minutes_played":90}');

do $$declare t text;n integer;rev uuid;begin
 select revision into rev from public.calculation_queue where player_id='bsd-92001';
 foreach t in array array['leagues','teams','players','fixtures','football_league_seasons',
                          'football_entity_sources','football_event_sources','football_match_stats'] loop
  execute format('update public.%I set updated_at=updated_at+interval ''1 second''',t);
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Unchanged % rewrote % rows',t,n;end if;
 end loop;
 if (select revision from public.calculation_queue where player_id='bsd-92001')<>rev then
  raise exception 'Unchanged poll invalidated calculation revision';end if;
end $$;

-- A genuine correction wakes a backed-off player immediately and resets attempts.
set local role service_role;
do $$declare rev uuid;stale uuid;delay interval;i integer;expected interval;begin
 select revision into rev from public.calculation_queue where player_id='bsd-92001';
 for i in 0..4 loop
  perform public.kickx_ack_calculation('bsd-92001',rev,'CALCULATION_WITHHELD');
  select retry_at-clock_timestamp() into delay from public.calculation_queue where player_id='bsd-92001';
  expected:=case i when 0 then interval '1 minute' when 1 then interval '2 minutes'
    when 2 then interval '5 minutes' when 3 then interval '15 minutes' else interval '1 hour' end;
  if delay not between expected-interval '2 seconds' and expected then
   raise exception 'Retry % expected %, got %',i,expected,delay;end if;
 end loop;
 stale:=rev;
 update public.football_match_stats set stats='{"minutes_played":90,"goals":1}',updated_at=clock_timestamp()
  where player_id='bsd-92001' and fixture_id='bsd-92001';
 if not exists(select 1 from public.calculation_queue where player_id='bsd-92001'
  and revision<>stale and attempts=0 and error_code is null and retry_at<=clock_timestamp()) then
  raise exception 'New evidence failed to bypass backoff';end if;
 perform public.kickx_ack_calculation('bsd-92001',stale,null);
 perform public.kickx_ack_calculation('bsd-92001',stale,'CALCULATION_WITHHELD');
 if not exists(select 1 from public.calculation_queue where player_id='bsd-92001' and attempts=0) then
  raise exception 'Stale acknowledgment affected new revision';end if;
 -- Non-scoring metadata stays stored without invalidating the calculation queue.
 select revision into rev from public.calculation_queue where player_id='bsd-92001';
 update public.football_event_sources set detail='{"id":92001,"metadata":"corrected"}',updated_at=clock_timestamp()
  where fixture_id='bsd-92001';
 if (select revision from public.calculation_queue where player_id='bsd-92001')<>rev then
  raise exception 'Metadata unnecessarily queued scoring';end if;
 update public.football_event_sources set lineups='{"changed":true}',updated_at=clock_timestamp()
  where fixture_id='bsd-92001';
 if (select revision from public.calculation_queue where player_id='bsd-92001')=rev then
  raise exception 'Changed lineup failed to queue scoring';end if;
 -- Final observation remains stable for an identical final score poll.
 update public.fixtures set home_score=1,updated_at=clock_timestamp() where id='bsd-92001';
end $$;
reset role;

-- Historical incomplete records keep the existing daily fallback.
update public.fixtures set starts_at=now()-interval '2 days' where id='bsd-92001';
set local role service_role;
do $$declare rev uuid;begin
 select revision into rev from public.calculation_queue where player_id='bsd-92001';
 perform public.kickx_ack_calculation('bsd-92001',rev,'CALCULATION_WITHHELD');
 if not exists(select 1 from public.calculation_queue where player_id='bsd-92001' and retry_at>now()+interval '23 hours') then
  raise exception 'Historical fallback retried too often';end if;
end $$;
reset role;
set local role anon;
do $$begin
 if has_function_privilege(current_user,'public.kickx_skip_unchanged_source()','execute')
 or has_function_privilege(current_user,'public.kickx_ack_calculation(text,uuid,text)','execute')
 or has_function_privilege(current_user,'public.kickx_queue_player(text)','execute') then
  raise exception 'Internal operations exposed to anonymous users';end if;
end $$;
reset role;
rollback;
