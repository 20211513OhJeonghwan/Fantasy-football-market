-- Additive BSD migration. Keep all af- identities and existing references.
begin;
do $$ declare t text; begin
  foreach t in array array['leagues','teams','players','fixtures'] loop
    execute format('alter table public.%I add column provider text',t);
    execute format('update public.%I set provider = case when id like ''af-%%'' then ''api-football'' else ''manual'' end',t);
    execute format('alter table public.%I alter column provider set default ''manual''',t);
    execute format('alter table public.%I alter column provider set not null',t);
    execute format('alter table public.%I drop constraint %I',t,t||'_external_id_key');
    execute format('create unique index %I on public.%I(provider,external_id)',t||'_provider_external_id_key',t);
  end loop;
end $$;
alter table public.players add column photo text check(photo is null or photo ~ '^https://sports\.bzzoiro\.com/img/player/[0-9]+/');
alter table public.fixtures add column provider_season_id bigint;
alter table public.football_league_seasons add column provider_season_id bigint;
create unique index football_provider_season_key on public.football_league_seasons(league_id,provider_season_id);
alter table public.football_match_stats add column normalized jsonb;
alter table public.football_match_stats add column legacy_stats jsonb;
alter table public.football_sync_jobs add column provider text not null default 'api-football';
alter table public.football_sync_jobs add column next_offset integer check(next_offset >= 0);
alter table public.football_sync_jobs add column retry_after_seconds integer check(retry_after_seconds >= 0);
alter table public.player_season_summaries add column stats_scope text not null default 'season';
alter table public.player_season_summaries add column matches_imported integer;
create table public.football_event_sources (
  fixture_id text primary key references public.fixtures(id), detail jsonb not null,
  player_stats jsonb, lineups jsonb, incidents jsonb, legacy_stats jsonb,
  updated_at timestamptz not null default now()
);
alter table public.football_event_sources enable row level security;
revoke all on public.football_event_sources from anon,authenticated;
grant all on public.football_event_sources to service_role;
-- Drop/recreate dependent functions/views to accommodate new p.* columns without reordering a view.
drop function public.watched_player_catalog();
drop view public.player_catalog;
create view public.player_catalog with (security_invoker=true) as
select p.*,t.league_id,
  case when t.league_id is not null then array[t.league_id] else coalesce(ss.league_ids,'{}'::text[]) end as league_ids,
  concat_ws(' ',p.name,p.english,t.name,t.english,l.name,(select string_agg(l2.name,' ') from public.leagues l2 where l2.id=any(ss.league_ids))) as search_text,
  s.price,s.change_percent,s.performance,s.volume,coalesce(s.goals,ss.goals) as goals,coalesce(s.assists,ss.assists) as assists,coalesce(s.minutes,ss.minutes) as minutes,ss.season,
  s.updated_at as market_updated_at,ss.stats_scope,ss.matches_imported
from public.players p left join public.teams t on t.id=p.team_id left join public.leagues l on l.id=t.league_id
left join public.player_market_snapshots s on s.id=p.id left join public.player_season_summaries ss on ss.id=p.id;
grant select on public.player_catalog to anon,authenticated,service_role;
create function public.watched_player_catalog() returns setof public.player_catalog
language sql stable security invoker set search_path='' as $$
  select p.* from public.player_catalog p where exists(select 1 from public.watchlists w where w.player_id=p.id and w.user_id=(select auth.uid()))
$$;
revoke all on function public.watched_player_catalog() from public,anon;
grant execute on function public.watched_player_catalog() to authenticated;
-- Sources, normalized records and public summaries commit together under stable entity locks.
create function public.apply_bsd_batch(payload jsonb) returns integer
language plpgsql set search_path='' as $$
declare row jsonb; written integer:=0; played public.fixtures%rowtype; opponent_name text; affected text[];
begin
  if payload->>'provider' is distinct from 'bsd' then raise exception 'BSD provider required'; end if;
  -- A low-volume manual importer favors serialization over racing cross-fixture totals.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
  if exists(select 1 from jsonb_array_elements(coalesce(payload->'leagues','[]')||coalesce(payload->'teams','[]')||coalesce(payload->'players','[]')||coalesce(payload->'fixtures','[]')) v
    where v->>'id' is distinct from 'bsd-'||(v->>'external_id')) then raise exception 'Invalid BSD identity'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(key,0)) from (
    select distinct key from (
      select value->>'id' as key from jsonb_array_elements(coalesce(payload->'leagues','[]')||coalesce(payload->'teams','[]')||coalesce(payload->'players','[]')||coalesce(payload->'fixtures','[]'))
      union select value->>'player_id' from jsonb_array_elements(coalesce(payload->'matches','[]'))
      union select value->>'fixture_id' from jsonb_array_elements(coalesce(payload->'sources','[]'))
    ) keys order by key
  ) locks;
  select array_agg(distinct key) into affected from (
    select value->>'player_id' as key from jsonb_array_elements(coalesce(payload->'matches','[]'))
    union select ms.player_id from public.football_match_stats ms where ms.fixture_id in (
      select value->>'id' from jsonb_array_elements(coalesce(payload->'fixtures','[]'))
    )
  ) keys;
  for row in select value from jsonb_array_elements(coalesce(payload->'leagues','[]')) loop
    insert into public.leagues(id,provider,external_id,name) values(row->>'id','bsd',(row->>'external_id')::bigint,row->>'name')
    on conflict(id) do update set name=excluded.name,updated_at=now();written:=written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'coverage','[]')) loop
    if row->>'league_id' not like 'bsd-%' then raise exception 'Invalid BSD league'; end if;
    if exists(select 1 from public.football_league_seasons s where s.league_id=row->>'league_id' and s.season=(row->>'season')::integer and s.provider_season_id is distinct from (row->>'provider_season_id')::bigint) then raise exception 'Ambiguous season year'; end if;
    insert into public.football_league_seasons(league_id,season,provider_season_id,coverage)
    values(row->>'league_id',(row->>'season')::integer,(row->>'provider_season_id')::bigint,row->'coverage')
    on conflict(league_id,season) do update set coverage=excluded.coverage,updated_at=now();written:=written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'teams','[]')) loop
    insert into public.teams(id,provider,external_id,name,english,code,league_id)
    values(row->>'id','bsd',(row->>'external_id')::bigint,row->>'name',row->>'name',row->>'code',row->>'league_id')
    on conflict(id) do update set name=excluded.name,english=excluded.english,code=coalesce(excluded.code,public.teams.code),league_id=coalesce(excluded.league_id,public.teams.league_id),updated_at=now();written:=written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'players','[]')) loop
    insert into public.players(id,provider,external_id,name,english,short_name,team_id,position,shirt_number,country,birth_date,photo)
    values(row->>'id','bsd',(row->>'external_id')::bigint,row->>'name',row->>'name',row->>'short_name',row->>'team_id',row->>'position',(row->>'shirt_number')::integer,row->>'country',(row->>'birth_date')::date,row->>'photo')
    on conflict(id) do update set name=excluded.name,english=excluded.english,short_name=coalesce(excluded.short_name,public.players.short_name),
      team_id=case when row ? 'team_id' then excluded.team_id else public.players.team_id end,
      position=case when row ? 'team_id' then coalesce(excluded.position,public.players.position) else coalesce(public.players.position,excluded.position) end,
      shirt_number=case when row ? 'team_id' then coalesce(excluded.shirt_number,public.players.shirt_number) else coalesce(public.players.shirt_number,excluded.shirt_number) end,
      country=coalesce(excluded.country,public.players.country),birth_date=coalesce(excluded.birth_date,public.players.birth_date),photo=coalesce(excluded.photo,public.players.photo),updated_at=now();written:=written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'fixtures','[]')) loop
    if not exists(select 1 from public.football_league_seasons s where s.league_id=row->>'league_id' and s.season=(row->>'season')::integer and s.provider_season_id=(row->>'provider_season_id')::bigint) then raise exception 'Unknown BSD season'; end if;
    insert into public.fixtures(id,provider,external_id,league_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,season,provider_season_id)
    values(row->>'id','bsd',(row->>'external_id')::bigint,row->>'league_id',row->>'home_team_id',row->>'away_team_id',(row->>'starts_at')::timestamptz,row->>'status',(row->>'home_score')::integer,(row->>'away_score')::integer,(row->>'season')::integer,(row->>'provider_season_id')::bigint)
    on conflict(id) do update set league_id=excluded.league_id,home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,
      starts_at=excluded.starts_at,status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,season=excluded.season,provider_season_id=excluded.provider_season_id,updated_at=now();written:=written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'sources','[]')) loop
    if row->>'fixture_id' not like 'bsd-%' then raise exception 'Invalid BSD fixture'; end if;
    if row->>'fixture_id' is distinct from 'bsd-'||(row#>>'{detail,id}') then raise exception 'Invalid source identity'; end if;
    if row ? 'player_stats' and (
      (row#>>'{player_stats,event_id}')::bigint is distinct from (row#>>'{detail,id}')::bigint
      or (row#>>'{player_stats,count}')::integer is distinct from jsonb_array_length(row#>'{player_stats,player_stats}')
      or (row#>>'{player_stats,count}')::integer is distinct from (select count(*) from jsonb_array_elements(coalesce(payload->'matches','[]')) m where m->>'fixture_id'=row->>'fixture_id')
    ) then raise exception 'Incomplete match snapshot'; end if;
    insert into public.football_event_sources(fixture_id,detail,player_stats,lineups,incidents,legacy_stats)
    values(row->>'fixture_id',row->'detail',row->'player_stats',row->'lineups',row->'incidents',row->'legacy_stats')
    on conflict(fixture_id) do update set detail=excluded.detail,
      player_stats=coalesce(excluded.player_stats,public.football_event_sources.player_stats),lineups=coalesce(excluded.lineups,public.football_event_sources.lineups),
      incidents=coalesce(excluded.incidents,public.football_event_sources.incidents),legacy_stats=coalesce(excluded.legacy_stats,public.football_event_sources.legacy_stats),updated_at=now();written:=written+1;
  end loop;
  -- A complete nonempty player-stat snapshot can remove stale lines after a provider correction.
  -- An unavailable/empty feed never silently erases prior records.
  delete from public.player_match_records r where r.fixture_id in(select value->>'fixture_id' from jsonb_array_elements(coalesce(payload->'sources','[]')) where (value#>>'{player_stats,count}')::integer>0)
    and not exists(select 1 from jsonb_array_elements(coalesce(payload->'matches','[]')) m where m->>'fixture_id'=r.fixture_id and m->>'player_id'=r.player_id);
  delete from public.football_match_stats r where r.fixture_id in(select value->>'fixture_id' from jsonb_array_elements(coalesce(payload->'sources','[]')) where (value#>>'{player_stats,count}')::integer>0)
    and not exists(select 1 from jsonb_array_elements(coalesce(payload->'matches','[]')) m where m->>'fixture_id'=r.fixture_id and m->>'player_id'=r.player_id);
  for row in select value from jsonb_array_elements(coalesce(payload->'matches','[]')) loop
    select * into strict played from public.fixtures where id=row->>'fixture_id';
    if played.provider<>'bsd' or played.status not in ('FT','AET','PEN') or row->>'player_id' not like 'bsd-%' or row->>'team_id' not in(played.home_team_id,played.away_team_id) then raise exception 'Invalid BSD match membership'; end if;
    insert into public.football_match_stats(player_id,fixture_id,team_id,stats,legacy_stats,normalized)
    values(row->>'player_id',row->>'fixture_id',row->>'team_id',row->'stats',row->'legacy_stats',row->'normalized')
    on conflict(player_id,fixture_id) do update set team_id=excluded.team_id,stats=excluded.stats,legacy_stats=excluded.legacy_stats,normalized=excluded.normalized,updated_at=now();
    select name into strict opponent_name from public.teams where id=case when played.home_team_id=row->>'team_id' then played.away_team_id else played.home_team_id end;
    insert into public.player_match_records(player_id,fixture_id,played_at,opponent,minutes,goals,assists)
    values(row->>'player_id',played.id,played.starts_at,opponent_name,(row#>>'{normalized,values,minutes}')::integer,(row#>>'{normalized,values,goals}')::integer,(row#>>'{normalized,values,assists}')::integer)
    on conflict(player_id,fixture_id) do update set played_at=excluded.played_at,opponent=excluded.opponent,minutes=excluded.minutes,goals=excluded.goals,assists=excluded.assists;
    written:=written+1;
  end loop;
  -- Fixture-only score corrections also refresh public result/played_at without another stats import.
  update public.player_match_records r set played_at=f.starts_at,result=case when f.status not in ('FT','AET','PEN') or f.home_score is null or f.away_score is null then null
    when f.home_score=f.away_score then '무' when (f.home_score>f.away_score)=(f.home_team_id=ms.team_id) then '승' else '패' end
  from public.fixtures f,public.football_match_stats ms where r.fixture_id=f.id and ms.fixture_id=r.fixture_id and ms.player_id=r.player_id and r.player_id=any(affected);
  -- Totals cover only imported finished matches; never claim season-complete totals.
  delete from public.player_season_summaries ss where ss.id=any(affected) and ss.stats_scope='imported_matches';
  insert into public.player_season_summaries(id,season,goals,assists,minutes,league_ids,stats_scope,matches_imported)
  select ms.player_id,f.season,
    case when count(ms.normalized#>>'{values,goals}')=count(*) then sum((ms.normalized#>>'{values,goals}')::integer) end,
    case when count(ms.normalized#>>'{values,assists}')=count(*) then sum((ms.normalized#>>'{values,assists}')::integer) end,
    case when count(ms.normalized#>>'{values,minutes}')=count(*) then sum((ms.normalized#>>'{values,minutes}')::integer) end,
    array_agg(distinct f.league_id),'imported_matches',count(*)
  from public.football_match_stats ms join public.fixtures f on f.id=ms.fixture_id
  where ms.player_id=any(affected) and f.provider='bsd' and f.status in ('FT','AET','PEN')
    and f.season=(select max(f2.season) from public.football_match_stats ms2 join public.fixtures f2 on f2.id=ms2.fixture_id where ms2.player_id=ms.player_id and f2.status in ('FT','AET','PEN'))
  group by ms.player_id,f.season
  on conflict(id) do update set season=excluded.season,goals=excluded.goals,assists=excluded.assists,minutes=excluded.minutes,league_ids=excluded.league_ids,stats_scope=excluded.stats_scope,matches_imported=excluded.matches_imported,updated_at=now();
  return written;
end $$;
revoke all on function public.apply_bsd_batch(jsonb) from public,anon,authenticated;
grant execute on function public.apply_bsd_batch(jsonb) to service_role;
commit;
