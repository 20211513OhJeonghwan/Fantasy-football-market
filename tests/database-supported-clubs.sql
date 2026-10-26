begin;
insert into public.leagues(id,name) values('bsd-1','PL'),('bsd-3','LaLiga'),('bsd-4','Serie A'),('bsd-5','Bundesliga'),('bsd-6','Ligue 1'),('club-test-cup','Cup') on conflict do nothing;
insert into public.teams(id,name,league_id) values('support-a','A','bsd-1'),('support-b','B','bsd-3'),('support-c','C','bsd-4'),('support-d','D','bsd-5'),('support-e','E','bsd-6'),('support-rival','Rival','bsd-1'),('support-outside','Outside','club-test-cup');
insert into auth.users(id) values('00000000-0000-0000-0000-000000000071'),('00000000-0000-0000-0000-000000000072');
insert into public.profiles(id,nickname,team_id) values('00000000-0000-0000-0000-000000000071','Five Fans','support-a'),('00000000-0000-0000-0000-000000000072','Other Fan','support-rival');
create function pg_temp.support_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected %',expected;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000071';
update public.profiles set team_ids=array['support-a','support-b','support-c','support-d','support-e'] where id=auth.uid();
do $$begin
 if (select cardinality(team_ids) from public.profiles where id=auth.uid())<>5 then raise exception 'Five clubs not saved';end if;
 if (select team_id from public.profiles where id=auth.uid())<>'support-a' then raise exception 'Primary badge lost';end if;
 if (select count(*) from public.profiles)<>1 then raise exception 'Profile privacy lost';end if;
end $$;
select pg_temp.support_error($q$update public.profiles set team_ids=array['support-a','support-rival'] where id=auth.uid()$q$,'ONE_CLUB_PER_LEAGUE');
select pg_temp.support_error($q$update public.profiles set team_ids=array['support-outside'] where id=auth.uid()$q$,'ONE_CLUB_PER_LEAGUE');
select pg_temp.support_error($q$update public.profiles set team_ids=array['support-a','support-a'] where id=auth.uid()$q$,'INVALID_SUPPORTED_CLUBS');
select pg_temp.support_error($q$update public.profiles set team_ids=array['support-a','support-b','support-c','support-d','support-e','support-rival'] where id=auth.uid()$q$,'INVALID_SUPPORTED_CLUBS');
select pg_temp.support_error($q$update public.profiles set team_ids=array['missing'] where id=auth.uid()$q$,'ONE_CLUB_PER_LEAGUE');
-- Non-primary supported club can post; unsupported rival cannot. Database is authoritative.
select public.kickx_community_write('createPost',jsonb_build_object('scope','club','target','support-e','title','다섯 번째 구단 이야기','body','다섯 번째 응원 구단에도 글을 작성합니다.','transaction','','requestId',gen_random_uuid()));
select pg_temp.support_error($q$select public.kickx_community_write('createPost',jsonb_build_object('scope','club','target','support-rival','title','권한 없는 구단','body','응원하지 않는 구단에 글을 씁니다.','transaction','','requestId',gen_random_uuid()))$q$,'FAN_REQUIRED');
reset role;
do $$begin
 if not public.kickx_can_write_lounge('00000000-0000-0000-0000-000000000071','club','support-e') then raise exception 'Fifth club not authorized';end if;
 if public.kickx_can_write_lounge('00000000-0000-0000-0000-000000000071','club','support-rival') then raise exception 'Unselected rival authorized';end if;
end $$;
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status) values('support-domestic','bsd-1','support-a','support-rival',now(),'NS'),('support-cup','club-test-cup','support-a','support-outside',now(),'NS');
update public.kickx_policy set version='report-v3' where id=true;
set local role anon;
do $$begin
 if exists(select 1 from public.fixture_catalog where id='support-cup') then raise exception 'Cup leaked into regular schedule';end if;
 if (select count(*) from public.club_fixture_catalog where home_team_id='support-a')<>2 then raise exception 'Club cup schedule hidden';end if;
 if not exists(select 1 from pg_class where oid='public.club_fixture_catalog'::regclass and 'security_invoker=true'=any(reloptions)) then raise exception 'Club schedule bypasses RLS';end if;
end $$;
reset role;
rollback;
