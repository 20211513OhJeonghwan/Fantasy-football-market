-- Automatic game operations; apply once after 202610090003. No operating seeds.
begin;
create table public.member_restrictions(user_id uuid primary key references public.profiles(id),suspended_until timestamptz,reason text,updated_by uuid references auth.users(id),updated_at timestamptz not null default now());
create table public.calculation_queue(player_id text primary key references public.players(id),revision uuid not null default gen_random_uuid(),queued_at timestamptz not null default now(),attempts integer not null default 0,retry_at timestamptz not null default now(),error_code text);
create table public.automation_state(singleton boolean primary key default true check(singleton),lease uuid,lease_until timestamptz,last_daily date,last_success timestamptz,last_error text);
insert into public.automation_state(singleton) values(true);
create table public.automation_runs(id uuid primary key,started_at timestamptz not null default now(),finished_at timestamptz,status text not null default 'running',daily boolean not null,summary jsonb not null default '{}',error_code text);
create table public.automation_daily_tasks(day date not null,key text not null,kind text not null,priority integer not null,payload jsonb not null,label text not null,completed boolean not null default false,primary key(day,key));
create table public.automatic_fixture_checks(fixture_id text primary key references public.fixtures(id),checked_at timestamptz not null default now(),retry_at timestamptz not null default now());
alter table public.player_names add column source text not null default 'manual';
alter table public.player_names add column source_id text;
create table public.name_mapping_checks(player_id text primary key references public.players(id),checked_at timestamptz not null default now(),status text not null,source_id text,input_signature text);
do $$declare t text;begin
 foreach t in array array['member_restrictions','calculation_queue','automation_state','automation_runs','automation_daily_tasks','automatic_fixture_checks','name_mapping_checks'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.kickx_queue_player(p_player text) returns void language sql security definer set search_path='' as $$
 insert into public.calculation_queue(player_id) values(p_player) on conflict(player_id) do update set revision=gen_random_uuid(),queued_at=now(),retry_at=now(),error_code=null;
$$;
create function public.kickx_queue_match_change() returns trigger language plpgsql security definer set search_path='' as $$
declare f text; m record;begin
 if TG_OP='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new;end if;
 if TG_TABLE_NAME='football_match_stats' then
  if TG_OP<>'DELETE' then perform public.kickx_queue_player(new.player_id);end if;
  if TG_OP<>'INSERT' then perform public.kickx_queue_player(old.player_id);end if;
 elsif TG_TABLE_NAME='fixtures' then
  if TG_OP='UPDATE' and (new.status,new.starts_at,new.home_score,new.away_score,new.home_team_id,new.away_team_id) is not distinct from (old.status,old.starts_at,old.home_score,old.away_score,old.home_team_id,old.away_team_id) then return new;end if;
  f:=case when TG_OP='DELETE' then old.id else new.id end;
 else f:=case when TG_OP='DELETE' then old.fixture_id else new.fixture_id end;
 end if;
 if f is not null then for m in select player_id from public.football_match_stats where fixture_id=f loop perform public.kickx_queue_player(m.player_id);end loop;end if;
 return case when TG_OP='DELETE' then old else new end;
end $$;
create trigger automatic_match_queue after insert or update or delete on public.football_match_stats for each row execute function public.kickx_queue_match_change();
create trigger automatic_source_queue after insert or update or delete on public.football_event_sources for each row execute function public.kickx_queue_match_change();
create trigger automatic_fixture_queue after update on public.fixtures for each row execute function public.kickx_queue_match_change();
-- Existing source records receive a first automatic calculation; retries are idempotent.
insert into public.calculation_queue(player_id) select id from public.players where provider='bsd' on conflict do nothing;
create function public.kickx_reserve_provider_request() returns void language plpgsql set search_path='' as $$
declare d date:=(now() at time zone 'UTC')::date;used integer;begin
 insert into public.football_bulk_daily_budget(day) values(d) on conflict do nothing;
 select requests into used from public.football_bulk_daily_budget where day=d for update;
 if used>=7000 then raise exception 'LOCAL_DAILY_BUDGET';end if;
 update public.football_bulk_daily_budget set requests=requests+1 where day=d;
end $$;
create function public.kickx_automation_claim() returns jsonb language plpgsql set search_path='' as $$
declare s public.automation_state%rowtype;t uuid;daily boolean;begin
 select * into s from public.automation_state where singleton for update;
 if s.lease_until>now() then return jsonb_build_object('busy',true);end if;
 update public.automation_runs set status='abandoned',finished_at=now(),error_code='LEASE_EXPIRED' where id=s.lease and status='running';
 t:=gen_random_uuid();daily:=s.last_daily is distinct from (now() at time zone 'Asia/Seoul')::date;
 update public.automation_state set lease=t,lease_until=now()+interval '50 minutes' where singleton;
 insert into public.automation_runs(id,daily) values(t,daily);
 return jsonb_build_object('token',t,'daily',daily,'day',(now() at time zone 'Asia/Seoul')::date);
end $$;
create function public.kickx_automation_finish(p_token uuid,p_daily boolean,p_summary jsonb,p_error text default null) returns void language plpgsql set search_path='' as $$
begin
 update public.automation_state set lease=null,lease_until=null,last_daily=case when p_daily then (select (started_at at time zone 'Asia/Seoul')::date from public.automation_runs where id=p_token) else last_daily end,last_success=case when p_error is null then now() else last_success end,last_error=p_error where singleton and lease=p_token;
 if not found then raise exception 'STALE_AUTOMATION_LEASE';end if;
 update public.automation_runs set status=case when p_error is null then 'completed' else 'failed' end,finished_at=now(),summary=p_summary,error_code=p_error where id=p_token;
end $$;
create function public.kickx_ack_calculation(p_player text,p_revision uuid,p_error text default null) returns void language plpgsql set search_path='' as $$
begin
 if p_error is null then delete from public.calculation_queue where player_id=p_player and revision=p_revision;
 else update public.calculation_queue set attempts=attempts+1,error_code=p_error,retry_at=now()+case when p_error='CALCULATION_WITHHELD' then interval '1 day' else interval '15 minutes' end where player_id=p_player and revision=p_revision;end if;
end $$;

create function public.kickx_auto_refresh_rankings() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=null; period_name text; start_time timestamptz; end_time timestamptz; entries jsonb; as_of timestamptz; begin
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
create function public.kickx_auto_initialize_market() returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=null; p public.kickx_policy%rowtype; n integer; begin
 perform public.kickx_economy_lock();select * into strict p from public.kickx_policy;
 with added as(insert into public.player_market_snapshots(id,price,pricing_rule_version,volume) select id,p.initial_price,p.version,(select count(*) from public.trades t where t.player_id=players.id) from public.players where provider='bsd' on conflict(id) do update set price=excluded.price,pricing_rule_version=excluded.pricing_rule_version,volume=excluded.volume,updated_at=clock_timestamp() where public.player_market_snapshots.price is null returning id,price)
 insert into public.price_history(player_id,recorded_at,value,rule_version) select id,clock_timestamp(),price,p.version from added;
 get diagnostics n=row_count;
 insert into public.operation_audit(actor,action,detail) values(actor,'market.initialize',jsonb_build_object('players',n));return n;
end $$;
create or replace function public.kickx_publish_calculation(p_actor uuid,p_player text,p_hash text,p_expected jsonb,p_results jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; p public.kickx_policy%rowtype; value_now bigint; old_value bigint; change numeric:=0; latest numeric; current_hash jsonb; begin
 if p_actor is not null and not exists(select 1 from public.user_roles where user_id=p_actor and role='admin') then raise exception 'ADMIN_REQUIRED';end if;
 -- Match the importer lock first so a corrected source cannot race publication.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 select coalesce(jsonb_agg(jsonb_build_object('fixture',m.fixture_id,'statsAt',m.updated_at,'sourceAt',s.updated_at,'fixtureAt',f.updated_at) order by m.fixture_id),'[]') into current_hash from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id where m.player_id=p_player;
 select coalesce(jsonb_agg(jsonb_build_object('fixture',e.fixture,'statsAt',e."statsAt",'sourceAt',e."sourceAt",'fixtureAt',e."fixtureAt") order by e.fixture),'[]') into p_expected from jsonb_to_recordset(p_expected) as e(fixture text,"statsAt" timestamptz,"sourceAt" timestamptz,"fixtureAt" timestamptz);
 if current_hash is distinct from p_expected then raise exception 'SOURCE_CHANGED';end if;
 select * into strict p from public.kickx_policy;
 if not exists(select 1 from public.players where id=p_player and provider='bsd') then raise exception 'INVALID_TARGET';end if;
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
create function public.kickx_require_active_member() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member();begin
 if exists(select 1 from public.member_restrictions where user_id=u and suspended_until>now()) then raise exception 'MEMBER_SUSPENDED';end if;
 return u;
end $$;

create function public.kickx_rank_after_assets() returns trigger language plpgsql security definer set search_path='' as $$
begin if exists(select 1 from new_assets) then perform public.kickx_auto_refresh_rankings();end if;return null;end $$;
create trigger automatic_asset_rank after insert on public.asset_snapshots referencing new table as new_assets for each statement execute function public.kickx_rank_after_assets();
create function public.kickx_restrict_member(p_user uuid,p_days integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare a uuid:=public.kickx_require_admin();begin
 if p_days not in(0,1,7,30) or p_days is null or char_length(btrim(p_reason)) not between 5 and 500 or p_reason is null then raise exception 'INVALID_INPUT';end if;
 if p_user=a or exists(select 1 from public.user_roles where user_id=p_user and role='admin') then raise exception 'PROTECTED_ADMIN';end if;
 insert into public.member_restrictions(user_id,suspended_until,reason,updated_by) values(p_user,case when p_days=0 then null else now()+make_interval(days=>p_days) end,btrim(p_reason),a) on conflict(user_id) do update set suspended_until=excluded.suspended_until,reason=excluded.reason,updated_by=a,updated_at=now();
 insert into public.operation_audit(actor,action,target,detail) values(a,case when p_days=0 then 'member.restore' else 'member.suspend' end,p_user::text,jsonb_build_object('days',p_days,'reason',btrim(p_reason)));
end $$;
create function public.kickx_profile_restriction() returns trigger language plpgsql security definer set search_path='' as $$
begin if exists(select 1 from public.member_restrictions where user_id=new.id and suspended_until>now()) then raise exception 'MEMBER_SUSPENDED';end if;return new;end $$;
create trigger profile_restriction before update on public.profiles for each row execute function public.kickx_profile_restriction();
create or replace function public.kickx_quote(p_player text,p_side text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member(); p public.kickx_policy%rowtype; s public.player_market_snapshots%rowtype; w public.wallets%rowtype; q public.trade_quotes%rowtype; fee bigint; begin
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
create or replace function public.kickx_trade(p_quote uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member(); q public.trade_quotes%rowtype; t public.trades%rowtype; s public.player_market_snapshots%rowtype; bal bigint; n text; begin
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
create or replace function public.kickx_save_squad(p_formation text,p_slots text[],p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member(); f text[]:=public.kickx_formation(p_formation); old public.squads%rowtype; i integer; begin
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
create or replace function public.kickx_community_write(p_action text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member(); post public.community_posts%rowtype; c public.community_comments%rowtype; target_comment public.community_comments%rowtype; id_value uuid; req uuid; t uuid; body_value text; title_value text; begin
 -- Serializes permissions, cooldown and idempotency for the same author.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:community:'||u::text,0));
 if p_action='createPost' then
  req:=(p_input->>'requestId')::uuid;if req is null then raise exception 'INVALID_INPUT';end if;
  select * into post from public.community_posts where author_id=u and request_id=req;if found then return jsonb_build_object('id',post.id);end if;
  if not public.kickx_can_write_lounge(u,p_input->>'scope',p_input->>'target') then raise exception 'FAN_REQUIRED';end if;
  if (p_input->>'scope'='club' and not exists(select 1 from public.teams where id=p_input->>'target')) or (p_input->>'scope'='player' and not exists(select 1 from public.players where id=p_input->>'target')) then raise exception 'INVALID_TARGET';end if;
  if exists(select 1 from public.community_posts where author_id=u and created_at>now()-interval '3 seconds') then raise exception 'TOO_FAST';end if;
  t:=nullif(p_input->>'transaction','')::uuid;
  if t is not null and not exists(select 1 from public.trades where id=t and user_id=u) then raise exception 'TRADE_NOT_OWNED';end if;
  insert into public.community_posts(author_id,scope,target,category,title,body,trade_id,request_id) values(u,p_input->>'scope',p_input->>'target',p_input->>'category',btrim(p_input->>'title'),btrim(p_input->>'body'),t,req) returning * into post;
  return jsonb_build_object('id',post.id);
 end if;
 select * into post from public.community_posts where id=(p_input->>'postId')::uuid for update;
 if not found or post.status<>'published' then raise exception 'POST_NOT_FOUND';end if;
 if p_action in('editPost','deletePost') then
  if post.author_id<>u then raise exception 'NOT_AUTHOR';end if;
  if (p_input->>'revision')::integer is distinct from post.revision then raise exception 'STALE_REVISION';end if;
  insert into public.community_revisions(post_id,actor,before_value) values(post.id,u,to_jsonb(post));
  if p_action='deletePost' then update public.community_posts set status='deleted',revision=revision+1,updated_at=now() where id=post.id;
  else
   if not public.kickx_can_write_lounge(u,post.scope,post.target) then raise exception 'FAN_REQUIRED';end if;
   t:=nullif(p_input->>'transaction','')::uuid;
   if t is not null and not exists(select 1 from public.trades where id=t and user_id=u) then raise exception 'TRADE_NOT_OWNED';end if;
   update public.community_posts set title=btrim(p_input->>'title'),body=btrim(p_input->>'body'),category=p_input->>'category',trade_id=t,revision=revision+1,updated_at=now() where id=post.id;
  end if;
 elsif p_action='comment' then
  req:=(p_input->>'requestId')::uuid;if req is null then raise exception 'INVALID_INPUT';end if;
  select * into c from public.community_comments where author_id=u and request_id=req;if found then if c.post_id<>post.id then raise exception 'REQUEST_REUSED';end if;return jsonb_build_object('id',c.id);end if;
  if not public.kickx_can_write_lounge(u,post.scope,post.target) then raise exception 'FAN_REQUIRED';end if;
  if exists(select 1 from public.community_comments where author_id=u and created_at>now()-interval '2 seconds') then raise exception 'TOO_FAST';end if;
  t:=nullif(p_input->>'parentId','')::uuid;
  if t is not null and not exists(select 1 from public.community_comments where id=t and post_id=post.id and parent_id is null and status='published') then raise exception 'INVALID_PARENT';end if;
  insert into public.community_comments(post_id,author_id,parent_id,body,request_id) values(post.id,u,t,btrim(p_input->>'body'),req) returning id into id_value;return jsonb_build_object('id',id_value);
 elsif p_action in('editComment','deleteComment') then
  select * into c from public.community_comments where id=(p_input->>'commentId')::uuid and post_id=post.id and status='published' for update;
  if not found or c.author_id<>u then raise exception 'NOT_AUTHOR';end if;
  if (p_input->>'revision')::integer is distinct from c.revision then raise exception 'STALE_REVISION';end if;
  if p_action='editComment' and not public.kickx_can_write_lounge(u,post.scope,post.target) then raise exception 'FAN_REQUIRED';end if;
  insert into public.community_revisions(post_id,comment_id,actor,before_value) values(post.id,c.id,u,to_jsonb(c));
  update public.community_comments set body=case when p_action='editComment' then btrim(p_input->>'body') else body end,status=case when p_action='deleteComment' then 'deleted' else status end,revision=revision+1,updated_at=now() where id=c.id;
 elsif p_action='like' then
  if jsonb_typeof(p_input->'liked') is distinct from 'boolean' then raise exception 'INVALID_INPUT';end if;
  if (p_input->>'liked')::boolean then insert into public.community_likes(user_id,post_id) values(u,post.id) on conflict do nothing;else delete from public.community_likes where user_id=u and post_id=post.id;end if;
 elsif p_action='view' then insert into public.community_views(user_id,post_id) values(u,post.id) on conflict do nothing;
 elsif p_action='report' then
  t:=nullif(p_input->>'commentId','')::uuid;
  if t is not null then
   select * into target_comment from public.community_comments where id=t and post_id=post.id and status='published';
   if not found then raise exception 'INVALID_TARGET';end if;
  end if;
  insert into public.community_reports(reporter,post_id,comment_id,reason) values(u,post.id,t,btrim(p_input->>'reason')) on conflict do nothing;
 else raise exception 'INVALID_ACTION';end if;
 return jsonb_build_object('id',post.id);
end $$;

create function public.kickx_apply_automatic_task(p_outcome jsonb) returns integer language plpgsql set search_path='' as $$
declare n integer:=0;e jsonb;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));
 if p_outcome->'batch' is not null and p_outcome->'batch'<>'null'::jsonb then n:=public.apply_bsd_batch(p_outcome->'batch');end if;
 for e in select value from jsonb_array_elements(coalesce(p_outcome->'entities','[]')) loop
  insert into public.football_entity_sources(kind,external_id,raw) values(e->>'kind',(e->>'external_id')::bigint,e->'raw') on conflict(provider,kind,external_id) do update set raw=excluded.raw,updated_at=now();
 end loop;
 if jsonb_array_length(coalesce(p_outcome#>'{squadMembership,playerIds}','[]'))>0 then
  update public.players set team_id=null,updated_at=now() where provider='bsd' and team_id=p_outcome#>>'{squadMembership,teamId}' and id not in(select jsonb_array_elements_text(p_outcome#>'{squadMembership,playerIds}'));
 end if;
 if jsonb_array_length(coalesce(p_outcome#>'{leagueMembership,teamIds}','[]'))>0 then
  update public.teams set league_id=null,updated_at=now() where provider='bsd' and league_id=p_outcome#>>'{leagueMembership,leagueId}' and id not in(select jsonb_array_elements_text(p_outcome#>'{leagueMembership,teamIds}'));
 end if;
 return n;
end $$;
create function public.kickx_queue_new_player() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.provider='bsd' then perform public.kickx_queue_player(new.id);end if;return new;end $$;
create trigger automatic_new_player after insert on public.players for each row execute function public.kickx_queue_new_player();


create function public.kickx_apply_automatic_name(p_player text,p_name text,p_aliases text[],p_source text,p_expected jsonb) returns boolean language plpgsql set search_path='' as $$
declare p public.players%rowtype;begin
 if p_name is null or char_length(p_name) not between 1 and 80 or p_name !~ '[가-힣]' or p_source !~ '^Q[0-9]+$' or p_source is null or cardinality(p_aliases)>20 or exists(select 1 from unnest(p_aliases) a where a is null or char_length(a)>80) then raise exception 'INVALID_INPUT';end if;
 select * into p from public.players where id=p_player for update;if not found then raise exception 'INVALID_TARGET';end if;
 if jsonb_build_object('name',p.name,'english',p.english,'birth_date',p.birth_date) is distinct from p_expected then return false;end if;
 insert into public.player_names(player_id,display_name,aliases,source,source_id) values(p_player,p_name,coalesce(p_aliases,'{}'),'wikidata',p_source) on conflict(player_id) do update set display_name=excluded.display_name,aliases=excluded.aliases,source=excluded.source,source_id=excluded.source_id,updated_at=now() where public.player_names.source<>'manual';
 return found;
end $$;

-- Each provider phase and its child tasks commit with the data in one transaction.
-- A killed runner resumes the persisted day rather than restarting the entire catalog.
create function public.kickx_automatic_daily_start(p_token uuid,p_tasks jsonb) returns void language plpgsql set search_path='' as $$
declare d date;t jsonb;begin
 perform 1 from public.automation_state where singleton and lease=p_token and lease_until>now() for update;
 if not found then raise exception 'STALE_AUTOMATION_LEASE';end if;
 select (started_at at time zone 'Asia/Seoul')::date into d from public.automation_runs where id=p_token;
 for t in select value from jsonb_array_elements(p_tasks) loop
  insert into public.automation_daily_tasks(day,key,kind,priority,payload,label) values(d,t->>'key',t->>'kind',(t->>'priority')::int,t->'payload',t->>'label') on conflict do nothing;
 end loop;
 delete from public.automation_daily_tasks where day<d-7;
end $$;
create function public.kickx_automatic_daily_finish_task(p_token uuid,p_key text,p_outcome jsonb) returns integer language plpgsql set search_path='' as $$
declare d date;t jsonb;n integer;job public.automation_daily_tasks%rowtype;begin
 perform 1 from public.automation_state where singleton and lease=p_token and lease_until>now() for update;
 if not found then raise exception 'STALE_AUTOMATION_LEASE';end if;
 select (started_at at time zone 'Asia/Seoul')::date into d from public.automation_runs where id=p_token;
 select * into job from public.automation_daily_tasks where day=d and key=p_key and not completed for update;
 if not found then raise exception 'STALE_AUTOMATION_TASK';end if;
 n:=public.kickx_apply_automatic_task(p_outcome);
 for t in select value from jsonb_array_elements(coalesce(p_outcome->'children','[]')) loop
  insert into public.automation_daily_tasks(day,key,kind,priority,payload,label) values(d,t->>'key',t->>'kind',(t->>'priority')::int,t->'payload',t->>'label') on conflict do nothing;
 end loop;
 update public.automation_daily_tasks set completed=(p_outcome->>'done')::boolean,payload=case when (p_outcome->>'done')::boolean then payload else p_outcome->'payload' end where day=d and key=p_key;
 return n;
end $$;

create or replace function public.kickx_save_player_name(p_player text,p_name text,p_aliases text[]) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_admin();begin
 if cardinality(p_aliases)>20 or exists(select 1 from unnest(p_aliases) x where char_length(x)>80 or x is null) then raise exception 'INVALID_INPUT';end if;
 insert into public.player_names(player_id,display_name,aliases,updated_by) values(p_player,btrim(p_name),coalesce(p_aliases,'{}'),u) on conflict(player_id) do update set display_name=excluded.display_name,aliases=excluded.aliases,updated_by=u,updated_at=now(),source='manual',source_id=null;
 insert into public.operation_audit(actor,action,target,detail) values(u,'player.name',p_player,jsonb_build_object('displayName',p_name,'aliases',p_aliases));
end $$;

-- Only trusted service-role jobs may calculate/publish with an automatic (null) actor.
do $$declare r record;begin
 for r in select oid::regprocedure fn from pg_proc where pronamespace='public'::regnamespace and proname in('kickx_queue_player','kickx_queue_match_change','kickx_reserve_provider_request','kickx_automation_claim','kickx_automation_finish','kickx_ack_calculation','kickx_auto_initialize_market','kickx_auto_refresh_rankings','kickx_rank_after_assets','kickx_profile_restriction','kickx_require_active_member','kickx_apply_automatic_task','kickx_queue_new_player','kickx_apply_automatic_name','kickx_automatic_daily_start','kickx_automatic_daily_finish_task') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.fn);execute format('grant execute on function %s to service_role',r.fn);
 end loop;
end $$;
revoke all on function public.kickx_restrict_member(uuid,integer,text) from public,anon;
grant execute on function public.kickx_restrict_member(uuid,integer,text) to authenticated;
-- Provision the interim base value immediately; preserve all already-published prices.
select public.kickx_auto_initialize_market();
select public.kickx_auto_refresh_rankings();
commit;
