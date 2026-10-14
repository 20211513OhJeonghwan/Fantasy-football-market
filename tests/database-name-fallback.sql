-- Rollback-only: new teamless/DOB-less identities and insert-only naming contracts.
begin;
insert into public.players(id,name,provider) values('bsd-990001','J. Zevan','bsd'),('bsd-990002','Preserved Player','bsd');
insert into public.player_names(player_id,display_name,source) values('bsd-990002','수동 이름','manual');
select public.kickx_apply_korean_catalog('[{"id":"bsd-990001","name":"J. Zevan","name_ko":"제이 제반","source":"transliteration"},{"id":"bsd-990002","name":"Preserved Player","name_ko":"덮어쓰면 안 됨","source":"transliteration"}]','[]');
do $$begin
 if (select name_ko from public.players where id='bsd-990001')<>'제이 제반' then raise exception 'Fallback column not synchronized';end if;
 if (select source from public.player_names where player_id='bsd-990001')<>'transliteration' then raise exception 'Draft classified as verified';end if;
 if (select name from public.players where id='bsd-990001')<>'J. Zevan' then raise exception 'Original identity replaced';end if;
 if (select name_ko from public.players where id='bsd-990002')<>'수동 이름' then raise exception 'Manual label overwritten';end if;
end$$;
select public.kickx_apply_korean_catalog('[{"id":"bsd-990001","name":"Changed spelling","name_ko":"다른 이름"}]','[]');
do $$begin
 if (select name_ko from public.players where id='bsd-990001')<>'제이 제반' then raise exception 'Identity guard bypassed';end if;
end$$;
-- Replaying the alias trigger repairs a nullable column while retaining provenance.
alter table public.players disable trigger korean_player_column;
update public.players set name_ko=null where id='bsd-990001';
alter table public.players enable trigger korean_player_column;
update public.player_names set display_name=display_name where player_id='bsd-990001';
do $$begin
 if (select name_ko from public.players where id='bsd-990001')<>'제이 제반' or (select source from public.player_names where player_id='bsd-990001')<>'transliteration' then raise exception 'Alias repair lost provenance';end if;
end$$;
rollback;
