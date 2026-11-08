-- A roster change protects existing holdings, not the player's public market price.
-- Three nullable holding fields; no per-minute snapshots, new table or new cron job.
begin;
set local lock_timeout='5s';
alter table public.holdings add column bench_price bigint,
 add column bench_started_at timestamptz, add column bench_reason text;
alter table public.holdings add constraint holdings_bench_valid check(
 (bench_price is null and bench_started_at is null and bench_reason is null) or
 (bench_price is not null and bench_price>0 and bench_started_at is not null and bench_reason is not null
  and bench_reason in('transfer','position','transfer_position')));
create index holdings_bench_due_idx on public.holdings(bench_started_at,user_id,player_id)
 where bench_started_at is not null;
alter table public.trades add column execution_reason text check(execution_reason in('bench_manual','bench_expired'));
create index trades_bench_history_idx on public.trades(user_id,player_id,created_at,sequence)
 include(price,quote_id) where execution_reason in('bench_manual','bench_expired');

-- Run before any player row locks, matching the existing trade/publication lock order.
create function kickx_private.lock_roster_change() returns trigger
language plpgsql security definer set search_path='' as $$begin
 perform public.kickx_economy_lock();return null;
end $$;
create trigger roster_change_lock before update of team_id,position on public.players
 for each statement execute function kickx_private.lock_roster_change();

create or replace function public.kickx_require_position_capacity(p_user uuid,p_player text)
returns void language plpgsql set search_path='' as $$
declare pos text;n integer;cap integer;begin
 select position into pos from public.players where id=p_player;
 if pos is null or pos not in('GK','DF','MF','FW') then raise exception 'POSITION_UNAVAILABLE';end if;
 -- A bench holding still prevents duplicate ownership.
 if exists(select 1 from public.holdings where user_id=p_user and player_id=p_player) then raise exception 'ALREADY_OWNED';end if;
 if exists(select 1 from public.holdings h join public.players p on p.id=h.player_id
  where h.user_id=p_user and h.bench_started_at is null
  group by p.position having count(*)>case p.position when 'GK' then 1 when 'DF' then 4 when 'MF' then 3 when 'FW' then 3 else 0 end) then raise exception 'LEGACY_SQUAD_EXCESS';end if;
 if (select count(*) from public.holdings where user_id=p_user and bench_started_at is null)>=11 then raise exception 'SQUAD_FULL';end if;
 cap:=case pos when 'GK' then 1 when 'DF' then 4 else 3 end;
 select count(*) into n from public.holdings h join public.players p on p.id=h.player_id
  where h.user_id=p_user and h.bench_started_at is null and p.position=pos;
 if n>=cap then raise exception 'POSITION_FULL';end if;
end $$;

create or replace function kickx_private.kickx_sync_owned_squad(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare f text[]:=array['GK','DF','DF','DF','DF','MF','MF','MF','FW','FW','FW'];
 old public.squads%rowtype;next_slots text[]:=array_fill(null::text,array[11]);i integer;candidate text;begin
 perform public.kickx_economy_lock();
 select * into old from public.squads where user_id=p_user for update;
 for i in 1..11 loop
  if old.formation_id='4-3-3' and old.slots[i] is not null
   and not old.slots[i]=any(array_remove(next_slots,null)) and exists(
    select 1 from public.holdings h join public.players p on p.id=h.player_id
    where h.user_id=p_user and h.player_id=old.slots[i] and h.bench_started_at is null and p.position=f[i]) then
   next_slots[i]:=old.slots[i];
  end if;
 end loop;
 for i in 1..11 loop
  if next_slots[i] is null then
   select h.player_id into candidate from public.holdings h join public.players p on p.id=h.player_id
    where h.user_id=p_user and h.bench_started_at is null and p.position=f[i]
    and not h.player_id=any(array_remove(next_slots,null)) order by h.acquired_at,h.player_id limit 1;
   next_slots[i]:=candidate;
  end if;
 end loop;
 insert into public.squads(user_id,formation_id,slots) values(p_user,'4-3-3',next_slots)
 on conflict(user_id) do update set formation_id='4-3-3',slots=excluded.slots,
  revision=public.squads.revision+1,updated_at=now()
 where public.squads.formation_id is distinct from '4-3-3' or public.squads.slots is distinct from excluded.slots;
end $$;

create function kickx_private.bench_roster_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare transferred boolean;repositioned boolean;frozen bigint;started timestamptz;member_id uuid;begin
 -- Missing metadata and first-time enrichment are not confirmed roster changes.
 transferred:=old.team_id is not null and new.team_id is not null and old.team_id<>new.team_id;
 repositioned:=old.position in('GK','DF','MF','FW') and new.position in('GK','DF','MF','FW') and old.position<>new.position;
 if not(coalesce(transferred,false) or coalesce(repositioned,false)) then return new;end if;
 if not exists(select 1 from public.holdings where player_id=new.id and bench_started_at is null) then return new;end if;
 select price::bigint into frozen from public.player_market_snapshots where id=new.id;
 if frozen is null or frozen<=0 then raise exception 'ROSTER_PRICE_UNAVAILABLE';end if;
 started:=clock_timestamp();
 for member_id in update public.holdings set bench_price=frozen,bench_started_at=started,
  bench_reason=case when transferred and repositioned then 'transfer_position' when transferred then 'transfer' else 'position' end
  where player_id=new.id and bench_started_at is null returning user_id loop
  perform kickx_private.kickx_sync_owned_squad(member_id);
 end loop;
 -- Repeated imports/another change never reset an existing freeze or its deadline.
 return new;
end $$;
create trigger roster_change_bench after update of team_id,position on public.players
 for each row when(old.team_id is distinct from new.team_id or old.position is distinct from new.position)
 execute function kickx_private.bench_roster_change();

create or replace function public.kickx_assets(u uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select w.balance+coalesce((select sum(coalesce(h.bench_price,s.price))::bigint
  from public.holdings h left join public.player_market_snapshots s on s.id=h.player_id
  where h.user_id=u),0) from public.wallets w where w.user_id=u
$$;

-- Rankings must also retain the freeze when evaluating the beginning of a week/month.
-- Executed sale quotes already retain the freeze timestamp; no new event history is needed.
create or replace function public.kickx_assets_at(u uuid,at_time timestamptz) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce((select sum(delta) from public.wallet_ledger where user_id=u and created_at<=at_time),0)::bigint
 +coalesce((select sum(coalesce(
  (select h.bench_price from public.holdings h where h.user_id=u and h.trade_id=t.id
   and h.bench_started_at<=at_time),
  (select s.price from public.trades s join public.trade_quotes q on q.id=s.quote_id
   where s.user_id=u and s.player_id=t.player_id and s.side='sell' and s.execution_reason in('bench_manual','bench_expired')
   and s.created_at>at_time and q.market_at>=t.created_at and q.market_at<=at_time
   order by s.created_at,s.sequence limit 1),
  (select ph.value from public.price_history ph where ph.player_id=t.player_id and ph.recorded_at<=at_time
   order by ph.recorded_at desc limit 1),t.price))::bigint
 from(select distinct on(player_id) * from public.trades where user_id=u and created_at<=at_time
  order by player_id,created_at desc,sequence desc) t where t.side='buy'),0)
$$;

-- Shared by authenticated manual sales and the existing internal minute tick.
-- This helper is private; only its verified callers can choose a member.
create function kickx_private.bench_quote(p_user uuid,p_player text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.holdings%rowtype;p public.kickx_policy%rowtype;q public.trade_quotes%rowtype;bal bigint;fee bigint;begin
 perform public.kickx_economy_lock();
 select * into h from public.holdings where user_id=p_user and player_id=p_player for update;
 if not found then raise exception 'NOT_OWNED';end if;
 if h.bench_started_at is null then raise exception 'PRICE_CHANGED';end if;
 select * into strict p from public.kickx_policy;
 select balance into strict bal from public.wallets where user_id=p_user;
 fee:=round(h.bench_price*p.sell_fee_bps/10000.0)::bigint;
 insert into public.trade_quotes(user_id,player_id,side,price,fee,net,market_at,policy_version,expires_at)
 values(p_user,p_player,'sell',h.bench_price,fee,h.bench_price-fee,h.bench_started_at,p.version,
  clock_timestamp()+make_interval(secs=>p.quote_seconds)) returning * into q;
 return jsonb_build_object('id',q.id,'playerId',p_player,'side','sell','quantity',1,'price',q.price,'fee',q.fee,
  'settlement',q.net,'balance',bal,'balanceAfter',bal+q.net,'quotedAt',q.created_at,'expiresAt',q.expires_at,
  'policyVersion',p.version,'benchExpiresAt',h.bench_started_at+interval '336 hours');
end $$;

create function kickx_private.settle_bench(p_user uuid,p_quote uuid,p_request uuid,p_automatic boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.holdings%rowtype;q public.trade_quotes%rowtype;t public.trades%rowtype;bal bigint;n text;begin
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
 if q.side<>'sell' or h.bench_started_at is null or q.price is distinct from h.bench_price
  or q.market_at is distinct from h.bench_started_at then raise exception 'PRICE_CHANGED';end if;
 if not p_automatic and h.bench_started_at+interval '336 hours'<=clock_timestamp() then raise exception 'BENCH_EXPIRED';end if;
 if p_automatic and h.bench_started_at+interval '336 hours'>clock_timestamp() then raise exception 'BENCH_NOT_EXPIRED';end if;
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

create function kickx_private.expire_roster_bench(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare h record;q jsonb;sold integer:=0;cutoff timestamptz:=clock_timestamp()-interval '336 hours';begin
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_INPUT';end if;
 if not exists(select 1 from public.holdings where bench_started_at<=cutoff) then return 0;end if;
 -- A busy price publication can defer to the next existing tick without blocking it.
 if not pg_catalog.pg_try_advisory_xact_lock(90261009) then return 0;end if;
 for h in select user_id,player_id from public.holdings
  where bench_started_at<=cutoff
  order by bench_started_at,user_id,player_id limit p_limit for update loop
  q:=kickx_private.bench_quote(h.user_id,h.player_id);
  perform kickx_private.settle_bench(h.user_id,(q->>'id')::uuid,gen_random_uuid(),true);
  sold:=sold+1;
 end loop;
 return sold;
end $$;

revoke all on function kickx_private.lock_roster_change(),kickx_private.bench_roster_change(),
 kickx_private.bench_quote(uuid,text),kickx_private.settle_bench(uuid,uuid,uuid,boolean),
 kickx_private.expire_roster_bench(integer) from public,anon,authenticated,service_role;
revoke all on function public.kickx_require_position_capacity(uuid,text) from public,anon,authenticated,service_role;
revoke all on function kickx_private.kickx_sync_owned_squad(uuid) from public,anon,authenticated,service_role;

-- Patch the current definitions rather than duplicating their existing guards/read fields.
do $$declare src text;changed text;begin
 src:=pg_get_functiondef('public.kickx_quote(text,text)'::regprocedure);
 changed:=replace(src,' perform public.kickx_economy_lock();',
 $patch$ perform public.kickx_economy_lock();
 if p_side='sell' and exists(select 1 from public.holdings where user_id=u and player_id=p_player and bench_started_at is not null) then
  if exists(select 1 from public.holdings where user_id=u and player_id=p_player and bench_started_at<=clock_timestamp()-interval '336 hours') then raise exception 'BENCH_EXPIRED';end if;
  return kickx_private.bench_quote(u,p_player);
 end if;$patch$);
 if changed=src then raise exception 'BENCH_QUOTE_PATCH_MISMATCH';end if;execute changed;
 src:=pg_get_functiondef('public.kickx_trade(uuid,uuid)'::regprocedure);
 changed:=replace(src,' if target is not null and (public.kickx_trade_window',
 $patch$ if side='sell' and exists(select 1 from public.holdings where user_id=u and player_id=target and bench_started_at is not null) then
  return kickx_private.settle_bench(u,p_quote,p_request,false);
 end if;
 if target is not null and (public.kickx_trade_window$patch$);
 if changed=src then raise exception 'BENCH_TRADE_PATCH_MISMATCH';end if;execute changed;

 src:=pg_get_functiondef('public.kickx_member_data()'::regprocedure);
 changed:=replace(src,'s.price','coalesce(h.bench_price,s.price)');
 changed:=replace(changed,$match$'value',coalesce(h.bench_price,s.price)$match$,
  $patch$'bench',case when h.bench_started_at is not null then jsonb_build_object('price',h.bench_price,'startedAt',h.bench_started_at,'expiresAt',h.bench_started_at+interval '336 hours','reason',h.bench_reason) end,'value',coalesce(h.bench_price,s.price)$patch$);
 changed:=replace(changed,'join public.player_market_snapshots s on s.id=h.player_id','left join public.player_market_snapshots s on s.id=h.player_id');
 changed:=replace(changed,$match$'status','체결'$match$,$patch$'status',case t.execution_reason when 'bench_expired' then '벤치 자동 매각' when 'bench_manual' then '벤치 매각' else '체결' end$patch$);
 if changed=src or strpos(changed,$match$'bench',case$match$)=0 then raise exception 'BENCH_MEMBER_PATCH_MISMATCH';end if;execute changed;

 -- A global price update does not change frozen assets, so it must not create redundant snapshots.
 src:=pg_get_functiondef('public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb)'::regprocedure);
 changed:=replace(src,'from public.holdings where player_id=p_player;',
  'from public.holdings where player_id=p_player and bench_started_at is null;');
 if changed=src then raise exception 'BENCH_PUBLICATION_PATCH_MISMATCH';end if;execute changed;

 src:=pg_get_functiondef('kickx_private.notify_player_price()'::regprocedure);
 changed:=replace(src,'where h.player_id=new.id','where h.player_id=new.id and h.bench_started_at is null');
 if changed=src then raise exception 'BENCH_NOTIFICATION_PATCH_MISMATCH';end if;execute changed;

 src:=pg_get_functiondef('kickx_private.notification_tick()'::regprocedure);
 changed:=replace(src,'declare removed integer;sent integer;begin',
  'declare removed integer;sent integer;sold integer;begin sold:=kickx_private.expire_roster_bench();');
 changed:=replace(changed,'where f.starts_at>now()','where h.bench_started_at is null and f.starts_at>now()');
 changed:=replace(changed,$match$jsonb_build_object('removed',removed,'sent',sent)$match$,$patch$jsonb_build_object('removed',removed,'sent',sent,'autoSold',sold)$patch$);
 if changed=src or strpos(changed,'sold:=kickx_private.expire_roster_bench()')=0 then raise exception 'BENCH_TICK_PATCH_MISMATCH';end if;execute changed;
end $$;
notify pgrst,'reload schema';
commit;
