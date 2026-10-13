-- Apply once after 202610090005 (the Korean catalog migration is independent).
-- Wallets, settled trades, costs and past snapshots are preserved. Price revaluation
-- is queued automatically; quotes wait for each player's first v2 publication.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
select public.kickx_economy_lock();
alter table public.kickx_policy add column pricing_reference_at timestamptz;
alter table public.kickx_policy add column pricing_reference_season integer;
alter table public.player_market_snapshots add column pricing_status text check(pricing_status in('pending','ready'));
alter table public.calculation_revisions add column pricing jsonb;
create table public.player_initial_values(
 player_id text primary key references public.players(id),rule_version text not null,
 detail jsonb not null,input_hash text not null,updated_at timestamptz not null default clock_timestamp()
);
create table public.player_price_results(
 player_id text not null references public.players(id),fixture_id text not null references public.fixtures(id),
 rule_version text not null,played_at timestamptz not null,price_before bigint not null,
 price_after bigint not null,target_price bigint not null,form_score numeric not null,
 change_percent numeric not null,window_fixture_ids jsonb not null,input_hash text not null,
 primary key(player_id,fixture_id)
);
create index player_price_results_time on public.player_price_results(player_id,played_at desc,fixture_id);
do $$declare t text;begin
 foreach t in array array['player_initial_values','player_price_results'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy pricing_public_read on public.%I for select to anon,authenticated using(true)',t);
 end loop;
end $$;

create or replace function public.kickx_queue_match_change() returns trigger language plpgsql security definer set search_path='' as $$
declare f text; m record;begin
 if TG_OP='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new;end if;
 if TG_TABLE_NAME='football_event_sources' then
  if TG_OP='UPDATE' and (new.player_stats,new.lineups,new.incidents,new.legacy_stats) is not distinct from (old.player_stats,old.lineups,old.incidents,old.legacy_stats) then return new;end if;
 end if;
 if TG_TABLE_NAME='football_match_stats' then
  if TG_OP<>'DELETE' then perform public.kickx_queue_player(new.player_id);end if;
  if TG_OP<>'INSERT' then perform public.kickx_queue_player(old.player_id);end if;
 elsif TG_TABLE_NAME='fixtures' then
  if TG_OP='UPDATE' and (new.status,new.starts_at,new.home_score,new.away_score,new.home_team_id,new.away_team_id,new.season) is not distinct from (old.status,old.starts_at,old.home_score,old.away_score,old.home_team_id,old.away_team_id,old.season) then return new;end if;
  f:=case when TG_OP='DELETE' then old.id else new.id end;
 else f:=case when TG_OP='DELETE' then old.fixture_id else new.fixture_id end;
 end if;
 if f is not null then for m in select player_id from public.football_match_stats where fixture_id=f loop perform public.kickx_queue_player(m.player_id);end loop;end if;
 return case when TG_OP='DELETE' then old else new end;
end $$;

-- Independent SQL implementation of engine/pricing.ts, verified by shared vectors.
create function public.kickx_market_plan(p_results jsonb,p_reference timestamptz,p_season integer default null)
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
   and (value->>'minutes')::numeric>0 and (value->>'minutes')::numeric<=90;
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
revoke all on function public.kickx_market_plan(jsonb,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.kickx_market_plan(jsonb,timestamptz,integer) to service_role;

alter function public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb) rename to kickx_publish_calculation_v1;
create function public.kickx_publish_calculation(p_actor uuid,p_player text,p_hash text,p_expected jsonb,p_results jsonb)
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
 if exists(select 1 from jsonb_array_elements(p_results) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId' join public.fixtures f on f.id=m.fixture_id
 where x->>'status' in('ready','provisional') and (f.status<>'FT' or f.starts_at>clock_timestamp() or coalesce((m.stats->>'minutes_played')::numeric,0)<=0 or (m.stats->>'minutes_played')::numeric>90)) or exists(select 1 from jsonb_array_elements(p_results) x join public.football_match_stats m on m.player_id=p_player and m.fixture_id=x->>'fixtureId' where x->>'status'='not-played' and (m.stats->>'minutes_played')::numeric is distinct from 0) then raise exception 'INVALID_INPUT';end if;
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
 withheld:=exists(select 1 from jsonb_array_elements(p_results) x join public.fixtures f on f.id=x->>'fixtureId' where f.status in('FT','AET','PEN') and f.starts_at>p.pricing_reference_at and x->>'status'='blocked');
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
revoke all on function public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb) to service_role;

alter function public.kickx_auto_initialize_market() rename to kickx_auto_initialize_market_v1;
create function public.kickx_auto_initialize_market() returns integer language plpgsql security definer set search_path='' as $$
declare p public.kickx_policy%rowtype;n integer;r record;begin
 perform public.kickx_economy_lock();select * into strict p from public.kickx_policy;
 if p.version='prototype-v1' then return public.kickx_auto_initialize_market_v1();end if;
 n:=0;
 for r in with added as(insert into public.player_market_snapshots(id,price,pricing_rule_version,pricing_status)
  select id,p.initial_price,p.version,'pending' from public.players where provider='bsd'
  on conflict(id) do update set price=excluded.price,pricing_rule_version=excluded.pricing_rule_version,pricing_status='pending' where public.player_market_snapshots.price is null returning id)
  select id from added loop perform public.kickx_queue_player(r.id);n:=n+1;end loop;
 return n;
end $$;
revoke all on function public.kickx_auto_initialize_market() from public,anon,authenticated;
grant execute on function public.kickx_auto_initialize_market() to service_role;

-- Prevent trading at an old/fallback price during first v2 recalculation.
alter function public.kickx_quote(text,text) rename to kickx_quote_base;
create function public.kickx_quote(p_player text,p_side text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();begin
 perform public.kickx_economy_lock();
 if exists(select 1 from public.kickx_policy where version='form-v2') and not exists(select 1 from public.player_market_snapshots where id=p_player and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 return public.kickx_quote_base(p_player,p_side);
end $$;
alter function public.kickx_trade(uuid,uuid) rename to kickx_trade_base;
create function public.kickx_trade(p_quote uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();target text;begin
 perform public.kickx_economy_lock();
 -- Preserve settled-trade idempotency even while a later revaluation is pending.
 if exists(select 1 from public.trades where user_id=u and (quote_id=p_quote or request_id=p_request)) then return public.kickx_trade_base(p_quote,p_request);end if;
 select player_id into target from public.trade_quotes where id=p_quote and user_id=u;
 if target is not null and exists(select 1 from public.kickx_policy where version='form-v2') and not exists(select 1 from public.player_market_snapshots where id=target and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 return public.kickx_trade_base(p_quote,p_request);
end $$;
revoke all on function public.kickx_quote_base(text,text),public.kickx_trade_base(uuid,uuid) from public,anon,authenticated;
revoke all on function public.kickx_quote(text,text),public.kickx_trade(uuid,uuid) from public,anon;
grant execute on function public.kickx_quote(text,text),public.kickx_trade(uuid,uuid) to authenticated;

update public.kickx_policy set version='form-v2',pricing_reference_at=clock_timestamp(),pricing_reference_season=(select max(season) from public.fixtures where starts_at<=clock_timestamp());
update public.player_market_snapshots set pricing_status='pending' where exists(select 1 from public.players p where p.id=player_market_snapshots.id and p.provider='bsd');
insert into public.calculation_queue(player_id) select id from public.players where provider='bsd'
on conflict(player_id) do update set revision=gen_random_uuid(),queued_at=now(),attempts=0,retry_at=now(),error_code=null;
insert into public.operation_audit(action,detail) values('policy.form-v2',jsonb_build_object('pointsUnit',2000,'weights',jsonb_build_array(5,4,3,2,1),'priorGames',5,'adjustment',0.4,'maxChange',0.08,'referenceAt',(select pricing_reference_at from public.kickx_policy)));
notify pgrst,'reload schema';
commit;
