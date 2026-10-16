-- Raw provider records are separate from KICK-X Performance and prices.
begin;
alter table public.fixtures add column season integer;
create table public.football_league_seasons (
  league_id text not null references public.leagues(id), season integer not null,
  coverage jsonb not null, updated_at timestamptz not null default now(),
  primary key(league_id, season)
);
create table public.football_player_seasons (
  player_id text not null references public.players(id), league_id text not null references public.leagues(id),
  team_id text not null references public.teams(id), season integer not null,
  stats jsonb not null, updated_at timestamptz not null default now(),
  primary key(player_id, league_id, team_id, season)
);
create table public.football_match_stats (
  player_id text not null references public.players(id), fixture_id text not null references public.fixtures(id),
  team_id text not null references public.teams(id), stats jsonb not null,
  updated_at timestamptz not null default now(), primary key(player_id, fixture_id)
);
create table public.football_sync_jobs (
  id uuid primary key default gen_random_uuid(), task text not null, target text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null check (status in ('running','completed','paused','failed')),
  requests integer not null default 0, rows_written integer not null default 0,
  next_page integer, error_code text
);
do $$ declare t text; begin
  foreach t in array array['football_league_seasons','football_player_seasons','football_match_stats','football_sync_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
create table public.player_season_summaries (
  id text primary key references public.players(id), season integer not null,
  goals integer, assists integer, minutes integer, league_ids text[] not null default '{}', updated_at timestamptz not null default now()
);
alter table public.player_season_summaries enable row level security;
revoke all on public.player_season_summaries from anon,authenticated;
grant select on public.player_season_summaries to anon,authenticated;
grant all on public.player_season_summaries to service_role;
create policy summary_public_read on public.player_season_summaries for select to anon,authenticated using (true);
-- No raw supplier JSON or operational jobs are exposed to the browser.
create view public.player_catalog with (security_invoker = true) as
select p.*, t.league_id,
  case when t.league_id is not null then array[t.league_id] else coalesce(ss.league_ids,'{}'::text[]) end as league_ids,
  concat_ws(' ',p.name,p.english,t.name,t.english,l.name,(select string_agg(l2.name,' ') from public.leagues l2 where l2.id=any(ss.league_ids))) as search_text,
  s.price,s.change_percent,s.performance,s.volume,coalesce(s.goals,ss.goals) as goals,coalesce(s.assists,ss.assists) as assists,coalesce(s.minutes,ss.minutes) as minutes,ss.season,
  s.updated_at as market_updated_at
from public.players p left join public.teams t on t.id=p.team_id
left join public.leagues l on l.id=t.league_id
left join public.player_market_snapshots s on s.id=p.id
left join public.player_season_summaries ss on ss.id=p.id;
create view public.fixture_catalog with (security_invoker = true) as
select f.*, concat_ws(' ',h.name,h.english,a.name,a.english) as search_text,
  case when upper(f.status) in ('1H','HT','2H','ET','BT','P','LIVE') then 'live'
       when upper(f.status) in ('NS','TBD') then 'scheduled'
       when upper(f.status) in ('FT','AET','PEN') then 'finished' else 'other' end as state
from public.fixtures f join public.teams h on h.id=f.home_team_id join public.teams a on a.id=f.away_team_id;
grant select on public.player_catalog, public.fixture_catalog to anon, authenticated, service_role;
create index player_records_player_time_idx on public.player_match_records(player_id, played_at desc);
create index fixtures_league_start_id_idx on public.fixtures(league_id, starts_at, id);
create index players_name_id_idx on public.players(name,id);
-- Serialize each response's dependent writes in one transaction. Only ingestion credentials can call it.
create function public.apply_football_batch(payload jsonb) returns integer
language plpgsql set search_path = '' as $$
declare row jsonb; written integer := 0; played public.fixtures%rowtype; opponent_name text;
begin
  -- Stable lock order prevents concurrent imports of the same player losing season totals.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(key,0)) from (
    select distinct value->>'id' as key from jsonb_array_elements(
      coalesce(payload->'leagues','[]') || coalesce(payload->'teams','[]') || coalesce(payload->'players','[]') || coalesce(payload->'fixtures','[]')
    ) order by key
  ) locks;
  for row in select value from jsonb_array_elements(coalesce(payload->'leagues','[]')) loop
    insert into public.leagues(id,external_id,name,updated_at)
    values(row->>'id',(row->>'external_id')::bigint,row->>'name',now())
    on conflict(id) do update set name=excluded.name,updated_at=excluded.updated_at;
    written := written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'coverage','[]')) loop
    insert into public.football_league_seasons(league_id,season,coverage) values(row->>'league_id',(row->>'season')::integer,row->'coverage')
    on conflict(league_id,season) do update set coverage=excluded.coverage,updated_at=now();
    written := written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'teams','[]')) loop
    insert into public.teams(id,external_id,name,english,code,league_id)
    values(row->>'id',(row->>'external_id')::bigint,row->>'name',row->>'name',row->>'code',row->>'league_id')
    on conflict(id) do update set name=excluded.name,english=excluded.english,code=coalesce(excluded.code,public.teams.code),league_id=coalesce(excluded.league_id,public.teams.league_id),updated_at=now();
    written := written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'players','[]')) loop
    insert into public.players(id,external_id,name,english,team_id,position,shirt_number,country,birth_date)
    values(row->>'id',(row->>'external_id')::bigint,row->>'name',row->>'name',row->>'team_id',row->>'position',(row->>'shirt_number')::integer,row->>'country',(row->>'birth_date')::date)
    on conflict(id) do update set name=excluded.name,english=excluded.english,
      team_id=case when row ? 'team_id' then excluded.team_id else public.players.team_id end,
      position=coalesce(excluded.position,public.players.position),shirt_number=coalesce(excluded.shirt_number,public.players.shirt_number),
      country=coalesce(excluded.country,public.players.country),birth_date=coalesce(excluded.birth_date,public.players.birth_date),updated_at=now();
    written := written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'seasons','[]')) loop
    insert into public.football_player_seasons(player_id,league_id,team_id,season,stats)
    values(row->>'player_id',row->>'league_id',row->>'team_id',(row->>'season')::integer,row->'stats')
    on conflict(player_id,league_id,team_id,season) do update set stats=excluded.stats,updated_at=now();
    written := written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'fixtures','[]')) loop
    insert into public.fixtures(id,external_id,league_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,season)
    values(row->>'id',(row->>'external_id')::bigint,row->>'league_id',row->>'home_team_id',row->>'away_team_id',(row->>'starts_at')::timestamptz,row->>'status',(row->>'home_score')::integer,(row->>'away_score')::integer,(row->>'season')::integer)
    on conflict(id) do update set league_id=excluded.league_id,home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,
      starts_at=excluded.starts_at,status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,season=excluded.season,updated_at=now();
    written := written+1;
  end loop;
  for row in select value from jsonb_array_elements(coalesce(payload->'matches','[]')) loop
    insert into public.football_match_stats(player_id,fixture_id,team_id,stats) values(row->>'player_id',row->>'fixture_id',row->>'team_id',row->'stats')
    on conflict(player_id,fixture_id) do update set team_id=excluded.team_id,stats=excluded.stats,updated_at=now();
    select * into strict played from public.fixtures where id=row->>'fixture_id';
    if row->>'team_id' not in (played.home_team_id,played.away_team_id) then raise exception 'Invalid fixture membership'; end if;
    select name into strict opponent_name from public.teams where id=case when played.home_team_id=row->>'team_id' then played.away_team_id else played.home_team_id end;
    insert into public.player_match_records(player_id,fixture_id,played_at,opponent,result,minutes,goals,assists)
    values(row->>'player_id',played.id,played.starts_at,opponent_name,
      case when played.status not in ('FT','AET','PEN') or played.home_score is null or played.away_score is null then null
           when played.home_score=played.away_score then '무'
           when (played.home_score>played.away_score)=(played.home_team_id=row->>'team_id') then '승' else '패' end,
      (row#>>'{stats,games,minutes}')::integer,(row#>>'{stats,goals,total}')::integer,(row#>>'{stats,goals,assists}')::integer)
    on conflict(player_id,fixture_id) do update set played_at=excluded.played_at,opponent=excluded.opponent,result=excluded.result,
      minutes=excluded.minutes,goals=excluded.goals,assists=excluded.assists;
    written := written+1;
  end loop;
  -- Recompute the latest imported season from per-team records, so retries never accumulate totals.
  insert into public.player_season_summaries(id,season,goals,assists,minutes,league_ids)
  select s.player_id,s.season,sum((s.stats#>>'{goals,total}')::integer),sum((s.stats#>>'{goals,assists}')::integer),sum((s.stats#>>'{games,minutes}')::integer),array_agg(distinct s.league_id)
  from public.football_player_seasons s
  where s.player_id in (select value->>'player_id' from jsonb_array_elements(coalesce(payload->'seasons','[]')))
    and s.season=(select max(s2.season) from public.football_player_seasons s2 where s2.player_id=s.player_id)
  group by s.player_id,s.season
  on conflict(id) do update set season=excluded.season,goals=excluded.goals,assists=excluded.assists,minutes=excluded.minutes,league_ids=excluded.league_ids,updated_at=now();
  return written;
end $$;
revoke all on function public.apply_football_batch(jsonb) from public,anon,authenticated;
grant execute on function public.apply_football_batch(jsonb) to service_role;
-- Authenticated invoker: own watchlists remain protected by RLS and auth.uid().
create function public.watched_player_catalog() returns setof public.player_catalog
language sql stable security invoker set search_path = '' as $$
  select p.* from public.player_catalog p where exists (
    select 1 from public.watchlists w where w.player_id=p.id and w.user_id=(select auth.uid())
  )
$$;
revoke all on function public.watched_player_catalog() from public, anon;
grant execute on function public.watched_player_catalog() to authenticated;
commit;
