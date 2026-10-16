-- Disposable test records are rolled back, never part of application seeds.
begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.players(id,name) values('test-player','CI-only player');
insert into public.profiles(id,nickname) values('00000000-0000-0000-0000-000000000001','승현 FC'),('00000000-0000-0000-0000-000000000002','Other tester');
insert into public.user_roles values('00000000-0000-0000-0000-000000000001','member'),('00000000-0000-0000-0000-000000000002','admin');
insert into public.watchlists(user_id,player_id) values('00000000-0000-0000-0000-000000000002','test-player');
set local role anon;
do $$
begin
  if (select count(*) from public.players) <> 1 then raise exception 'Public catalog is not readable'; end if;
  begin perform * from public.profiles; raise exception 'Guest can read profiles'; exception when insufficient_privilege then null; end;
  begin insert into public.players(id,name) values('fake','Forbidden'); raise exception 'Guest can write catalog'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'Profile isolation failed'; end if;
  if (select count(*) from public.watchlists) <> 0 then raise exception 'Watchlist isolation failed'; end if;
  if (select count(*) from public.user_roles where role='admin') <> 0 then raise exception 'Role isolation failed'; end if;
  begin update public.user_roles set role='admin'; raise exception 'Member can assign admin'; exception when insufficient_privilege then null; end;
  begin insert into public.watchlists(user_id,player_id) values('00000000-0000-0000-0000-000000000002','test-player'); raise exception 'Member can write another watchlist'; exception when insufficient_privilege then null; end;
  begin update public.profiles set id='00000000-0000-0000-0000-000000000002'; raise exception 'Member can change profile identity'; exception when insufficient_privilege then null; end;
  update public.profiles set nickname='승현 Updated' where id='00000000-0000-0000-0000-000000000001';
  if (select nickname from public.profiles) <> '승현 Updated' then raise exception 'Own profile update failed'; end if;
  insert into public.watchlists(user_id,player_id) values('00000000-0000-0000-0000-000000000001','test-player') on conflict(user_id,player_id) do nothing;
  insert into public.watchlists(user_id,player_id) values('00000000-0000-0000-0000-000000000001','test-player') on conflict(user_id,player_id) do nothing;
  if (select count(*) from public.watchlists) <> 1 then raise exception 'Watchlist request is not idempotent'; end if;
  delete from public.watchlists where user_id='00000000-0000-0000-0000-000000000001';
  if (select count(*) from public.watchlists) <> 0 then raise exception 'Watchlist removal failed'; end if;
  begin update public.profiles set nickname='Other tester' where id='00000000-0000-0000-0000-000000000001'; raise exception 'Duplicate nickname accepted'; exception when unique_violation then null; end;
end $$;
reset role;
rollback;
