-- Profile icon: owners may set a glyph or a supported club crest; dropping the club clears the crest.
begin;
insert into public.leagues(id,name) values('bsd-1','PL'),('bsd-3','LaLiga') on conflict do nothing;
insert into public.teams(id,name,league_id) values('avatar-a','A','bsd-1'),('avatar-b','B','bsd-3') on conflict do nothing;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000081');
insert into public.profiles(id,nickname,team_id) values('00000000-0000-0000-0000-000000000081','Icon Fan','avatar-a');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000081';
select public.kickx_save_profile('{"nickname":"Icon Fan","teams":["avatar-a","avatar-b"],"avatar":"icon:trophy"}');
do $$begin if (select avatar from public.profiles where id=auth.uid())<>'icon:trophy' then raise exception 'Glyph not saved';end if;end $$;
update public.profiles set avatar='club:avatar-b' where id=auth.uid();
do $$begin if (select avatar from public.profiles where id=auth.uid())<>'club:avatar-b' then raise exception 'Supported crest not saved';end if;end $$;
select public.kickx_save_profile('{"nickname":"Icon Fan","teams":["avatar-a"]}');
do $$begin if (select avatar from public.profiles where id=auth.uid()) is not null then raise exception 'Crest kept after leaving the club';end if;end $$;
update public.profiles set avatar='club:avatar-b' where id=auth.uid();
do $$begin if (select avatar from public.profiles where id=auth.uid()) is not null then raise exception 'Unsupported crest accepted';end if;end $$;
do $$begin
 begin update public.profiles set avatar='icon:<script>' where id=auth.uid(); exception when check_violation then return; end;
 raise exception 'Invalid glyph accepted';
end $$;
reset role;
rollback;
