begin;
create function public.kickx_member_data() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member(); w public.wallets%rowtype; holdings_json jsonb; trades_json jsonb; owned_json jsonb; squad_json jsonb; total bigint; assets bigint;profit bigint; rank_value bigint;begin
 select * into w from public.wallets where user_id=u;if not found then raise exception 'PROFILE_REQUIRED';end if;
 select coalesce(sum(s.price),0)::bigint,coalesce(sum(s.price-h.cost),0)::bigint,coalesce(jsonb_agg(jsonb_build_object('id',h.player_id,'playerId',h.player_id,'playerName',coalesce(n.display_name,p.name),'quantity',1,'cost',h.cost,'value',s.price,'profit',s.price-h.cost,'returnRate',round((s.price-h.cost)*100/h.cost,4)) order by h.acquired_at,h.player_id),'[]') into assets,profit,holdings_json from public.holdings h join public.players p on p.id=h.player_id left join public.player_names n on n.player_id=p.id join public.player_market_snapshots s on s.id=h.player_id where h.user_id=u;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into owned_json from public.player_catalog p join public.holdings h on h.player_id=p.id where h.user_id=u;
 select coalesce(jsonb_agg(item),'[]') into trades_json from(select jsonb_build_object('id',t.id,'playerId',t.player_id,'playerName',t.player_name,'type',t.side,'quantity',1,'price',t.price,'fee',t.fee,'net',t.net,'date',t.created_at,'status','체결') as item from public.trades t where user_id=u order by created_at desc,id desc limit 200) q;
 select jsonb_build_object('formationId',s.formation_id,'slots',to_jsonb(s.slots),'revision',s.revision,'value',(select coalesce(sum(price),0) from public.player_market_snapshots where id=any(s.slots)),'performance',(select case when count(*)=count(performance) then round(avg(performance),2) else null end from public.player_market_snapshots where id=any(s.slots))) into squad_json from public.squads s where user_id=u;
 select (v->>'rank')::bigint into rank_value from (select * from public.ranking_snapshots where period='weekly' and starts_at<=now() and ends_at>now() order by calculated_at desc limit 1) r cross join lateral jsonb_array_elements(r.rows) v where v->>'userId'=u::text;
 total:=w.balance+assets;
 return jsonb_build_object('financialReady',true,'points',w.balance,'totalAssets',total,'playerAssets',assets,'profit',profit,'realizedProfit',total-w.initial_points-profit,'returnRate',round((total-w.initial_points)*100.0/w.initial_points,4),'weeklyRank',rank_value,'holdings',holdings_json,'ownedPlayers',owned_json,'transactions',trades_json,'transactionTotal',(select count(*) from public.trades where user_id=u),'watchlist',coalesce((select jsonb_agg(player_id order by player_id) from public.watchlists where user_id=u),'[]'),'assetHistory',coalesce((select jsonb_agg(jsonb_build_object('at',recorded_at,'value',value) order by recorded_at) from(select * from public.asset_snapshots where user_id=u order by recorded_at desc limit 1000) a),'[]'),'squad',squad_json);
end $$;
revoke all on function public.kickx_member_data() from public,anon;grant execute on function public.kickx_member_data() to authenticated;
-- Retain prices if a previously scored record becomes missing/blocked on correction.
-- Such a correction needs source repair; don't turn it into a synthetic zero or price reset.
create function public.kickx_check_calculation(p_player text,p_results jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.performance_results old where old.player_id=p_player and old.status in('ready','provisional') and not exists(select 1 from jsonb_array_elements(p_results) r where r->>'fixtureId'=old.fixture_id and r->>'status' in('ready','provisional')))
$$;
revoke all on function public.kickx_check_calculation(text,jsonb) from public,anon,authenticated;grant execute on function public.kickx_check_calculation(text,jsonb) to service_role;
create function public.kickx_community_counts() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('scope',scope,'target',target,'count',n)),'[]') from (select scope,target,count(*) n from public.community_posts where status='published' group by scope,target) x
$$;
revoke all on function public.kickx_community_counts() from public;
grant execute on function public.kickx_community_counts() to anon,authenticated;
create function public.kickx_market_summary() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('volume',(select count(*) from public.trades),'rising',count(*) filter(where change_percent>0),'falling',count(*) filter(where change_percent<0),'pricedPlayers',count(*) filter(where price is not null and exists(select 1 from public.players p where p.id=player_market_snapshots.id and p.trade_status is null)),'calculatedAt',max(updated_at)) from public.player_market_snapshots
$$;
revoke all on function public.kickx_market_summary() from public;grant execute on function public.kickx_market_summary() to anon,authenticated;
commit;
