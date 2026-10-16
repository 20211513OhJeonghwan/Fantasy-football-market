begin;
create table public.player_names(player_id text primary key references public.players(id),display_name text not null check(char_length(display_name) between 1 and 80),aliases text[] not null default '{}',updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),check(cardinality(aliases)<=20));
alter table public.player_names enable row level security;
grant select on public.player_names to anon,authenticated;grant all on public.player_names to service_role;
create policy names_read on public.player_names for select using(true);
-- p.* is unchanged: append display columns and preserve the dependent view contract.
create or replace view public.player_catalog with(security_invoker=true) as
select p.*,t.league_id,
 case when t.league_id is not null then array[t.league_id] else coalesce(ss.league_ids,'{}'::text[]) end as league_ids,
 concat_ws(' ',p.name,p.english,t.name,t.english,l.name,(select string_agg(l2.name,' ') from public.leagues l2 where l2.id=any(ss.league_ids)),n.display_name,array_to_string(n.aliases,' ')) as search_text,
 s.price,s.change_percent,s.performance,s.volume,coalesce(s.goals,ss.goals) as goals,coalesce(s.assists,ss.assists) as assists,coalesce(s.minutes,ss.minutes) as minutes,ss.season,
 s.updated_at as market_updated_at,ss.stats_scope,ss.matches_imported,n.display_name,n.aliases
from public.players p left join public.teams t on t.id=p.team_id left join public.leagues l on l.id=t.league_id left join public.player_market_snapshots s on s.id=p.id left join public.player_season_summaries ss on ss.id=p.id left join public.player_names n on n.player_id=p.id;
create function public.owned_player_catalog() returns setof public.player_catalog language sql stable security invoker set search_path='' as $$select p.* from public.player_catalog p where exists(select 1 from public.holdings h where h.player_id=p.id and h.user_id=(select auth.uid()))$$;
revoke all on function public.owned_player_catalog() from public,anon;grant execute on function public.owned_player_catalog() to authenticated;
create table public.community_posts(id uuid primary key default gen_random_uuid(),author_id uuid not null references auth.users(id),scope text not null check(scope in('club','player')),target text not null,category text not null check(category in('자유','경기 분석','선수 토론','거래 후기','질문')),title text not null check(char_length(title) between 2 and 80),body text not null check(char_length(body) between 10 and 3000),trade_id uuid references public.trades(id),status text not null default 'published' check(status in('published','hidden','deleted')),revision integer not null default 1,request_id uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(author_id,request_id));
create index posts_lounge_time on public.community_posts(scope,target,created_at desc) where status='published';
create table public.community_comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.community_posts(id),author_id uuid not null references auth.users(id),parent_id uuid references public.community_comments(id),body text not null check(char_length(body) between 1 and 1000),status text not null default 'published' check(status in('published','hidden','deleted')),revision integer not null default 1,request_id uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(author_id,request_id));
create index comments_post_time on public.community_comments(post_id,created_at);
create table public.community_likes(user_id uuid not null references auth.users(id),post_id uuid not null references public.community_posts(id),created_at timestamptz not null default now(),primary key(user_id,post_id));
create table public.community_views(user_id uuid not null references auth.users(id),post_id uuid not null references public.community_posts(id),day date not null default (now() at time zone 'Asia/Seoul')::date,primary key(user_id,post_id,day));
create table public.community_reports(id uuid primary key default gen_random_uuid(),reporter uuid not null references auth.users(id),post_id uuid not null references public.community_posts(id),comment_id uuid references public.community_comments(id),reason text not null check(char_length(reason) between 5 and 500),status text not null default 'open' check(status in('open','hidden','dismissed','restored')),resolution text,created_at timestamptz not null default now(),resolved_at timestamptz);
create unique index report_once on public.community_reports(reporter,post_id,coalesce(comment_id,'00000000-0000-0000-0000-000000000000'::uuid)) where status='open';
create table public.community_revisions(id uuid primary key default gen_random_uuid(),post_id uuid references public.community_posts(id),comment_id uuid references public.community_comments(id),actor uuid not null references auth.users(id),before_value jsonb not null,created_at timestamptz not null default now());
create function public.kickx_can_write_lounge(u uuid,s text,t text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles p where p.id=u and (s='player' or p.team_id=t))$$;
create function public.kickx_community_write(p_action text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member(); post public.community_posts%rowtype; c public.community_comments%rowtype; target_comment public.community_comments%rowtype; id_value uuid; req uuid; t uuid; body_value text; title_value text; begin
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
create function public.kickx_moderate(p_report uuid,p_action text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_admin(); r public.community_reports%rowtype; old_value jsonb; begin
 if p_action not in('hide','dismiss','restore') or p_action is null or char_length(btrim(p_reason)) not between 5 and 500 or p_reason is null then raise exception 'INVALID_INPUT';end if;
 select * into r from public.community_reports where id=p_report for update;if not found then raise exception 'REPORT_NOT_FOUND';end if;
 if (p_action in('hide','dismiss') and r.status<>'open') or (p_action='restore' and r.status<>'hidden') then raise exception 'STALE_REVISION';end if;
 if p_action in('hide','restore') then
  if r.comment_id is null then
   select to_jsonb(p) into old_value from public.community_posts p where p.id=r.post_id and p.status<>'deleted' for update;
   if not found then raise exception 'POST_NOT_FOUND';end if;
   update public.community_posts set status=case when p_action='hide' then 'hidden' else 'published' end,revision=revision+1,updated_at=now() where id=r.post_id;
  else
   select to_jsonb(c) into old_value from public.community_comments c where c.id=r.comment_id and c.status<>'deleted' for update;
   if not found then raise exception 'POST_NOT_FOUND';end if;
   update public.community_comments set status=case when p_action='hide' then 'hidden' else 'published' end,revision=revision+1,updated_at=now() where id=r.comment_id;
  end if;
 end if;
 update public.community_reports set status=case p_action when 'hide' then 'hidden' when 'dismiss' then 'dismissed' else 'restored' end,resolution=btrim(p_reason),resolved_at=now() where id=r.id;
 insert into public.operation_audit(actor,action,target,detail) values(u,'community.'||p_action,r.id::text,jsonb_build_object('reason',p_reason,'before',old_value));
 return jsonb_build_object('id',r.id);
end $$;
create function public.kickx_save_player_name(p_player text,p_name text,p_aliases text[]) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_admin();begin
 if cardinality(p_aliases)>20 or exists(select 1 from unnest(p_aliases) x where char_length(x)>80 or x is null) then raise exception 'INVALID_INPUT';end if;
 insert into public.player_names(player_id,display_name,aliases,updated_by) values(p_player,btrim(p_name),coalesce(p_aliases,'{}'),u) on conflict(player_id) do update set display_name=excluded.display_name,aliases=excluded.aliases,updated_by=u,updated_at=now();
 insert into public.operation_audit(actor,action,target,detail) values(u,'player.name',p_player,jsonb_build_object('displayName',p_name,'aliases',p_aliases));
end $$;
do $$declare t text;begin
 foreach t in array array['community_posts','community_comments','community_likes','community_views','community_reports','community_revisions'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- Public response functions expose only published content and public pseudonyms.
-- Private trade/like/view/reporter rows remain unreadable to other members.
create function public.kickx_post_json(p public.community_posts) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'author',coalesce((select nickname from public.profiles where id=p.author_id),'탈퇴한 사용자'),'authorId',p.author_id,'scope',p.scope,'target',p.target,'targetName',case when p.scope='club' then (select name from public.teams where id=p.target) else (select coalesce(n.display_name,x.name) from public.players x left join public.player_names n on n.player_id=x.id where x.id=p.target) end,'category',p.category,'title',p.title,'body',p.body,'date',p.created_at,'updatedAt',p.updated_at,'revision',p.revision,'likes',(select count(*) from public.community_likes where post_id=p.id),'liked',exists(select 1 from public.community_likes where post_id=p.id and user_id=auth.uid()),'views',(select count(*) from public.community_views where post_id=p.id),'commentCount',(select count(*) from public.community_comments where post_id=p.id and status='published'),'transaction',(select jsonb_build_object('id',t.id,'playerId',t.player_id,'playerName',t.player_name,'type',t.side,'quantity',1,'price',t.price,'fee',t.fee,'net',t.net,'date',t.created_at,'status','체결') from public.trades t where t.id=p.trade_id and t.user_id=p.author_id))
$$;
create function public.kickx_posts(p_scope text default null,p_target text default null,p_query text default '',p_category text default null,p_sort text default 'new',p_page integer default 1,p_size integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n bigint;begin
 if p_page not between 1 and 10000 or p_size not between 1 and 50 or char_length(p_query)>100 then raise exception 'INVALID_INPUT';end if;
 select count(*) into n from public.community_posts p where status='published' and (p_scope is null or scope=p_scope) and(p_target is null or target=p_target) and(p_category is null or category=p_category) and(position(lower(coalesce(p_query,'')) in lower(title||' '||body))>0);
 select coalesce(jsonb_agg(item),'[]') into result from(select public.kickx_post_json(p) as item from public.community_posts p where status='published' and(p_scope is null or scope=p_scope) and(p_target is null or target=p_target) and(p_category is null or category=p_category) and(position(lower(coalesce(p_query,'')) in lower(title||' '||body))>0) order by case when p_sort='popular' then (select count(*) from public.community_likes where post_id=p.id) end desc,created_at desc,id limit p_size offset (p_page-1)*p_size) q;
 return jsonb_build_object('items',result,'total',n,'page',p_page,'size',p_size);
end $$;
create function public.kickx_post_detail(p_id uuid,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.community_posts%rowtype; comments jsonb;begin
 if p_page not between 1 and 10000 then raise exception 'INVALID_INPUT';end if;
 select * into p from public.community_posts where id=p_id and status='published';if not found then return jsonb_build_object('post',null,'comments','[]'::jsonb);end if;
 select coalesce(jsonb_agg(item),'[]') into comments from(select jsonb_build_object('id',c.id,'postId',c.post_id,'authorId',c.author_id,'author',coalesce((select nickname from public.profiles where id=c.author_id),'탈퇴한 사용자'),'body',c.body,'parentId',c.parent_id,'date',c.created_at,'revision',c.revision,'updatedAt',c.updated_at) as item from public.community_comments c where c.post_id=p.id and c.status='published' order by c.created_at,c.id limit 50 offset (p_page-1)*50) q;
 return jsonb_build_object('post',public.kickx_post_json(p),'comments',comments);
end $$;
revoke all on function public.kickx_can_write_lounge(uuid,text,text),public.kickx_post_json(public.community_posts),public.kickx_community_write(text,jsonb),public.kickx_moderate(uuid,text,text),public.kickx_save_player_name(text,text,text[]),public.kickx_posts(text,text,text,text,text,integer,integer),public.kickx_post_detail(uuid,integer) from public,anon,authenticated;
grant execute on function public.kickx_community_write(text,jsonb),public.kickx_moderate(uuid,text,text),public.kickx_save_player_name(text,text,text[]) to authenticated;
grant execute on function public.kickx_posts(text,text,text,text,text,integer,integer),public.kickx_post_detail(uuid,integer) to anon,authenticated;
commit;
