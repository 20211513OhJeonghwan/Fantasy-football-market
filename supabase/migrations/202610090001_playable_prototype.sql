-- Prototype policy v1; additive only. No operating data or demo rows are seeded.
begin;
create table public.kickx_policy (
 id boolean primary key default true check(id), version text not null,
 initial_points bigint not null check(initial_points>0), initial_price bigint not null check(initial_price>0),
 sell_fee_bps integer not null check(sell_fee_bps between 0 and 10000),
 min_price bigint not null, max_price bigint not null, quote_seconds integer not null
);
insert into public.kickx_policy values(true,'prototype-v1',1300000,100000,200,10000,1000000,60);
create table public.wallets(user_id uuid primary key references auth.users(id),balance bigint not null check(balance>=0),initial_points bigint not null,created_at timestamptz not null default clock_timestamp());
create table public.trade_quotes(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),player_id text not null references public.players(id),side text not null check(side in('buy','sell')),price bigint not null,fee bigint not null,net bigint not null,market_at timestamptz not null,policy_version text not null,created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null);
create table public.trades(sequence bigint generated always as identity unique,id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),player_id text not null references public.players(id),player_name text not null,side text not null check(side in('buy','sell')),price bigint not null check(price>0),fee bigint not null check(fee>=0),net bigint not null check(net>=0),quote_id uuid not null unique references public.trade_quotes(id),request_id uuid not null,policy_version text not null,created_at timestamptz not null default clock_timestamp(),unique(user_id,request_id));
create index trades_user_time on public.trades(user_id,created_at desc);
create table public.holdings(user_id uuid not null references auth.users(id),player_id text not null references public.players(id),cost bigint not null check(cost>0),trade_id uuid not null references public.trades(id),acquired_at timestamptz not null default clock_timestamp(),primary key(user_id,player_id));
create table public.wallet_ledger(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),kind text not null check(kind in('initial','buy','sell')),delta bigint not null,balance_after bigint not null check(balance_after>=0),trade_id uuid unique references public.trades(id),created_at timestamptz not null default clock_timestamp());
create unique index wallet_one_initial on public.wallet_ledger(user_id) where kind='initial';
create index ledger_user_time on public.wallet_ledger(user_id,created_at);
create table public.squads(user_id uuid primary key references auth.users(id),formation_id text not null,slots text[] not null check(cardinality(slots)=11),revision integer not null default 1,updated_at timestamptz not null default clock_timestamp());
create table public.asset_snapshots(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),value bigint not null,recorded_at timestamptz not null default clock_timestamp());
create index asset_user_time on public.asset_snapshots(user_id,recorded_at desc);
create table public.ranking_snapshots(id uuid primary key default gen_random_uuid(),period text not null check(period in('weekly','monthly')),starts_at timestamptz not null,ends_at timestamptz not null,calculated_at timestamptz not null default clock_timestamp(),rows jsonb not null);
create table public.operation_audit(id uuid primary key default gen_random_uuid(),actor uuid references auth.users(id),action text not null,target text,detail jsonb not null default '{}',created_at timestamptz not null default clock_timestamp());
create table public.performance_results(player_id text not null references public.players(id),fixture_id text not null references public.fixtures(id),score numeric,status text not null check(status in('ready','provisional','blocked','not-played')),rule_version text not null,input_hash text not null,position text,breakdown jsonb not null,warnings jsonb not null,calculated_at timestamptz not null default clock_timestamp(),primary key(player_id,fixture_id));
create table public.calculation_revisions(id uuid primary key default gen_random_uuid(),player_id text not null references public.players(id),input_hash text not null,rule_version text not null,previous_price bigint,new_price bigint not null,results jsonb not null,actor uuid references auth.users(id),created_at timestamptz not null default clock_timestamp());
create table public.player_calculation_state(player_id text primary key references public.players(id),input_hash text not null,rule_version text not null,calculated_at timestamptz not null default clock_timestamp());

create function public.kickx_require_member() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if not exists(select 1 from public.profiles where id=u) then raise exception 'PROFILE_REQUIRED'; end if;
 return u;
end $$;
create function public.kickx_require_admin() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); begin
 if u is null or not exists(select 1 from public.user_roles where user_id=u and role='admin') then raise exception 'ADMIN_REQUIRED'; end if;
 return u;
end $$;
-- Every economic mutation takes this same lock, before any row locks. This is deliberately
-- serialized for the small capstone workload, including price publication and snapshots.
create function public.kickx_economy_lock() returns void language sql set search_path='' as $$select pg_catalog.pg_advisory_xact_lock(90261009)$$;
create function public.kickx_open_wallet() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member(); p public.kickx_policy%rowtype; w public.wallets%rowtype; begin
 perform public.kickx_economy_lock(); select * into strict p from public.kickx_policy;
 insert into public.wallets(user_id,balance,initial_points) values(u,p.initial_points,p.initial_points) on conflict do nothing;
 if found then
  insert into public.wallet_ledger(user_id,kind,delta,balance_after) values(u,'initial',p.initial_points,p.initial_points);
  insert into public.asset_snapshots(user_id,value) values(u,p.initial_points);
 end if;
 select * into strict w from public.wallets where user_id=u;
 return to_jsonb(w);
end $$;
create function public.kickx_assets(u uuid) returns bigint language sql stable security definer set search_path='' as $$
 select w.balance+coalesce((select sum(s.price)::bigint from public.holdings h join public.player_market_snapshots s on s.id=h.player_id where h.user_id=u),0) from public.wallets w where w.user_id=u
$$;
create function public.kickx_quote(p_player text,p_side text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member(); p public.kickx_policy%rowtype; s public.player_market_snapshots%rowtype; w public.wallets%rowtype; q public.trade_quotes%rowtype; fee bigint; begin
 perform public.kickx_open_wallet(); select * into strict p from public.kickx_policy;
 if p_side not in('buy','sell') or p_side is null then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.player_market_snapshots where id=p_player;
 if s.price is null or s.price<=0 then raise exception 'PRICE_UNAVAILABLE'; end if;
 if exists(select 1 from public.players where id=p_player and trade_status is not null) then raise exception 'TRADING_PAUSED'; end if;
 if p_side='buy' and exists(select 1 from public.holdings where user_id=u and player_id=p_player) then raise exception 'ALREADY_OWNED'; end if;
 if p_side='sell' and not exists(select 1 from public.holdings where user_id=u and player_id=p_player) then raise exception 'NOT_OWNED'; end if;
 select * into strict w from public.wallets where user_id=u;
 fee:=case when p_side='sell' then round(s.price*p.sell_fee_bps/10000)::bigint else 0 end;
 insert into public.trade_quotes(user_id,player_id,side,price,fee,net,market_at,policy_version,expires_at)
 values(u,p_player,p_side,s.price::bigint,fee,s.price::bigint-fee,s.updated_at,p.version,clock_timestamp()+make_interval(secs=>p.quote_seconds)) returning * into q;
 return jsonb_build_object('id',q.id,'playerId',p_player,'side',p_side,'quantity',1,'price',q.price,'fee',q.fee,'settlement',q.net,'balance',w.balance,'balanceAfter',w.balance+case when p_side='buy' then -q.net else q.net end,'quotedAt',q.created_at,'expiresAt',q.expires_at,'policyVersion',p.version);
end $$;
create function public.kickx_trade(p_quote uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member(); q public.trade_quotes%rowtype; t public.trades%rowtype; s public.player_market_snapshots%rowtype; bal bigint; n text; begin
 perform public.kickx_economy_lock();
 select * into t from public.trades where user_id=u and request_id=p_request;
 if found then if t.quote_id<>p_quote then raise exception 'REQUEST_REUSED';end if;return to_jsonb(t);end if;
 select * into t from public.trades where user_id=u and quote_id=p_quote;
 if found then return to_jsonb(t);end if;
 if p_request is null then raise exception 'INVALID_INPUT';end if;
 select * into q from public.trade_quotes where id=p_quote and user_id=u for update;
 if not found then raise exception 'QUOTE_NOT_FOUND';end if;
 if q.expires_at<=clock_timestamp() then raise exception 'QUOTE_EXPIRED';end if;
 if q.policy_version<>(select version from public.kickx_policy) then raise exception 'PRICE_CHANGED';end if;
 select * into s from public.player_market_snapshots where id=q.player_id for update;
 if s.price is distinct from q.price or s.updated_at is distinct from q.market_at then raise exception 'PRICE_CHANGED';end if;
 select coalesce(nm.display_name,p.name) into n from public.players p left join public.player_names nm on nm.player_id=p.id where p.id=q.player_id and p.trade_status is null;
 if not found then raise exception 'TRADING_PAUSED';end if;
 select balance into strict bal from public.wallets where user_id=u for update;
 if q.side='buy' then
  if exists(select 1 from public.holdings where user_id=u and player_id=q.player_id) then raise exception 'ALREADY_OWNED';end if;
  if bal<q.net then raise exception 'INSUFFICIENT_POINTS';end if; bal:=bal-q.net;
 else
  if not exists(select 1 from public.holdings where user_id=u and player_id=q.player_id) then raise exception 'NOT_OWNED';end if;bal:=bal+q.net;
 end if;
 insert into public.trades(user_id,player_id,player_name,side,price,fee,net,quote_id,request_id,policy_version)
 values(u,q.player_id,n,q.side,q.price,q.fee,q.net,q.id,p_request,q.policy_version) returning * into t;
 if q.side='buy' then insert into public.holdings(user_id,player_id,cost,trade_id) values(u,q.player_id,q.price,t.id);
 else
  delete from public.holdings where user_id=u and player_id=q.player_id;
  update public.squads set slots=array_replace(slots,q.player_id,null),revision=revision+1,updated_at=now() where user_id=u and q.player_id=any(slots);
 end if;
 update public.player_market_snapshots set volume=(select count(*) from public.trades where player_id=q.player_id) where id=q.player_id;
 update public.wallets set balance=bal where user_id=u;
 insert into public.wallet_ledger(user_id,kind,delta,balance_after,trade_id) values(u,q.side,case when q.side='buy' then -q.net else q.net end,bal,t.id);
 insert into public.asset_snapshots(user_id,value) values(u,public.kickx_assets(u));
 return to_jsonb(t);
end $$;
create function public.kickx_formation(f text) returns text[] language sql immutable set search_path='' as $$
 select case f when '4-3-3' then array['GK','DF','DF','DF','DF','MF','MF','MF','FW','FW','FW'] when '4-4-2' then array['GK','DF','DF','DF','DF','MF','MF','MF','MF','FW','FW'] when '3-5-2' then array['GK','DF','DF','DF','MF','MF','MF','MF','MF','FW','FW'] when '3-4-3' then array['GK','DF','DF','DF','MF','MF','MF','MF','FW','FW','FW'] when '4-5-1' then array['GK','DF','DF','DF','DF','MF','MF','MF','MF','MF','FW'] else null end
$$;
create function public.kickx_save_squad(p_formation text,p_slots text[],p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member(); f text[]:=public.kickx_formation(p_formation); old public.squads%rowtype; i integer; begin
 perform public.kickx_economy_lock();
 if f is null or p_slots is null or cardinality(p_slots)<>11 or array_ndims(p_slots)<>1 or array_lower(p_slots,1)<>1 then raise exception 'INVALID_SQUAD';end if;
 select * into old from public.squads where user_id=u;
 if p_revision is distinct from coalesce(old.revision,0) then raise exception 'STALE_REVISION';end if;
 if (select count(*) from unnest(p_slots) v where v is not null)<>(select count(distinct v) from unnest(p_slots) v where v is not null) then raise exception 'DUPLICATE_PLAYER';end if;
 for i in 1..11 loop
  if p_slots[i] is not null and not exists(select 1 from public.holdings h join public.players p on p.id=h.player_id where h.user_id=u and h.player_id=p_slots[i] and p.position=f[i]) then raise exception 'INVALID_SQUAD_PLAYER';end if;
 end loop;
 insert into public.squads(user_id,formation_id,slots) values(u,p_formation,p_slots) on conflict(user_id) do update set formation_id=excluded.formation_id,slots=excluded.slots,revision=public.squads.revision+1,updated_at=now() returning * into old;
 return to_jsonb(old);
end $$;
-- Point-in-time valuation uses actual publication times and completed trades, never a
-- later correction's revised historical price. Deposits exist only as the initial grant.
create function public.kickx_assets_at(u uuid,at_time timestamptz) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select sum(delta) from public.wallet_ledger where user_id=u and created_at<=at_time),0)::bigint + coalesce((
 select sum(coalesce((select value from public.price_history ph where ph.player_id=t.player_id and ph.recorded_at<=at_time order by ph.recorded_at desc limit 1),t.price))::bigint
 from (select distinct on(player_id) * from public.trades where user_id=u and created_at<=at_time order by player_id,created_at desc,sequence desc) t where t.side='buy'),0)
$$;
create function public.kickx_refresh_rankings() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.kickx_require_admin(); period_name text; start_time timestamptz; end_time timestamptz; entries jsonb; as_of timestamptz; begin
 perform public.kickx_economy_lock();as_of:=clock_timestamp();
 foreach period_name in array array['weekly','monthly'] loop
  start_time:=date_trunc(case when period_name='weekly' then 'week' else 'month' end,as_of at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  end_time:=((start_time at time zone 'Asia/Seoul')+case when period_name='weekly' then interval '1 week' else interval '1 month' end) at time zone 'Asia/Seoul';
  with values_at as(select w.user_id,p.nickname,p.team_id,public.kickx_assets(w.user_id) as assets,case when w.created_at>=start_time then w.initial_points else public.kickx_assets_at(w.user_id,start_time-interval '1 microsecond') end as baseline from public.wallets w join public.profiles p on p.id=w.user_id), rates as(select *,case when baseline>0 then (assets-baseline)*100.0/baseline else null end as rate from values_at), ranked as(select *,rank() over(order by rate desc nulls last) as place from rates where rate is not null)
  select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'rank',place,'nickname',nickname,'team',team_id,'assets',assets,'returnRate',round(rate,4),'baseline',baseline) order by place,user_id),'[]') into entries from ranked;
  insert into public.ranking_snapshots(period,starts_at,ends_at,calculated_at,rows) values(period_name,start_time,end_time,as_of,entries);
 end loop;
 insert into public.operation_audit(actor,action) values(actor,'ranking.refresh');
 return jsonb_build_object('calculatedAt',as_of);
end $$;
create function public.kickx_initialize_market() returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.kickx_require_admin(); p public.kickx_policy%rowtype; n integer; begin
 perform public.kickx_economy_lock();select * into strict p from public.kickx_policy;
 with added as(insert into public.player_market_snapshots(id,price,pricing_rule_version,volume) select id,p.initial_price,p.version,(select count(*) from public.trades t where t.player_id=players.id) from public.players where provider='bsd' and position is not null on conflict(id) do update set price=excluded.price,pricing_rule_version=excluded.pricing_rule_version,volume=excluded.volume,updated_at=clock_timestamp() where public.player_market_snapshots.price is null returning id,price)
 insert into public.price_history(player_id,recorded_at,value,rule_version) select id,clock_timestamp(),price,p.version from added;
 get diagnostics n=row_count;
 insert into public.operation_audit(actor,action,detail) values(actor,'market.initialize',jsonb_build_object('players',n));return n;
end $$;
-- This function is server/service_role-only. Administrator identity is checked again.
create function public.kickx_publish_calculation(p_actor uuid,p_player text,p_hash text,p_expected jsonb,p_results jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; p public.kickx_policy%rowtype; value_now bigint; old_value bigint; change numeric:=0; latest numeric; current_hash jsonb; begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='admin') then raise exception 'ADMIN_REQUIRED';end if;
 -- Match the importer lock first so a corrected source cannot race publication.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 select coalesce(jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at) order by m.fixture_id),'[]') into current_hash from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id where m.player_id=p_player;
 select coalesce(jsonb_agg(jsonb_build_object('fixture',e.fixture,'statsAt',e."statsAt",'sourceAt',e."sourceAt",'fixtureAt',e."fixtureAt") order by e.fixture),'[]') into p_expected from jsonb_to_recordset(p_expected) as e(fixture text,"statsAt" timestamptz,"sourceAt" timestamptz,"fixtureAt" timestamptz);
 if current_hash is distinct from p_expected then raise exception 'SOURCE_CHANGED';end if;
 select * into strict p from public.kickx_policy;
 if not exists(select 1 from public.players where id=p_player and provider='bsd' and position is not null) then raise exception 'INVALID_TARGET';end if;
 if exists(select 1 from public.player_calculation_state where player_id=p_player and input_hash=p_hash and rule_version=p.version) then return jsonb_build_object('unchanged',true);end if;
 if p.version<>'prototype-v1' then raise exception 'RULE_VERSION_MISMATCH';end if;
 if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
 select price::bigint into old_value from public.player_market_snapshots where id=p_player;
 value_now:=p.initial_price;
 if not public.kickx_check_calculation(p_player,p_results) then
  insert into public.operation_audit(actor,action,target,detail) values(p_actor,'calculation.withheld',p_player,jsonb_build_object('reason','PREVIOUS_RESULT_NOW_INCOMPLETE'));
  return jsonb_build_object('withheld',true,'reason','PREVIOUS_RESULT_NOW_INCOMPLETE');
 end if;
 -- Clear only the current projection; immutable previous calculation revisions remain.
 delete from public.performance_results where player_id=p_player;
 update public.player_match_records set performance=null,rule_version=null where player_id=p_player;
 for r in select value from jsonb_array_elements(p_results) loop
  insert into public.performance_results(player_id,fixture_id,score,status,rule_version,input_hash,position,breakdown,warnings)
  values(p_player,r->>'fixtureId',(r->>'score')::numeric,r->>'status',p.version,p_hash,r->>'position',r->'breakdown',r->'warnings');
  if r->>'status' in('ready','provisional') then
   latest:=(r->>'score')::numeric;
   change:=greatest(-5,least(5,latest-4));
   value_now:=greatest(p.min_price,least(p.max_price,round(value_now*(1+change/100))::bigint));
   update public.player_match_records set performance=latest,rule_version=p.version where player_id=p_player and fixture_id=r->>'fixtureId';
  end if;
 end loop;
 insert into public.calculation_revisions(player_id,input_hash,rule_version,previous_price,new_price,results,actor) values(p_player,p_hash,p.version,old_value,value_now,p_results,p_actor);
 insert into public.player_calculation_state(player_id,input_hash,rule_version) values(p_player,p_hash,p.version) on conflict(player_id) do update set input_hash=excluded.input_hash,rule_version=excluded.rule_version,calculated_at=now();
 insert into public.player_market_snapshots(id,price,change_percent,performance,performance_rule_version,pricing_rule_version,volume)
 values(p_player,value_now,case when old_value>0 then round((value_now-old_value)*100.0/old_value,4) else null end,latest,case when latest is not null then p.version end,p.version,(select count(*) from public.trades where player_id=p_player))
 on conflict(id) do update set price=excluded.price,volume=excluded.volume,change_percent=excluded.change_percent,performance=excluded.performance,performance_rule_version=excluded.performance_rule_version,pricing_rule_version=excluded.pricing_rule_version,updated_at=clock_timestamp();
 insert into public.price_history(player_id,recorded_at,value,rule_version) values(p_player,clock_timestamp(),value_now,p.version);
 insert into public.asset_snapshots(user_id,value) select user_id,public.kickx_assets(user_id) from public.holdings where player_id=p_player;
 insert into public.operation_audit(actor,action,target,detail) values(p_actor,'calculation.publish',p_player,jsonb_build_object('price',value_now,'results',jsonb_array_length(p_results)));
 return jsonb_build_object('unchanged',false,'price',value_now,'performance',latest);
end $$;
-- All economic tables are read-only to end users; writes go through authenticated RPCs.
do $$declare t text;begin
 foreach t in array array['kickx_policy','wallets','trade_quotes','trades','holdings','wallet_ledger','squads','asset_snapshots','ranking_snapshots','operation_audit','performance_results','calculation_revisions','player_calculation_state'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['wallets','trade_quotes','trades','holdings','wallet_ledger','squads','asset_snapshots'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
 end loop;
 foreach t in array array['kickx_policy','ranking_snapshots','performance_results'] loop
  execute format('grant select on public.%I to anon,authenticated',t);
  execute format('create policy visible_read on public.%I for select to anon,authenticated using(true)',t);
 end loop;
end $$;
-- Revoke default PUBLIC function execution, including internal security-definer helpers.
do $$declare r record;begin
 for r in select oid::regprocedure as fn from pg_proc where pronamespace='public'::regnamespace and proname like 'kickx_%' loop execute format('revoke all on function %s from public,anon,authenticated',r.fn);execute format('grant execute on function %s to service_role',r.fn);end loop;
end $$;
grant execute on function public.kickx_open_wallet(),public.kickx_quote(text,text),public.kickx_trade(uuid,uuid),public.kickx_save_squad(text,text[],integer),public.kickx_refresh_rankings(),public.kickx_initialize_market() to authenticated;
commit;
