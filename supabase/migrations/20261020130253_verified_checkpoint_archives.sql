-- Reversible compaction only after verified private Storage backups.
-- Installation creates helpers/columns; it does not mutate existing payloads,
-- schedule cron, read Vault, forward credentials, or execute a cleanup.
begin;
alter table public.calculation_revisions add column archive_path text;
alter table public.calculation_revisions add column archived_at timestamptz;
alter table public.automation_daily_tasks add column archive_path text;
alter table public.club_collection_tasks add column archive_path text;
create function public.kickx_archive_object_exists(p_path text) returns boolean language plpgsql stable set search_path='' as $$
declare present boolean;begin
 if to_regclass('storage.objects') is null then return false;end if;
 execute 'select exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id where b.id=$1 and not b.public and o.name=$2)'
 into present using 'kickx-calculation-archives',p_path;
 return present;
end $$;
-- The newest full calculation for EACH player and rule stays in PostgreSQL.
-- Older full JSON is compacted only after a verified private Storage upload.
create function public.kickx_revision_archive_batch(p_limit integer default 250) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)-'archive_path'-'archived_at'||jsonb_build_object('archive_hash',md5(jsonb_build_array(r.results,r.pricing)::text)) order by r.created_at,r.id),'[]')
 from (select c.* from public.calculation_revisions c where c.archive_path is null
  and exists(select 1 from public.calculation_revisions newer where newer.player_id=c.player_id and newer.rule_version=c.rule_version and (newer.created_at,newer.id)>(c.created_at,c.id))
  order by c.created_at,c.id limit greatest(1,least(coalesce(p_limit,250),250))) r
$$;
create function public.kickx_finish_revision_archive(p_path text,p_rows jsonb) returns integer language plpgsql set search_path='' as $$
declare changed integer;begin
 if p_path is null or p_path !~ '^calculation-revisions/[a-f0-9]{64}[.]json[.]gz$' or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows)>250 then raise exception 'INVALID_ARCHIVE';end if;
 if not public.kickx_archive_object_exists(p_path) then raise exception 'ARCHIVE_OBJECT_REQUIRED';end if;
 perform public.kickx_economy_lock();
 update public.calculation_revisions c set results='[]',pricing=null,archive_path=p_path,archived_at=clock_timestamp()
 from jsonb_to_recordset(p_rows) x(id uuid,archive_hash text)
 where c.id=x.id and c.archive_path is null and md5(jsonb_build_array(c.results,c.pricing)::text)=x.archive_hash
  and exists(select 1 from public.calculation_revisions newer where newer.player_id=c.player_id and newer.rule_version=c.rule_version and (newer.created_at,newer.id)>(c.created_at,c.id));
 get diagnostics changed=row_count;return changed;
end $$;


create function public.kickx_checkpoint_archive_batch(p_limit integer default 250) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(data order by day nulls first,key),'[]') from (
  select * from (
   select d.day,d.key,to_jsonb(d)-'archive_path'||jsonb_build_object('_source','daily','archive_hash',md5(d.payload::text)) as data
   from public.automation_daily_tasks d where d.completed and d.payload<>'{}'::jsonb
   union all
   select null::date,c.key,to_jsonb(c)-'archive_path'||jsonb_build_object('_source','club','archive_hash',md5(c.payload::text))
   from public.club_collection_tasks c where c.completed and c.payload<>'{}'::jsonb
  ) pending order by day nulls first,key limit greatest(1,least(coalesce(p_limit,250),250))
 ) batch
$$;
create function public.kickx_finish_checkpoint_archive(p_path text,p_rows jsonb) returns integer language plpgsql set search_path='' as $$
declare daily_count integer;club_count integer;begin
 if p_path is null or p_path !~ '^checkpoint-payloads/[a-f0-9]{64}[.]json[.]gz$' or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows)>250 then raise exception 'INVALID_ARCHIVE';end if;
 if not public.kickx_archive_object_exists(p_path) then raise exception 'ARCHIVE_OBJECT_REQUIRED';end if;
 update public.automation_daily_tasks d set payload='{}',archive_path=p_path
 from jsonb_to_recordset(p_rows) x(_source text,day date,key text,archive_hash text)
 where x._source='daily' and d.day=x.day and d.key=x.key and d.completed and d.payload<>'{}'::jsonb and md5(d.payload::text)=x.archive_hash;
 get diagnostics daily_count=row_count;
 update public.club_collection_tasks c set payload='{}',archive_path=p_path
 from jsonb_to_recordset(p_rows) x(_source text,key text,archive_hash text)
 where x._source='club' and c.key=x.key and c.completed and c.payload<>'{}'::jsonb and md5(c.payload::text)=x.archive_hash;
 get diagnostics club_count=row_count;
 return daily_count+club_count;
end $$;
do $$declare r record;begin
 for r in select oid::regprocedure as fn from pg_proc where pronamespace='public'::regnamespace and proname in(
  'kickx_archive_object_exists','kickx_revision_archive_batch','kickx_finish_revision_archive','kickx_checkpoint_archive_batch','kickx_finish_checkpoint_archive') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.fn);
  execute format('grant execute on function %s to service_role',r.fn);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
