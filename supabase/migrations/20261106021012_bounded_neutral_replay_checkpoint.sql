-- Small checkpoint rows and streaming aggregates fit the free compute tier.
begin;
do $patch$declare d text;begin
 d:=pg_get_functiondef('public.kickx_apply_neutral_assessments(jsonb)'::regprocedure);
 if position($old$ insert into kickx_private.valuation_checkpoint(id,data)values('neutral-six-20261106',jsonb_build_object(
  'integrity',before_hash,'parameters',(select report_parameters from public.kickx_policy),
  'performance',(select jsonb_agg(to_jsonb(x)) from public.performance_results x),
  'prices',(select jsonb_agg(to_jsonb(x)) from public.player_price_results x),
  'snapshots',(select jsonb_agg(to_jsonb(x)) from public.player_market_snapshots x),
  'history',(select jsonb_agg(to_jsonb(x)) from public.price_history x),
  'records',(select jsonb_agg(jsonb_build_object('id',id,'performance',performance,'rule_version',rule_version)) from public.player_match_records),
  'assets',(select jsonb_agg(to_jsonb(x)) from public.asset_snapshots x),
  'rankings',(select jsonb_agg(to_jsonb(x)) from public.ranking_snapshots x)))on conflict(id)do nothing;$old$ in d)=0 then raise exception 'REPLAY_FUNCTION_CHANGED';end if;
 d:=replace(d,$old$ insert into kickx_private.valuation_checkpoint(id,data)values('neutral-six-20261106',jsonb_build_object(
  'integrity',before_hash,'parameters',(select report_parameters from public.kickx_policy),
  'performance',(select jsonb_agg(to_jsonb(x)) from public.performance_results x),
  'prices',(select jsonb_agg(to_jsonb(x)) from public.player_price_results x),
  'snapshots',(select jsonb_agg(to_jsonb(x)) from public.player_market_snapshots x),
  'history',(select jsonb_agg(to_jsonb(x)) from public.price_history x),
  'records',(select jsonb_agg(jsonb_build_object('id',id,'performance',performance,'rule_version',rule_version)) from public.player_match_records),
  'assets',(select jsonb_agg(to_jsonb(x)) from public.asset_snapshots x),
  'rankings',(select jsonb_agg(to_jsonb(x)) from public.ranking_snapshots x)))on conflict(id)do nothing;$old$,$new$ -- Keep each checkpoint row small; never assemble the whole market in one JSON value.
 insert into kickx_private.valuation_checkpoint(id,data)
 select 'neutral-six-20261106',jsonb_build_object('integrity',before_hash,'parameters',(select report_parameters from public.kickx_policy))
 union all select 'neutral-six-20261106:performance:'||x.player_id||':'||x.fixture_id,jsonb_build_object('table','performance_results','row',to_jsonb(x)) from public.performance_results x where x.rule_version='report-v3' and x.status in('ready','provisional') and x.score is not null
 union all select 'neutral-six-20261106:source:'||x.player_id||':'||x.fixture_id,jsonb_build_object('table','performance_source_hash','row',jsonb_build_object('player_id',x.player_id,'fixture_id',x.fixture_id,'source_hash',x.source_hash)) from public.performance_results x where x.rule_version='report-v3' and x.source_hash is not null
 union all select 'neutral-six-20261106:price:'||x.player_id||':'||x.fixture_id,jsonb_build_object('table','player_price_results','row',to_jsonb(x)) from public.player_price_results x
 union all select 'neutral-six-20261106:snapshot:'||x.id,jsonb_build_object('table','player_market_snapshots','row',to_jsonb(x)) from public.player_market_snapshots x
 union all select 'neutral-six-20261106:history:'||x.id::text,jsonb_build_object('table','price_history','row',to_jsonb(x)) from public.price_history x
 union all select 'neutral-six-20261106:record:'||x.id::text,jsonb_build_object('table','player_match_record_score','row',jsonb_build_object('id',x.id,'performance',x.performance,'rule_version',x.rule_version)) from public.player_match_records x where exists(select 1 from public.performance_results r where r.player_id=x.player_id and r.fixture_id=x.fixture_id and r.rule_version='report-v3' and r.status in('ready','provisional'))
 union all select 'neutral-six-20261106:asset:'||x.id::text,jsonb_build_object('table','asset_snapshots','row',to_jsonb(x)) from public.asset_snapshots x
 union all select 'neutral-six-20261106:ranking:'||x.id::text,jsonb_build_object('table','ranking_snapshots','row',to_jsonb(x)) from public.ranking_snapshots x
 on conflict(id)do nothing;$new$);
 d:=replace(d,'before_hash:=public.kickx_valuation_integrity();',$new$perform pg_catalog.set_config('enable_hashagg','off',true);before_hash:=public.kickx_valuation_integrity();$new$);
 d:=replace(d,$old$set source_hash=md5(source_hash||'neutral-six-20261106') where source_hash is not null$old$,$new$set source_hash=md5(source_hash||'neutral-six-20261106') where rule_version='report-v3' and source_hash is not null$new$);
 d:=replace(d,$old$r.fixture_id=m.fixture_id and r.status in('ready','provisional')$old$,$new$r.fixture_id=m.fixture_id and r.rule_version='report-v3' and r.status in('ready','provisional')$new$);execute d;
 d:=pg_get_functiondef('public.kickx_calculation_sources(text)'::regprocedure);
 d:=replace(d,$old$md5(h.signature||coalesce(p.report_parameters->>'scoringRevision',''))$old$,$new$coalesce(md5(h.signature||(p.report_parameters->>'scoringRevision')),h.signature)$new$);execute d;
end $patch$;
notify pgrst,'reload schema';
commit;
