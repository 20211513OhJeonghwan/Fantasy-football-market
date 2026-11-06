-- Reuse verified fixture scope and compute observed duration in one pass.
begin;
do $patch$declare d text;begin
 d:=pg_get_functiondef('public.kickx_apply_neutral_assessments(jsonb)'::regprocedure);
 if position($old$ create temporary table neutral_plans on commit drop as
 select i.player_id,public.kickx_report_plan(coalesce((select jsonb_agg(jsonb_build_object('fixtureId',r.fixture_id,'score',r.score,'status',r.status,'season',f.season,
 'minutes',m.stats->'minutes_played','startedAt',f.starts_at,'endedAt',public.kickx_fixture_valuation_at(f.id)))
 from public.performance_results r join public.fixtures f on f.id=r.fixture_id join public.football_match_stats m on m.player_id=r.player_id and m.fixture_id=r.fixture_id
 where r.player_id=i.player_id and r.rule_version='report-v3' and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and public.kickx_regular_fixture(f.id) is true),'[]'),i.detail,p.report_parameters)plan
 from public.player_initial_values i cross join public.kickx_policy p where i.rule_version='report-v3' and i.detail is not null and public.kickx_market_eligible(i.player_id);$old$ in d)=0 then raise exception 'REPLAY_FUNCTION_CHANGED';end if;
 d:=replace(d,$old$ create temporary table neutral_plans on commit drop as
 select i.player_id,public.kickx_report_plan(coalesce((select jsonb_agg(jsonb_build_object('fixtureId',r.fixture_id,'score',r.score,'status',r.status,'season',f.season,
 'minutes',m.stats->'minutes_played','startedAt',f.starts_at,'endedAt',public.kickx_fixture_valuation_at(f.id)))
 from public.performance_results r join public.fixtures f on f.id=r.fixture_id join public.football_match_stats m on m.player_id=r.player_id and m.fixture_id=r.fixture_id
 where r.player_id=i.player_id and r.rule_version='report-v3' and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and public.kickx_regular_fixture(f.id) is true),'[]'),i.detail,p.report_parameters)plan
 from public.player_initial_values i cross join public.kickx_policy p where i.rule_version='report-v3' and i.detail is not null and public.kickx_market_eligible(i.player_id);$old$,$new$ -- Scope and completion clocks are materialized per fixture, not per player/appearance.
 create temporary table neutral_scope on commit drop as
 select f.id,f.starts_at,f.finished_observed_at,f.season
 from public.fixtures f where f.status='FT' and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and public.kickx_regular_fixture(f.id) is true;
 create unique index on pg_temp.neutral_scope(id);
 create temporary table neutral_games on commit drop as
 with games as materialized(select f.* from pg_temp.neutral_scope f cross join public.kickx_policy p
 where f.starts_at>=to_timestamp((p.report_parameters->>'valuationStartMs')::numeric/1000)-interval '4 hours'),
 minutes as materialized(select m.fixture_id,case when jsonb_typeof(m.stats->'minutes_played')='number' then(m.stats->>'minutes_played')::numeric end n from public.football_match_stats m join games f on f.id=m.fixture_id),
 ordered as(select fixture_id,n,lead(n)over(partition by fixture_id order by n desc)next_n from minutes where n between 90 and 180 and n=trunc(n)),
 observed as(select fixture_id,max(n)filter(where next_n>=n-2) n from ordered group by fixture_id)
 select f.*,case when f.finished_observed_at between f.starts_at+interval '60 minutes' and f.starts_at+interval '4 hours'
 then f.finished_observed_at else f.starts_at+(coalesce(o.n,90)+15)*interval '1 minute' end as ended_at
 from games f left join observed o on o.fixture_id=f.id;
 create unique index on pg_temp.neutral_games(id);
 create temporary table neutral_plans on commit drop as
 with results as materialized(select r.player_id,jsonb_agg(jsonb_build_object('fixtureId',r.fixture_id,'score',r.score,'status',r.status,'season',f.season,
 'minutes',m.stats->'minutes_played','startedAt',f.starts_at,'endedAt',f.ended_at))items from public.performance_results r join pg_temp.neutral_games f on f.id=r.fixture_id
 join public.football_match_stats m on m.player_id=r.player_id and m.fixture_id=r.fixture_id where r.rule_version='report-v3' group by r.player_id)
 select i.player_id,public.kickx_report_plan(coalesce(r.items,'[]'),i.detail,p.report_parameters)plan
 from public.player_initial_values i cross join public.kickx_policy p left join results r on r.player_id=i.player_id
 where i.rule_version='report-v3' and i.detail is not null and public.kickx_market_eligible(i.player_id);$new$);
 d:=replace(d,$old$performance=(select case when r.status='not-played' then null else r.score end from public.performance_results r join public.fixtures f on f.id=r.fixture_id where r.player_id=s.id and r.status in('ready','provisional','not-played') and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and public.kickx_regular_fixture(f.id) is true order by f.starts_at desc,f.id desc limit 1)$old$,$new$performance=(select case when r.status='not-played' then null else r.score end from public.performance_results r join pg_temp.neutral_scope f on f.id=r.fixture_id where r.player_id=s.id and r.status in('ready','provisional','not-played') order by f.starts_at desc,f.id desc limit 1)$new$);execute d;
end $patch$;
notify pgrst,'reload schema';
commit;
