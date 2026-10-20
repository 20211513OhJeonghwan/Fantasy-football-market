-- Limit cheap keys before expanding large JSON/TOAST checkpoint payloads.
-- pg_column_size reads the stored size without decompressing an entire payload.
-- A nonempty object is larger than the empty-object JSONB representation.
begin;
create or replace function public.kickx_checkpoint_archive_batch(p_limit integer default 50) returns jsonb language sql stable set search_path='' as $$
 with candidates as materialized (
  select * from (
   select 'daily'::text as source,d.day,d.key from public.automation_daily_tasks d
    where d.completed and pg_column_size(d.payload)>pg_column_size('{}'::jsonb)
   union all
   select 'club',null::date,c.key from public.club_collection_tasks c
    where c.completed and pg_column_size(c.payload)>pg_column_size('{}'::jsonb)
  ) keys order by day nulls first,key limit greatest(1,least(coalesce(p_limit,50),50))
 ), expanded as (
  select k.day,k.key,to_jsonb(d)-'archive_path'||jsonb_build_object('_source','daily','archive_hash',md5(d.payload::text)) as data
   from candidates k join public.automation_daily_tasks d on k.source='daily' and d.day=k.day and d.key=k.key
  union all
  select k.day,k.key,to_jsonb(c)-'archive_path'||jsonb_build_object('_source','club','archive_hash',md5(c.payload::text))
   from candidates k join public.club_collection_tasks c on k.source='club' and c.key=k.key
 ) select coalesce(jsonb_agg(data order by day nulls first,key),'[]') from expanded
$$;
create or replace function public.kickx_revision_archive_batch(p_limit integer default 50) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)-'archive_path'-'archived_at'||jsonb_build_object('archive_hash',md5(jsonb_build_array(r.results,r.pricing)::text)) order by r.created_at,r.id),'[]')
 from (select c.* from public.calculation_revisions c where c.archive_path is null
  and exists(select 1 from public.calculation_revisions newer where newer.player_id=c.player_id and newer.rule_version=c.rule_version and (newer.created_at,newer.id)>(c.created_at,c.id))
  order by c.created_at,c.id limit greatest(1,least(coalesce(p_limit,50),50))) r
$$;
notify pgrst,'reload schema';
commit;
