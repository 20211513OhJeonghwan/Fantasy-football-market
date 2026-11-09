-- A bad pre-launch record must not block the post-launch valuation chain.
-- Canceled fixtures stay in the calendar/source archive but never in scoring.
begin;
do $patch$
declare d text; old_d text; sig text;
begin
 foreach sig in array array['public.kickx_calculation_sources(text)',
  'public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb)',
  'public.kickx_publish_calculation_delta(uuid,text,text,jsonb)'] loop
  d:=pg_get_functiondef(sig::regprocedure);old_d:=d;
  d:=replace(d,'where m.player_id=p_player','where m.player_id=p_player and f.status<>''CANC''');
  if d=old_d then raise exception 'CANCELED_SCOPE_PATCH_CHANGED: %',sig;end if;
  -- Reject a canceled fixture supplied to the incremental publisher too.
  if sig='public.kickx_publish_calculation_delta(uuid,text,text,jsonb)' then
   d:=replace(d,$old$from public.football_match_stats m where m.player_id=p_player and f.status<>'CANC' and m.fixture_id=x->>'fixtureId'$old$,
    $new$from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id where m.player_id=p_player and f.status<>'CANC' and m.fixture_id=x->>'fixtureId'$new$);
  elsif sig='public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb)' then
   d:=replace(d,$old$from public.football_match_stats m where m.player_id=p_player and f.status<>'CANC' and m.fixture_id=x->>'fixtureId'$old$,
    $new$from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id where m.player_id=p_player and f.status<>'CANC' and m.fixture_id=x->>'fixtureId'$new$);
   old_d:=d;
   d:=replace(d,$old$and public.kickx_regular_fixture(z.id) is true)) and old.status$old$,
    $new$and public.kickx_regular_fixture(z.id) is true and z.status<>'CANC' and public.kickx_fixture_valuation_at(z.id)>=to_timestamp(coalesce((p.report_parameters->>'valuationStartMs')::numeric,0)/1000))) and old.status$new$);
   if d=old_d then raise exception 'PREVIOUS_PRICING_SCOPE_PATCH_CHANGED';end if;
   -- Legacy policy also permits a previously completed fixture to be canceled.
   d:=replace(d,'old.player_id=p_player and (',
    'old.player_id=p_player and exists(select 1 from public.fixtures canceled_guard where canceled_guard.id=old.fixture_id and canceled_guard.status<>''CANC'') and (');
   old_d:=d;
   d:=replace(d,$old$and f.season>(p.report_reference->>'season')::integer and f.status='FT' and x->>'status'='blocked'$old$,
    $new$and f.season>(p.report_reference->>'season')::integer and f.status='FT' and public.kickx_fixture_valuation_at(f.id)>=to_timestamp(coalesce((p.report_parameters->>'valuationStartMs')::numeric,0)/1000) and x->>'status'='blocked'$new$);
   if d=old_d then raise exception 'CURRENT_PRICING_SCOPE_PATCH_CHANGED';end if;
  end if;
  execute d;
 end loop;
 d:=pg_get_functiondef('public.kickx_calculation_input(text,boolean)'::regprocedure);
 d:=replace(d,'from public.football_match_stats where player_id=p_player','from public.kickx_calculation_sources(p_player)');
 execute d;
 d:=pg_get_functiondef('public.kickx_check_calculation(text,jsonb)'::regprocedure);
 d:=replace(d,'old.player_id=p_player and old.status',
  'old.player_id=p_player and exists(select 1 from public.fixtures f where f.id=old.fixture_id and f.status<>''CANC'') and old.status');
 execute d;
end $patch$;

-- Retry only affected players. Do not reset prices, initial values or accounts.
do $$declare p record;begin
 for p in select distinct s.id from public.player_market_snapshots s
 where public.kickx_market_eligible(s.id) and (s.pricing_status='pending' or exists(
  select 1 from public.performance_results r join public.fixtures f on f.id=r.fixture_id
  where r.player_id=s.id and f.status='CANC')) loop
  perform public.kickx_queue_player(p.id);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
