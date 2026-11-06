-- The normal publisher must preserve the latest verified DNP display after the bulk replay.
begin;
do $patch$
declare original text; amended text;
begin
 original:=pg_get_functiondef('public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb)'::regprocedure);
 amended:=replace(original,
  $from$p.report_parameters->>'pricingModel'='position-match'$from$,
  $to$p.report_parameters->>'pricingModel' in('position-match','position-points')$to$);
 if amended=original then raise exception 'POINT_PRICING_PUBLISHER_GUARD_CHANGED';end if;
 execute amended;
end $patch$;
notify pgrst,'reload schema';
commit;
