-- Approved: restore the report's unbounded additive score and add observed everyday actions.
-- Historical source evidence and frozen initial prices are preserved. Price events start Oct 15 KST.
begin;
-- A lower TOAST target compresses the expanded evidence instead of duplicating large inline rows.
alter table public.performance_results set(toast_tuple_target=768);
create function kickx_private.additive_points(metric text,v numeric,pos text) returns numeric language sql immutable set search_path='' as $$
 select round(case metric
 when 'minutes' then case when v>=60 then 2 else 1 end
 when 'goals' then v*case pos when 'GK' then 10 when 'DF' then 6 when 'MF' then 5 else 4 end
 when 'assists' then v*case pos when 'GK' then 5 when 'DF' then 4 else 3 end
 when 'yellow_cards' then -v when 'red_cards' then -3*v when 'own_goals' then -2*v
 when 'shots_on_target' then v*case pos when 'MF' then .5 else 1 end
 when 'key_passes' then v*case pos when 'MF' then 1 else .5 end
 when 'crosses_completed' then v*.5 when 'pass_accuracy' then case when v>=85 then 1 else 0 end
 when 'defensive_actions' then case pos when 'DF' then floor(v/3) else v*.5 end
 when 'clean_sheet' then v*case pos when 'MF' then 1 when 'FW' then 0 else 4 end
 when 'conceded' then -floor(v/2) when 'saves' then floor(v/3) when 'penalty_saves' then v*5
 when 'passes_completed' then floor(v/10)*.5 when 'ball_recoveries' then v*.5 when 'clearances' then v*.25
 when 'dribbles_completed' then v*.5 when 'shots_blocked' then v*.5 when 'fouls_won' then v*.25
 when 'high_claims' then case pos when 'GK' then v*.5 else 0 end
 when 'keeper_sweeper_success' then case pos when 'GK' then v*.5 else 0 end else 0 end,2)
$$;
revoke all on function kickx_private.additive_points(text,numeric,text) from public,anon,authenticated,service_role;

-- Retain old policy examples for historical migrations/tests; production chooses position-match explicitly.
do $$declare d text;begin
 d:=pg_get_functiondef('public.kickx_report_plan(jsonb,jsonb,jsonb)'::regprocedure);
 d:=replace(d,'public.kickx_report_plan(', 'kickx_private.neutral_report_plan(');execute d;
end $$;
revoke all on function kickx_private.neutral_report_plan(jsonb,jsonb,jsonb) from public,anon,authenticated;
create or replace function public.kickx_report_plan(p_results jsonb,p_baseline jsonb,p_parameters jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare r jsonb;steps jsonb:='[]';v bigint;before_v bigint;rate numeric;raw_rate numeric;exposure numeric;t numeric;at text;ref numeric;pos text;begin
 if p_parameters->>'pricingModel' is distinct from 'position-match' then return kickx_private.neutral_report_plan(p_results,p_baseline,p_parameters);end if;
 if jsonb_typeof(p_results) is distinct from 'array' or p_baseline is null or(p_parameters->>'benchmarkCutoffMs')::numeric is distinct from (p_parameters->>'valuationStartMs')::numeric then raise exception 'INVALID_REPORT_BASELINE';end if;
 v:=(p_baseline->>'price')::bigint;
 for r in select value from jsonb_array_elements(p_results) where (value->>'season')::integer>(p_baseline->>'season')::integer
 and ((value->>'status' in('ready','provisional') and jsonb_typeof(value->'score')='number' and (value->>'minutes')::numeric>0 and (value->>'minutes')::numeric<=180) or(value->>'status'='not-played' and (value->>'minutes')::numeric=0))
 order by coalesce(value->>'endedAt',value->>'startedAt')::timestamptz,value->>'fixtureId' loop
  at:=coalesce(r->>'endedAt',r->>'startedAt');
  if extract(epoch from at::timestamptz)*1000<(p_parameters->>'valuationStartMs')::numeric then continue;end if;
  pos:=r->>'position';ref:=null;exposure:=least((r->>'minutes')::numeric/60,1);
  if r->>'status'='not-played' then raw_rate:=-coalesce((p_parameters->>'nonParticipationRate')::numeric,.015);exposure:=0;
  else
   ref:=(p_parameters#>>array['positionBenchmarks',pos])::numeric;
   if ref is null or ref<=0 then raise exception 'POSITION_BENCHMARK_REQUIRED';end if;
   raw_rate:=((r->>'score')::numeric-ref)/greatest(abs(ref),(p_parameters->>'s')::numeric)*(p_parameters->>'priceSensitivity')::numeric*exposure;
  end if;
  rate:=greatest(-(p_parameters->>'maxDown')::numeric,least((p_parameters->>'maxUp')::numeric,raw_rate));
  before_v:=v;t:=greatest((p_parameters->>'minPrice')::numeric,least((p_parameters->>'maxPrice')::numeric,v*(1+rate)));
  v:=greatest((p_parameters->>'minPrice')::bigint,ceil(before_v*(1-(p_parameters->>'maxDown')::numeric))::bigint,least((p_parameters->>'maxPrice')::bigint,floor(before_v*(1+(p_parameters->>'maxUp')::numeric))::bigint,floor(t+.5)::bigint));
  steps:=steps||jsonb_build_array(jsonb_build_object('fixtureId',r->>'fixtureId','playedAt',at,'priceBefore',before_v,'priceAfter',v,'targetPrice',floor(t+.5)::bigint,
   'formScore',coalesce((r->>'score')::numeric,0),'changePercent',floor((v-before_v)*100.0/before_v*10000+.5)/10000,'window',jsonb_build_array(r->>'fixtureId'),
   'evidence',jsonb_build_object('reason',case when r->>'status'='not-played' then 'NON_PARTICIPATION' else 'POSITION_MATCH_SCORE' end,'position',pos,'referenceScore',ref,'rawScore',r->'score','exposure',exposure,'rawRate',raw_rate,'rate',rate,'sensitivity',p_parameters->'priceSensitivity','benchmarkCutoffMs',p_parameters->'benchmarkCutoffMs')));
 end loop;
 return jsonb_build_object('version','report-v3','baseline',p_baseline,'price',v,'steps',steps);
end $$;

-- Report facts carry the exact fixed comparison; no fabricated universal neutral score.
do $patch$declare d text;sig text;begin
 d:=pg_get_functiondef('public.kickx_match_report_context(text,text)'::regprocedure);
 d:=replace(d,$from$'playerName',coalesce(p.name_ko,p.name),$from$,$to$'position',s.position,'referenceScore',(select(report_parameters#>>array['positionBenchmarks',s.position])::numeric from public.kickx_policy),'priceSensitivity',(select(report_parameters->>'priceSensitivity')::numeric from public.kickx_policy),'priceExposure',least(r.minutes/60.0,1),'playerName',coalesce(p.name_ko,p.name),$to$);
 d:=replace(d,'ord<=24','ord<=32');execute d;
 foreach sig in array array['public.kickx_read_match_report(text,text)','public.kickx_claim_match_report(text,text,uuid)','public.kickx_finish_match_report(text,text,uuid,text,jsonb,text,text)']loop
  d:=pg_get_functiondef(sig::regprocedure);d:=replace(d,'match-report-outcome-v3','match-report-additive-v4');
  d:=replace(d,$from$'changePercent',facts->'changePercent')$from$,$to$'changePercent',facts->'changePercent','referenceScore',facts->'referenceScore','priceSensitivity',facts->'priceSensitivity')$to$);execute d;
 end loop;
 d:=pg_get_functiondef('public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb)'::regprocedure);
 d:=replace(d,$from$p.report_parameters?'neutralScore'$from$,$to$(p.report_parameters?'neutralScore' or p.report_parameters->>'pricingModel'='position-match')$to$);execute d;
end $patch$;

-- Explicit, idempotent maintenance entry point. No raw data backup copy is added to the database.
-- The pre-change checkpoint already exists; source evidence is never rewritten by this replay.
create function kickx_private.apply_additive_assessments(p_expected_integrity jsonb) returns jsonb
language plpgsql security invoker set search_path='' set jit=off set enable_hashagg=off as $$
declare before_hash jsonb;changed integer;price_count integer;refs jsonb;sample_counts jsonb;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 before_hash:=public.kickx_valuation_integrity();if before_hash is distinct from p_expected_integrity then raise exception 'VALUATION_FINANCIAL_INTEGRITY';end if;
 if exists(select 1 from public.kickx_policy where report_parameters->>'scoringRevision'='report-additive-20261106')then return '{"unchanged":true}';end if;
 if not exists(select 1 from public.kickx_policy where version='report-v3'and report_parameters->>'valuationStartMs'='1791990000000')then raise exception 'RESET_POLICY_REQUIRED';end if;
 create temporary table additive_games on commit drop as
 select f.*,s.updated_at source_updated_at,s.incidents,public.kickx_fixture_valuation_at(f.id) ended_at,public.kickx_observed_fixture_minutes(f.id) scoring_duration
 from public.fixtures f left join public.football_event_sources s on s.fixture_id=f.id
 where f.status='FT'and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')and public.kickx_regular_fixture(f.id)is true
 and exists(select 1 from public.performance_results r where r.fixture_id=f.id and r.rule_version='report-v3');
 create unique index on pg_temp.additive_games(id);
 create temporary table additive_scores on commit drop as
 with valid as materialized(select r.player_id,r.fixture_id,r.position,r.breakdown,m.stats from public.performance_results r join pg_temp.additive_games g on g.id=r.fixture_id join public.football_match_stats m using(player_id,fixture_id)
 where r.rule_version='report-v3'and r.status in('ready','provisional')and r.score is not null),
 metrics as materialized(
 select v.player_id,v.fixture_id,v.position pos,b,ord,b->>'metric' metric,(b->>'value')::numeric v
 from valid v cross join lateral jsonb_array_elements(v.breakdown)with ordinality x(b,ord)
 where b->>'metric'not in('score_range','passes_completed','ball_recoveries','clearances','dribbles_completed','shots_blocked','fouls_won','high_claims','keeper_sweeper_success')
 union all
 select v.player_id,v.fixture_id,v.position,jsonb_build_object('metric',x.metric,'value',v.stats->x.field,'evidence',x.field),x.ord,x.metric,(v.stats->>x.field)::numeric
 from valid v cross join(values ('passes_completed','accurate_pass',101),('ball_recoveries','ball_recovery',102),('clearances','total_clearance',103),
 ('dribbles_completed','won_contest',104),('shots_blocked','outfielder_block',105),('fouls_won','was_fouled',106),
 ('high_claims','good_high_claim',107),('keeper_sweeper_success','accurate_keeper_sweeper',108))x(metric,field,ord)
 where jsonb_typeof(v.stats->x.field)='number'and(v.stats->>x.field)::numeric>0 and(v.stats->>x.field)::numeric=trunc((v.stats->>x.field)::numeric)
 and (x.metric not in('high_claims','keeper_sweeper_success')or v.position='GK')),
 parts as materialized(select player_id,fixture_id,ord,b||jsonb_build_object('points',round(case metric
 when 'minutes' then case when v>=60 then 2 else 1 end
 when 'goals' then v*case pos when 'GK' then 10 when 'DF' then 6 when 'MF' then 5 else 4 end
 when 'assists' then v*case pos when 'GK' then 5 when 'DF' then 4 else 3 end
 when 'yellow_cards' then -v when 'red_cards' then -3*v when 'own_goals' then -2*v
 when 'shots_on_target' then v*case pos when 'MF' then .5 else 1 end
 when 'key_passes' then v*case pos when 'MF' then 1 else .5 end
 when 'crosses_completed' then v*.5 when 'pass_accuracy' then case when v>=85 then 1 else 0 end
 when 'defensive_actions' then case pos when 'DF' then floor(v/3) else v*.5 end
 when 'clean_sheet' then v*case pos when 'MF' then 1 when 'FW' then 0 else 4 end
 when 'conceded' then -floor(v/2) when 'saves' then floor(v/3) when 'penalty_saves' then v*5
 when 'passes_completed' then floor(v/10)*.5 when 'ball_recoveries' then v*.5 when 'clearances' then v*.25
 when 'dribbles_completed' then v*.5 when 'shots_blocked' then v*.5 when 'fouls_won' then v*.25
 when 'high_claims' then case pos when 'GK' then v*.5 else 0 end
 when 'keeper_sweeper_success' then case pos when 'GK' then v*.5 else 0 end else 0 end,2))||case metric when 'minutes'then jsonb_build_object('evidence','verified appearance; report minutes band')else '{}'::jsonb end item from metrics)
 select player_id,fixture_id,jsonb_agg(item order by ord)parts,sum((item->>'points')::numeric)score from parts group by player_id,fixture_id;
 update public.performance_results r set breakdown=c.parts,score=c.score,input_hash=md5(jsonb_build_array('report-additive-20261106',c.parts,r.source_hash)::text),calculated_at=clock_timestamp()
 from pg_temp.additive_scores c where r.player_id=c.player_id and r.fixture_id=c.fixture_id;
 get diagnostics changed=row_count;
 select jsonb_object_agg(position,mean_score),jsonb_object_agg(position,n)into refs,sample_counts from(
 select r.position,round(avg(r.score),6)mean_score,count(*)n from public.performance_results r join pg_temp.additive_games g on g.id=r.fixture_id
 where r.rule_version='report-v3'and r.status in('ready','provisional')and r.score is not null and g.ended_at<timestamptz '2026-10-14T15:00:00Z'
 and g.season=(select (report_reference->>'season')::integer+1 from public.kickx_policy) group by r.position)q;
 if refs is null or (select count(*)from jsonb_object_keys(refs))<>4 or exists(select 1 from jsonb_each_text(refs)where value::numeric<=0)or exists(select 1 from jsonb_each_text(sample_counts)where value::integer<30)then raise exception 'INSUFFICIENT_PRELAUNCH_BENCHMARK';end if;
 update public.kickx_policy set report_parameters=(report_parameters-'neutralScore'-'pointRate'-'capChangeAtMs'-'previousMaxUp'-'previousMaxDown')||jsonb_build_object('pricingModel','position-match','priceSensitivity',.1,'positionBenchmarks',refs,'benchmarkCounts',sample_counts,'benchmarkCutoffMs',1791990000000,'maxUp',.1,'maxDown',.1,'scoringRevision','report-additive-20261106')where id=true;
 -- Exact source fingerprints match normal incremental ingestion, including settled VAR cases.
 with signatures as materialized(select r.player_id,r.fixture_id,md5((case when g.incidents @? '$.incidents[*] ? (@.type == "varDecision" && (@.decision == "cardUpgrade" || @.decision == "redCardGiven"))' then md5(md5(jsonb_build_array(m.updated_at,g.updated_at,g.source_updated_at,p.version,p.club_competitions_enabled,g.scoring_duration,'scoring-cache-v1')::text)||':var-terminal-20261030')else md5(jsonb_build_array(m.updated_at,g.updated_at,g.source_updated_at,p.version,p.club_competitions_enabled,g.scoring_duration,'scoring-cache-v1')::text) end)||'report-additive-20261106') signature
 from public.performance_results r join pg_temp.additive_games g on g.id=r.fixture_id join public.football_match_stats m using(player_id,fixture_id)cross join public.kickx_policy p where r.rule_version='report-v3')
 update public.performance_results r set source_hash=x.signature from signatures x where r.player_id=x.player_id and r.fixture_id=x.fixture_id;
 update public.player_match_records m set performance=r.score,rule_version=r.rule_version from public.performance_results r where r.player_id=m.player_id and r.fixture_id=m.fixture_id and r.rule_version='report-v3'and r.status in('ready','provisional');
 create temporary table additive_plans on commit drop as
 with results as materialized(select r.player_id,jsonb_agg(jsonb_build_object('fixtureId',r.fixture_id,'score',r.score,'status',r.status,'position',r.position,'season',f.season,
 'minutes',m.stats->'minutes_played','startedAt',f.starts_at,'endedAt',f.ended_at))items from public.performance_results r join pg_temp.additive_games f on f.id=r.fixture_id
 join public.football_match_stats m using(player_id,fixture_id)where r.rule_version='report-v3'and f.ended_at>=timestamptz '2026-10-14T15:00:00Z'group by r.player_id)
 select i.player_id,public.kickx_report_plan(coalesce(r.items,'[]'),i.detail,p.report_parameters)plan from public.player_initial_values i cross join public.kickx_policy p left join results r on r.player_id=i.player_id
 where i.rule_version='report-v3'and i.detail is not null and(public.kickx_market_eligible(i.player_id)or exists(select 1 from public.player_price_results x where x.player_id=i.player_id and x.rule_version='report-v3'));
 delete from public.player_price_results r using pg_temp.additive_plans p where r.player_id=p.player_id;
 insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
 select p.player_id,x->>'fixtureId','report-v3',(x->>'playedAt')::timestamptz,(x->>'priceBefore')::bigint,(x->>'priceAfter')::bigint,(x->>'targetPrice')::bigint,(x->>'formScore')::numeric,(x->>'changePercent')::numeric,x->'window',r.input_hash
 from pg_temp.additive_plans p cross join lateral jsonb_array_elements(plan->'steps')x join public.performance_results r on r.player_id=p.player_id and r.fixture_id=x->>'fixtureId';
 get diagnostics price_count=row_count;
 delete from public.price_history h using pg_temp.additive_plans p where h.player_id=p.player_id;
 insert into public.price_history(player_id,recorded_at,value,rule_version)
 select p.player_id,timestamptz '2026-10-14T15:00:00Z',(plan#>>'{baseline,price}')::numeric,'report-v3'from pg_temp.additive_plans p
 union all select p.player_id,(x->>'playedAt')::timestamptz,(x->>'priceAfter')::numeric,'report-v3'from pg_temp.additive_plans p cross join lateral jsonb_array_elements(plan->'steps')x;
 update public.player_market_snapshots s set performance_rule_version='report-v3',pricing_rule_version='report-v3',price=(p.plan->>'price')::numeric,change_percent=coalesce((p.plan#>>'{steps,-1,changePercent}')::numeric,0),
 performance=(select case when r.status='not-played'then null else r.score end from public.performance_results r join pg_temp.additive_games f on f.id=r.fixture_id where r.player_id=s.id and r.status in('ready','provisional','not-played')order by f.starts_at desc,f.id desc limit 1),updated_at=clock_timestamp()
 from pg_temp.additive_plans p where p.player_id=s.id;
 -- Reuse the latest full derived revision; do not append thousands of duplicate plans.
 update public.calculation_revisions c set pricing=p.plan,new_price=(p.plan->>'price')::bigint,input_hash=md5(p.player_id||':report-additive-20261106')
 from pg_temp.additive_plans p where c.id=(select x.id from public.calculation_revisions x where x.player_id=p.player_id and x.rule_version='report-v3'and x.archive_path is null order by x.created_at desc,x.id desc limit 1);
 delete from public.player_calculation_state c using pg_temp.additive_plans p where c.player_id=p.player_id;
 update public.asset_snapshots a set value=public.kickx_assets_at(a.user_id,a.recorded_at)where a.recorded_at>=timestamptz '2026-10-14T15:00:00Z';
 perform public.kickx_auto_refresh_rankings();
 if before_hash is distinct from public.kickx_valuation_integrity()then raise exception 'VALUATION_FINANCIAL_INTEGRITY';end if;
 if exists(select 1 from public.price_history where rule_version='report-v3'and recorded_at<timestamptz '2026-10-14T15:00:00Z')then raise exception 'PRELAUNCH_PRICE_EVENT';end if;
 insert into public.operation_audit(action,detail)values('policy.report-additive',jsonb_build_object('scores',changed,'priceSteps',price_count,'positionBenchmarks',refs,'benchmarkCounts',sample_counts,'financialIntegrityUnchanged',true,'providerRequests',0));
 return jsonb_build_object('scores',changed,'priceSteps',price_count,'players',(select count(*)from pg_temp.additive_plans),'positionBenchmarks',refs,'benchmarkCounts',sample_counts,'financialIntegrityUnchanged',true,'providerRequests',0);
end $$;
revoke all on function kickx_private.apply_additive_assessments(jsonb)from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
