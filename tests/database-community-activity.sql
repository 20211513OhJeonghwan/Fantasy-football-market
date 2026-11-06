begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000301'),('00000000-0000-0000-0000-000000000302'),('00000000-0000-0000-0000-000000000303');
insert into public.profiles(id,nickname,avatar)values
 ('00000000-0000-0000-0000-000000000301','Activity Author','icon:trophy'),
 ('00000000-0000-0000-0000-000000000302','Activity Parent','icon:whistle'),
 ('00000000-0000-0000-0000-000000000303','Activity Replier',null);
insert into public.players(id,name,position)values('activity-player','Activity Player','FW');
insert into public.community_posts(id,author_id,scope,target,title,body,request_id,status)values
 ('00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000301','player','activity-player','Public post','Public post body for activity',gen_random_uuid(),'published'),
 ('00000000-0000-0000-0001-000000000302','00000000-0000-0000-0000-000000000301','player','activity-player','Hidden post','Hidden private evidence',gen_random_uuid(),'hidden');
create function pg_temp.activity_assert(ok boolean,reason text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',reason;end if;end $$;
insert into public.community_comments(id,post_id,author_id,body,request_id) values
 ('00000000-0000-0000-0002-000000000301','00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000302','Parent comment',gen_random_uuid());
insert into public.community_comments(id,post_id,author_id,parent_id,body,request_id) values
 ('00000000-0000-0000-0002-000000000302','00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0002-000000000301','Reply comment',gen_random_uuid());
select pg_temp.activity_assert((select count(*)=2 from public.user_notifications where comment_id='00000000-0000-0000-0002-000000000302'),'Reply should reach the parent and distinct post author once each');
select pg_temp.activity_assert(not exists(select 1 from public.user_notifications where user_id=actor_id),'Self notification was generated');
insert into public.community_comments(id,post_id,author_id,body,request_id) values
 ('00000000-0000-0000-0002-000000000303','00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000301','Post author parent',gen_random_uuid());
insert into public.community_comments(id,post_id,author_id,parent_id,body,request_id) values
 ('00000000-0000-0000-0002-000000000304','00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0002-000000000303','Reply to author',gen_random_uuid());
select pg_temp.activity_assert((select count(*)=1 and min(kind)='reply' from public.user_notifications where comment_id='00000000-0000-0000-0002-000000000304'),'Same recipient got duplicate post/reply notifications');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',true);
set local role authenticated;
select public.kickx_set_community_notifications(false,false);
select pg_temp.activity_assert(not (public.kickx_notification_summary()->>'commentNotifications')::boolean,'Comment preference did not persist');
select pg_temp.activity_assert((select count(*)=1 from public.profiles),'Public avatars must not expose profile table rows');
select pg_temp.activity_assert((select bool_and(user_id=auth.uid()) from public.user_notifications),'Other inbox leaked');
reset role;
insert into public.community_comments(id,post_id,author_id,parent_id,body,request_id) values
 ('00000000-0000-0000-0002-000000000305','00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0002-000000000303','Muted reply',gen_random_uuid());
select pg_temp.activity_assert(not exists(select 1 from public.user_notifications where comment_id='00000000-0000-0000-0002-000000000305'),'Disabled reply was delivered as a comment instead');
select pg_temp.activity_assert((select comment_notifications and reply_notifications from public.profiles where id='00000000-0000-0000-0000-000000000302'),'Preferences changed another member');
insert into public.community_comments(post_id,author_id,body,request_id,status) values
 ('00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000302','Hidden comment',gen_random_uuid(),'hidden'),
 ('00000000-0000-0000-0001-000000000302','00000000-0000-0000-0000-000000000302','Comment in hidden post',gen_random_uuid(),'published');
set local role anon;
select pg_temp.activity_assert(public.kickx_post_detail('00000000-0000-0000-0001-000000000301')#>>'{post,authorAvatar}'='icon:trophy','Another author avatar missing');
select pg_temp.activity_assert(public.kickx_post_detail('00000000-0000-0000-0001-000000000301')#>>'{comments,0,authorAvatar}'='icon:whistle','Comment avatar missing');
select pg_temp.activity_assert(public.kickx_community_activity('00000000-0000-0000-0000-000000000301')#>>'{postCount}'='1','Hidden post exposed through author activity');
select pg_temp.activity_assert(public.kickx_posts(p_page=>999)#>>'{page}'='1','Board page out of range after deletion');
select pg_temp.activity_assert(public.kickx_community_activity('00000000-0000-0000-0000-000000000302','comments')#>>'{total}'='1','Hidden comment or hidden post exposed through author activity');
do $$begin begin perform public.kickx_notifications();raise exception 'Guest read inbox';exception when insufficient_privilege then null;end;
 begin perform kickx_private.read_notification_feed(null,20,false);raise exception 'Guest called internal inbox';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Focused comment destinations must resolve pages beyond the first 50 rows.
insert into public.community_comments(id,post_id,author_id,body,request_id,created_at)
select ('00000000-0000-0000-0003-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0001-000000000301','00000000-0000-0000-0000-000000000301','Pagination comment '||n,gen_random_uuid(),now()+n*interval '1 second' from generate_series(1,60)n;
set local role anon;
select pg_temp.activity_assert(public.kickx_post_detail('00000000-0000-0000-0001-000000000301',1,'00000000-0000-0000-0003-000000000060')#>>'{page}'='2','Deep linked reply opened the wrong page');
select pg_temp.activity_assert(public.kickx_post_detail('00000000-0000-0000-0001-000000000301',999)#>>'{page}'='2','Shrinking comment lists do not clamp pages');
select pg_temp.activity_assert(public.kickx_community_activity('00000000-0000-0000-0000-000000000301','comments',999,20)#>>'{page}'='4','Activity pages not clamped');
reset role;
-- The write RPC must not duplicate delivery when a comment request is retried.
update public.community_comments set created_at=now()-interval '10 minutes' where author_id='00000000-0000-0000-0000-000000000303';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000303',true);
set local role authenticated;
select public.kickx_community_write('comment','{"postId":"00000000-0000-0000-0001-000000000301","parentId":"00000000-0000-0000-0002-000000000301","body":"Idempotent notification","requestId":"00000000-0000-0000-0004-000000000301"}');
select public.kickx_community_write('comment','{"postId":"00000000-0000-0000-0001-000000000301","parentId":"00000000-0000-0000-0002-000000000301","body":"Idempotent notification","requestId":"00000000-0000-0000-0004-000000000301"}');
select public.kickx_community_write('view','{"postId":"00000000-0000-0000-0001-000000000301"}');
select public.kickx_community_write('view','{"postId":"00000000-0000-0000-0001-000000000301"}');
reset role;
select pg_temp.activity_assert((select count(*)=1 from public.user_notifications where comment_id=(select id from public.community_comments where request_id='00000000-0000-0000-0004-000000000301')),'Retried comment duplicated delivery');
select pg_temp.activity_assert((select count(*)=1 and min(day)=(now()at time zone'Asia/Seoul')::date from public.community_views where post_id='00000000-0000-0000-0001-000000000301'),'Korean-day views not idempotent');
-- Deleted/hidden content must disappear from inbox facts and the red dot.
insert into public.ranking_snapshots(period,starts_at,ends_at,calculated_at,rows)values('weekly',now()-interval '1 day',now()+interval '1 day',now()+interval '1 minute','[{"userId":"00000000-0000-0000-0000-000000000301"},{"userId":"00000000-0000-0000-0000-000000000302"}]');
set local role anon;
select pg_temp.activity_assert(public.kickx_ranking_avatars()#>>'{00000000-0000-0000-0000-000000000301,avatar}'='icon:trophy','Ranked public avatar missing');
reset role;
update public.community_posts set status='hidden' where id='00000000-0000-0000-0001-000000000301';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000302',true);
set local role authenticated;
select pg_temp.activity_assert(jsonb_array_length(public.kickx_notifications()->'items')=0,'Hidden community text leaked through notifications');
select pg_temp.activity_assert(not(public.kickx_notification_summary()->>'hasUnread')::boolean,'Hidden notifications left an unread red dot');
reset role;
rollback;
