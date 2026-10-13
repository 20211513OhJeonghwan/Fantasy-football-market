-- Apply once after 202610130001. Existing wallets, holdings and trades are preserved.
-- Adds club competitions, persistent backfills, extra-time scoring and fixture evidence.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
select public.kickx_economy_lock();
alter table public.kickx_policy add column club_competitions_enabled boolean not null default false;
alter table public.fixtures add column stage text;
alter table public.fixtures add column round_label text;
alter table public.fixtures add column penalties_home integer check(penalties_home>=0);
alter table public.fixtures add column penalties_away integer check(penalties_away>=0);
create table public.club_competition_backfills(league_id text not null references public.leagues(id),season_id bigint not null,completed_at timestamptz not null default now(),primary key(league_id,season_id));
create table public.club_collection_tasks(key text primary key,kind text not null,priority integer not null,payload jsonb not null,label text not null,completed boolean not null default false,updated_at timestamptz not null default now(),retry_at timestamptz not null default now(),error_code text);
alter table public.club_competition_backfills enable row level security;
alter table public.club_collection_tasks enable row level security;
revoke all on public.club_competition_backfills,public.club_collection_tasks from anon,authenticated;
grant all on public.club_competition_backfills,public.club_collection_tasks to service_role;
create function public.kickx_market_eligible(p_player text) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=p_player and t.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) or exists(select 1 from public.holdings where player_id=p_player)
$$;
create function public.kickx_club_seed(p_token uuid,p_tasks jsonb) returns void language plpgsql set search_path='' as $$
declare t jsonb;begin
 perform 1 from public.automation_state where singleton and lease=p_token and lease_until>now() for update;
 if not found then raise exception 'STALE_AUTOMATION_LEASE';end if;
 for t in select value from jsonb_array_elements(p_tasks) loop
  insert into public.club_collection_tasks(key,kind,priority,payload,label) values(t->>'key',t->>'kind',(t->>'priority')::integer,t->'payload',t->>'label')
  on conflict(key) do update set payload=excluded.payload,completed=false,retry_at=now(),error_code=null,updated_at=now()
  where public.club_collection_tasks.completed and
   ((t#>>'{payload,refresh}')::boolean is true or (public.club_collection_tasks.updated_at at time zone 'Asia/Seoul')::date < (now() at time zone 'Asia/Seoul')::date)
   and not exists(select 1 from public.club_collection_tasks other where not other.completed and other.key<>t->>'key' and coalesce(other.payload#>>'{context,league}',other.payload->>'league')=t#>>'{payload,league}');
 end loop;
end $$;
create function public.kickx_club_finish(p_token uuid,p_key text,p_outcome jsonb) returns integer language plpgsql set search_path='' as $$
declare j public.club_collection_tasks%rowtype;t jsonb;n integer;sid jsonb;fid jsonb;begin
 perform 1 from public.automation_state where singleton and lease=p_token and lease_until>now() for update;
 if not found then raise exception 'STALE_AUTOMATION_LEASE';end if;
 select * into strict j from public.club_collection_tasks where key=p_key and not completed for update;
 sid:=p_outcome->'completedSeason';
 if sid is not null then
  if sid->>'leagueId' is distinct from 'bsd-'||(j.payload#>>'{context,league}') or sid->>'seasonId' is distinct from j.payload#>>'{context,seasonId}' then raise exception 'INVALID_CLUB_COMPLETION';end if;
  if exists(select 1 from public.club_collection_tasks where not completed and key<>p_key and coalesce(payload#>>'{context,league}',payload->>'league')=j.payload#>>'{context,league}') then raise exception 'CLUB_BACKFILL_PENDING';end if;
  insert into public.club_competition_backfills(league_id,season_id) values(sid->>'leagueId',(sid->>'seasonId')::bigint) on conflict do nothing;
 end if;
 n:=public.kickx_apply_automatic_task(p_outcome);
 for t in select value from jsonb_array_elements(coalesce(p_outcome->'children','[]')) loop
  insert into public.club_collection_tasks(key,kind,priority,payload,label) values(t->>'key',t->>'kind',(t->>'priority')::integer,t->'payload',t->>'label')
  on conflict(key) do update set payload=excluded.payload,completed=false,updated_at=now(),retry_at=now(),error_code=null where public.club_collection_tasks.completed;
 end loop;
 update public.club_collection_tasks set completed=(p_outcome->>'done')::boolean,payload=case when (p_outcome->>'done')::boolean then payload else p_outcome->'payload' end,updated_at=now(),error_code=null,retry_at=now() where key=p_key;
 if j.kind='match' and (p_outcome->>'done')::boolean and exists(select 1 from public.fixtures where id='bsd-'||(j.payload->>'eventId')) then
  insert into public.automatic_fixture_checks(fixture_id,checked_at,retry_at) values('bsd-'||(j.payload->>'eventId'),now(),now()+case when p_outcome->>'warning' is not null then interval '15 minutes' else interval '6 hours' end) on conflict(fixture_id) do update set checked_at=excluded.checked_at,retry_at=excluded.retry_at;
 end if;
 return n;
end $$;
create function public.kickx_club_fail(p_token uuid,p_key text,p_error text) returns void language plpgsql set search_path='' as $$begin
 perform 1 from public.automation_state where singleton and lease=p_token and lease_until>now() for update;
 if not found then raise exception 'STALE_AUTOMATION_LEASE';end if;
 update public.club_collection_tasks set error_code=p_error,retry_at=now()+interval '15 minutes' where key=p_key and not completed;
end $$;

create or replace function public.apply_bsd_batch(payload jsonb) returns integer
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
    values(row->>'id','bsd',(row->>'external_id')::bigint,row->>'name',row->>'name',row->>'code',case when row->>'league_id' in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') then row->>'league_id' end)
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
    insert into public.fixtures(id,provider,external_id,league_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,season,provider_season_id,stage,round_label,penalties_home,penalties_away)
    values(row->>'id','bsd',(row->>'external_id')::bigint,row->>'league_id',row->>'home_team_id',row->>'away_team_id',(row->>'starts_at')::timestamptz,row->>'status',(row->>'home_score')::integer,(row->>'away_score')::integer,(row->>'season')::integer,(row->>'provider_season_id')::bigint,row->>'stage',row->>'round_label',(row->>'penalties_home')::integer,(row->>'penalties_away')::integer)
    on conflict(id) do update set league_id=excluded.league_id,home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,
      starts_at=excluded.starts_at,status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,season=excluded.season,provider_season_id=excluded.provider_season_id,stage=excluded.stage,round_label=excluded.round_label,penalties_home=excluded.penalties_home,penalties_away=excluded.penalties_away,updated_at=now();written:=written+1;
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
    when f.home_score=f.away_score and f.penalties_home is not null and f.penalties_away is not null and f.penalties_home<>f.penalties_away then case when (f.penalties_home>f.penalties_away)=(f.home_team_id=ms.team_id) then '승' else '패' end when f.home_score=f.away_score then '무' when (f.home_score>f.away_score)=(f.home_team_id=ms.team_id) then '승' else '패' end
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

create or replace function public.kickx_market_plan(p_results jsonb,p_reference timestamptz,p_season integer default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare played jsonb;historical jsonb;pool jsonb;window_rows jsonb:='[]';steps jsonb:='[]';
 r jsonb;current_season integer;prior_season integer;seed_season integer;n integer;
 mean_score numeric;seed_score numeric;initial_value bigint;value_now bigint;before_value bigint;
 target_value bigint;form_score numeric;limit_rate numeric;anchor timestamptz;source_name text;
 warnings jsonb:='[]';window_ids jsonb;baseline jsonb;
begin
 if p_reference is null or jsonb_typeof(p_results) is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
 select coalesce(jsonb_agg(value order by (value->>'startedAt')::timestamptz,value->>'fixtureId'),'[]') into played
 from jsonb_array_elements(p_results)
 where value->>'status' in('ready','provisional') and jsonb_typeof(value->'score')='number'
   and (value->>'minutes')::numeric>0 and (value->>'minutes')::numeric<=120;
 select coalesce(jsonb_agg(value),'[]') into historical from jsonb_array_elements(played) where (value->>'startedAt')::timestamptz<=p_reference;
 select coalesce(p_season,max((value->>'season')::integer)) into current_season from jsonb_array_elements(historical);
 select max((value->>'season')::integer) into prior_season from jsonb_array_elements(historical) where (value->>'season')::integer<current_season;
 select coalesce(prior_season,max((value->>'season')::integer)) into seed_season from jsonb_array_elements(historical);
 select coalesce(jsonb_agg(value),'[]'),count(*),avg((value->>'score')::numeric) into pool,n,mean_score from jsonb_array_elements(historical) where seed_season is null or (value->>'season')::integer=seed_season;
 seed_score:=(coalesce(mean_score,0)*n+50*5)/(n+5);
 initial_value:=round(greatest(10000,least(1000000,seed_score*2000)))::bigint;value_now:=initial_value;
 anchor:=case when prior_season is not null and n>0 then (pool->(n-1)->>'startedAt')::timestamptz else p_reference end;
 source_name:=case when prior_season is not null then 'previous-season' when n>0 then 'available-history' else 'neutral' end;
 if prior_season is null then warnings:=warnings||jsonb_build_array(case when n>0 then 'PREVIOUS_SEASON_UNAVAILABLE' else 'NO_USABLE_HISTORY' end);end if;
 if n<10 then warnings:=warnings||'"SMALL_SAMPLE_PRIOR"'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(pool) where value->>'status'='provisional') then warnings:=warnings||'"PROVISIONAL_HISTORY"'::jsonb;end if;
 baseline:=jsonb_build_object('referenceAt',p_reference,'anchorAt',anchor,'season',seed_season,'source',source_name,'gameCount',n,'meanScore',mean_score,'seedScore',seed_score,'price',initial_value,'fixtures',coalesce((select jsonb_agg(value->>'fixtureId') from jsonb_array_elements(pool)),'[]'),'warnings',warnings);
 for r in select value from jsonb_array_elements(played) loop
  window_rows:=jsonb_build_array(r)||window_rows;
  if jsonb_array_length(window_rows)>5 then window_rows:=window_rows-5;end if;
  if (r->>'startedAt')::timestamptz<=anchor then continue;end if;
  select sum((5-i)*coalesce((window_rows->i->>'score')::numeric,seed_score))/15 into form_score from generate_series(0,4) as g(i);
  target_value:=round(greatest(10000,least(1000000,form_score*2000)))::bigint;
  limit_rate:=0.08*least(1,(r->>'minutes')::numeric/60);before_value:=value_now;
  value_now:=round(greatest(10000,least(1000000,greatest(before_value*(1-limit_rate),least(before_value*(1+limit_rate),before_value+0.4*(target_value-before_value))))))::bigint;
  select jsonb_agg(value->>'fixtureId') into window_ids from jsonb_array_elements(window_rows);
  steps:=steps||jsonb_build_array(jsonb_build_object('fixtureId',r->>'fixtureId','playedAt',r->>'startedAt','priceBefore',before_value,'priceAfter',value_now,'targetPrice',target_value,'formScore',round(form_score,6),'changePercent',round((value_now-before_value)*100.0/before_value,4),'window',window_ids));
 end loop;
 return jsonb_build_object('version','form-v2','baseline',baseline,'price',value_now,'steps',steps);
end $$;

create or replace function public.kickx_publish_calculation(p_actor uuid,p_player text,p_hash text,p_expected jsonb,p_results jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.kickx_policy%rowtype;r jsonb;current_hash jsonb;enriched jsonb;plan jsonb;
 old_value bigint;value_now bigint;latest numeric;price_changed boolean;withheld boolean:=false;
 old_plan jsonb;old_ready boolean;old_pricing_status text;
begin
 if p_actor is not null and not exists(select 1 from public.user_roles where user_id=p_actor and role='admin') then raise exception 'ADMIN_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 select * into strict p from public.kickx_policy;
 if p.version='prototype-v1' then return public.kickx_publish_calculation_v1(p_actor,p_player,p_hash,p_expected,p_results);end if;
 if p.version<>'form-v2' then raise exception 'RULE_VERSION_MISMATCH';end if;
 if p.club_competitions_enabled and not public.kickx_market_eligible(p_player) then delete from public.calculation_queue where player_id=p_player;return jsonb_build_object('unchanged',true,'outsideMarketScope',true);end if;
 if not exists(select 1 from public.players where id=p_player and provider='bsd') then raise exception 'INVALID_TARGET';end if;
 if jsonb_typeof(p_results) is distinct from 'array' or p_hash is null or p_hash='' then raise exception 'INVALID_INPUT';end if;
 select coalesce(jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at) order by m.fixture_id),'[]') into current_hash from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id where m.player_id=p_player;
 select coalesce(jsonb_agg(jsonb_build_object('fixture',e.fixture,'statsAt',e."statsAt",'sourceAt',e."sourceAt",'fixtureAt',e."fixtureAt") order by e.fixture),'[]') into p_expected from jsonb_to_recordset(p_expected) as e(fixture text,"statsAt" timestamptz,"sourceAt" timestamptz,"fixtureAt" timestamptz);
 if current_hash is distinct from p_expected then raise exception 'SOURCE_CHANGED';end if;
 if jsonb_array_length(p_results)<>jsonb_array_length(current_hash) or
 (select count(distinct value->>'fixtureId') from jsonb_array_elements(p_results))<>jsonb_array_length(p_results) or
 exists(select 1 from jsonb_array_elements(p_results) x where
  not exists(select 1 from public.football_match_stats m where m.player_id=p_player and m.fixture_id=x->>'fixtureId') or
  x->>'ruleVersion' is distinct from p.version or x->>'status' is null or x->>'status' not in('ready','provisional','blocked','not-played') or
  jsonb_typeof(x->'breakdown') is distinct from 'array' or jsonb_typeof(x->'warnings') is distinct from 'array' or
  (x->>'status' in('ready','provisional') and (jsonb_typeof(x->'score') is distinct from 'number' or abs((x->>'score')::numeric)>10000)) or
  (x->>'status' in('blocked','not-played') and x->>'score' is not null)) then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from jsonb_array_elements(p_results) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId' join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id
 where x->>'status' in('ready','provisional') and ((f.status not in ('FT','AET','PEN') or (not p.club_competitions_enabled and f.status<>'FT')) or f.starts_at>clock_timestamp() or coalesce((m.stats->>'minutes_played')::numeric,0)<=0 or (m.stats->>'minutes_played')::numeric>case when p.club_competitions_enabled and (f.status='AET' or s.detail->'extra_time_score' is not null and s.detail->'extra_time_score'<>'null'::jsonb) then 120 else 90 end)) or exists(select 1 from jsonb_array_elements(p_results) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId' where x->>'status'='not-played' and (m.stats->>'minutes_played')::numeric is distinct from 0) then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from public.player_calculation_state where player_id=p_player and input_hash=p_hash and rule_version=p.version) and exists(select 1 from public.player_market_snapshots where id=p_player and pricing_status='ready') then return jsonb_build_object('unchanged',true);end if;
 -- A previously published score becoming incomplete must not erase asset value.
 if exists(select 1 from public.performance_results old where old.player_id=p_player and old.status in('ready','provisional') and not exists(select 1 from jsonb_array_elements(p_results) x where x->>'fixtureId'=old.fixture_id and x->>'status' in('ready','provisional','not-played'))) then
  update public.player_market_snapshots set pricing_status='pending' where id=p_player;
  insert into public.operation_audit(actor,action,target,detail) values(p_actor,'calculation.withheld',p_player,'{"reason":"PREVIOUS_RESULT_NOW_INCOMPLETE"}');
  return jsonb_build_object('withheld',true,'reason','PREVIOUS_RESULT_NOW_INCOMPLETE');
 end if;
 select coalesce(jsonb_agg(x||jsonb_build_object('startedAt',f.starts_at,'season',f.season,'minutes',m.stats->'minutes_played') order by f.starts_at,f.id),'[]') into enriched
 from jsonb_array_elements(p_results) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId' join public.fixtures f on f.id=m.fixture_id;
 plan:=public.kickx_market_plan(enriched,p.pricing_reference_at,p.pricing_reference_season);
 select price::bigint,pricing_status into old_value,old_pricing_status from public.player_market_snapshots where id=p_player;
 select pricing into old_plan from public.calculation_revisions where player_id=p_player and rule_version=p.version order by created_at desc limit 1;
 old_ready:=old_pricing_status='ready';
 -- Newly finished but unscorable matches cannot silently vanish from the last-five window.
 withheld:=exists(select 1 from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId' where f.status in('FT','AET','PEN') and f.starts_at>p.pricing_reference_at and x->>'status'='blocked' and (not p.club_competitions_enabled or f.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')))
 or (jsonb_array_length(plan->'steps')>0 and exists(select 1 from
  (select x from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId'
   where f.status in('FT','AET','PEN') and (x->>'status'<>'blocked' or not p.club_competitions_enabled or f.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) and x->>'status'<>'not-played' order by f.starts_at desc,f.id desc limit 5) candidates
  where x->>'status'='blocked'));
 value_now:=case when withheld then coalesce(old_value,p.initial_price) else (plan->>'price')::bigint end;
 delete from public.performance_results where player_id=p_player;
 update public.player_match_records set performance=null,rule_version=null where player_id=p_player;
 for r in select value from jsonb_array_elements(enriched) loop
  insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,position,breakdown,warnings)
  values(p_player,r->>'fixtureId',(r->>'score')::numeric,r->>'status',p.version,p_hash,r->>'position',r->'breakdown',r->'warnings');
  if r->>'status' in('ready','provisional') then latest:=(r->>'score')::numeric;update public.player_match_records set performance=latest,rule_version=p.version where player_id=p_player and fixture_id=r->>'fixtureId';end if;
 end loop;
 if withheld then
  update public.player_market_snapshots set pricing_status='pending' where id=p_player;
  insert into public.operation_audit(actor,action,target,detail) values(p_actor,'calculation.withheld',p_player,'{"reason":"LATEST_RESULT_INCOMPLETE"}');
  return jsonb_build_object('withheld',true,'reason','LATEST_RESULT_INCOMPLETE','price',value_now);
 end if;
 insert into public.player_initial_values(player_id,rule_version,detail,input_hash) values(p_player,p.version,plan->'baseline',p_hash)
 on conflict(player_id) do update set rule_version=excluded.rule_version,detail=excluded.detail,input_hash=excluded.input_hash,updated_at=clock_timestamp();
 delete from public.player_price_results where player_id=p_player;
 for r in select value from jsonb_array_elements(plan->'steps') loop
  insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
  values(p_player,r->>'fixtureId',p.version,(r->>'playedAt')::timestamptz,(r->>'priceBefore')::bigint,(r->>'priceAfter')::bigint,(r->>'targetPrice')::bigint,(r->>'formScore')::numeric,(r->>'changePercent')::numeric,r->'window',p_hash);
 end loop;
 insert into public.calculation_revisions(player_id,input_hash,rule_version,previous_price,new_price,results,pricing,actor) values(p_player,p_hash,p.version,old_value,value_now,p_results,plan,p_actor);
 insert into public.player_calculation_state(player_id,input_hash,rule_version) values(p_player,p_hash,p.version) on conflict(player_id) do update set input_hash=excluded.input_hash,rule_version=excluded.rule_version,calculated_at=clock_timestamp();
 price_changed:=old_value is distinct from value_now or (old_plan is null and not coalesce(old_ready,false));
 insert into public.player_market_snapshots(id,price,change_percent,performance,performance_rule_version,pricing_rule_version,volume,pricing_status)
 values(p_player,value_now,case when old_value>0 then round((value_now-old_value)*100.0/old_value,4) else null end,latest,case when latest is not null then p.version end,p.version,(select count(*) from public.trades where player_id=p_player),'ready')
 on conflict(id) do update set price=excluded.price,volume=excluded.volume,
 change_percent=case when price_changed then excluded.change_percent else public.player_market_snapshots.change_percent end,
 performance=excluded.performance,performance_rule_version=excluded.performance_rule_version,pricing_rule_version=excluded.pricing_rule_version,pricing_status='ready',
 updated_at=case when price_changed then clock_timestamp() else public.player_market_snapshots.updated_at end;
 -- A DNP, warning-only update or unchanged source never creates fictitious price moves.
 if price_changed then
  insert into public.price_history(player_id,recorded_at,value,rule_version) values(p_player,clock_timestamp(),value_now,p.version);
  insert into public.asset_snapshots(user_id,value) select user_id,public.kickx_assets(user_id) from public.holdings where player_id=p_player;
 end if;
 insert into public.operation_audit(actor,action,target,detail) values(p_actor,'calculation.publish',p_player,jsonb_build_object('price',value_now,'results',jsonb_array_length(p_results),'baseline',plan->'baseline','lastStep',plan->'steps'->-1,'correction',old_plan is not null));
 return jsonb_build_object('unchanged',false,'price',value_now,'performance',latest,'initialPrice',plan#>'{baseline,price}','pricing',plan);
end $$;

create or replace function public.kickx_auto_initialize_market() returns integer language plpgsql security definer set search_path='' as $$
declare p public.kickx_policy%rowtype;r record;n integer:=0;begin
 perform public.kickx_economy_lock();select * into strict p from public.kickx_policy;
 if p.version='prototype-v1' then return public.kickx_auto_initialize_market_v1();end if;
 for r in with added as(insert into public.player_market_snapshots(id,price,pricing_rule_version,pricing_status)
  select id,p.initial_price,p.version,'pending' from public.players where provider='bsd' and (not p.club_competitions_enabled or public.kickx_market_eligible(id))
  on conflict(id) do update set price=excluded.price,pricing_rule_version=excluded.pricing_rule_version,pricing_status='pending' where public.player_market_snapshots.price is null returning id)
  select id from added loop perform public.kickx_queue_player(r.id);n:=n+1;end loop;
 return n;
end $$;
-- Preserve all public view columns and append display metadata. Source JSON remains private.
do $$declare definition text;begin
 select pg_get_viewdef('public.fixture_catalog'::regclass,true) into definition;
 execute 'create or replace view public.fixture_catalog with(security_invoker=true) as select old.*,f.stage,f.round_label,f.penalties_home,f.penalties_away,
 case when f.status not in (''FT'',''AET'',''PEN'') then null
 when exists(select 1 from public.performance_results r where r.fixture_id=f.id and r.status=''blocked'') then
  case when exists(select 1 from public.performance_results r where r.fixture_id=f.id and r.status in (''ready'',''provisional'')) then ''partial'' else ''withheld'' end
 when exists(select 1 from public.performance_results r join public.player_market_snapshots m on m.id=r.player_id where r.fixture_id=f.id and m.pricing_status=''pending'') then ''pending''
 when exists(select 1 from public.performance_results r where r.fixture_id=f.id) then ''reflected'' else ''pending'' end as reflection_status
 from ('||rtrim(definition,';')||') old join public.fixtures f on f.id=old.id';
end $$;
-- Apply the same market-scope check inside quote issuance, not just in the UI.
create or replace function public.kickx_quote(p_player text,p_side text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();begin
 perform public.kickx_economy_lock();
 if p_side='buy' and exists(select 1 from public.kickx_policy where club_competitions_enabled) and not exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=p_player and t.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) then raise exception 'OUTSIDE_MARKET_SCOPE';end if;
 if exists(select 1 from public.kickx_policy where version='form-v2') and not exists(select 1 from public.player_market_snapshots where id=p_player and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 return public.kickx_quote_base(p_player,p_side);
end $$;
do $$declare r record;begin
 for r in select oid::regprocedure fn from pg_proc where pronamespace='public'::regnamespace and proname in ('kickx_market_eligible','kickx_club_seed','kickx_club_finish','kickx_club_fail') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.fn);execute format('grant execute on function %s to service_role',r.fn);
 end loop;
end $$;
create or replace function public.kickx_queue_player(p_player text) returns void language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.kickx_policy where club_competitions_enabled) and not public.kickx_market_eligible(p_player) then return;end if;
 insert into public.calculation_queue(player_id) values(p_player) on conflict(player_id) do update set revision=gen_random_uuid(),queued_at=now(),retry_at=now(),error_code=null;
end $$;
create function public.kickx_cup_queue_change() returns trigger language plpgsql security definer set search_path='' as $$
declare fid text;r record;begin
 if TG_TABLE_NAME='players' then
  if new.team_id is distinct from old.team_id then perform public.kickx_queue_player(new.id);end if;return new;
 elsif TG_TABLE_NAME='fixtures' then
  if (new.penalties_home,new.penalties_away) is not distinct from (old.penalties_home,old.penalties_away) then return new;end if;fid:=new.id;
 else
  if (new.detail->'extra_time_score',new.detail->'penalty_shootout') is not distinct from (old.detail->'extra_time_score',old.detail->'penalty_shootout') then return new;end if;fid:=new.fixture_id;
 end if;
 for r in select player_id from public.football_match_stats where fixture_id=fid loop perform public.kickx_queue_player(r.player_id);end loop;
 return new;
end $$;
create trigger club_player_membership after update of team_id on public.players for each row execute function public.kickx_cup_queue_change();
create trigger club_fixture_result after update of penalties_home,penalties_away on public.fixtures for each row execute function public.kickx_cup_queue_change();
create trigger club_source_result after update of detail on public.football_event_sources for each row execute function public.kickx_cup_queue_change();
revoke all on function public.kickx_cup_queue_change() from public,anon,authenticated;
grant execute on function public.kickx_cup_queue_change() to service_role;
create or replace function public.kickx_trade(p_quote uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();target text;side text;begin
 perform public.kickx_economy_lock();
 if exists(select 1 from public.trades where user_id=u and (quote_id=p_quote or request_id=p_request)) then return public.kickx_trade_base(p_quote,p_request);end if;
 select player_id,trade_quotes.side into target,side from public.trade_quotes where id=p_quote and user_id=u;
 if side='buy' and exists(select 1 from public.kickx_policy where club_competitions_enabled) and not exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=target and t.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) then raise exception 'OUTSIDE_MARKET_SCOPE';end if;
 if target is not null and exists(select 1 from public.kickx_policy where version='form-v2') and not exists(select 1 from public.player_market_snapshots where id=target and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 return public.kickx_trade_base(p_quote,p_request);
end $$;
update public.kickx_policy set club_competitions_enabled=true;
insert into public.calculation_queue(player_id) select p.id from public.players p where p.provider='bsd' and public.kickx_market_eligible(p.id)
on conflict(player_id) do update set revision=gen_random_uuid(),queued_at=now(),retry_at=now(),error_code=null;
insert into public.operation_audit(action,detail) values('policy.club-competitions',jsonb_build_object('scoringRevision','club-competitions-v1','maximumMinutes',120));
notify pgrst,'reload schema';
commit;
