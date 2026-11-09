-- One shared duration for transfer, position and formation freezes.
-- Existing bench start times and prices are preserved; inbox retention stays 14 days.
begin;
set local lock_timeout='5s';

create function kickx_private.bench_retention() returns interval
language sql immutable set search_path='' as $$select interval '168 hours'$$;
revoke all on function kickx_private.bench_retention() from public,anon,authenticated,service_role;

do $$declare target regprocedure;src text;changed text;begin
 foreach target in array array[
  'kickx_private.bench_quote(uuid,text)'::regprocedure,
  'kickx_private.settle_bench(uuid,uuid,uuid,boolean)'::regprocedure,
  'kickx_private.expire_roster_bench(integer)'::regprocedure,
  'public.kickx_quote(text,text)'::regprocedure,
  'public.kickx_member_data()'::regprocedure
 ] loop
  src:=pg_get_functiondef(target);
  changed:=replace(src,$old$interval '336 hours'$old$,'kickx_private.bench_retention()');
  if changed=src then raise exception 'BENCH_RETENTION_PATCH_MISMATCH: %',target;end if;
  execute changed;
 end loop;
end $$;

notify pgrst,'reload schema';
commit;
