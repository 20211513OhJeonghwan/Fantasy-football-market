-- Preserve the one-off rollback checkpoint while reducing its free-plan footprint.
begin;
create function kickx_private.checkpoint_rows() returns table(id text,data jsonb)
language sql stable security invoker set search_path='' as $$
 select c.id,c.data from kickx_private.valuation_checkpoint c where c.data->>'format' is distinct from 'row-batch-v1'
 union all select x->>'id',x->'data' from kickx_private.valuation_checkpoint c cross join lateral jsonb_array_elements(case when c.data->>'format'='row-batch-v1'then c.data->'records'else '[]'::jsonb end)x
$$;
revoke all on function kickx_private.checkpoint_rows() from public,anon,authenticated,service_role;
create function kickx_private.pack_valuation_checkpoint() returns jsonb
language plpgsql security invoker set search_path='' set jit=off set enable_hashagg=off as $$
declare before_hash text;after_hash text;before_count bigint;after_count bigint;before_bytes bigint;after_bytes bigint;items jsonb;ids text[];n integer:=0;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:checkpoint-pack',0));
 select count(*),md5(string_agg(md5(id||'|'||data::text),',' order by id))into before_count,before_hash from kickx_private.checkpoint_rows();
 select sum(pg_column_size(data))into before_bytes from kickx_private.valuation_checkpoint;
 loop
  select array_agg(id order by id),jsonb_agg(jsonb_build_object('id',id,'data',data)order by id)into ids,items from(
   select id,data from kickx_private.valuation_checkpoint where id like 'neutral-six-20261106:%' and id not like 'neutral-six-20261106:packed:%' order by id limit 500 for update)q;
  exit when ids is null;
  insert into kickx_private.valuation_checkpoint(id,data)values('neutral-six-20261106:packed:'||md5(array_to_string(ids,',')),jsonb_build_object('format','row-batch-v1','records',items));
  delete from kickx_private.valuation_checkpoint where id=any(ids);n:=n+1;
 end loop;
 select count(*),md5(string_agg(md5(id||'|'||data::text),','order by id))into after_count,after_hash from kickx_private.checkpoint_rows();
 if (before_count,before_hash)is distinct from(after_count,after_hash)then raise exception 'CHECKPOINT_CONTENT_CHANGED';end if;
 select sum(pg_column_size(data))into after_bytes from kickx_private.valuation_checkpoint;
 return jsonb_build_object('groups',n,'records',after_count,'beforeBytes',before_bytes,'afterBytes',after_bytes,'contentUnchanged',true,'contentHash',after_hash);
end $$;
revoke all on function kickx_private.pack_valuation_checkpoint() from public,anon,authenticated,service_role;

-- Preserve consistency for formerly listed players, even after they leave the market.
create function kickx_private.reprice_archived_players() returns jsonb
language plpgsql security invoker set search_path='' set jit=off as $$
declare q record;r jsonb;plan jsonb;items jsonb;params jsonb;n integer:=0;before_hash jsonb;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 before_hash:=public.kickx_valuation_integrity();select report_parameters into params from public.kickx_policy;
 if params->>'scoringRevision' is distinct from 'neutral-six-20261106'then raise exception 'RESET_POLICY_REQUIRED';end if;
 for q in select i.*from public.player_initial_values i where i.rule_version='report-v3'and not public.kickx_market_eligible(i.player_id)and exists(select 1 from public.player_price_results p where p.player_id=i.player_id)loop
  select coalesce(jsonb_agg(jsonb_build_object('fixtureId',s.fixture_id,'score',s.score,'status',s.status,'season',f.season,'minutes',m.stats->'minutes_played','startedAt',f.starts_at,'endedAt',public.kickx_fixture_valuation_at(f.id))),'[]')into items
  from public.performance_results s join public.fixtures f on f.id=s.fixture_id join public.football_match_stats m on m.player_id=s.player_id and m.fixture_id=s.fixture_id where s.player_id=q.player_id and s.rule_version='report-v3'and public.kickx_regular_fixture(f.id)is true;
  plan:=public.kickx_report_plan(items,q.detail,params);
  delete from public.player_price_results where player_id=q.player_id;
  for r in select value from jsonb_array_elements(plan->'steps')loop
   insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
   values(q.player_id,r->>'fixtureId','report-v3',(r->>'playedAt')::timestamptz,(r->>'priceBefore')::bigint,(r->>'priceAfter')::bigint,(r->>'targetPrice')::bigint,(r->>'formScore')::numeric,(r->>'changePercent')::numeric,r->'window',(select input_hash from public.performance_results where player_id=q.player_id and fixture_id=r->>'fixtureId'));
  end loop;
  update public.player_market_snapshots set price=(plan->>'price')::numeric,change_percent=coalesce((plan#>>'{steps,-1,changePercent}')::numeric,0),
   performance=(select case when s.status='not-played'then null else s.score end from public.performance_results s join public.fixtures f on f.id=s.fixture_id where s.player_id=q.player_id and s.status in('ready','provisional','not-played')and public.kickx_regular_fixture(f.id)is true order by f.starts_at desc,f.id desc limit 1),performance_rule_version='report-v3',pricing_rule_version='report-v3'where id=q.player_id;
  delete from public.price_history where player_id=q.player_id;
  insert into public.price_history(player_id,recorded_at,value,rule_version)values(q.player_id,to_timestamp((params->>'valuationStartMs')::numeric/1000),(q.detail->>'price')::numeric,'report-v3');
  insert into public.price_history(player_id,recorded_at,value,rule_version)select q.player_id,(x->>'playedAt')::timestamptz,(x->>'priceAfter')::numeric,'report-v3'from jsonb_array_elements(plan->'steps')x;
  delete from public.player_calculation_state where player_id=q.player_id;n:=n+1;
 end loop;
 if before_hash is distinct from public.kickx_valuation_integrity()then raise exception 'VALUATION_FINANCIAL_INTEGRITY';end if;
 return jsonb_build_object('archivedPlayers',n,'financialIntegrityUnchanged',true);
end $$;
revoke all on function kickx_private.reprice_archived_players() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
