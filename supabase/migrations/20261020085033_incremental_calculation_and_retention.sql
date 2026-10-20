-- Retain score evidence and trading history; transfer only changed match inputs.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
select public.kickx_economy_lock();
alter table public.performance_results add column source_hash text;
create index calculation_revisions_latest_idx on public.calculation_revisions(player_id,rule_version,created_at desc,id desc);

-- All functions below are private service operations. No client can mark a score cached.
create function public.kickx_calculation_sources(p_player text)
returns table(fixture_id text,source_hash text,cached boolean) language sql stable set search_path='' as $$
 select m.fixture_id,h.signature,coalesce(r.rule_version=p.version and r.source_hash=h.signature,false)
 from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id
 left join public.football_event_sources s on s.fixture_id=f.id
 left join public.performance_results r on r.player_id=m.player_id and r.fixture_id=m.fixture_id
 cross join public.kickx_policy p
 cross join lateral(select md5(jsonb_build_array(m.updated_at,f.updated_at,s.updated_at,p.version,p.club_competitions_enabled,'scoring-cache-v1')::text) as signature) h
 where m.player_id=p_player
$$;
create function public.kickx_calculation_token(p_player text) returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_array(p.version,p.pricing_reference_at,p.pricing_reference_season,p.club_competitions_enabled,
  (select coalesce(jsonb_agg(jsonb_build_array(fixture_id,source_hash) order by fixture_id),'[]') from public.kickx_calculation_sources(p_player)))::text)
 from public.kickx_policy p
$$;
create function public.kickx_calculation_input(p_player text,p_full boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare policy jsonb;records jsonb;total integer;begin
 select jsonb_build_object('version',version,'club_competitions_enabled',club_competitions_enabled,
  'pricing_reference_at',pricing_reference_at,'pricing_reference_season',pricing_reference_season) into policy from public.kickx_policy;
 select count(*) into total from public.football_match_stats where player_id=p_player;
 if total>10000 then raise exception 'CALCULATION_SCOPE_TOO_LARGE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('player_id',m.player_id,'fixture_id',m.fixture_id,'team_id',m.team_id,
  'stats',m.stats,'legacy_stats',m.legacy_stats,'updated_at',m.updated_at,
  'fixtures',jsonb_build_object('id',f.id,'starts_at',f.starts_at,'season',f.season,'status',f.status,
   'home_team_id',f.home_team_id,'away_team_id',f.away_team_id,'home_score',f.home_score,'away_score',f.away_score,'updated_at',f.updated_at,
   'football_event_sources',jsonb_build_object('detail',s.detail,'lineups',s.lineups,'incidents',s.incidents,'updated_at',s.updated_at)))
  order by f.starts_at,f.id),'[]') into records
 from public.kickx_calculation_sources(p_player) c join public.football_match_stats m on m.player_id=p_player and m.fixture_id=c.fixture_id
 join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id
 where p_full or not c.cached or policy->>'version'<>'form-v2';
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
 select pricing into old_plan from public.calculation_revisions where player_id=p_player and rule_version=p.version order by created_at desc,id desc limit 1;
 old_ready:=old_pricing_status='ready';
 -- Newly finished but unscorable matches cannot silently vanish from the last-five window.
 withheld:=exists(select 1 from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId' where f.status in('FT','AET','PEN') and f.starts_at>p.pricing_reference_at and x->>'status'='blocked' and (not p.club_competitions_enabled or f.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')))
 or (jsonb_array_length(plan->'steps')>0 and exists(select 1 from
  (select x from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId'
   where f.status in('FT','AET','PEN') and (x->>'status'<>'blocked' or not p.club_competitions_enabled or f.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) and x->>'status'<>'not-played' order by f.starts_at desc,f.id desc limit 5) candidates
  where x->>'status'='blocked'));
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

-- Reassemble unchanged scores inside PostgreSQL, never send their large JSON to a worker.
create function public.kickx_publish_calculation_delta(p_actor uuid,p_player text,p_token text,p_results jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare p public.kickx_policy%rowtype;expected jsonb;combined jsonb;answer jsonb;hash text;needed jsonb;supplied jsonb;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
 perform public.kickx_economy_lock();
 select * into strict p from public.kickx_policy;
 if p.version<>'form-v2' or jsonb_typeof(p_results) is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
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

-- Installation changes function definitions only; no existing rows are changed here.
do $$declare r record;begin
 for r in select oid::regprocedure as fn from pg_proc where pronamespace='public'::regnamespace and proname in(
  'kickx_calculation_sources','kickx_calculation_token','kickx_calculation_input','kickx_publish_calculation_delta') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.fn);
  execute format('grant execute on function %s to service_role',r.fn);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
