-- Fixture reflection and public batch trading checks must not scan every player's
-- scoring history for each page. Prices, score rules and settlement stay unchanged.
begin;
set local lock_timeout = '3s';
create index performance_results_fixture_status_idx
  on public.performance_results(fixture_id,status,player_id);

create or replace function public.kickx_trade_windows(p_players text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if cardinality(p_players)>100 then raise exception 'INVALID_INPUT';end if;
  -- Evaluate the fixture clock once for the entire batch, not once per player.
  with active_fixtures as materialized (
    select f.id,f.home_team_id,f.away_team_id,f.starts_at,f.status,f.finished_observed_at
    from public.fixtures f
    where now()>=f.starts_at-interval '90 minutes'
      and f.status not in ('PST','CANC')
      and (f.status not in ('FT','AET','PEN','AWD','WO')
        or f.finished_observed_at is null
        or now()<f.finished_observed_at+interval '10 minutes')
  )
  select coalesce(jsonb_object_agg(p.id,coalesce((
    select jsonb_build_object('locked',true,'fixtureId',f.id,'startsAt',f.starts_at,
      'finishedAt',f.finished_observed_at,'unlockAt',
      case when f.status in ('FT','AET','PEN','AWD','WO')
        then f.finished_observed_at+interval '10 minutes' end)
    from active_fixtures f
    where p.team_id in(f.home_team_id,f.away_team_id)
      or exists(select 1 from public.football_match_stats m where m.fixture_id=f.id and m.player_id=p.id)
    order by f.starts_at limit 1
  ),jsonb_build_object('locked',false))),'{}'::jsonb)
  into result from public.players p where p.id=any(p_players);
  return result;
end $$;
-- CREATE OR REPLACE preserves the existing anon/authenticated/service_role grants.
commit;
