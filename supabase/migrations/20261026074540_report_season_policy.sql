-- Additive report policy. Prior-season preparation must finish before activation.
-- No wallet, cost basis or settled trade is repriced. Historical source bundles live in private Storage.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
select public.kickx_economy_lock();
alter table public.kickx_policy add column report_parameters jsonb not null default '{"lambda":5,"kappa":4,"beta":0.3,"s":1,"deviationLimit":1,"initialMin":10000,"initialMax":1000000,"minPrice":10000,"maxPrice":1000000,"maxUp":0.02,"maxDown":0.02,"lowerQuantile":0.05,"upperQuantile":0.95}';
alter table public.kickx_policy add column report_reference jsonb;

create index if not exists report_match_stats_fixture_idx on public.football_match_stats(fixture_id);
create function public.kickx_observed_fixture_minutes(p_fixture text) returns integer
language sql stable set search_path='' as $$
 with values_at as(select case when jsonb_typeof(stats->'minutes_played')='number' then (stats->>'minutes_played')::numeric end n
 from public.football_match_stats where fixture_id=p_fixture), ordered as(
 select n,lead(n) over(order by n desc) next_n from values_at where n between 90 and 180 and n=trunc(n))
 select coalesce(max(n) filter(where next_n>=n-2),90)::integer from ordered
$$;

-- Holdings are unlimited; only the saved 4-3-3 lineup has positional capacities.
create or replace function public.kickx_require_position_capacity(p_user uuid,p_player text) returns void
language plpgsql set search_path='' as $$begin
 if not exists(select 1 from public.players where id=p_player and position in('GK','DF','MF','FW')) then raise exception 'POSITION_UNAVAILABLE';end if;
 if exists(select 1 from public.holdings where user_id=p_user and player_id=p_player) then raise exception 'ALREADY_OWNED';end if;
end $$;
revoke all on function public.kickx_require_position_capacity(uuid,text) from public,anon,authenticated,service_role;

create function public.kickx_report_baseline(p_player text,p_position text,p_reference jsonb,p_parameters jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare g jsonb;o jsonb;n integer;mu numeric;b numeric;pct numeric;v bigint;season integer;begin
 g:=p_reference->'groups'->p_position;o:=p_reference->'players'->p_player->p_position;
 if p_reference->>'status' is distinct from 'ready' or g is null or jsonb_array_length(g->'baselines')=0 then return null;end if;
 n:=coalesce((o->>'n')::integer,0);mu:=(g->>'mean')::numeric;season:=(p_reference->>'season')::integer;
 b:=round((coalesce((o->>'sum')::numeric,0)+(p_parameters->>'lambda')::numeric*mu)/(n+(p_parameters->>'lambda')::numeric),10);
 select (count(*) filter(where value::numeric<b)+0.5*count(*) filter(where value::numeric=b))/count(*) into pct from jsonb_array_elements_text(g->'baselines');
 v:=round((p_parameters->>'initialMin')::numeric+((p_parameters->>'initialMax')::numeric-(p_parameters->>'initialMin')::numeric)*pct);
 return jsonb_build_object('source',case when n>0 then 'previous-season' else 'position-prior' end,'season',season,'gameCount',n,
 'meanScore',case when n>0 then (o->>'sum')::numeric/n else null end,'seedScore',b,'percentile',pct,'price',v,
 'lower',g->'lower','upper',g->'upper','referenceHash',p_reference->>'hash','fixtures',coalesce(o->'fixtures','[]'),
 'warnings',case when n>0 then '[]'::jsonb else '["PREVIOUS_SEASON_PLAYER_UNAVAILABLE"]'::jsonb end);
end $$;

create function public.kickx_report_plan(p_results jsonb,p_baseline jsonb,p_parameters jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb;steps jsonb:='[]';window_ids jsonb:='[]';v bigint;before_v bigint;b numeric;c numeric;d numeric;q numeric;total numeric:=0;
 n integer:=0;season integer;next_season integer;t double precision;lo bigint;hi bigint;begin
 if jsonb_typeof(p_results) is distinct from 'array' or p_baseline is null then raise exception 'INVALID_REPORT_BASELINE';end if;
 b:=(p_baseline->>'seedScore')::numeric;v:=(p_baseline->>'price')::bigint;
 for r in select value from jsonb_array_elements(p_results)
 where value->>'status' in('ready','provisional') and jsonb_typeof(value->'score')='number'
 and (value->>'minutes')::numeric>0 and (value->>'minutes')::numeric<=180
 and (value->>'season')::integer>(p_baseline->>'season')::integer
 order by (value->>'startedAt')::timestamptz,value->>'fixtureId' loop
  next_season:=(r->>'season')::integer;
  if season is distinct from next_season then season:=next_season;total:=0;n:=0;window_ids:='[]';end if;
  q:=greatest((p_baseline->>'lower')::numeric,least((p_baseline->>'upper')::numeric,(r->>'score')::numeric));
  total:=total+q;n:=n+1;window_ids:=window_ids||jsonb_build_array(r->>'fixtureId');
  c:=((p_parameters->>'kappa')::numeric*b+total)/((p_parameters->>'kappa')::numeric+n);
  d:=(c-b)/greatest(abs(b),(p_parameters->>'s')::numeric);
  t:=greatest((p_parameters->>'minPrice')::double precision,least((p_parameters->>'maxPrice')::double precision,
   (p_baseline->>'price')::double precision*exp((p_parameters->>'beta')::double precision*greatest(-(p_parameters->>'deviationLimit')::numeric,least((p_parameters->>'deviationLimit')::numeric,d))::double precision)));
  before_v:=v;lo:=greatest((p_parameters->>'minPrice')::bigint,ceil(before_v*(1-(p_parameters->>'maxDown')::numeric))::bigint);
  hi:=least((p_parameters->>'maxPrice')::bigint,floor(before_v*(1+(p_parameters->>'maxUp')::numeric))::bigint);
  v:=greatest(lo,least(hi,floor(t+0.5)::bigint));
  steps:=steps||jsonb_build_array(jsonb_build_object('fixtureId',r->>'fixtureId','playedAt',r->>'startedAt','priceBefore',before_v,'priceAfter',v,
   'targetPrice',floor(t+0.5)::bigint,'formScore',floor(c*1000000+0.5)/1000000,'changePercent',floor((v-before_v)*100.0/before_v*10000+0.5)/10000,
   'window',window_ids,'evidence',jsonb_build_object('season',season,'n',n,'rawScore',r->'score','boundedScore',q,'cumulativeSum',total,
    'cumulativeScore',c,'deviation',d,'target',t,'referenceHash',p_baseline->>'referenceHash')));
 end loop;
 return jsonb_build_object('version','report-v3','baseline',p_baseline,'price',v,'steps',steps);
end $$;

-- Small response and compare-and-swap; a resumed preparation cannot overwrite another runner.
create function public.kickx_save_report_reference(p_revision integer,p_reference jsonb) returns integer
language plpgsql set search_path='' as $$declare current_revision integer;next_revision integer;begin
 perform public.kickx_economy_lock();
 select coalesce((report_reference->>'revision')::integer,0) into current_revision from public.kickx_policy;
 if current_revision<>p_revision then raise exception 'REFERENCE_CHANGED';end if;
 if exists(select 1 from public.kickx_policy where version='report-v3') then raise exception 'REFERENCE_ALREADY_ACTIVE';end if;
 if jsonb_typeof(p_reference) is distinct from 'object' or pg_column_size(p_reference)>15000000 then raise exception 'INVALID_REFERENCE';end if;
 next_revision:=current_revision+1;
 update public.kickx_policy set report_reference=p_reference||jsonb_build_object('revision',next_revision) where id=true;
 return next_revision;
end $$;
create function public.kickx_activate_report_policy() returns integer language plpgsql set search_path='' as $$
declare p public.kickx_policy%rowtype;k text;r record;n integer:=0;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 select * into strict p from public.kickx_policy;
 if p.version='report-v3' then return 0;end if;
 if p.report_reference->>'status' is distinct from 'ready' or jsonb_array_length(p.report_reference->'archives')=0
 or (p.report_reference->>'completed')::integer<>(p.report_reference->>'fixtureCount')::integer then raise exception 'REFERENCE_NOT_READY';end if;
 foreach k in array array['GK','DF','MF','FW'] loop
  if coalesce(jsonb_array_length(p.report_reference->'groups'->k->'baselines'),0)=0 then raise exception 'REFERENCE_NOT_READY';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p.report_reference->'archives') a where not exists(
  select 1 from storage.objects o where o.bucket_id='kickx-calculation-archives' and o.name=a->>'path')) then raise exception 'REFERENCE_ARCHIVE_MISSING';end if;
 update public.kickx_policy set version='report-v3',club_competitions_enabled=false,pricing_reference_at=clock_timestamp(),pricing_reference_season=(report_reference->>'season')::integer+1 where id=true;
 perform public.kickx_report_refresh_summaries();
 delete from public.realtime_fixture_tasks t using public.fixtures f where f.id=t.fixture_id and f.league_id not in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6');
 update public.player_market_snapshots set pricing_status='pending' where id in(select id from public.players where public.kickx_market_eligible(id));
 for r in select id from public.players where public.kickx_market_eligible(id) loop perform public.kickx_queue_player(r.id);n:=n+1;end loop;
 insert into public.operation_audit(action,detail) values('policy.report-v3',jsonb_build_object('referenceHash',p.report_reference->>'hash','parameters',p.report_parameters));
 return n;
end $$;
create or replace function public.kickx_calculation_sources(p_player text)
returns table(fixture_id text,source_hash text,cached boolean) language sql stable set search_path='' as $$
 select m.fixture_id,h.signature,coalesce(r.rule_version=p.version and r.source_hash=h.signature,false)
 from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id
 left join public.football_event_sources s on s.fixture_id=f.id
 left join public.performance_results r on r.player_id=m.player_id and r.fixture_id=m.fixture_id
 cross join public.kickx_policy p
 cross join lateral(select md5(jsonb_build_array(m.updated_at,f.updated_at,s.updated_at,p.version,p.club_competitions_enabled,case when p.version='report-v3' then public.kickx_observed_fixture_minutes(f.id) end,'scoring-cache-v1')::text) as signature) h
 where m.player_id=p_player
$$;

create or replace function public.kickx_calculation_token(p_player text) returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_array(p.version,p.pricing_reference_at,p.pricing_reference_season,p.club_competitions_enabled,p.report_parameters,case when p.version='report-v3' then p.report_reference->>'hash' end,
  (select coalesce(jsonb_agg(jsonb_build_array(fixture_id,source_hash) order by fixture_id),'[]') from public.kickx_calculation_sources(p_player)))::text)
 from public.kickx_policy p
$$;

create or replace function public.kickx_calculation_input(p_player text,p_full boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare policy jsonb;records jsonb;total integer;begin
 select jsonb_build_object('version',version,'club_competitions_enabled',club_competitions_enabled,
  'pricing_reference_at',pricing_reference_at,'pricing_reference_season',pricing_reference_season,'report_parameters',report_parameters,'reportBaseline',case when version='report-v3' then public.kickx_report_baseline(p_player,(select position from public.players where id=p_player),report_reference,report_parameters) end) into policy from public.kickx_policy;
 select count(*) into total from public.football_match_stats where player_id=p_player;
 if total>10000 then raise exception 'CALCULATION_SCOPE_TOO_LARGE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('player_id',m.player_id,'fixture_id',m.fixture_id,'team_id',m.team_id,
  'stats',m.stats,'legacy_stats',m.legacy_stats,'updated_at',m.updated_at,
  'fixtures',jsonb_build_object('id',f.id,'starts_at',f.starts_at,'season',f.season,'status',f.status,
   'league_id',f.league_id,'durationMinutes',case when policy->>'version'='report-v3' then public.kickx_observed_fixture_minutes(f.id) else 90 end,'home_team_id',f.home_team_id,'away_team_id',f.away_team_id,'home_score',f.home_score,'away_score',f.away_score,'updated_at',f.updated_at,
   'football_event_sources',jsonb_build_object('detail',s.detail,'lineups',s.lineups,'incidents',s.incidents,'updated_at',s.updated_at)))
  order by f.starts_at,f.id),'[]') into records
 from public.kickx_calculation_sources(p_player) c join public.football_match_stats m on m.player_id=p_player and m.fixture_id=c.fixture_id
 join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id
 where p_full or not c.cached or policy->>'version' not in('form-v2','report-v3');
 return jsonb_build_object('policy',policy,'token',public.kickx_calculation_token(p_player),'records',records,'total',total,'reused',total-jsonb_array_length(records));
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
 if p.version not in('form-v2','report-v3') then raise exception 'RULE_VERSION_MISMATCH';end if;
 if (p.club_competitions_enabled or p.version='report-v3') and not public.kickx_market_eligible(p_player) then delete from public.calculation_queue where player_id=p_player;return jsonb_build_object('unchanged',true,'outsideMarketScope',true);end if;
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
 where x->>'status' in('ready','provisional') and ((f.status not in ('FT','AET','PEN') or (not p.club_competitions_enabled and f.status<>'FT')) or f.starts_at>clock_timestamp() or coalesce((m.stats->>'minutes_played')::numeric,0)<=0 or (m.stats->>'minutes_played')::numeric>case when p.club_competitions_enabled and (f.status='AET' or s.detail->'extra_time_score' is not null and s.detail->'extra_time_score'<>'null'::jsonb) then 120 when p.version='report-v3' then public.kickx_observed_fixture_minutes(f.id) else 90 end)) or exists(select 1 from jsonb_array_elements(p_results) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId' where x->>'status'='not-played' and (m.stats->>'minutes_played')::numeric is distinct from 0) then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from public.player_calculation_state where player_id=p_player and input_hash=p_hash and rule_version=p.version) and exists(select 1 from public.player_market_snapshots where id=p_player and pricing_status='ready') then return jsonb_build_object('unchanged',true);end if;
 -- A previously published score becoming incomplete must not erase asset value.
 if exists(select 1 from public.performance_results old where old.player_id=p_player and (p.version<>'report-v3' or old.rule_version=p.version and exists(select 1 from public.fixtures z where z.id=old.fixture_id and z.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'))) and old.status in('ready','provisional') and not exists(select 1 from jsonb_array_elements(p_results) x where x->>'fixtureId'=old.fixture_id and x->>'status' in('ready','provisional','not-played'))) then
  update public.player_market_snapshots set pricing_status='pending' where id=p_player;
  insert into public.operation_audit(actor,action,target,detail) values(p_actor,'calculation.withheld',p_player,'{"reason":"PREVIOUS_RESULT_NOW_INCOMPLETE"}');
  return jsonb_build_object('withheld',true,'reason','PREVIOUS_RESULT_NOW_INCOMPLETE');
 end if;
 select coalesce(jsonb_agg(x||jsonb_build_object('startedAt',f.starts_at,'season',f.season,'minutes',m.stats->'minutes_played') order by f.starts_at,f.id),'[]') into enriched
 from jsonb_array_elements(p_results) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId' join public.fixtures f on f.id=m.fixture_id;
 if p.version='report-v3' then
  plan:=public.kickx_report_plan((select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(enriched) x join public.fixtures f on f.id=x->>'fixtureId' where f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')),public.kickx_report_baseline(p_player,(select position from public.players where id=p_player),p.report_reference,p.report_parameters),p.report_parameters);
 else plan:=public.kickx_market_plan(enriched,p.pricing_reference_at,p.pricing_reference_season);end if;
 select price::bigint,pricing_status into old_value,old_pricing_status from public.player_market_snapshots where id=p_player;
 select pricing into old_plan from public.calculation_revisions where player_id=p_player and rule_version=p.version order by created_at desc,id desc limit 1;
 old_ready:=old_pricing_status='ready';
 -- Newly finished but unscorable matches cannot silently vanish from the last-five window.
 withheld:=case when p.version='report-v3' then exists(select 1 from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId' where f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and f.season>(p.report_reference->>'season')::integer and f.status='FT' and x->>'status'='blocked') else exists(select 1 from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId' where f.status in('FT','AET','PEN') and f.starts_at>p.pricing_reference_at and x->>'status'='blocked' and (not p.club_competitions_enabled or f.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')))
 or (jsonb_array_length(plan->'steps')>0 and exists(select 1 from
  (select x from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId'
   where f.status in('FT','AET','PEN') and (x->>'status'<>'blocked' or not p.club_competitions_enabled or f.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) and x->>'status'<>'not-played' order by f.starts_at desc,f.id desc limit 5) candidates
  where x->>'status'='blocked')) end;
 value_now:=case when withheld then coalesce(old_value,p.initial_price) else (plan->>'price')::bigint end;
 delete from public.performance_results where player_id=p_player and fixture_id not in(select value->>'fixtureId' from jsonb_array_elements(enriched));
 update public.player_match_records set performance=null,rule_version=null where player_id=p_player
  and (performance is not null or rule_version is not null)
  and not exists(select 1 from jsonb_array_elements(enriched) x where x->>'fixtureId'=fixture_id and x->>'status' in('ready','provisional'));
 for r in select value from jsonb_array_elements(enriched) loop
  insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,position,breakdown,warnings)
  values(p_player,r->>'fixtureId',(r->>'score')::numeric,r->>'status',p.version,p_hash,r->>'position',r->'breakdown',r->'warnings')
  on conflict(player_id,fixture_id) do update set score=excluded.score,status=excluded.status,rule_version=excluded.rule_version,
   input_hash=excluded.input_hash,position=excluded.position,breakdown=excluded.breakdown,warnings=excluded.warnings,
   calculated_at=clock_timestamp(),source_hash=null
  where (performance_results.score,performance_results.status,performance_results.rule_version,performance_results.position,performance_results.breakdown,performance_results.warnings)
   is distinct from (excluded.score,excluded.status,excluded.rule_version,excluded.position,excluded.breakdown,excluded.warnings);
  if r->>'status' in('ready','provisional') then latest:=(r->>'score')::numeric;update public.player_match_records set performance=latest,rule_version=p.version where player_id=p_player and fixture_id=r->>'fixtureId' and (performance,rule_version) is distinct from (latest,p.version);end if;
 end loop;
 if withheld then
  update public.player_market_snapshots set pricing_status='pending' where id=p_player;
  insert into public.operation_audit(actor,action,target,detail) values(p_actor,'calculation.withheld',p_player,'{"reason":"LATEST_RESULT_INCOMPLETE"}');
  return jsonb_build_object('withheld',true,'reason','LATEST_RESULT_INCOMPLETE','price',value_now);
 end if;
 insert into public.player_initial_values(player_id,rule_version,detail,input_hash) values(p_player,p.version,plan->'baseline',p_hash)
 on conflict(player_id) do update set rule_version=excluded.rule_version,detail=excluded.detail,input_hash=excluded.input_hash,updated_at=clock_timestamp() where (player_initial_values.rule_version,player_initial_values.detail) is distinct from (excluded.rule_version,excluded.detail);
 delete from public.player_price_results where player_id=p_player and fixture_id not in(select value->>'fixtureId' from jsonb_array_elements(plan->'steps'));
 for r in select value from jsonb_array_elements(plan->'steps') loop
  insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
  values(p_player,r->>'fixtureId',p.version,(r->>'playedAt')::timestamptz,(r->>'priceBefore')::bigint,(r->>'priceAfter')::bigint,(r->>'targetPrice')::bigint,(r->>'formScore')::numeric,(r->>'changePercent')::numeric,r->'window',(select input_hash from public.performance_results where player_id=p_player and fixture_id=r->>'fixtureId'))
  on conflict(player_id,fixture_id) do update set rule_version=excluded.rule_version,played_at=excluded.played_at,
   price_before=excluded.price_before,price_after=excluded.price_after,target_price=excluded.target_price,
   form_score=excluded.form_score,change_percent=excluded.change_percent,window_fixture_ids=excluded.window_fixture_ids,input_hash=excluded.input_hash
  where (player_price_results.rule_version,player_price_results.played_at,player_price_results.price_before,player_price_results.price_after,
   player_price_results.target_price,player_price_results.form_score,player_price_results.change_percent,player_price_results.window_fixture_ids,player_price_results.input_hash)
   is distinct from (excluded.rule_version,excluded.played_at,excluded.price_before,excluded.price_after,excluded.target_price,excluded.form_score,excluded.change_percent,excluded.window_fixture_ids,excluded.input_hash);
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

create or replace function public.kickx_publish_calculation_delta(p_actor uuid,p_player text,p_token text,p_results jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare p public.kickx_policy%rowtype;expected jsonb;combined jsonb;answer jsonb;hash text;needed jsonb;supplied jsonb;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
 perform public.kickx_economy_lock();
 select * into strict p from public.kickx_policy;
 if p.version not in('form-v2','report-v3') or jsonb_typeof(p_results) is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
 if p_token is distinct from public.kickx_calculation_token(p_player) then raise exception 'SOURCE_CHANGED';end if;
 select coalesce(jsonb_agg(fixture_id order by fixture_id),'[]') into needed from public.kickx_calculation_sources(p_player) where not cached;
 select coalesce(jsonb_agg(value->>'fixtureId' order by value->>'fixtureId'),'[]') into supplied from jsonb_array_elements(p_results);
 -- A concurrent calculation may already have cached the same source. Allow its
 -- identical result to be resubmitted, but never an omitted or foreign fixture.
 if exists(select 1 from jsonb_array_elements_text(needed) n where not exists(select 1 from jsonb_array_elements(p_results) x where x->>'fixtureId'=n))
 or exists(select 1 from jsonb_array_elements(p_results) x where not exists(select 1 from public.football_match_stats m where m.player_id=p_player and m.fixture_id=x->>'fixtureId'))
 or jsonb_array_length(supplied)<>(select count(distinct value->>'fixtureId') from jsonb_array_elements(p_results)) then raise exception 'INVALID_DELTA';end if;
 select coalesce(jsonb_agg(coalesce(x.value-'minutes',jsonb_build_object('fixtureId',m.fixture_id,'position',r.position,'score',r.score,
  'status',r.status,'breakdown',r.breakdown,'warnings',r.warnings,'ruleVersion',r.rule_version)||
  case when p.club_competitions_enabled then '{"scoringRevision":"club-competitions-v1"}'::jsonb else '{}'::jsonb end) order by f.starts_at,f.id),'[]') into combined
 from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id
 left join public.performance_results r on r.player_id=m.player_id and r.fixture_id=m.fixture_id
 left join jsonb_array_elements(p_results) x on x.value->>'fixtureId'=m.fixture_id where m.player_id=p_player;
 select coalesce(jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at) order by m.fixture_id),'[]') into expected
 from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id where m.player_id=p_player;
 -- Equal scores can still produce different prices after minutes/date/season corrections.
 -- Hash semantic pricing inputs as well as the score evidence, not poll timestamps.
 select md5(jsonb_build_array(p.version,p.pricing_reference_at,p.pricing_reference_season,p.club_competitions_enabled,
  coalesce(jsonb_agg(x||jsonb_build_object('startedAt',f.starts_at,'season',f.season,'minutes',m.stats->'minutes_played') order by f.starts_at,f.id),'[]'))::text)
 into hash from jsonb_array_elements(combined) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId'
 join public.fixtures f on f.id=m.fixture_id;
 answer:=public.kickx_publish_calculation(p_actor,p_player,hash,expected,combined);
 -- Incomplete corrections can be withheld before publication. Mark only evidence
 -- whose persisted score actually matches the newly computed result as reusable.
 update public.performance_results r set source_hash=c.source_hash
 from public.kickx_calculation_sources(p_player) c,jsonb_array_elements(p_results) x
 where r.player_id=p_player and r.fixture_id=c.fixture_id and r.fixture_id=x->>'fixtureId'
  and (r.score,r.status,r.rule_version,r.position,r.breakdown,r.warnings)
   is not distinct from ((x->>'score')::numeric,x->>'status',x->>'ruleVersion',x->>'position',x->'breakdown',x->'warnings')
  and r.source_hash is distinct from c.source_hash;
 return answer-'pricing';
end $$;


-- Scope applies to both quote/settlement clocks and batch UI clocks.
do $$declare name text;definition text;begin
 foreach name in array array['kickx_trade_window','kickx_trade_windows'] loop
  select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname=name;
  definition:=replace(definition,'where now()>=','where (f.league_id in(''bsd-1'',''bsd-3'',''bsd-4'',''bsd-5'',''bsd-6'') or not exists(select 1 from public.kickx_policy where version=''report-v3'')) and now()>=');
  definition:=replace(definition,'where (p.team_id in','where (f.league_id in(''bsd-1'',''bsd-3'',''bsd-4'',''bsd-5'',''bsd-6'') or not exists(select 1 from public.kickx_policy where version=''report-v3'')) and (p.team_id in');
  execute definition;
 end loop;
end $$;

-- Retain pending-price and current-market checks for the new version.
do $$declare name text;definition text;begin
 foreach name in array array['kickx_quote','kickx_trade','kickx_auto_initialize_market'] loop
  select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname=name;
  definition:=replace(definition,'version=''form-v2''','version in(''form-v2'',''report-v3'')');
  definition:=replace(definition,'where club_competitions_enabled)','where (club_competitions_enabled or version=''report-v3''))');
  definition:=replace(definition,'not p.club_competitions_enabled or public.kickx_market_eligible(id)','(not p.club_competitions_enabled and p.version<>''report-v3'') or public.kickx_market_eligible(id)');
  execute definition;
 end loop;
end $$;
do $$declare definition text;begin
 select pg_get_viewdef('public.fixture_catalog'::regclass,true) into definition;
 execute 'create or replace view public.fixture_catalog with(security_invoker=true) as select old.* from ('||rtrim(definition,';')||') old where old.league_id in (''bsd-1'',''bsd-3'',''bsd-4'',''bsd-5'',''bsd-6'') or not exists(select 1 from public.kickx_policy where version=''report-v3'')';
end $$;
create view public.scoped_player_match_records with(security_invoker=true) as
 select r.* from public.player_match_records r where not exists(select 1 from public.kickx_policy where version='report-v3')
 or exists(select 1 from public.fixtures f where f.id=r.fixture_id and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'));
create view public.scoped_performance_results with(security_invoker=true) as
 select r.*,f.starts_at as played_at from public.performance_results r join public.fixtures f on f.id=r.fixture_id
 where f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') or not exists(select 1 from public.kickx_policy where version='report-v3');
grant select on public.scoped_player_match_records,public.scoped_performance_results to anon,authenticated,service_role;

-- Retain existing public policy columns; never expose the large private reference through REST.
revoke select on public.kickx_policy from public,anon,authenticated;
do $$declare cols text;begin
 select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute
 where attrelid='public.kickx_policy'::regclass and attnum>0 and not attisdropped and attname<>'report_reference';
 execute 'grant select ('||cols||') on public.kickx_policy to anon,authenticated';
end $$;

-- Derived season counters use the same competition scope as prices and match histories.
create function public.kickx_report_refresh_summaries() returns void language plpgsql set search_path='' as $$begin
 delete from public.player_season_summaries ss where ss.stats_scope='imported_matches' and not exists(
 select 1 from public.football_match_stats ms join public.fixtures f on f.id=ms.fixture_id where ms.player_id=ss.id
 and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and f.status='FT');
 insert into public.player_season_summaries(id,season,goals,assists,minutes,league_ids,stats_scope,matches_imported)
 select ms.player_id,f.season,
 case when count(ms.normalized#>>'{values,goals}')=count(*) then sum((ms.normalized#>>'{values,goals}')::integer) end,
 case when count(ms.normalized#>>'{values,assists}')=count(*) then sum((ms.normalized#>>'{values,assists}')::integer) end,
 case when count(ms.normalized#>>'{values,minutes}')=count(*) then sum((ms.normalized#>>'{values,minutes}')::integer) end,
 array_agg(distinct f.league_id),'imported_matches',count(*)
 from public.football_match_stats ms join public.fixtures f on f.id=ms.fixture_id
 where f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and f.status='FT'
 and f.season=(select max(f2.season) from public.football_match_stats ms2 join public.fixtures f2 on f2.id=ms2.fixture_id
 where ms2.player_id=ms.player_id and f2.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and f2.status='FT')
 group by ms.player_id,f.season
 on conflict(id) do update set season=excluded.season,goals=excluded.goals,assists=excluded.assists,minutes=excluded.minutes,
 league_ids=excluded.league_ids,stats_scope=excluded.stats_scope,matches_imported=excluded.matches_imported,updated_at=clock_timestamp();
end $$;
do $$declare definition text;begin
 select pg_get_functiondef('public.apply_bsd_batch(jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'where ms.player_id=any(affected) and f.provider=',
 'where (f.league_id in(''bsd-1'',''bsd-3'',''bsd-4'',''bsd-5'',''bsd-6'') or not exists(select 1 from public.kickx_policy where version=''report-v3'')) and ms.player_id=any(affected) and f.provider=');
 definition:=replace(definition,'where ms2.player_id=ms.player_id and f2.status',
 'where (f2.league_id in(''bsd-1'',''bsd-3'',''bsd-4'',''bsd-5'',''bsd-6'') or not exists(select 1 from public.kickx_policy where version=''report-v3'')) and ms2.player_id=ms.player_id and f2.status');
 execute definition;
end $$;

-- Private references and preparation are never writable/readable through an anonymous client.
do $$declare r record;begin
 for r in select oid::regprocedure fn from pg_proc where pronamespace='public'::regnamespace and proname in(
 'kickx_report_refresh_summaries','kickx_observed_fixture_minutes','kickx_calculation_sources','kickx_report_baseline','kickx_report_plan','kickx_save_report_reference','kickx_activate_report_policy',
 'kickx_calculation_token','kickx_calculation_input','kickx_publish_calculation','kickx_publish_calculation_delta') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.fn);
  execute format('grant execute on function %s to service_role',r.fn);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
