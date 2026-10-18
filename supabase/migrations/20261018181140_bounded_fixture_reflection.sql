-- Do bounded point lookups for the displayed fixtures. A correlated EXISTS in
-- the old view can be expanded into hashes of the entire scoring table even
-- when the caller requests only twenty rows.
begin;
set local lock_timeout = '3s';
create function public.kickx_fixture_reflection(p_fixture text,p_status text)
returns text language plpgsql stable strict security invoker set search_path='' as $$
begin
 if p_status not in ('FT','AET','PEN') then return null;end if;
 if exists(select 1 from public.performance_results r where r.fixture_id=p_fixture and r.status='blocked') then
  if exists(select 1 from public.performance_results r where r.fixture_id=p_fixture and r.status in ('ready','provisional'))
   then return 'partial';else return 'withheld';end if;
 end if;
 if exists(select 1 from public.performance_results r join public.player_market_snapshots m on m.id=r.player_id
   where r.fixture_id=p_fixture and m.pricing_status='pending') then return 'pending';end if;
 if exists(select 1 from public.performance_results r where r.fixture_id=p_fixture) then return 'reflected';end if;
 return 'pending';
end $$;
revoke all on function public.kickx_fixture_reflection(text,text) from public;
grant execute on function public.kickx_fixture_reflection(text,text) to anon,authenticated,service_role;
do $$declare definition text;columns text;begin
 select pg_get_viewdef('public.fixture_catalog'::regclass,true) into definition;
 select string_agg(format('old.%I',attname),',' order by attnum) into columns
  from pg_attribute where attrelid='public.fixture_catalog'::regclass and attnum>0 and not attisdropped and attname<>'reflection_status';
 -- Keep the existing view's column order, metadata, searches, grants and RLS.
 -- The unselected old reflection expression is pruned by PostgreSQL.
 execute 'create or replace view public.fixture_catalog with(security_invoker=true) as select '
   ||columns||',public.kickx_fixture_reflection(old.id,old.status) as reflection_status from ('||rtrim(definition,';')||') old';
end $$;
commit;
