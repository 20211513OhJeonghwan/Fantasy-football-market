-- Fixed 4-3-3: all owned players count, even when not registered in a lineup.
-- Existing wallet, holdings and saved lineups are retained.
create or replace function public.kickx_formation(f text) returns text[]
language sql immutable set search_path='' as $$
 select case when f='4-3-3' then array['GK','DF','DF','DF','DF','MF','MF','MF','FW','FW','FW'] else null end
$$;

-- Invoker-only internal helper; callers already hold the economy transaction lock.
create function public.kickx_require_position_capacity(p_user uuid,p_player text) returns void
language plpgsql set search_path='' as $$
declare pos text; capacity integer; owned integer;begin
 if exists(select 1 from public.holdings where user_id=p_user and player_id=p_player) then
  raise exception 'ALREADY_OWNED';
 end if;
 select position into pos from public.players where id=p_player;
 select count(*) into capacity from unnest(public.kickx_formation('4-3-3')) as f(position) where f.position=pos;
 if capacity=0 then raise exception 'POSITION_UNAVAILABLE';end if;
 select count(*) into owned from public.holdings h join public.players p on p.id=h.player_id
 where h.user_id=p_user and p.position=pos;
 if owned>=capacity then raise exception 'POSITION_FULL';end if;
end $$;
revoke all on function public.kickx_require_position_capacity(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.kickx_quote(p_player text,p_side text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();begin
 perform public.kickx_economy_lock();
 if p_side='buy' and exists(select 1 from public.kickx_policy where club_competitions_enabled) and not exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=p_player and t.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) then raise exception 'OUTSIDE_MARKET_SCOPE';end if;
 if exists(select 1 from public.kickx_policy where version='form-v2') and not exists(select 1 from public.player_market_snapshots where id=p_player and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 if (public.kickx_trade_window(p_player,clock_timestamp())->>'locked')::boolean then raise exception 'MATCH_TRADING_LOCKED';end if;
 if p_side='buy' then perform public.kickx_require_position_capacity(u,p_player);end if;
 return public.kickx_quote_base(p_player,p_side);
end $$;
create or replace function public.kickx_trade(p_quote uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();target text;side text;begin
 perform public.kickx_economy_lock();
 if exists(select 1 from public.trades where user_id=u and (quote_id=p_quote or request_id=p_request)) then return public.kickx_trade_base(p_quote,p_request);end if;
 select player_id,trade_quotes.side into target,side from public.trade_quotes where id=p_quote and user_id=u;
 if target is not null and (public.kickx_trade_window(target,clock_timestamp())->>'locked')::boolean then raise exception 'MATCH_TRADING_LOCKED';end if;
 if side='buy' and exists(select 1 from public.kickx_policy where club_competitions_enabled) and not exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=target and t.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) then raise exception 'OUTSIDE_MARKET_SCOPE';end if;
 if target is not null and exists(select 1 from public.kickx_policy where version='form-v2') and not exists(select 1 from public.player_market_snapshots where id=target and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 if side='buy' then perform public.kickx_require_position_capacity(u,target);end if;
 return public.kickx_trade_base(p_quote,p_request);
end $$;

-- Keep older entry points private: clients must go through all trading checks.
revoke all on function public.kickx_quote_base(text,text),public.kickx_trade_base(uuid,uuid) from public,anon,authenticated;
