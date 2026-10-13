begin;
update public.kickx_policy set version='prototype-v1';
insert into public.leagues(id,name) values('bsd-900001','Test league');
insert into public.teams(id,name,provider,league_id) values('bsd-900001','Test FC','bsd','bsd-900001'),('bsd-900002','Away FC','bsd','bsd-900001');
insert into public.players(id,name,provider,birth_date,team_id,position) values
 ('bsd-900001','Test Player','bsd','2000-01-01','bsd-900001','FW'),
 ('bsd-900002','Same Name','bsd','2000-02-01','bsd-900001','DF'),
 ('bsd-900003','Preserved','bsd','2000-01-01','bsd-900001','GK');
insert into public.player_names(player_id,display_name,source) values('bsd-900003','기존 이름','manual');
insert into public.player_market_snapshots(id,price,pricing_rule_version) values('bsd-900001',123456,'test-only');
insert into public.fixtures(id,home_team_id,away_team_id,starts_at,status) values('bsd-900001','bsd-900001','bsd-900002','2026-10-11T12:00:00Z','NS');
set local role service_role;
do $$declare result jsonb;payload jsonb:='[
 {"id":"bsd-900001","name":"Test Player","name_ko":"테스트 선수","birth_date":"2000-01-01","source_id":"Q123"},
 {"id":"bsd-900002","name":"Same Name","name_ko":"잘못된 선수","birth_date":"2000-01-01","source_id":"Q456"},
 {"id":"bsd-900003","name":"Preserved","name_ko":"덮어쓰기 시도"}]';begin
 result:=public.kickx_apply_korean_catalog(payload,'[{"id":"bsd-900001","name":"Test FC","name_ko":"테스트 구단"}]');
 if result->>'players'<>'1' or result->>'teams'<>'1' or result->>'skipped'<>'2' then raise exception 'Identity/preservation check failed: %',result;end if;
 if (select name_ko from public.players where id='bsd-900001')<>'테스트 선수' then raise exception 'Player column not synchronized';end if;
 if (select name_ko from public.players where id='bsd-900003')<>'기존 이름' then raise exception 'Manual name overwritten';end if;
 if (select source from public.player_names where player_id='bsd-900001')<>'wikidata' then raise exception 'Trigger lost source metadata';end if;
 if (select search_text from public.player_catalog where id='bsd-900001') not like '%테스트 구단%' or
    (select search_text from public.player_catalog where id='bsd-900001') not like '%Test Player%' then raise exception 'Bilingual search missing';end if;
 if (select search_text from public.fixture_catalog where id='bsd-900001') not like '%테스트 구단%' then raise exception 'Fixture search missing';end if;
 if public.kickx_apply_korean_catalog(payload,'[]')->>'players'<>'0' then raise exception 'Replay overwrote labels';end if;
 update public.players set name_ko='직접 수정' where id='bsd-900001';
 if (select display_name from public.player_names where player_id='bsd-900001')<>'직접 수정' or
    (select source from public.player_names where player_id='bsd-900001')<>'manual' then raise exception 'Column edit not protected';end if;
 if public.kickx_apply_automatic_name('bsd-900001','자동 수정',array['Test Player'],'Q123','{"name":"Test Player","english":null,"birth_date":"2000-01-01"}') then raise exception 'Automatic lookup overwrote manual column';end if;
 -- A normal provider refresh omits localization fields and must retain them.
 perform public.apply_bsd_batch('{"provider":"bsd","players":[{"id":"bsd-900001","external_id":900001,"name":"Test Player"}],"teams":[{"id":"bsd-900001","external_id":900001,"name":"Test FC","league_id":"bsd-900001"}]}');
 if (select name_ko from public.players where id='bsd-900001')<>'직접 수정' or
    (select name_ko from public.teams where id='bsd-900001')<>'테스트 구단' then raise exception 'Refresh erased localization';end if;
 if (select price from public.player_market_snapshots where id='bsd-900001')<>123456 then raise exception 'Name import changed the economy';end if;
 delete from public.player_names where player_id='bsd-900001';
 if (select name_ko from public.players where id='bsd-900001') is not null then raise exception 'Deleted alias left a stale column';end if;
end $$;
reset role;
set local role anon;
do $$begin
 if (select name_ko from public.teams where id='bsd-900001')<>'테스트 구단' then raise exception 'Public name inaccessible';end if;
 begin perform public.kickx_apply_korean_catalog('[]','[]');raise exception 'Anonymous import allowed';exception when insufficient_privilege then null;end;
 begin update public.players set name_ko='우회' where id='bsd-900001';raise exception 'Anonymous update allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
