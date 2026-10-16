-- KICK-X 2026-10-17: run ONCE in the Supabase SQL Editor as owner.
-- Requires existing migrations through 202610140001. No credentials to edit.
begin;
-- Match trading windows, category-free community and a separately leased minute worker.
-- Existing migrations remain immutable. Apply as the database owner.
alter table public.fixtures add column finished_observed_at timestamptz;
update public.fixtures set finished_observed_at=updated_at where status in ('FT','AET','PEN','AWD','WO');
create function public.kickx_observe_fixture_end() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status in ('FT','AET','PEN','AWD','WO') then
  if TG_OP='INSERT' then new.finished_observed_at:=coalesce(new.finished_observed_at,clock_timestamp());
  elsif old.status not in ('FT','AET','PEN','AWD','WO') or old.finished_observed_at is null then new.finished_observed_at:=clock_timestamp();
  else new.finished_observed_at:=old.finished_observed_at;end if;
 else new.finished_observed_at:=null;end if;
 return new;
end $$;
create trigger fixture_end_observation before insert or update on public.fixtures for each row execute function public.kickx_observe_fixture_end();
create index fixture_trade_windows on public.fixtures(starts_at,status);
-- Never infer the final whistle from kickoff + 90 minutes: stoppage/extra time matter.
-- An unconfirmed end remains locked; a postponed/cancelled match releases its lock.
create function public.kickx_trade_window(p_player text,p_at timestamptz default now()) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('locked',true,'fixtureId',f.id,'startsAt',f.starts_at,'finishedAt',f.finished_observed_at,'unlockAt',case when f.status in ('FT','AET','PEN','AWD','WO') then f.finished_observed_at+interval '10 minutes' end)
 from public.fixtures f join public.players p on p.id=p_player
 where (p.team_id in(f.home_team_id,f.away_team_id) or exists(select 1 from public.football_match_stats m where m.fixture_id=f.id and m.player_id=p.id))
 and p_at>=f.starts_at-interval '90 minutes'
 and f.status not in ('PST','CANC')
 and (f.status not in ('FT','AET','PEN','AWD','WO') or f.finished_observed_at is null or p_at<f.finished_observed_at+interval '10 minutes')
 order by f.starts_at limit 1),jsonb_build_object('locked',false))
$$;
create function public.kickx_trade_windows(p_players text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if cardinality(p_players)>100 then raise exception 'INVALID_INPUT';end if;
 select coalesce(jsonb_object_agg(id,public.kickx_trade_window(id,now())),'{}') into result from public.players where id=any(p_players);
 return result;
end $$;
revoke all on function public.kickx_trade_window(text,timestamptz),public.kickx_trade_windows(text[]) from public;
grant execute on function public.kickx_trade_window(text,timestamptz),public.kickx_trade_windows(text[]) to anon,authenticated,service_role;
create or replace function public.kickx_quote(p_player text,p_side text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();begin
 perform public.kickx_economy_lock();
 if p_side='buy' and exists(select 1 from public.kickx_policy where club_competitions_enabled) and not exists(select 1 from public.players p join public.teams t on t.id=p.team_id where p.id=p_player and t.league_id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')) then raise exception 'OUTSIDE_MARKET_SCOPE';end if;
 if exists(select 1 from public.kickx_policy where version='form-v2') and not exists(select 1 from public.player_market_snapshots where id=p_player and pricing_status='ready') then raise exception 'PRICE_RECALCULATING';end if;
 if (public.kickx_trade_window(p_player,clock_timestamp())->>'locked')::boolean then raise exception 'MATCH_TRADING_LOCKED';end if;
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
 return public.kickx_trade_base(p_quote,p_request);
end $$;
-- Old internal entry points must not let clients bypass the new checks.
revoke all on function public.kickx_quote_base(text,text),public.kickx_trade_base(uuid,uuid) from public,anon,authenticated;
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
create or replace function public.kickx_post_json(p public.community_posts) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'author',coalesce((select nickname from public.profiles where id=p.author_id),'탈퇴한 사용자'),'authorId',p.author_id,'scope',p.scope,'target',p.target,'targetName',case when p.scope='club' then (select coalesce(name_ko,name) from public.teams where id=p.target) else (select coalesce(x.name_ko,n.display_name,x.name) from public.players x left join public.player_names n on n.player_id=x.id where x.id=p.target) end,'title',p.title,'body',p.body,'date',p.created_at,'updatedAt',p.updated_at,'revision',p.revision,'likes',(select count(*) from public.community_likes where post_id=p.id),'liked',exists(select 1 from public.community_likes where post_id=p.id and user_id=auth.uid()),'views',(select count(*) from public.community_views where post_id=p.id),'commentCount',(select count(*) from public.community_comments where post_id=p.id and status='published'),'transaction',(select jsonb_build_object('id',t.id,'playerId',t.player_id,'playerName',t.player_name,'type',t.side,'quantity',1,'price',t.price,'fee',t.fee,'net',t.net,'date',t.created_at,'status','체결') from public.trades t where t.id=p.trade_id and t.user_id=p.author_id))
$$;
create or replace function public.kickx_posts(p_scope text default null,p_target text default null,p_query text default '',p_category text default null,p_sort text default 'new',p_page integer default 1,p_size integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n bigint;begin
 if p_page not between 1 and 10000 or p_size not between 1 and 50 or char_length(p_query)>100 then raise exception 'INVALID_INPUT';end if;
 select count(*) into n from public.community_posts p where status='published' and (p_scope is null or scope=p_scope) and(p_target is null or target=p_target)  and(position(lower(coalesce(p_query,'')) in lower(title||' '||body))>0);
 select coalesce(jsonb_agg(item),'[]') into result from(select public.kickx_post_json(p) as item from public.community_posts p where status='published' and(p_scope is null or scope=p_scope) and(p_target is null or target=p_target)  and(position(lower(coalesce(p_query,'')) in lower(title||' '||body))>0) order by case when p_sort='popular' then (select count(*) from public.community_likes where post_id=p.id) end desc,created_at desc,id limit p_size offset (p_page-1)*p_size) q;
 return jsonb_build_object('items',result,'total',n,'page',p_page,'size',p_size);
end $$;
-- Drop the category after every consumer has been replaced. Keep the old RPC argument
-- ignored for cached clients during deployment; it can never filter or write posts.
alter table public.community_posts drop column category;

-- Credentials live in Vault (installed by the separate operations script), not in these tables.
create table public.realtime_worker_state(singleton boolean primary key default true check(singleton),lease uuid,lease_until timestamptz,last_started_at timestamptz,last_success_at timestamptz,last_checked_at timestamptz,last_error text,summary jsonb not null default '{}');
insert into public.realtime_worker_state(singleton) values(true);
create table public.realtime_fixture_tasks(fixture_id text primary key references public.fixtures(id),payload jsonb not null,priority integer not null default 10,retry_at timestamptz not null default now(),attempts integer not null default 0,error_code text);
create table public.realtime_fixture_checks(fixture_id text primary key references public.fixtures(id),checked_at timestamptz not null default now(),retry_at timestamptz not null default now(),detail jsonb);
create table public.realtime_calendar_checks(league_id text primary key references public.leagues(id),retry_at timestamptz not null default now(),offset_value integer not null default 0,season_id bigint,season_year integer);
do $$declare t text;begin
 foreach t in array array['realtime_worker_state','realtime_fixture_tasks','realtime_fixture_checks','realtime_calendar_checks'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- SECURITY INVOKER + service-role-only grants authenticate incoming machine credentials.
create function public.kickx_realtime_due_fixtures(p_at timestamptz default now()) returns setof public.fixtures language sql stable set search_path='' as $$
 select f.* from public.fixtures f
 left join public.realtime_fixture_checks c on c.fixture_id=f.id
 where f.provider='bsd' and f.starts_at<=p_at+interval '10 minutes' and f.status not in ('PST','CANC')
 and (f.starts_at>=p_at-interval '1 day' or f.status not in ('FT','AET','PEN','AWD','WO'))
 and coalesce(c.retry_at,'-infinity')<=p_at
 and not exists(select 1 from public.realtime_fixture_tasks t where t.fixture_id=f.id)
 and exists(select 1 from public.football_entity_sources e where e.kind='league' and e.raw#>>'{currentSeason,season,id}'=f.provider_season_id::text and e.raw#>>'{currentSeason,season,is_current}'='true' and e.raw#>>'{currentSeason,season,end_date}'>=to_char(p_at,'YYYY-MM-DD'))
 order by case when f.starts_at>=p_at-interval '4 hours' then 0 else 1 end,coalesce(c.retry_at,'-infinity'),f.starts_at desc limit 16
$$;
revoke all on function public.kickx_realtime_due_fixtures(timestamptz) from public,anon,authenticated;
grant execute on function public.kickx_realtime_due_fixtures(timestamptz) to service_role;
create function public.kickx_realtime_claim() returns jsonb language plpgsql set search_path='' as $$
declare s public.realtime_worker_state%rowtype;t uuid:=gen_random_uuid();begin
 select * into s from public.realtime_worker_state where singleton for update;
 if s.lease_until>clock_timestamp() then return jsonb_build_object('busy',true);end if;
 update public.realtime_worker_state set lease=t,lease_until=clock_timestamp()+interval '90 seconds',last_started_at=clock_timestamp() where singleton;
 return jsonb_build_object('token',t,'now',clock_timestamp());
end $$;
create function public.kickx_realtime_finish(p_token uuid,p_summary jsonb,p_error text default null) returns void language plpgsql set search_path='' as $$
begin
 update public.realtime_worker_state set lease=null,lease_until=null,summary=p_summary,last_checked_at=case when coalesce((p_summary->>'checked')::int,0)>0 then clock_timestamp() else last_checked_at end,last_success_at=case when p_error is null then clock_timestamp() else last_success_at end,last_error=p_error where singleton and lease=p_token;
 if not found then raise exception 'STALE_AUTOMATION_LEASE';end if;
end $$;
revoke all on function public.kickx_realtime_claim(),public.kickx_realtime_finish(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.kickx_realtime_claim(),public.kickx_realtime_finish(uuid,jsonb,text) to service_role;
create function public.kickx_data_freshness() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lastCheckedAt',greatest(s.last_checked_at,(select max(checked_at) from public.automatic_fixture_checks)),'lastSuccessAt',greatest(s.last_success_at,a.last_success),'lastError',coalesce(s.last_error,a.last_error),'priceUpdatedAt',(select max(updated_at) from public.player_market_snapshots),'workerRunning',s.lease_until>now()) from public.realtime_worker_state s cross join public.automation_state a where s.singleton and a.singleton
$$;
revoke all on function public.kickx_data_freshness() from public;
grant execute on function public.kickx_data_freshness() to anon,authenticated,service_role;
-- Upcoming/just-finished calculations retry quickly; old historical failures back off.
create or replace function public.kickx_ack_calculation(p_player text,p_revision uuid,p_error text default null) returns void language plpgsql set search_path='' as $$
begin
 if p_error is null then delete from public.calculation_queue where player_id=p_player and revision=p_revision;
 else update public.calculation_queue set attempts=attempts+1,error_code=p_error,retry_at=clock_timestamp()+case when exists(select 1 from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id where m.player_id=p_player and f.starts_at>clock_timestamp()-interval '6 hours') then interval '1 minute' when p_error='CALCULATION_WITHHELD' then interval '1 day' else interval '15 minutes' end where player_id=p_player and revision=p_revision;end if;
end $$;
notify pgrst,'reload schema';
-- Run as the Supabase SQL Editor owner after 202610170001.
-- No credentials are pasted here: the existing GitHub Secrets configure Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.kickx_configure_minute_worker(p_bsd_key text,p_service_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item record;secret_id uuid;old_value text;begin
 if p_bsd_key is null or char_length(p_bsd_key) not between 8 and 512 or p_service_key is null or char_length(p_service_key) not between 20 and 2048 then raise exception 'INVALID_INPUT';end if;
 for item in select 'kickx_bsd_key' as name,p_bsd_key as value union all select 'kickx_worker_service_key',p_service_key loop
  select id,decrypted_secret into secret_id,old_value from vault.decrypted_secrets where name=item.name;
  if secret_id is null then perform vault.create_secret(item.value,item.name);
  elsif old_value is distinct from item.value then perform vault.update_secret(secret_id,item.value);end if;
 end loop;
 return jsonb_build_object('configured',true);
end $$;
revoke all on function public.kickx_configure_minute_worker(text,text) from public,anon,authenticated;
grant execute on function public.kickx_configure_minute_worker(text,text) to service_role;

create or replace function public.kickx_dispatch_minute_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare service_key text;bsd_key text;request_id bigint;begin
 -- An idle DB checks calendars every 15 minutes, with no BSD calls on other ticks.
 if not exists(select 1 from public.realtime_worker_state where singleton and coalesce(lease_until,'-infinity')<=now()) then return null;end if;
 if not exists(select 1 from public.kickx_realtime_due_fixtures(now()))
 and not exists(select 1 from public.realtime_fixture_tasks where retry_at<=now())
 and not exists(select 1 from public.calculation_queue where retry_at<=now())
 and extract(minute from now())::int % 15<>0 then return null;end if;
 select decrypted_secret into service_key from vault.decrypted_secrets where name='kickx_worker_service_key';
 select decrypted_secret into bsd_key from vault.decrypted_secrets where name='kickx_bsd_key';
 if service_key is null or bsd_key is null then return null;end if;
 -- Fixed trusted origin: never forward either secret to a caller-selected URL.
 select net.http_post(url:='https://kick-x-test.vercel.app/api/internal/football',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key),body:=jsonb_build_object('bsdKey',bsd_key),timeout_milliseconds:=65000) into request_id;
 return request_id;
end $$;
revoke all on function public.kickx_dispatch_minute_worker() from public,anon,authenticated;
-- Named cron.schedule replaces its own schedule instead of creating duplicates.
select cron.schedule('kickx-football-minute','* * * * *','select public.kickx_dispatch_minute_worker();');
notify pgrst,'reload schema';
commit;
