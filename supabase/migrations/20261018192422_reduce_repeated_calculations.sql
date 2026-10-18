-- Keep source timestamps stable and back off retries of incomplete evidence.
-- Actual source changes still create a new revision due immediately.
begin;

create function public.kickx_skip_unchanged_source() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'updated_at') is not distinct from (to_jsonb(old)-'updated_at') then
  return null;
 end if;
 return new;
end $$;
revoke all on function public.kickx_skip_unchanged_source() from public,anon,authenticated;

do $$declare t text;begin
 foreach t in array array['leagues','teams','players','fixtures','football_league_seasons',
                          'football_entity_sources','football_event_sources','football_match_stats'] loop
  -- Run after fixture_end_observation, which may add a meaningful end timestamp.
  execute format('create trigger zz_skip_unchanged_source before update on public.%I for each row execute function public.kickx_skip_unchanged_source()',t);
 end loop;
end $$;

create or replace function public.kickx_queue_player(p_player text) returns void
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.kickx_policy where club_competitions_enabled)
    and not public.kickx_market_eligible(p_player) then return;end if;
 insert into public.calculation_queue(player_id) values(p_player)
 on conflict(player_id) do update set revision=gen_random_uuid(),queued_at=now(),
  retry_at=now(),attempts=0,error_code=null;
end $$;

create or replace function public.kickx_ack_calculation(p_player text,p_revision uuid,p_error text default null)
returns void language plpgsql set search_path='' as $$
begin
 if p_error is null then
  delete from public.calculation_queue where player_id=p_player and revision=p_revision;
 else
  update public.calculation_queue q set attempts=q.attempts+1,error_code=p_error,
   retry_at=clock_timestamp()+case
    when exists(select 1 from public.football_match_stats m join public.fixtures f on f.id=m.fixture_id
                where m.player_id=p_player and f.starts_at>clock_timestamp()-interval '6 hours'
                  and f.starts_at<=clock_timestamp()) then
     case when q.attempts=0 then interval '1 minute'
          when q.attempts=1 then interval '2 minutes'
          when q.attempts=2 then interval '5 minutes'
          when q.attempts=3 then interval '15 minutes'
          when p_error='CALCULATION_WITHHELD' then interval '1 hour'
          else interval '15 minutes' end
    when p_error='CALCULATION_WITHHELD' then interval '1 day'
    else interval '15 minutes' end
   where q.player_id=p_player and q.revision=p_revision;
 end if;
end $$;

notify pgrst,'reload schema';
commit;
