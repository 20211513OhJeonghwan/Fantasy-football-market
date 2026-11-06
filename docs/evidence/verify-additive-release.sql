-- Read-only production verification for the additive scoring and fixed-point pricing release.
with policy as materialized(select report_parameters p from public.kickx_policy),
scored as materialized(
 select r.*,public.kickx_fixture_valuation_at(f.id) ended_at
 from public.performance_results r join public.fixtures f on f.id=r.fixture_id
 where r.rule_version='report-v3'and r.status in('ready','provisional')and f.status='FT'and public.kickx_regular_fixture(f.id)is true
),
priced as materialized(
 select v.*,r.status,r.position,r.score,(m.stats->>'minutes_played')::numeric minutes,
 (p.p#>>array['positionBenchmarks',r.position])::numeric reference_score,p.p parameters
 from public.player_price_results v join public.performance_results r using(player_id,fixture_id,rule_version)
 join public.football_match_stats m using(player_id,fixture_id)cross join policy p where v.rule_version='report-v3'
),
raw_moves as materialized(
 select v.*,case when status='not-played'then -price_before*(parameters->>'nonParticipationRate')::numeric else
 (parameters->>'priceUnit')::numeric*(parameters->>'priceSensitivity')::numeric*(score-reference_score)/greatest(abs(reference_score),(parameters->>'s')::numeric)*least(minutes/60,1)end delta from priced v
),
checked_moves as materialized(
 select v.*,greatest((parameters->>'minPrice')::numeric,ceil(price_before*(1-(parameters->>'maxDown')::numeric)),
 least((parameters->>'maxPrice')::numeric,floor(price_before*(1+(parameters->>'maxUp')::numeric)),
 floor(greatest((parameters->>'minPrice')::numeric,least((parameters->>'maxPrice')::numeric,
 price_before*(1+greatest(-(parameters->>'maxDown')::numeric,least((parameters->>'maxUp')::numeric,delta/price_before)))))+.5))) expected_price from raw_moves v
),
latest as materialized(select distinct on(player_id)* from priced order by player_id,played_at desc,fixture_id desc),
report_ids as materialized(select * from(select v.*,row_number()over(partition by position order by played_at desc,fixture_id,player_id)n from priced v where status in('ready','provisional'))x where n<=2),
reports as materialized(select v.*,public.kickx_match_report_context(player_id,fixture_id) facts from report_ids v),
source_players as materialized(select player_id from latest order by md5(player_id)limit 12),
sources as materialized(select c.* from source_players p cross join lateral public.kickx_calculation_sources(p.player_id)c join public.fixtures f on f.id=c.fixture_id where f.status='FT'and public.kickx_regular_fixture(f.id)is true)
select jsonb_build_object(
 'checkedAt',clock_timestamp(),'policy',(select p from policy),'databaseBytes',pg_database_size(current_database()),
 'scoreRows',(select count(*)from scored),'scoreSumMismatches',(select count(*)from scored r where r.score is distinct from(select sum((b->>'points')::numeric)from jsonb_array_elements(r.breakdown)b)),
 'scoreCeilingRows',(select count(*)from scored where breakdown @> '[{"metric":"score_range"}]'),'maxScore',(select max(score)from scored),
 'postLaunchPlayed',(select count(*)from scored where ended_at>=timestamptz '2026-10-14T15:00Z'),
 'postLaunchAtMostFive',(select count(*)from scored where ended_at>=timestamptz '2026-10-14T15:00Z'and score<=5),
 'priceEvents',(select count(*)from priced),'dnpEvents',(select count(*)from priced where status='not-played'),
 'preLaunchPriceEvents',(select count(*)from priced where played_at<timestamptz '2026-10-14T15:00Z'),
 'preLaunchChartRows',(select count(*)from public.price_history where rule_version='report-v3'and recorded_at<timestamptz '2026-10-14T15:00Z'),
 'priceDirectionMismatches',(select count(*)from priced where(status='not-played'and price_after>price_before)or(status in('ready','provisional')and((score>reference_score and price_after<price_before)or(score<reference_score and price_after>price_before)or(score=reference_score and price_after<>price_before)))),
 'rateCapViolations',(select count(*)from priced where price_after>floor(price_before*1.10)or price_after<ceil(price_before*.90)),
 'minimumViolations',(select count(*)from priced where price_after<10000),
 'formulaMismatches',(select count(*)from checked_moves where price_after<>expected_price),
 'invalidPriceStatuses',(select count(*)from priced where status not in('ready','provisional','not-played')),
 'maxActualChange',(select max(abs((price_after-price_before)*100.0/price_before))from priced),
 'snapshotPriceMismatches',(select count(*)from latest v join public.player_market_snapshots s on s.id=v.player_id where s.price is distinct from v.price_after),
 'dnpClassificationMismatches',(select count(*)from latest v join public.player_market_snapshots s on s.id=v.player_id where s.last_price_reason is distinct from(case when v.status='not-played'then 'not-played'else 'performance'end)),
 'latestDnpScoreMismatches',(select count(*)from public.player_market_snapshots where last_price_reason='not-played'and performance is not null),
 'sampleSourceChecks',(select count(*)from sources),'sampleUncachedSources',(select count(*)from sources where not cached),
 'sampleReports',(select count(*)from reports),'sampleReportMismatches',(select count(*)from reports where facts is null or(facts->>'score')::numeric is distinct from score or(facts->>'referenceScore')::numeric is distinct from reference_score or(facts->>'priceUnit')::numeric is distinct from 100000 or(facts->>'priceAfter')::numeric is distinct from price_after),
 'financialIntegrity',public.kickx_valuation_integrity(),'marketSummary',public.kickx_market_summary(),
 'migrations',(select jsonb_agg(version order by version)from supabase_migrations.schema_migrations where version in('20261106103458','20261106115352'))
) validation;
