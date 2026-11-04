begin;
set local lock_timeout='3s';

-- Small preferences on the existing profile; the existing 14-day inbox is reused.
alter table public.profiles add column comment_notifications boolean not null default true,
 add column reply_notifications boolean not null default true;
grant update(comment_notifications,reply_notifications) on public.profiles to authenticated;
alter table public.user_notifications alter column player_id drop not null,
 add column post_id uuid references public.community_posts(id) on delete cascade,
 add column comment_id uuid references public.community_comments(id) on delete cascade,
 add column actor_id uuid references auth.users(id) on delete set null;
alter table public.user_notifications drop constraint user_notifications_kind_check,
 drop constraint user_notifications_check1;
alter table public.user_notifications add constraint user_notifications_kind_check check(kind in('price','match','comment','reply')),
 add constraint user_notifications_payload_check check(
 (kind='price' and player_id is not null and price_before is not null and price_after is not null and price_before>0 and price_after>0 and price_before<>price_after)
 or(kind='match' and player_id is not null and fixture_id is not null and starts_at is not null)
 or(kind in('comment','reply') and post_id is not null and comment_id is not null));
create index user_notifications_post_idx on public.user_notifications(post_id) where post_id is not null;
create index user_notifications_comment_idx on public.user_notifications(comment_id) where comment_id is not null;
create index user_notifications_actor_idx on public.user_notifications(actor_id) where actor_id is not null;
create index community_posts_author_activity_idx on public.community_posts(author_id,created_at desc,id desc) where status='published';
create index community_comments_author_activity_idx on public.community_comments(author_id,created_at desc,id desc) where status='published';

create function kickx_private.notify_community_comment() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.community_posts%rowtype; parent_author uuid;begin
 if new.status<>'published' then return new;end if;
 select * into p from public.community_posts where id=new.post_id and status='published';
 if not found then return new;end if;
 if new.parent_id is not null then
  select author_id into parent_author from public.community_comments where id=new.parent_id and post_id=p.id and status='published';
 end if;
 -- Reply recipients take precedence when the post author also wrote the parent.
 insert into public.user_notifications(user_id,kind,post_id,comment_id,actor_id,source_key)
 select u.id,'reply',p.id,new.id,new.author_id,'comment:'||new.id
 from public.profiles u where u.id=parent_author and u.id<>new.author_id and u.reply_notifications
 on conflict(user_id,source_key)do nothing;
 insert into public.user_notifications(user_id,kind,post_id,comment_id,actor_id,source_key)
 select u.id,'comment',p.id,new.id,new.author_id,'comment:'||new.id
 from public.profiles u where u.id=p.author_id and u.id<>new.author_id
 and u.id is distinct from parent_author and u.comment_notifications
 on conflict(user_id,source_key)do nothing;
 return new;
end $$;
revoke all on function kickx_private.notify_community_comment() from public,anon,authenticated;
create trigger notify_community_comment after insert on public.community_comments
 for each row execute function kickx_private.notify_community_comment();

-- Definer code stays private. Its authenticated wrappers never accept a recipient ID.
create function kickx_private.read_notification_feed(p_before bigint,p_limit integer,p_summary boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();prefs jsonb;unread boolean;result jsonb;begin
 if u is null then raise exception 'LOGIN_REQUIRED';end if;
 if p_limit is null or p_limit not between 1 and 30 or p_before<=0 then raise exception 'INVALID_INPUT';end if;
 select jsonb_build_object('matchNotifications',match_notifications,'commentNotifications',comment_notifications,'replyNotifications',reply_notifications)
 into prefs from public.profiles where id=u;
 prefs:=coalesce(prefs,'{"matchNotifications":true,"commentNotifications":true,"replyNotifications":true}'::jsonb);
 select exists(select 1 from public.user_notifications n where n.user_id=u and n.expires_at>now() and n.read_at is null
 and(n.kind in('price','match') or exists(select 1 from public.community_comments c join public.community_posts p on p.id=c.post_id
 where c.id=n.comment_id and p.id=n.post_id and c.status='published' and p.status='published'))) into unread;
 if p_summary then return prefs||jsonb_build_object('hasUnread',unread);end if;
 with page as materialized(
  select n.* from public.user_notifications n where n.user_id=u and n.expires_at>now() and(p_before is null or n.id<p_before)
  and(n.kind in('price','match') or exists(select 1 from public.community_comments c join public.community_posts p on p.id=c.post_id
   where c.id=n.comment_id and p.id=n.post_id and c.status='published' and p.status='published'))
  order by n.id desc limit p_limit+1),
 shown as(select * from page order by id desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',n.id::text,'kind',n.kind,'playerId',n.player_id,'playerName',coalesce(x.name_ko,x.name),'teamId',x.team_id,
 'fixtureId',n.fixture_id,'homeName',coalesce(h.name_ko,h.name),'awayName',coalesce(a.name_ko,a.name),
 'startsAt',n.starts_at,'priceBefore',n.price_before,'priceAfter',n.price_after,'createdAt',n.created_at,'readAt',n.read_at,
 'postId',n.post_id,'commentId',n.comment_id,'actorName',coalesce(actor.nickname,'탈퇴한 사용자'),'postTitle',p.title,'body',left(c.body,160))
 order by n.id desc) from shown n left join public.players x on x.id=n.player_id
 left join public.fixtures f on f.id=n.fixture_id left join public.teams h on h.id=f.home_team_id left join public.teams a on a.id=f.away_team_id
 left join public.profiles actor on actor.id=n.actor_id left join public.community_posts p on p.id=n.post_id
 left join public.community_comments c on c.id=n.comment_id),'[]'::jsonb),
 'hasMore',(select count(*)>p_limit from page),'hasUnread',unread) into result;
 return result;
end $$;
revoke all on function kickx_private.read_notification_feed(bigint,integer,boolean) from public,anon;
grant usage on schema kickx_private to anon,authenticated;
grant execute on function kickx_private.read_notification_feed(bigint,integer,boolean) to authenticated,service_role;
create or replace function public.kickx_notification_summary() returns jsonb
language sql stable security invoker set search_path='' as $$select kickx_private.read_notification_feed(null,20,true)$$;
create or replace function public.kickx_notifications(p_before bigint default null,p_limit integer default 20) returns jsonb
language sql stable security invoker set search_path='' as $$select kickx_private.read_notification_feed(p_before,p_limit,false)$$;

create function public.kickx_set_community_notifications(p_comments boolean default null,p_replies boolean default null)
returns jsonb language plpgsql security invoker set search_path='' as $$begin
 if auth.uid()is null then raise exception 'LOGIN_REQUIRED';end if;
 if p_comments is null and p_replies is null then raise exception 'INVALID_INPUT';end if;
 update public.profiles set comment_notifications=coalesce(p_comments,comment_notifications),reply_notifications=coalesce(p_replies,reply_notifications)
 where id=(select auth.uid());
 if not found then raise exception 'PROFILE_REQUIRED';end if;
 return public.kickx_notification_summary();
end $$;
revoke all on function public.kickx_set_community_notifications(boolean,boolean) from public,anon;
grant execute on function public.kickx_set_community_notifications(boolean,boolean) to authenticated,service_role;

-- Preserve the existing serializer and its transaction/visibility rules.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.kickx_post_json(public.community_posts)'::regprocedure);
 if position('''authorId'',p.author_id' in definition)=0 then raise exception 'POST_SERIALIZER_CHANGED';end if;
 execute replace(definition,'''authorId'',p.author_id','''authorId'',p.author_id,''authorAvatar'',(select avatar from public.profiles where id=p.author_id)');
end $$;

-- Deleting a final result must not strand a board on an empty out-of-range page.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.kickx_posts(text,text,text,text,text,integer,integer)'::regprocedure);
 if position('select coalesce(jsonb_agg(item)' in definition)=0 then raise exception 'POST_FEED_CHANGED';end if;
 execute replace(definition,'select coalesce(jsonb_agg(item)',
 'p_page:=least(p_page,greatest(1,ceil(n::numeric/p_size)::integer)); select coalesce(jsonb_agg(item)');
end $$;

create or replace function public.kickx_post_detail(p_id uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.community_posts%rowtype;comments jsonb;n integer;pages integer;shown integer;begin
 if p_page is null or p_page not between 1 and 10000 then raise exception 'INVALID_INPUT';end if;
 select * into p from public.community_posts where id=p_id and status='published';
 if not found then return jsonb_build_object('post',null,'comments','[]'::jsonb,'page',1,'pages',1);end if;
 select count(*) into n from public.community_comments where post_id=p.id and status='published';
 pages:=greatest(1,ceil(n/50.0)::integer);shown:=least(p_page,pages);
 select coalesce(jsonb_agg(item order by created_at,id),'[]'::jsonb) into comments from(
 select c.created_at,c.id,jsonb_build_object('id',c.id,'postId',c.post_id,'authorId',c.author_id,
 'author',coalesce(author.nickname,'탈퇴한 사용자'),'authorAvatar',author.avatar,'body',c.body,'parentId',c.parent_id,
 'parentAuthor',case when parent.status='published' then coalesce(parent_author.nickname,'탈퇴한 사용자') end,
 'parentBody',case when parent.status='published' then left(parent.body,160) end,
 'date',c.created_at,'revision',c.revision,'updatedAt',c.updated_at) as item
 from public.community_comments c left join public.profiles author on author.id=c.author_id
 left join public.community_comments parent on parent.id=c.parent_id and parent.post_id=c.post_id
 left join public.profiles parent_author on parent_author.id=parent.author_id
 where c.post_id=p.id and c.status='published' order by c.created_at,c.id limit 50 offset (shown-1)*50) q;
 return jsonb_build_object('post',public.kickx_post_json(p),'comments',comments,'page',shown,'pages',pages);
end $$;

create function kickx_private.focused_post_detail(p_id uuid,p_page integer,p_comment uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare focused public.community_comments%rowtype;n integer;begin
 if p_page is null or p_page not between 1 and 10000 then raise exception 'INVALID_INPUT';end if;
 if p_comment is not null then
  select c.* into focused from public.community_comments c join public.community_posts p on p.id=c.post_id
  where c.id=p_comment and c.post_id=p_id and c.status='published' and p.status='published';
  if found then
   select count(*) into n from public.community_comments c where c.post_id=p_id and c.status='published'
   and(c.created_at,c.id)<(focused.created_at,focused.id);
   p_page:=n/50+1;
  end if;
 end if;
 return public.kickx_post_detail(p_id,p_page);
end $$;
revoke all on function kickx_private.focused_post_detail(uuid,integer,uuid) from public;
grant execute on function kickx_private.focused_post_detail(uuid,integer,uuid) to anon,authenticated,service_role;
create function public.kickx_post_detail(p_id uuid,p_page integer,p_comment uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select kickx_private.focused_post_detail(p_id,p_page,p_comment)$$;
revoke all on function public.kickx_post_detail(uuid,integer,uuid) from public;
grant execute on function public.kickx_post_detail(uuid,integer,uuid) to anon,authenticated,service_role;

create function kickx_private.community_activity(p_author uuid,p_kind text,p_page integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare author jsonb;post_count integer;comment_count integer;total integer;shown integer;items jsonb;begin
 if p_author is null then p_author:=auth.uid();end if;
 if p_author is null then raise exception 'LOGIN_REQUIRED';end if;
 if p_kind is null or p_kind not in('posts','comments') or p_page is null or p_page not between 1 and 10000 or p_size is null or p_size not between 1 and 30 then raise exception 'INVALID_INPUT';end if;
 select jsonb_build_object('id',id,'nickname',nickname,'avatar',avatar) into author from public.profiles where id=p_author;
 if author is null then return jsonb_build_object('author',null,'items','[]'::jsonb,'total',0,'page',1,'size',p_size,'postCount',0,'commentCount',0);end if;
 select count(*) into post_count from public.community_posts where author_id=p_author and status='published';
 select count(*) into comment_count from public.community_comments c join public.community_posts p on p.id=c.post_id
 where c.author_id=p_author and c.status='published' and p.status='published';
 total:=case when p_kind='posts' then post_count else comment_count end;
 shown:=least(p_page,greatest(1,ceil(total::numeric/p_size)::integer));
 with entries as(
  select p.id,p.id as post_id,p.scope,p.target,p.title,left(p.body,160) as body,p.created_at,false as reply
  from public.community_posts p where p_kind='posts' and p.author_id=p_author and p.status='published'
  union all
  select c.id,p.id,p.scope,p.target,p.title,left(c.body,160),c.created_at,c.parent_id is not null
  from public.community_comments c join public.community_posts p on p.id=c.post_id
  where p_kind='comments' and c.author_id=p_author and c.status='published' and p.status='published'),
 page as(select * from entries order by created_at desc,id desc limit p_size offset (shown-1)*p_size)
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'postId',e.post_id,'title',e.title,'body',e.body,'date',e.created_at,
 'reply',e.reply,'scope',e.scope,'target',e.target,'targetName',case when e.scope='club' then coalesce(t.name_ko,t.name) else coalesce(x.name_ko,x.name) end)
 order by e.created_at desc,e.id desc),'[]'::jsonb) into items from page e
 left join public.teams t on e.scope='club' and t.id=e.target left join public.players x on e.scope='player' and x.id=e.target;
 return jsonb_build_object('author',author,'items',items,'total',total,'page',shown,'size',p_size,'postCount',post_count,'commentCount',comment_count);
end $$;
revoke all on function kickx_private.community_activity(uuid,text,integer,integer) from public;
grant execute on function kickx_private.community_activity(uuid,text,integer,integer) to anon,authenticated,service_role;
create function public.kickx_community_activity(p_author uuid default null,p_kind text default 'posts',p_page integer default 1,p_size integer default 20)
returns jsonb language sql stable security invoker set search_path='' as $$select kickx_private.community_activity(p_author,p_kind,p_page,p_size)$$;
revoke all on function public.kickx_community_activity(uuid,text,integer,integer) from public;
grant execute on function public.kickx_community_activity(uuid,text,integer,integer) to anon,authenticated,service_role;

-- Only avatars of already-public ranking users, no broad profile table policy.
create function kickx_private.ranking_avatars() returns jsonb language sql stable security definer set search_path='' as $$
 with snapshots as((select rows from public.ranking_snapshots where period='weekly' and ends_at>now() order by calculated_at desc limit 1)
 union all(select rows from public.ranking_snapshots where period='monthly' and ends_at>now() order by calculated_at desc limit 1)),
 users as(select distinct (entry->>'userId')::uuid id from snapshots cross join lateral jsonb_array_elements(rows) entry)
 select coalesce(jsonb_object_agg(p.id::text,p.avatar),'{}'::jsonb) from users u join public.profiles p on p.id=u.id
$$;
revoke all on function kickx_private.ranking_avatars() from public;
grant execute on function kickx_private.ranking_avatars() to anon,authenticated,service_role;
create function public.kickx_ranking_avatars() returns jsonb language sql stable security invoker set search_path='' as $$select kickx_private.ranking_avatars()$$;
revoke all on function public.kickx_ranking_avatars() from public;
grant execute on function public.kickx_ranking_avatars() to anon,authenticated,service_role;

-- Match the browser's daily view key with the service's Korean date.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.kickx_community_write(text,jsonb)'::regprocedure);
 if position('community_views(user_id,post_id) values(u,post.id)' in definition)=0 then raise exception 'VIEW_WRITER_CHANGED';end if;
 execute replace(definition,'community_views(user_id,post_id) values(u,post.id)',
 'community_views(user_id,post_id,day) values(u,post.id,(now() at time zone ''Asia/Seoul'')::date)');
end $$;
notify pgrst,'reload schema';
commit;
