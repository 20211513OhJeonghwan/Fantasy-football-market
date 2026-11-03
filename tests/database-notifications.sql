begin;
insert into auth.users(id)values('00000000-0000-0000-0000-000000000091'),('00000000-0000-0000-0000-000000000092');
insert into public.profiles(id,nickname)values('00000000-0000-0000-0000-000000000091','Inbox One'),('00000000-0000-0000-0000-000000000092','Inbox Two');
insert into public.leagues(id,name)values('bsd-1','League')on conflict do nothing;
insert into public.teams(id,name,league_id)values('inbox-home','Home','bsd-1'),('inbox-away','Away','bsd-1');
insert into public.players(id,name,team_id)values('inbox-player','Inbox Player','inbox-home');
insert into public.player_market_snapshots(id,price,pricing_status,pricing_rule_version)values('inbox-player',100000,'ready','report-v3');
insert into public.trade_quotes(id,user_id,player_id,side,price,fee,net,market_at,policy_version,expires_at)
 select gen_random_uuid(),id,'inbox-player','buy',100000,0,100000,now(),'report-v3',now()+interval '1 minute'from auth.users where id in('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092');
insert into public.trades(user_id,player_id,player_name,side,price,fee,net,quote_id,request_id,policy_version)
 select user_id,player_id,'Inbox Player','buy',price,fee,net,id,gen_random_uuid(),policy_version from public.trade_quotes where player_id='inbox-player';
insert into public.holdings(user_id,player_id,cost,trade_id)select user_id,player_id,net,id from public.trades where player_id='inbox-player';
create function pg_temp.inbox_assert(ok boolean,reason text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',reason;end if;end $$;
update public.player_market_snapshots set price=102000,updated_at=clock_timestamp()where id='inbox-player';
select pg_temp.inbox_assert((select count(*)=2 from public.user_notifications),'Price delivery must reach each holder once');
update public.player_market_snapshots set price=102000,updated_at=clock_timestamp()where id='inbox-player';
select pg_temp.inbox_assert((select count(*)=2 from public.user_notifications),'Unchanged prices must not duplicate notifications');
update public.player_market_snapshots set price=103000,pricing_status='pending'where id='inbox-player';
select pg_temp.inbox_assert((select count(*)=2 from public.user_notifications),'Withheld prices must not be announced');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000091',true);
set local role authenticated;
select pg_temp.inbox_assert((select count(*)=1 from public.user_notifications),'Members cannot read another inbox');
select pg_temp.inbox_assert((public.kickx_notification_summary()->>'hasUnread')::boolean,'Unread indicator missing');
select public.kickx_mark_notifications();
select pg_temp.inbox_assert(not(public.kickx_notification_summary()->>'hasUnread')::boolean,'Mark all did not clear own unread');
select public.kickx_set_match_notifications(false);
reset role;
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status,stage)
 values('inbox-match','bsd-1','inbox-home','inbox-away',now()+interval '60 minutes','NS','league-phase');
select kickx_private.notification_tick();
select kickx_private.notification_tick();
select pg_temp.inbox_assert((select count(*)=1 from public.user_notifications where kind='match'),'Match mute or deduplication failed');
select pg_temp.inbox_assert((select user_id='00000000-0000-0000-0000-000000000092'from public.user_notifications where kind='match'),'Muted holder received kickoff notification');
select pg_temp.inbox_assert((select read_at is null from public.user_notifications where kind='price'and user_id='00000000-0000-0000-0000-000000000092'),'Marking one inbox changed another');
insert into public.user_notifications(user_id,kind,player_id,source_key,price_before,price_after,created_at,expires_at)
 values('00000000-0000-0000-0000-000000000091','price','inbox-player','expired',100000,102000,now()-interval '15 days',now()-interval '1 day');
set local role authenticated;
select pg_temp.inbox_assert((select count(*)=1 from public.user_notifications),'Expired rows must be hidden before cleanup');
do $$begin begin update public.user_notifications set price_after=999 where true;raise exception 'Notification facts were writable';exception when insufficient_privilege then null;end;end $$;
reset role;
select kickx_private.notification_tick();
select pg_temp.inbox_assert(not exists(select 1 from public.user_notifications where source_key='expired'),'Expired notifications not deleted');
set local role anon;
do $$begin begin perform public.kickx_notifications();raise exception 'Guest read notification RPC';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
