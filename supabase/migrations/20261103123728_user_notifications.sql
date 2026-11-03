begin;
set local lock_timeout='3s';
alter table public.profiles add column match_notifications boolean not null default true;
grant update(match_notifications) on public.profiles to authenticated;

create table public.user_notifications(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('price','match')),
 player_id text not null references public.players(id) on delete cascade,
 fixture_id text references public.fixtures(id) on delete cascade,
 source_key text not null check(char_length(source_key)<=180),
 price_before bigint,price_after bigint,starts_at timestamptz,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '14 days',read_at timestamptz,
 unique(user_id,source_key),
 check(expires_at=created_at+interval '14 days'),
 check((kind='price'and price_before is not null and price_after is not null and price_before>0 and price_after>0 and price_before<>price_after)
    or(kind='match'and fixture_id is not null and starts_at is not null))
);
create index user_notifications_inbox_idx on public.user_notifications(user_id,id desc);
create index user_notifications_unread_idx on public.user_notifications(user_id,expires_at)where read_at is null;
create index user_notifications_expiry_idx on public.user_notifications(expires_at);
create index user_notifications_player_idx on public.user_notifications(player_id);
create index user_notifications_fixture_idx on public.user_notifications(fixture_id);
create index if not exists holdings_player_notifications_idx on public.holdings(player_id,user_id);
alter table public.user_notifications enable row level security;
create policy own_notifications_read on public.user_notifications for select to authenticated
 using(user_id=(select auth.uid())and expires_at>now());
create policy own_notifications_mark on public.user_notifications for update to authenticated
 using(user_id=(select auth.uid())and expires_at>now())with check(user_id=(select auth.uid())and expires_at>now());
revoke all on public.user_notifications from anon,authenticated;
grant select on public.user_notifications to authenticated;
grant update(read_at)on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;

-- Cross-member event delivery is internal, never an exposed definer RPC.
create schema if not exists kickx_private;
revoke all on schema kickx_private from public,anon,authenticated;
grant usage on schema kickx_private to service_role;
create function kickx_private.notify_player_price()returns trigger
language plpgsql security definer set search_path='' as $$
declare event_key text;begin
 if new.pricing_status is distinct from 'ready'or old.price is null or new.price is null or old.price=new.price then return new;end if;
 event_key:='price:'||new.id||':'||md5(concat_ws(':',old.price,new.price,new.updated_at));
 insert into public.user_notifications(user_id,kind,player_id,source_key,price_before,price_after)
 select h.user_id,'price',new.id,event_key,old.price::bigint,new.price::bigint
 from public.holdings h where h.player_id=new.id on conflict(user_id,source_key)do nothing;
 return new;
end $$;
revoke all on function kickx_private.notify_player_price()from public,anon,authenticated;
create trigger notify_player_price after update of price,pricing_status on public.player_market_snapshots
 for each row execute function kickx_private.notify_player_price();

create function kickx_private.notification_tick()returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare removed integer;sent integer;begin
 -- Expiry hides rows immediately through RLS; physical cleanup is bounded.
 delete from public.user_notifications where id in(
  select id from public.user_notifications where expires_at<=now()order by expires_at limit 2000);
 get diagnostics removed=row_count;
 insert into public.user_notifications(user_id,kind,player_id,fixture_id,source_key,starts_at)
 select h.user_id,'match',p.id,f.id,'match:'||f.id||':'||p.id||':'||extract(epoch from f.starts_at)::bigint,f.starts_at
 from public.fixtures f join public.players p on p.team_id in(f.home_team_id,f.away_team_id)
 join public.holdings h on h.player_id=p.id join public.profiles u on u.id=h.user_id
 where f.starts_at>now()and f.starts_at<=now()+interval '90 minutes'
 and f.status in('NS','TBD','1H','HT','2H','LIVE')and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')
 and public.kickx_regular_fixture(f.id)is distinct from false and u.match_notifications
 on conflict(user_id,source_key)do nothing;
 get diagnostics sent=row_count;
 -- This job's execution logs have their own short retention; no growing cron log.
 if to_regclass('cron.job_run_details')is not null then
  delete from cron.job_run_details where jobid in(select jobid from cron.job where jobname='kickx-notifications')and end_time<now()-interval '1 day';
 end if;
 return jsonb_build_object('removed',removed,'sent',sent);
end $$;
revoke all on function kickx_private.notification_tick()from public,anon,authenticated;
grant execute on function kickx_private.notification_tick()to service_role;

create function public.kickx_notification_summary()returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('hasUnread',exists(select 1 from public.user_notifications n where n.user_id=(select auth.uid())and n.read_at is null and n.expires_at>now()),
 'matchNotifications',coalesce((select match_notifications from public.profiles where id=(select auth.uid())),true))
$$;
create function public.kickx_notifications(p_before bigint default null,p_limit integer default 20)returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;begin
 if auth.uid()is null then raise exception 'LOGIN_REQUIRED';end if;
 if p_limit is null or p_limit not between 1 and 30 or p_before<=0 then raise exception 'INVALID_INPUT';end if;
 with page as materialized(select n.* from public.user_notifications n where n.user_id=(select auth.uid())and n.expires_at>now()
  and(p_before is null or n.id<p_before)order by n.id desc limit p_limit+1),
 shown as(select * from page order by id desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id::text,'kind',n.kind,'playerId',n.player_id,
  'playerName',coalesce(p.name_ko,p.name),'teamId',p.team_id,'fixtureId',n.fixture_id,'homeName',coalesce(h.name_ko,h.name),'awayName',coalesce(a.name_ko,a.name),
  'startsAt',n.starts_at,'priceBefore',n.price_before,'priceAfter',n.price_after,'createdAt',n.created_at,'readAt',n.read_at)order by n.id desc)
 from shown n join public.players p on p.id=n.player_id left join public.fixtures f on f.id=n.fixture_id
 left join public.teams h on h.id=f.home_team_id left join public.teams a on a.id=f.away_team_id),'[]'::jsonb),
 'hasMore',(select count(*)>p_limit from page),'hasUnread',exists(select 1 from public.user_notifications n where n.user_id=(select auth.uid())and n.read_at is null and n.expires_at>now()))into result;
 return result;
end $$;
create function public.kickx_mark_notifications(p_ids bigint[] default null)returns jsonb
language plpgsql security invoker set search_path='' as $$begin
 if auth.uid()is null then raise exception 'LOGIN_REQUIRED';end if;
 if cardinality(p_ids)>100 then raise exception 'INVALID_INPUT';end if;
 update public.user_notifications set read_at=now()where user_id=(select auth.uid())and expires_at>now()and read_at is null and(p_ids is null or id=any(p_ids));
 return public.kickx_notification_summary();
end $$;
create function public.kickx_set_match_notifications(p_enabled boolean)returns jsonb
language plpgsql security invoker set search_path='' as $$begin
 if auth.uid()is null then raise exception 'LOGIN_REQUIRED';end if;
 if p_enabled is null then raise exception 'INVALID_INPUT';end if;
 update public.profiles set match_notifications=p_enabled where id=(select auth.uid());
 if not found then raise exception 'PROFILE_REQUIRED';end if;
 return public.kickx_notification_summary();
end $$;
revoke all on function public.kickx_notification_summary(),public.kickx_notifications(bigint,integer),public.kickx_mark_notifications(bigint[]),public.kickx_set_match_notifications(boolean)from public,anon;
grant execute on function public.kickx_notification_summary(),public.kickx_notifications(bigint,integer),public.kickx_mark_notifications(bigint[]),public.kickx_set_match_notifications(boolean)to authenticated,service_role;
do $$begin if exists(select 1 from pg_extension where extname='pg_cron')then
 perform cron.schedule('kickx-notifications','* * * * *','select kickx_private.notification_tick();');
end if;end $$;
notify pgrst,'reload schema';
commit;
