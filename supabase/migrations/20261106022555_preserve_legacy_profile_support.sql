-- Nickname/avatar saves must not invoke the legacy singular-team clearing adapter.
begin;
do $$declare d text;begin
 d:=pg_get_functiondef('public.kickx_save_profile(jsonb)'::regprocedure);
 if position('set nickname=nick,team_id=main,team_ids=ids,'in d)=0 then raise exception 'PROFILE_WRITER_CHANGED';end if;
 d:=replace(d,'set nickname=nick,team_id=main,team_ids=ids,','set nickname=nick,team_id=coalesce(main,ids[1]),team_ids=ids,');execute d;
end $$;
notify pgrst,'reload schema';
commit;
