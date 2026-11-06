-- Repeated identical automated holds become one daily record with an exact attempt count.
-- Member moderation, trades, source statistics and non-repeated audit events stay untouched.
begin;
create index operation_audit_withheld_target_time_idx on public.operation_audit(target,created_at desc)where action='calculation.withheld';
create function kickx_private.aggregate_repeated_audit()returns trigger language plpgsql set search_path='' as $$
declare found_row public.operation_audit%rowtype;begin
 if new.action<>'calculation.withheld'then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('kickx:withheld:'||coalesce(new.target,'')||coalesce(new.actor::text,'')||(new.detail-'_repeat')::text,0));
 select * into found_row from public.operation_audit a where a.action=new.action and a.target is not distinct from new.target and a.actor is not distinct from new.actor
 and a.created_at>=date_trunc('day',new.created_at at time zone 'Asia/Seoul')at time zone 'Asia/Seoul'
 and a.created_at<(date_trunc('day',new.created_at at time zone 'Asia/Seoul')+interval '1 day')at time zone 'Asia/Seoul'
 and a.detail-'_repeat'=new.detail-'_repeat'order by a.created_at desc,a.id desc limit 1 for update;
 if found_row.id is not null then
  update public.operation_audit set detail=(detail-'_repeat')||jsonb_build_object('_repeat',jsonb_build_object('count',coalesce((detail#>>'{_repeat,count}')::bigint,1)+1,'firstAt',coalesce(detail#>>'{_repeat,firstAt}',created_at::text),'lastAt',new.created_at))where id=found_row.id;
  return null;
 end if;
 return new;
end $$;
revoke all on function kickx_private.aggregate_repeated_audit()from public,anon,authenticated,service_role;
create trigger operation_audit_repeat before insert on public.operation_audit for each row execute function kickx_private.aggregate_repeated_audit();
create function kickx_private.compact_repeated_audit()returns jsonb language plpgsql set search_path='' as $$
declare before_count bigint;after_count bigint;attempts_before bigint;attempts_after bigint;begin
 lock table public.operation_audit in share row exclusive mode;
 select count(*),sum(coalesce((detail#>>'{_repeat,count}')::bigint,1))into before_count,attempts_before from public.operation_audit where action='calculation.withheld';
 create temporary table audit_groups on commit drop as
 select (array_agg(id order by created_at desc,id desc))[1]keep_id,array_agg(id)ids,count(*)rows,
 sum(coalesce((detail#>>'{_repeat,count}')::bigint,1))attempts,min(coalesce((detail#>>'{_repeat,firstAt}')::timestamptz,created_at))first_at,max(coalesce((detail#>>'{_repeat,lastAt}')::timestamptz,created_at))last_at
 from public.operation_audit where action='calculation.withheld'group by target,actor,detail-'_repeat',(created_at at time zone 'Asia/Seoul')::date having count(*)>1;
 update public.operation_audit a set detail=(detail-'_repeat')||jsonb_build_object('_repeat',jsonb_build_object('count',g.attempts,'firstAt',g.first_at,'lastAt',g.last_at))from pg_temp.audit_groups g where a.id=g.keep_id;
 delete from public.operation_audit a using pg_temp.audit_groups g where a.id=any(g.ids)and a.id<>g.keep_id;
 select count(*),sum(coalesce((detail#>>'{_repeat,count}')::bigint,1))into after_count,attempts_after from public.operation_audit where action='calculation.withheld';
 if attempts_before is distinct from attempts_after then raise exception 'AUDIT_ATTEMPT_COUNT_CHANGED';end if;
 return jsonb_build_object('beforeRows',before_count,'afterRows',after_count,'removedDuplicates',before_count-after_count,'attemptCount',attempts_after);
end $$;
revoke all on function kickx_private.compact_repeated_audit()from public,anon,authenticated,service_role;
alter table public.operation_audit set(autovacuum_vacuum_scale_factor=.05,autovacuum_vacuum_threshold=50);
notify pgrst,'reload schema';
commit;
