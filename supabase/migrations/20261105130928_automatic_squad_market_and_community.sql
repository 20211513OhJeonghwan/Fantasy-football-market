-- Purchases are the lineup: 4-3-3 holdings quotas, atomic automatic placement.
-- Existing excess assets are retained. Only their owner's further buys are blocked.
create or replace function public.kickx_require_position_capacity(p_user uuid,p_player text)
returns void language plpgsql set search_path='' as $$
declare pos text;n integer;cap integer;begin
 select position into pos from public.players where id=p_player;
 if pos is null or pos not in('GK','DF','MF','FW') then raise exception 'POSITION_UNAVAILABLE';end if;
 if exists(select 1 from public.holdings where user_id=p_user and player_id=p_player) then raise exception 'ALREADY_OWNED';end if;
 if exists(select 1 from public.holdings h join public.players p on p.id=h.player_id where h.user_id=p_user
  group by p.position having count(*)>case p.position when 'GK' then 1 when 'DF' then 4 when 'MF' then 3 when 'FW' then 3 else 0 end) then raise exception 'LEGACY_SQUAD_EXCESS';end if;
 if (select count(*) from public.holdings where user_id=p_user)>=11 then raise exception 'SQUAD_FULL';end if;
 cap:=case pos when 'GK' then 1 when 'DF' then 4 else 3 end;
 select count(*) into n from public.holdings h join public.players p on p.id=h.player_id where h.user_id=p_user and p.position=pos;
 if n>=cap then raise exception 'POSITION_FULL';end if;
end $$;
revoke all on function public.kickx_require_position_capacity(uuid,text) from public,anon,authenticated;

-- Called only while the existing economy lock is held; clients cannot supply another user.
create or replace function kickx_private.kickx_sync_owned_squad(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare f text[]:=array['GK','DF','DF','DF','DF','MF','MF','MF','FW','FW','FW'];
 old public.squads%rowtype;next_slots text[]:=array_fill(null::text,array[11]);i integer;candidate text;begin
 perform public.kickx_economy_lock();
 select * into old from public.squads where user_id=p_user for update;
 for i in 1..11 loop
  candidate:=null;
  if old.formation_id='4-3-3' and old.slots[i] is not null and not old.slots[i]=any(array_remove(next_slots,null)) and exists(
   select 1 from public.holdings h join public.players p on p.id=h.player_id where h.user_id=p_user and h.player_id=old.slots[i] and p.position=f[i]) then
   next_slots[i]:=old.slots[i];
  end if;
 end loop;
 for i in 1..11 loop
  if next_slots[i] is null then
   select h.player_id into candidate from public.holdings h join public.players p on p.id=h.player_id
   where h.user_id=p_user and p.position=f[i] and not h.player_id=any(array_remove(next_slots,null))
   order by h.acquired_at,h.player_id limit 1;
   next_slots[i]:=candidate;
  end if;
 end loop;
 insert into public.squads(user_id,formation_id,slots) values(p_user,'4-3-3',next_slots)
 on conflict(user_id) do update set formation_id='4-3-3',slots=excluded.slots,revision=public.squads.revision+1,updated_at=now()
 where public.squads.formation_id is distinct from '4-3-3' or public.squads.slots is distinct from excluded.slots;
end $$;
revoke all on function kickx_private.kickx_sync_owned_squad(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.kickx_trade(p_quote uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=public.kickx_require_active_member();target text;side text;receipt jsonb;begin
 perform public.kickx_economy_lock();
 if exists(select 1 from public.trades where user_id=u and (quote_id=p_quote or request_id=p_request)) then return public.kickx_trade_base(p_quote,p_request);end if;
 select player_id,trade_quotes.side into target,side from public.trade_quotes where id=p_quote and user_id=u;
 if target is not null and (public.kickx_trade_window(target,clock_timestamp())->>'locked')::boolean then raise exception 'MATCH_TRADING_LOCKED';end if;
 if side='buy' and exists(select 1 from public.kickx_policy where (club_competitions_enabled or version='report-v3')) and not exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=target and t.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) then raise exception 'OUTSIDE_MARKET_SCOPE';end if;
 if target is not null and exists(select 1 from public.kickx_policy where version in('form-v2','report-v3')) and not exists(select 1 from public.player_market_snapshots where id=target and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 if side='buy' then perform public.kickx_require_position_capacity(u,target);end if;
 receipt:=public.kickx_trade_base(p_quote,p_request);
 perform kickx_private.kickx_sync_owned_squad(u);
 return receipt;
end $function$
;

-- Retain a compatible RPC, but it cannot unplace or replace owned players.
create or replace function public.kickx_save_squad(p_formation text,p_slots text[],p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();current_squad public.squads%rowtype;begin
 perform public.kickx_economy_lock();
 if p_formation is distinct from '4-3-3' or p_slots is null or cardinality(p_slots)<>11 or array_ndims(p_slots)<>1 or array_lower(p_slots,1)<>1 then raise exception 'INVALID_SQUAD';end if;
 perform kickx_private.kickx_sync_owned_squad(u);
 select * into strict current_squad from public.squads where user_id=u;
 if p_revision is distinct from current_squad.revision then raise exception 'STALE_REVISION';end if;
 if p_slots is distinct from current_squad.slots then raise exception 'AUTO_SQUAD_MANAGED';end if;
 return to_jsonb(current_squad);
end $$;

-- Backfill presentation only. No trades, wallet balances, holdings or acquisition costs change.
do $$declare r record;financial_before jsonb;begin
 perform public.kickx_economy_lock();
 financial_before:=public.kickx_valuation_integrity();
 for r in select user_id from public.holdings union select user_id from public.squads loop
  perform kickx_private.kickx_sync_owned_squad(r.user_id);
 end loop;
 if financial_before is distinct from public.kickx_valuation_integrity() then raise exception 'SQUAD_FINANCIAL_INTEGRITY';end if;
 insert into public.operation_audit(action,detail) values('squad.automatic-migration',jsonb_build_object('financialUnchanged',true,'integrity',financial_before));
end $$;

CREATE OR REPLACE FUNCTION public.kickx_community_write(p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=public.kickx_require_active_member(); post public.community_posts%rowtype; c public.community_comments%rowtype; target_comment public.community_comments%rowtype; id_value uuid; req uuid; t uuid; body_value text; title_value text; begin
 -- Serializes permissions, cooldown and idempotency for the same author.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:community:'||u::text,0));
 if p_action in('createPost','editPost') and (char_length(btrim(coalesce(p_input->>'title','')))<2 or char_length(btrim(p_input->>'title'))>80) then raise exception 'TITLE_REQUIRED';end if;
 if p_action='createPost' then
  req:=(p_input->>'requestId')::uuid;if req is null then raise exception 'INVALID_INPUT';end if;
  select * into post from public.community_posts where author_id=u and request_id=req;if found then return jsonb_build_object('id',post.id);end if;
  if not public.kickx_can_write_lounge(u,p_input->>'scope',p_input->>'target') then raise exception 'FAN_REQUIRED';end if;
  if (p_input->>'scope'='club' and not exists(select 1 from public.teams where id=p_input->>'target')) or (p_input->>'scope'='player' and not exists(select 1 from public.players where id=p_input->>'target')) then raise exception 'INVALID_TARGET';end if;
  if exists(select 1 from public.community_posts where author_id=u and created_at>now()-interval '3 seconds') then raise exception 'TOO_FAST';end if;
  t:=nullif(p_input->>'transaction','')::uuid;
  if t is not null and not exists(select 1 from public.trades where id=t and user_id=u) then raise exception 'TRADE_NOT_OWNED';end if;
   if (p_input->>'scope')='player' and t is not null and not exists(select 1 from public.trades where id=t and player_id=p_input->>'target') then raise exception 'TRADE_PLAYER_MISMATCH';end if;
  insert into public.community_posts(author_id,scope,target,title,body,trade_id,request_id) values(u,p_input->>'scope',p_input->>'target',btrim(p_input->>'title'),btrim(p_input->>'body'),t,req) returning * into post;
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
   if post.scope='player' and t is not null and not exists(select 1 from public.trades where id=t and player_id=post.target) then raise exception 'TRADE_PLAYER_MISMATCH';end if;
   update public.community_posts set title=btrim(p_input->>'title'),body=btrim(p_input->>'body'),trade_id=t,revision=revision+1,updated_at=now() where id=post.id;
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
 elsif p_action='view' then insert into public.community_views(user_id,post_id,day) values(u,post.id,(now() at time zone 'Asia/Seoul')::date) on conflict do nothing;
 elsif p_action='report' then
  t:=nullif(p_input->>'commentId','')::uuid;
  if t is not null then
   select * into target_comment from public.community_comments where id=t and post_id=post.id and status='published';
   if not found then raise exception 'INVALID_TARGET';end if;
  end if;
  insert into public.community_reports(reporter,post_id,comment_id,reason) values(u,post.id,t,btrim(p_input->>'reason')) on conflict do nothing;
 else raise exception 'INVALID_ACTION';end if;
 return jsonb_build_object('id',post.id);
end $function$
;

-- A cutover preserves the old ±2% history during deterministic replay/corrections.
-- Future finished games use ±10%; DNP remains -1.5%, and the target formula stays unchanged.
CREATE OR REPLACE FUNCTION public.kickx_report_plan(p_results jsonb, p_baseline jsonb, p_parameters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare r jsonb;steps jsonb:='[]';window_ids jsonb:='[]';v bigint;before_v bigint;b numeric;c numeric;d numeric;q numeric;total numeric:=0;
 n integer:=0;season integer;next_season integer;t double precision;lo bigint;hi bigint;dnp boolean;at_time timestamptz;
 up numeric;down numeric;
 rate numeric:=coalesce((p_parameters->>'nonParticipationRate')::numeric,.015);begin
 if jsonb_typeof(p_results) is distinct from 'array' or p_baseline is null then raise exception 'INVALID_REPORT_BASELINE';end if;
 if rate<0 or rate>=1 then raise exception 'INVALID_REPORT_PARAMETERS';end if;
 b:=(p_baseline->>'seedScore')::numeric;v:=(p_baseline->>'price')::bigint;
 if (select count(*) from jsonb_array_elements(p_results))<>(select count(distinct x->>'fixtureId')from jsonb_array_elements(p_results)x) then raise exception 'INVALID_PRICING_MATCH';end if;
 for r in select value from jsonb_array_elements(p_results)
 where ((value->>'status' in('ready','provisional') and jsonb_typeof(value->'score')='number' and (value->>'minutes')::numeric>0 and (value->>'minutes')::numeric<=180)
 or (value->>'status'='not-played' and (value->>'minutes')::numeric=0))
 and (value->>'season')::integer>(p_baseline->>'season')::integer
 order by coalesce(value->>'endedAt',value->>'startedAt')::timestamptz,value->>'fixtureId' loop
  next_season:=(r->>'season')::integer;
  if season is distinct from next_season then season:=next_season;total:=0;n:=0;window_ids:='[]';end if;
  dnp:=r->>'status'='not-played';q:=null;
  if not dnp then
   q:=greatest((p_baseline->>'lower')::numeric,least((p_baseline->>'upper')::numeric,(r->>'score')::numeric));
   total:=total+q;n:=n+1;window_ids:=window_ids||jsonb_build_array(r->>'fixtureId');
  end if;
  c:=((p_parameters->>'kappa')::numeric*b+total)/((p_parameters->>'kappa')::numeric+n);
  d:=(c-b)/greatest(abs(b),(p_parameters->>'s')::numeric);
  at_time:=coalesce(r->>'endedAt',r->>'startedAt')::timestamptz;
  if extract(epoch from at_time)*1000<coalesce((p_parameters->>'valuationStartMs')::numeric,0) then continue;end if;
  if dnp then t:=v*(1-rate);else
   t:=(p_baseline->>'price')::double precision*exp((p_parameters->>'beta')::double precision*greatest(-(p_parameters->>'deviationLimit')::numeric,least((p_parameters->>'deviationLimit')::numeric,d))::double precision);
  end if;
  t:=greatest((p_parameters->>'minPrice')::double precision,least((p_parameters->>'maxPrice')::double precision,t));
  up:=(p_parameters->>'maxUp')::numeric;down:=(p_parameters->>'maxDown')::numeric;
  if p_parameters ? 'capChangeAtMs' and extract(epoch from at_time)*1000<(p_parameters->>'capChangeAtMs')::numeric then
   up:=(p_parameters->>'previousMaxUp')::numeric;down:=(p_parameters->>'previousMaxDown')::numeric;
  end if;
  if up is null or down is null or up<0 or up>=1 or down<0 or down>=1 then raise exception 'INVALID_REPORT_PARAMETERS';end if;
  before_v:=v;lo:=greatest((p_parameters->>'minPrice')::bigint,ceil(before_v*(1-down))::bigint);
  hi:=least((p_parameters->>'maxPrice')::bigint,floor(before_v*(1+up))::bigint);
  v:=greatest(lo,least(hi,floor(t+0.5)::bigint));
  steps:=steps||jsonb_build_array(jsonb_build_object('fixtureId',r->>'fixtureId','playedAt',at_time,'priceBefore',before_v,'priceAfter',v,
   'targetPrice',floor(t+0.5)::bigint,'formScore',floor(c*1000000+0.5)/1000000,'changePercent',floor((v-before_v)*100.0/before_v*10000+0.5)/10000,
   'window',window_ids,'evidence',jsonb_build_object('season',season,'n',n,'reason',case when dnp then 'NON_PARTICIPATION' else 'PERFORMANCE'end,
    'nonParticipationRate',case when dnp then rate end,'rawScore',r->'score','boundedScore',q,'cumulativeSum',total,'cumulativeScore',c,'deviation',d,'target',t,'referenceHash',p_baseline->>'referenceHash')));
 end loop;
 return jsonb_build_object('version','report-v3','baseline',p_baseline,'price',v,'steps',steps);
end $function$
;
update public.kickx_policy set report_parameters=report_parameters||jsonb_build_object(
 'previousMaxUp',(report_parameters->>'maxUp')::numeric,
 'previousMaxDown',(report_parameters->>'maxDown')::numeric,
 'capChangeAtMs',floor(extract(epoch from clock_timestamp())*1000),
 'maxUp',0.10,'maxDown',0.10);
alter table public.kickx_policy alter column report_parameters set default
 '{"lambda":5,"kappa":4,"beta":0.3,"s":1,"deviationLimit":1,"initialMin":50000,"initialMax":150000,"minPrice":10000,"maxPrice":1000000,"maxUp":0.10,"maxDown":0.10,"nonParticipationRate":0.015,"lowerQuantile":0.05,"upperQuantile":0.95,"valuationStartMs":1791990000000}';
notify pgrst,'reload schema';

