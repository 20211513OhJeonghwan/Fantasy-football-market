-- Current-price bench, seven-day return and single settlement.
begin;
set local lock_timeout='5s';
select public.kickx_economy_lock();
create table kickx_private.bench_legacy_prices(
 trade_id uuid primary key references public.trades(id) on delete cascade,
 price bigint not null check(price>0),starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at>=starts_at));
alter table kickx_private.bench_legacy_prices enable row level security;
revoke all on kickx_private.bench_legacy_prices from public,anon,authenticated,service_role;
insert into kickx_private.bench_legacy_prices
 select trade_id,bench_price,bench_started_at,clock_timestamp() from public.holdings where bench_started_at is not null;
insert into kickx_private.bench_legacy_prices
 select b.id,s.price,q.market_at,s.created_at
 from public.trades s join public.trade_quotes q on q.id=s.quote_id
 cross join lateral(select id from public.trades b where b.user_id=s.user_id and b.player_id=s.player_id and b.side='buy'
 and (b.created_at,b.sequence)<(s.created_at,s.sequence) order by b.created_at desc,b.sequence desc limit 1)b
 where s.execution_reason in('bench_manual','bench_expired') and q.market_at<=s.created_at on conflict do nothing;
create or replace function public.kickx_assets(u uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select w.balance+coalesce((select sum(coalesce(nullif(s.price,0),h.bench_price,h.cost))::bigint
 from public.holdings h left join public.player_market_snapshots s on s.id=h.player_id where h.user_id=u),0)
 from public.wallets w where w.user_id=u
$$;
create or replace function public.kickx_assets_at(u uuid,at_time timestamptz) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce((select sum(delta) from public.wallet_ledger where user_id=u and created_at<=at_time),0)::bigint
 +coalesce((select sum(coalesce(
 (select l.price from kickx_private.bench_legacy_prices l where l.trade_id=t.id and l.starts_at<=at_time and at_time<l.ends_at),
 (select value from public.price_history where player_id=t.player_id and recorded_at<=at_time order by recorded_at desc limit 1),t.price))::bigint
 from(select distinct on(player_id)* from public.trades where user_id=u and created_at<=at_time order by player_id,created_at desc,sequence desc)t where t.side='buy'),0)
$$;
create or replace function kickx_private.bench_quote(p_user uuid,p_player text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.holdings%rowtype;p public.kickx_policy%rowtype;q public.trade_quotes%rowtype;bal bigint;fee bigint;value_now bigint;market_at timestamptz;begin
 perform public.kickx_economy_lock();
 select * into h from public.holdings where user_id=p_user and player_id=p_player for update;
 if not found then raise exception 'NOT_OWNED';end if;
 if h.bench_started_at is null then raise exception 'PRICE_CHANGED';end if;

 if (public.kickx_trade_window(p_player,clock_timestamp())->>'locked')::boolean then raise exception 'MATCH_TRADING_LOCKED';end if;
 select coalesce(nullif(s.price,0),h.bench_price,h.cost)::bigint,s.updated_at into value_now,market_at
 from public.player_market_snapshots s where s.id=p_player;
 value_now:=coalesce(value_now,h.bench_price,h.cost);market_at:=coalesce(market_at,h.bench_started_at);
 if value_now is null or value_now<=0 then raise exception 'PRICE_UNAVAILABLE';end if;
 select * into strict p from public.kickx_policy;
 select balance into strict bal from public.wallets where user_id=p_user;
 fee:=round(value_now*p.sell_fee_bps/10000.0)::bigint;
 insert into public.trade_quotes(user_id,player_id,side,price,fee,net,market_at,policy_version,expires_at)
 values(p_user,p_player,'sell',value_now,fee,value_now-fee,market_at,p.version,
  clock_timestamp()+make_interval(secs=>p.quote_seconds)) returning * into q;
 return jsonb_build_object('id',q.id,'playerId',p_player,'side','sell','quantity',1,'price',q.price,'fee',q.fee,
  'settlement',q.net,'balance',bal,'balanceAfter',bal+q.net,'quotedAt',q.created_at,'expiresAt',q.expires_at,
  'policyVersion',p.version,'benchExpiresAt',h.bench_started_at+kickx_private.bench_retention());
end $$;
create or replace function kickx_private.settle_bench(p_user uuid,p_quote uuid,p_request uuid,p_automatic boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.holdings%rowtype;q public.trade_quotes%rowtype;t public.trades%rowtype;bal bigint;n text;value_now bigint;market_at timestamptz;begin
 perform public.kickx_economy_lock();
 select * into t from public.trades where user_id=p_user and request_id=p_request;
 if found then if t.quote_id<>p_quote then raise exception 'REQUEST_REUSED';end if;return to_jsonb(t);end if;
 select * into t from public.trades where user_id=p_user and quote_id=p_quote;
 if found then return to_jsonb(t);end if;
 if p_request is null then raise exception 'INVALID_INPUT';end if;
 select * into q from public.trade_quotes where id=p_quote and user_id=p_user for update;
 if not found then raise exception 'QUOTE_NOT_FOUND';end if;
 if q.expires_at<=clock_timestamp() then raise exception 'QUOTE_EXPIRED';end if;
 if q.policy_version<>(select version from public.kickx_policy) then raise exception 'PRICE_CHANGED';end if;
 select * into h from public.holdings where user_id=p_user and player_id=q.player_id for update;
 if not found then raise exception 'NOT_OWNED';end if;

 if (public.kickx_trade_window(q.player_id,clock_timestamp())->>'locked')::boolean then raise exception 'MATCH_TRADING_LOCKED';end if;
 select coalesce(nullif(s.price,0),h.bench_price,h.cost)::bigint,s.updated_at into value_now,market_at
 from public.player_market_snapshots s where s.id=q.player_id;
 value_now:=coalesce(value_now,h.bench_price,h.cost);market_at:=coalesce(market_at,h.bench_started_at);
 if value_now is null or value_now<=0 then raise exception 'PRICE_UNAVAILABLE';end if;
 if q.side<>'sell' or h.bench_started_at is null or q.price is distinct from value_now
  or q.market_at is distinct from market_at then raise exception 'PRICE_CHANGED';end if;
 if not p_automatic and h.bench_started_at+kickx_private.bench_retention()<=clock_timestamp() then raise exception 'BENCH_EXPIRED';end if;
 if p_automatic and h.bench_started_at+kickx_private.bench_retention()>clock_timestamp() then raise exception 'BENCH_NOT_EXPIRED';end if;
 select coalesce(p.name_ko,nm.display_name,p.name) into strict n from public.players p
  left join public.player_names nm on nm.player_id=p.id where p.id=q.player_id;
 select balance into strict bal from public.wallets where user_id=p_user for update;bal:=bal+q.net;
 insert into public.trades(user_id,player_id,player_name,side,price,fee,net,quote_id,request_id,policy_version,execution_reason)
 values(p_user,q.player_id,n,'sell',q.price,q.fee,q.net,q.id,p_request,q.policy_version,
  case when p_automatic then 'bench_expired' else 'bench_manual' end) returning * into t;
 delete from public.holdings where user_id=p_user and player_id=q.player_id;
 update public.wallets set balance=bal where user_id=p_user;
 insert into public.wallet_ledger(user_id,kind,delta,balance_after,trade_id) values(p_user,'sell',q.net,bal,t.id);
 update public.player_market_snapshots set volume=coalesce(volume,0)+1 where id=q.player_id;
 perform kickx_private.kickx_sync_owned_squad(p_user);
 insert into public.asset_snapshots(user_id,value) values(p_user,public.kickx_assets(p_user));
 return to_jsonb(t);
end $$;
create or replace function kickx_private.expire_roster_bench(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare h record;q jsonb;sold integer:=0;cutoff timestamptz:=clock_timestamp()-kickx_private.bench_retention();begin
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.holdings where bench_started_at<=cutoff) then return 0;end if;
 -- A busy price publication can defer to the next existing tick without blocking it.
 if not pg_catalog.pg_try_advisory_xact_lock(90261009) then return 0;end if;
 for h in select user_id,player_id from public.holdings
  where bench_started_at<=cutoff and not (public.kickx_trade_window(player_id,clock_timestamp())->>'locked')::boolean
  order by bench_started_at,user_id,player_id limit p_limit for update loop
  q:=kickx_private.bench_quote(h.user_id,h.player_id);
  perform kickx_private.settle_bench(h.user_id,(q->>'id')::uuid,gen_random_uuid(),true);
  sold:=sold+1;
 end loop;
 return sold;
end $$;
create function public.kickx_restore_bench(p_player text,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();s public.squads%rowtype;owned public.holdings%rowtype;
 pos text;f text[];cap integer;n integer;begin
 perform public.kickx_economy_lock();
 if p_player is null or p_revision is null or p_revision<0 then raise exception 'INVALID_INPUT';end if;
 select * into s from public.squads where user_id=u for update;
 if not found or p_revision is distinct from s.revision then raise exception 'STALE_REVISION';end if;
 select * into owned from public.holdings where user_id=u and player_id=p_player for update;
 if not found then raise exception 'NOT_OWNED';end if;
 if owned.bench_started_at is null then raise exception 'NOT_BENCHED';end if;
 if owned.bench_started_at+kickx_private.bench_retention()<=clock_timestamp() then raise exception 'BENCH_EXPIRED';end if;
 select position into pos from public.players where id=p_player;
 if pos is null or pos not in('GK','DF','MF','FW') then raise exception 'POSITION_UNAVAILABLE';end if;
 if not exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=p_player
 and t.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) then raise exception 'OUTSIDE_MARKET_SCOPE';end if;
 if exists(select 1 from public.players where id=p_player and trade_status is not null) then raise exception 'TRADING_PAUSED';end if;
 if not exists(select 1 from public.player_market_snapshots where id=p_player and price>0) then raise exception 'PRICE_UNAVAILABLE';end if;
 if exists(select 1 from public.kickx_policy where version in('form-v2','report-v3')) and not exists(
 select 1 from public.player_market_snapshots where id=p_player and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 if (public.kickx_trade_window(p_player,clock_timestamp())->>'locked')::boolean then raise exception 'MATCH_TRADING_LOCKED';end if;
 f:=kickx_private.formation_positions(s.formation_id);
 if(select count(*) from public.holdings where user_id=u and bench_started_at is null)>=11 then raise exception 'SQUAD_FULL';end if;
 if exists(select 1 from public.holdings h join public.players p on p.id=h.player_id where h.user_id=u and h.bench_started_at is null
 group by p.position having p.position is null or count(*)>(select count(*) from unnest(f)x where x=p.position)) then raise exception 'LEGACY_SQUAD_EXCESS';end if;
 select count(*) into cap from unnest(f)x where x=pos;
 select count(*) into n from public.holdings h join public.players p on p.id=h.player_id where h.user_id=u and h.bench_started_at is null and p.position=pos;
 if n>=cap then raise exception 'POSITION_FULL';end if;
 update public.holdings set bench_price=null,bench_started_at=null,bench_reason=null where user_id=u and player_id=p_player;
 perform kickx_private.kickx_sync_owned_squad(u);
 select * into strict s from public.squads where user_id=u;return to_jsonb(s);
end $$;
revoke all on function public.kickx_restore_bench(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.kickx_restore_bench(text,integer) to authenticated;
do $$declare src text;changed text;begin
 src:=pg_get_functiondef('public.kickx_member_data()'::regprocedure);
 changed:=replace(src,'coalesce(h.bench_price,s.price)','coalesce(nullif(s.price,0),h.bench_price,h.cost)');
 changed:=replace(changed,$old$'price',h.bench_price$old$,$new$'price',coalesce(nullif(s.price,0),h.bench_price,h.cost)$new$);
 if changed=src or strpos(changed,'coalesce(h.bench_price,s.price)')>0 then raise exception 'BENCH_LIVE_MEMBER_PATCH_MISMATCH';end if;execute changed;
 src:=pg_get_functiondef('public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb)'::regprocedure);
 changed:=replace(src,'from public.holdings where player_id=p_player and bench_started_at is null;','from public.holdings where player_id=p_player;');
 if changed=src then raise exception 'BENCH_LIVE_PUBLICATION_PATCH_MISMATCH';end if;execute changed;
 src:=pg_get_functiondef('kickx_private.notify_player_price()'::regprocedure);
 changed:=replace(src,'where h.player_id=new.id and h.bench_started_at is null','where h.player_id=new.id');
 if changed=src then raise exception 'BENCH_LIVE_NOTIFICATION_PATCH_MISMATCH';end if;execute changed;
end $$;
update public.trade_quotes q set expires_at=least(q.expires_at,clock_timestamp()) where exists(
 select 1 from public.holdings h where h.user_id=q.user_id and h.player_id=q.player_id and h.bench_started_at is not null)
 and not exists(select 1 from public.trades t where t.quote_id=q.id);
insert into public.asset_snapshots(user_id,value) select distinct user_id,public.kickx_assets(user_id) from public.holdings where bench_started_at is not null;
comment on column public.holdings.bench_price is 'Last-known fallback only. Current market price takes precedence.';
notify pgrst,'reload schema';
commit;
