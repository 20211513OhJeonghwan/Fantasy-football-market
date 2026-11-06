begin;
alter table public.operation_audit disable trigger operation_audit_repeat;
insert into public.operation_audit(action,target,detail,created_at)
select 'calculation.withheld','dedupe-test','{"reason":"MISSING_STATS"}',timestamptz '2026-10-16T01:00Z'+n*interval '1 minute'from generate_series(0,99)n;
alter table public.operation_audit enable trigger operation_audit_repeat;
insert into public.operation_audit(action,target,detail,created_at)values('calculation.publish','dedupe-test','{"price":100000}','2026-10-16T03:00Z');
do $$declare answer jsonb;begin
 answer:=kickx_private.compact_repeated_audit();
 if(select count(*)from public.operation_audit where action='calculation.withheld'and target='dedupe-test')<>1 then raise exception 'Duplicates not compacted';end if;
 if(select(detail#>>'{_repeat,count}')::integer from public.operation_audit where action='calculation.withheld'and target='dedupe-test')<>100 then raise exception 'Attempt count lost';end if;
 if not exists(select 1 from public.operation_audit where action='calculation.publish'and target='dedupe-test'and detail='{"price":100000}')then raise exception 'Non-repeated event changed';end if;
end $$;
insert into public.operation_audit(action,target,detail,created_at)values('calculation.withheld','dedupe-test','{"reason":"MISSING_STATS"}','2026-10-16T04:00Z'),('calculation.withheld','dedupe-test','{"reason":"OTHER_REASON"}','2026-10-16T04:00Z'),('calculation.withheld','dedupe-test','{"reason":"MISSING_STATS"}','2026-10-17T04:00Z');
do $$begin
 if(select count(*)from public.operation_audit where action='calculation.withheld'and target='dedupe-test')<>3 then raise exception 'Daily or reason boundaries lost';end if;
 if(select(detail#>>'{_repeat,count}')::integer from public.operation_audit where action='calculation.withheld'and target='dedupe-test'and detail->>'reason'='MISSING_STATS'and created_at<'2026-10-17')<>101 then raise exception 'Future repeated insertion grew rows';end if;
 if has_function_privilege('anon','kickx_private.compact_repeated_audit()','execute')or has_function_privilege('authenticated','kickx_private.apply_additive_assessments(jsonb)','execute')then raise exception 'Private maintenance exposed';end if;
end $$;
rollback;
