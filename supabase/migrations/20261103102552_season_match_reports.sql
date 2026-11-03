-- Season-cumulative reports must not inherit the old five-appearance window cap.
-- Preserve source fingerprints, current policy, login-only RPCs and the shared cache.
begin;
create or replace function public.kickx_match_report_context(p_player text,p_fixture text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'playerName',coalesce(p.name_ko,p.name),
   'opponent',coalesce((select coalesce(t.name_ko,t.name) from public.teams t where t.id in(f.home_team_id,f.away_team_id) and t.name=r.opponent limit 1),r.opponent),
   'playedAt',f.starts_at,'minutes',r.minutes,'score',s.score,'scoreStatus',s.status,'ruleVersion',s.rule_version,
   'contributions',coalesce((select jsonb_agg(jsonb_build_object('metric',b->>'metric','value',b->'value','points',b->'points') order by ord)
     from jsonb_array_elements(s.breakdown) with ordinality as x(b,ord) where ord<=24 and (b->>'points')::numeric<>0),'[]'::jsonb),
   'warningCount',jsonb_array_length(s.warnings),
   'priceBefore',v.price_before,'priceAfter',v.price_after,'targetPrice',v.target_price,
   'formScore',v.form_score,'changePercent',v.change_percent,'windowSize',jsonb_array_length(v.window_fixture_ids)
 )
 from public.performance_results s
 join public.player_price_results v on v.player_id=s.player_id and v.fixture_id=s.fixture_id and v.rule_version=s.rule_version and v.input_hash=s.input_hash
 join public.player_match_records r on r.player_id=s.player_id and r.fixture_id=s.fixture_id
 join public.fixtures f on f.id=s.fixture_id
 join public.players p on p.id=s.player_id
 where s.player_id=p_player and s.fixture_id=p_fixture and f.status in('FT','AET','PEN')
   and s.status in('ready','provisional') and s.score is not null and r.minutes>0
   and s.rule_version=(select version from public.kickx_policy)
   and v.window_fixture_ids ? p_fixture
   and ((s.rule_version='form-v2' and jsonb_array_length(v.window_fixture_ids) between 1 and 5)
     or (s.rule_version='report-v3' and jsonb_array_length(v.window_fixture_ids)>=1))
$$;

notify pgrst,'reload schema';
commit;
