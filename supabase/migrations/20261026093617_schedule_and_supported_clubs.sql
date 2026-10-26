begin;
set local lock_timeout='5s';
alter table public.profiles add column team_ids text[] not null default '{}';
update public.profiles p set team_ids=array[p.team_id] where p.team_id is not null;
alter table public.profiles add constraint profiles_supported_team_count check(cardinality(team_ids)<=5);

-- Validate the entire selection atomically, including direct REST writes.
-- The existing primary badge stays compatible with older ranking snapshots.
create function public.kickx_validate_supported_clubs() returns trigger
language plpgsql security invoker set search_path='' as $$
declare n integer;found_count integer;league_count integer;begin
 if TG_OP='INSERT' and cardinality(new.team_ids)=0 and new.team_id is not null then new.team_ids:=array[new.team_id];
 elsif TG_OP='UPDATE' and new.team_ids is not distinct from old.team_ids and new.team_id is distinct from old.team_id then
  new.team_ids:=case when new.team_id is null then '{}'::text[] else array[new.team_id] end;
 end if;
 n:=cardinality(new.team_ids);
 if n>5 or array_ndims(new.team_ids)>1 or array_position(new.team_ids,null) is not null or
  (select count(distinct t) from unnest(new.team_ids) t)<>n then raise exception 'INVALID_SUPPORTED_CLUBS';end if;
 select count(*),count(distinct league_id) into found_count,league_count from public.teams
 where id=any(new.team_ids) and league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6');
 if found_count<>n or league_count<>n then raise exception 'ONE_CLUB_PER_LEAGUE';end if;
 new.team_id:=new.team_ids[1];return new;
end $$;
revoke all on function public.kickx_validate_supported_clubs() from public,anon,authenticated;
create trigger profiles_supported_clubs before insert or update of team_id,team_ids on public.profiles
for each row execute function public.kickx_validate_supported_clubs();
grant insert(team_ids),update(team_ids) on public.profiles to authenticated;

create or replace function public.kickx_can_write_lounge(u uuid,s text,t text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=u and (s='player' or s='club' and t=any(p.team_ids)))
$$;
-- Preserve the existing internal helper's access boundary.
revoke all on function public.kickx_can_write_lounge(uuid,text,text) from public,anon,authenticated;
grant execute on function public.kickx_can_write_lounge(uuid,text,text) to service_role;

-- All competition schedules are public club information; prices still use only the five leagues.
create view public.club_fixture_catalog with(security_invoker=true) as
 select f.*,concat_ws(' ',h.name,h.english,h.name_ko,a.name,a.english,a.name_ko) as search_text,
 case when upper(f.status) in('1H','HT','2H','ET','BT','P','LIVE') then 'live'
  when upper(f.status) in('NS','TBD') then 'scheduled'
  when upper(f.status) in('FT','AET','PEN') then 'finished' else 'other' end as state,
 case when f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') then public.kickx_fixture_reflection(f.id,f.status) end as reflection_status
 from public.fixtures f join public.teams h on h.id=f.home_team_id join public.teams a on a.id=f.away_team_id;
grant select on public.club_fixture_catalog to anon,authenticated,service_role;

-- A kickoff range plus deterministic ordering serves month and club schedules.
create index if not exists fixtures_home_calendar_idx on public.fixtures(home_team_id,starts_at,id);
create index if not exists fixtures_away_calendar_idx on public.fixtures(away_team_id,starts_at,id);

-- Include all supported clubs in new ranking snapshots without changing their scoring.
do $$declare definition text;begin
 select pg_get_functiondef('public.kickx_refresh_rankings()'::regprocedure) into definition;
 definition:=replace(definition,'p.nickname,p.team_id,','p.nickname,p.team_id,p.team_ids,');
 definition:=replace(definition,'''team'',team_id,','''team'',team_id,''teams'',team_ids,');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
