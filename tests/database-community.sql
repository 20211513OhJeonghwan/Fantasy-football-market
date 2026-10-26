-- Public content vs private evidence, author/fan permissions and moderation.
begin;
update public.kickx_policy set version='prototype-v1';
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.leagues(id,name) values('bsd-1','Test League') on conflict do nothing;
insert into public.teams(id,name,league_id) values('bsd-1','Home','bsd-1'),('bsd-2','Away','bsd-1');
insert into public.players(id,name,position,provider) values('bsd-10','Player','FW','bsd');
insert into public.profiles(id,nickname,team_id) values('00000000-0000-0000-0000-000000000001','Author','bsd-1'),('00000000-0000-0000-0000-000000000002','Moderator','bsd-2');
insert into public.user_roles values('00000000-0000-0000-0000-000000000002','admin');
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;raise exception 'Expected % from %',expected,command;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$declare input jsonb;r jsonb;c jsonb;begin
 input:=jsonb_build_object('requestId',gen_random_uuid(),'scope','club','target','bsd-2','category','자유','title','Test post','body','Long enough test body','transaction','');
 perform pg_temp.expect_error(format('select public.kickx_community_write(%L,%L::jsonb)','createPost',input),'FAN_REQUIRED');
 input:=jsonb_set(input,'{target}','"bsd-1"');r:=public.kickx_community_write('createPost',input);
 if r<>public.kickx_community_write('createPost',input) or (public.kickx_posts()->>'total')::int<>1 then raise exception 'Post retry not idempotent';end if;
 perform set_config('kickx.test.post',r->>'id',true);
 input:=jsonb_build_object('postId',r->>'id','revision',0,'title','Updated','body','Updated body text long','category','자유','transaction','');
 perform pg_temp.expect_error(format('select public.kickx_community_write(%L,%L::jsonb)','editPost',input),'STALE_REVISION');
 input:=jsonb_set(input,'{revision}','1');perform public.kickx_community_write('editPost',input);
 if public.kickx_post_detail((r->>'id')::uuid)#>>'{post,title}'<>'Updated' then raise exception 'Post edit failed';end if;
 input:=jsonb_build_object('postId',r->>'id','requestId',gen_random_uuid(),'body','First comment');c:=public.kickx_community_write('comment',input);
 if c<>public.kickx_community_write('comment',input) then raise exception 'Comment duplicated';end if;perform set_config('kickx.test.comment',c->>'id',true);
 perform public.kickx_community_write('like',jsonb_build_object('postId',r->>'id','liked',true));perform public.kickx_community_write('like',jsonb_build_object('postId',r->>'id','liked',true));
 perform public.kickx_community_write('view',jsonb_build_object('postId',r->>'id'));perform public.kickx_community_write('view',jsonb_build_object('postId',r->>'id'));
 if public.kickx_post_detail((r->>'id')::uuid)#>>'{post,likes}'<>'1' or public.kickx_post_detail((r->>'id')::uuid)#>>'{post,views}'<>'1' then raise exception 'Like/view inflated';end if;
 perform pg_temp.expect_error('select * from public.community_reports','42501');
 perform pg_temp.expect_error('select public.kickx_post_json(null)','42501');
 perform pg_temp.expect_error('select public.kickx_moderate(null,null,null)','ADMIN_REQUIRED');
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$declare input jsonb;begin
 input:=jsonb_build_object('postId',current_setting('kickx.test.post'),'revision',2);
 perform pg_temp.expect_error(format('select public.kickx_community_write(%L,%L::jsonb)','deletePost',input),'NOT_AUTHOR');
 input:=jsonb_build_object('postId',current_setting('kickx.test.post'),'requestId',gen_random_uuid(),'body','Fan-only comment');
 perform pg_temp.expect_error(format('select public.kickx_community_write(%L,%L::jsonb)','comment',input),'FAN_REQUIRED');
 input:=jsonb_build_object('postId',current_setting('kickx.test.post'),'commentId',current_setting('kickx.test.comment'),'reason','Review this comment');
 perform public.kickx_community_write('report',input);perform public.kickx_community_write('report',input);
end $$;
reset role;
do $$begin
 if (select count(*) from public.community_reports)<>1 then raise exception 'Report duplicated';end if;
 perform set_config('kickx.test.report',(select id::text from public.community_reports),true);
end $$;
set local role authenticated;
select public.kickx_moderate(current_setting('kickx.test.report')::uuid,'hide','Review completed, hide');
do $$begin
 if jsonb_array_length(public.kickx_post_detail(current_setting('kickx.test.post')::uuid)->'comments')<>0 then raise exception 'Hidden comment exposed';end if;
end $$;
select public.kickx_moderate(current_setting('kickx.test.report')::uuid,'restore','Review corrected, restore');
select public.kickx_community_write('report',jsonb_build_object('postId',current_setting('kickx.test.post'),'reason','Review whole post'));
reset role;
select set_config('kickx.test.report',(select id::text from public.community_reports where comment_id is null),true);
set local role authenticated;
select public.kickx_moderate(current_setting('kickx.test.report')::uuid,'hide','Review completed, hide post');
reset role;
set local role anon;
do $$begin
 if (public.kickx_posts()->>'total')::int<>0 or public.kickx_post_detail(current_setting('kickx.test.post')::uuid)->'post'<>'null'::jsonb then raise exception 'Hidden content publicly exposed';end if;
 perform pg_temp.expect_error('select * from public.community_revisions','42501');
 perform pg_temp.expect_error('select * from public.community_comments','42501');
end $$;
reset role;
do $$begin
 if (select count(*) from public.operation_audit where action like 'community.%')<>3 or (select count(*) from public.community_revisions)<>1 then raise exception 'Missing edit/moderation audit';end if;
end $$;
rollback;
