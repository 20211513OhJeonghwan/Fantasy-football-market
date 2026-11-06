begin;
insert into public.leagues(id,name)values('bsd-1','PL'),('bsd-3','Liga')on conflict do nothing;
insert into public.teams(id,name,league_id)values('main-a','Main A','bsd-1'),('main-b','Main B','bsd-3'),('main-c','Other','bsd-1'),('main-d','Sub change','bsd-3');
insert into auth.users(id,created_at)values('00000000-0000-0000-0000-000000000501',now()),('00000000-0000-0000-0000-000000000502',now()),('00000000-0000-0000-0000-000000000503',now()-interval '2 hours');
insert into public.profiles(id,nickname,team_ids,primary_team_id,primary_confirmed_at,created_at)values
 ('00000000-0000-0000-0000-000000000501','본진회원',array['main-a','main-b'],'main-a',now(),now()),
 ('00000000-0000-0000-0000-000000000502','서브회원',array['main-c','main-b'],'main-c',now(),now()),
 ('00000000-0000-0000-0000-000000000503','다른회원',array['main-c'],'main-c',now(),now()-interval '2 hours');
insert into auth.users(id,created_at)values('00000000-0000-0000-0000-000000000504',now()-interval '2 hours');
insert into public.profiles(id,nickname,team_ids,created_at)values('00000000-0000-0000-0000-000000000504','기존회원',array['main-b'],now()-interval '2 hours');
insert into public.players(id,name,position,team_id)values('poll-player','Player','FW','main-a');
create function pg_temp.primary_assert(ok boolean,msg text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',msg;end if;end $$;
create function pg_temp.primary_error(command text,expected text)returns void language plpgsql as $$begin begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'Expected %',expected;end $$;
select pg_temp.primary_assert(kickx_private.support_window('2026-01-31T15:00Z')='2026-02','KST start');
select pg_temp.primary_assert(kickx_private.support_window('2026-02-07T14:59:59Z')='2026-02','KST end');
select pg_temp.primary_assert(kickx_private.support_window('2026-02-07T15:00Z')is null,'Window exceeded a week');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000501';
set local role authenticated;
select pg_temp.primary_error($q$update public.profiles set primary_team_id='main-c' where id=auth.uid()$q$,'42501');
select pg_temp.primary_error($q$select public.kickx_save_profile('{"nickname":"본진회원","teams":["main-c","main-b"],"primaryTeam":"main-c","confirmPrimary":true}')$q$,'PRIMARY_TEAM_IMMUTABLE');
select public.kickx_save_profile('{"nickname":"본진회원","teams":["main-a","main-d"],"primaryTeam":"main-a"}');
select pg_temp.primary_assert((select team_ids@>array['main-d']from public.profiles where id=auth.uid()),'First-hour subteam did not change');
select public.kickx_save_profile('{"nickname":"본진회원","teams":["main-a","main-b"],"primaryTeam":"main-a"}');
do $$declare r jsonb;begin
 r:=public.kickx_community_write('createPost',jsonb_build_object('scope','club','target','main-a','title','경기 투표','body','오늘 경기 결과에 대해 의견을 나눠 봅시다.','transaction','','requestId',gen_random_uuid(),'poll',jsonb_build_object('question','다음 경기 예상은?','options',jsonb_build_array('승리','무승부','패배'),'days',7)));
 perform set_config('kickx.primary.post',r->>'id',true);
end $$;
reset role;
-- A second club's primary author creates a post in the first member's subteam board.
insert into public.community_posts(id,author_id,scope,target,title,body,request_id,poll)values('00000000-0000-0000-0001-000000000501','00000000-0000-0000-0000-000000000502','club','main-b','서브팀 투표','서브팀 참여 권한을 확인합니다.',gen_random_uuid(),jsonb_build_object('question','동의하나요?','options',jsonb_build_array('네','아니요'),'endsAt',now()+interval '1 day'));
set local role authenticated;
select public.kickx_community_write('vote',jsonb_build_object('postId',current_setting('kickx.primary.post'),'option',1));
select public.kickx_community_write('vote',jsonb_build_object('postId',current_setting('kickx.primary.post'),'option',1));
select public.kickx_community_write('vote',jsonb_build_object('postId',current_setting('kickx.primary.post'),'option',2));
select pg_temp.primary_assert(public.kickx_post_detail(current_setting('kickx.primary.post')::uuid)#>>'{post,poll,total}'='1','Duplicate vote counted');
select pg_temp.primary_assert(public.kickx_post_detail(current_setting('kickx.primary.post')::uuid)#>>'{post,poll,myVote}'='2','Vote did not change');
select pg_temp.primary_error($q$select * from public.community_poll_votes$q$,'42501');
select pg_temp.primary_error($q$select public.kickx_community_write('createPost',jsonb_build_object('scope','club','target','main-b','title','불가 글','body','서브팀은 게시글 작성이 불가능합니다.','transaction','','requestId',gen_random_uuid()))$q$,'FAN_REQUIRED');
select public.kickx_community_write('comment',jsonb_build_object('postId','00000000-0000-0000-0001-000000000501','body','서브팀 댓글은 작성할 수 있습니다.','requestId',gen_random_uuid()));
select public.kickx_community_write('vote','{"postId":"00000000-0000-0000-0001-000000000501","option":0}');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000503';
select pg_temp.primary_error($q$select public.kickx_community_write('vote','{"postId":"00000000-0000-0000-0001-000000000501","option":1}')$q$,'PARTICIPATION_REQUIRED');
select pg_temp.primary_error($q$select public.kickx_community_write('comment','{"postId":"00000000-0000-0000-0001-000000000501","body":"다른 구단은 읽기만 가능합니다.","requestId":"00000000-0000-0000-0003-000000000503"}')$q$,'PARTICIPATION_REQUIRED');
reset role;
-- Historical first-team fields are not silently promoted to an immutable primary.
select pg_temp.primary_assert((select primary_team_id='main-a' from public.profiles where nickname='본진회원'),'Primary changed');
set local role anon;
select pg_temp.primary_assert(public.kickx_post_detail(current_setting('kickx.primary.post')::uuid)#>>'{post,authorPrimaryTeam}'='main-a','Official crest identity missing');
select pg_temp.primary_assert(public.kickx_post_detail(current_setting('kickx.primary.post')::uuid)#>'{post,poll,myVote}'='null'::jsonb,'Guest saw a personal vote');
select pg_temp.primary_error($q$select public.kickx_community_write('vote','{}')$q$,'42501');
reset role;
-- An existing unconfirmed member can save an icon without clearing support or choosing a primary.
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000504';
set local role authenticated;
select public.kickx_save_profile('{"nickname":"기존회원변경","teams":["main-b"],"primaryTeam":null,"avatar":"icon:trophy"}');
select pg_temp.primary_assert((select team_ids=array['main-b']and primary_team_id is null and avatar='icon:trophy'from public.profiles where id=auth.uid()),'Legacy profile save cleared support or forced a primary');
reset role;
-- A current holding is verified by the database and revoked immediately after sale.
insert into public.community_posts(id,author_id,scope,target,title,body,request_id)values('00000000-0000-0000-0001-000000000502','00000000-0000-0000-0000-000000000501','player','poll-player','선수 이야기','모든 회원이 선수 글을 쓸 수 있습니다.',gen_random_uuid());
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
update public.players set provider='bsd' where id='poll-player';
insert into public.player_market_snapshots(id,price,pricing_rule_version)values('poll-player',100000,'prototype-v1');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000501';
set local role authenticated;
do $$declare q jsonb;begin perform public.kickx_open_wallet();q:=public.kickx_quote('poll-player','buy');perform public.kickx_trade((q->>'id')::uuid,gen_random_uuid());end $$;
reset role;
set local role anon;
select pg_temp.primary_assert((public.kickx_post_detail('00000000-0000-0000-0001-000000000502')#>>'{post,authorHoldsPlayer}')::boolean,'Owned-player badge missing');
reset role;
delete from public.holdings where player_id='poll-player';
set local role anon;
select pg_temp.primary_assert(not(public.kickx_post_detail('00000000-0000-0000-0001-000000000502')#>>'{post,authorHoldsPlayer}')::boolean,'Sold player kept ownership badge');
reset role;
rollback;
