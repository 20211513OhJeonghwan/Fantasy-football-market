-- A player post needs a title and may expose only the author's trade of that player.
begin;
update public.kickx_policy set version='prototype-v1',club_competitions_enabled=false;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000092'),('00000000-0000-0000-0000-000000000093');
insert into public.leagues(id,name) values('bsd-1','League') on conflict do nothing;
insert into public.teams(id,name,league_id) values('attachment-team','Attachment','bsd-1');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000092','Attachment'),('00000000-0000-0000-0000-000000000093','OtherAttachment');
insert into public.players(id,name,provider,position,team_id) values('attach-a','Player A','bsd','DF','attachment-team'),('attach-b','Player B','bsd','MF','attachment-team');
insert into public.player_market_snapshots(id,price,pricing_rule_version) values('attach-a',50000,'prototype-v1'),('attach-b',50000,'prototype-v1');
create function pg_temp.attachment_error(command text,expected text)returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;raise exception 'Expected %',expected;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000093';
do $$declare q jsonb;t jsonb;begin
 perform public.kickx_open_wallet();q:=public.kickx_quote('attach-a','buy');t:=public.kickx_trade((q->>'id')::uuid,gen_random_uuid());
 perform set_config('kickx.attachment.other',t->>'id',true);
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000092';
do $$declare q jsonb;t jsonb;input jsonb;post_id uuid;revision integer;begin
 perform public.kickx_open_wallet();
 q:=public.kickx_quote('attach-a','buy');t:=public.kickx_trade((q->>'id')::uuid,gen_random_uuid());perform set_config('kickx.attachment.same',t->>'id',true);
 q:=public.kickx_quote('attach-b','buy');t:=public.kickx_trade((q->>'id')::uuid,gen_random_uuid());perform set_config('kickx.attachment.wrong',t->>'id',true);
 input:=jsonb_build_object('requestId',gen_random_uuid(),'scope','player','target','attach-a','title','선수 경기 후기','body','이 선수의 경기와 거래에 대한 후기입니다.','transaction',current_setting('kickx.attachment.wrong'));
 perform pg_temp.attachment_error(format('select public.kickx_community_write(''createPost'',%L)',input),'TRADE_PLAYER_MISMATCH');
 input:=jsonb_set(input,'{transaction}',to_jsonb(current_setting('kickx.attachment.other')));
 perform pg_temp.attachment_error(format('select public.kickx_community_write(''createPost'',%L)',input),'TRADE_NOT_OWNED');
 input:=jsonb_set(input,'{transaction}',to_jsonb(current_setting('kickx.attachment.same')));
 perform pg_temp.attachment_error(format('select public.kickx_community_write(''createPost'',%L)',jsonb_set(input,'{title}','""')),'TITLE_REQUIRED');
 post_id:=(public.kickx_community_write('createPost',input)->>'id')::uuid;
 if public.kickx_community_write('createPost',input)->>'id'<>post_id::text then raise exception 'Post duplicated';end if;
 if public.kickx_post_detail(post_id)#>>'{post,transaction,id}'<>current_setting('kickx.attachment.same') then raise exception 'Matching trade attachment missing';end if;
 input:=input||jsonb_build_object('postId',post_id,'revision',1,'transaction',current_setting('kickx.attachment.wrong'));
 perform pg_temp.attachment_error(format('select public.kickx_community_write(''editPost'',%L)',input),'TRADE_PLAYER_MISMATCH');
 input:=jsonb_set(input,'{transaction}','""');perform public.kickx_community_write('editPost',input);
 if public.kickx_post_detail(post_id)#>'{post,transaction}' is distinct from 'null'::jsonb then raise exception 'Trade attachment was not removed';end if;
end $$;
rollback;
