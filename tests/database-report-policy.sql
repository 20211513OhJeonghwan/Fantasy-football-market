begin;
create function pg_temp.report_error(command text,expected text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if sqlerrm=expected or sqlstate=expected then return;else raise;end if;end;
 raise exception 'Expected %',expected;
end $$;
select pg_temp.report_error('select public.kickx_activate_report_policy()','REFERENCE_NOT_READY');
update public.kickx_policy set version='report-v3',club_competitions_enabled=false,
 report_parameters=jsonb_set(jsonb_set(report_parameters,'{initialMin}','100000'),'{initialMax}','100000'),
 report_reference='{"status":"ready","season":2025,"hash":"fixed-report-reference","groups":{"FW":{"mean":6,"lower":0,"upper":30,"baselines":[6]}},"players":{"report-policy-player":{"FW":{"n":20,"sum":120,"fixtures":[]}}}}';
insert into public.leagues(id,name) values('bsd-1','Report league'),('report-cup','Report cup') on conflict do nothing;
insert into public.teams(id,name,league_id) values('report-policy-home','Report home','bsd-1'),('report-policy-away','Report away','bsd-1');
insert into public.players(id,name,provider,position,team_id) values('report-policy-player','Report player','bsd','FW','report-policy-home'),('report-policy-support','Support','bsd','DF','report-policy-home');
insert into public.fixtures(id,league_id,home_team_id,away_team_id,starts_at,status,home_score,away_score,season)
 values('report-policy-1','bsd-1','report-policy-home','report-policy-away','2026-09-01T12:00:00Z','FT',0,0,2026),
 ('report-policy-2','bsd-1','report-policy-home','report-policy-away','2026-09-02T12:00:00Z','FT',0,0,2026),
 ('report-policy-cup','report-cup','report-policy-home','report-policy-away','2026-09-03T12:00:00Z','FT',0,0,2026);
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)
 select 'report-policy-player',id,'report-policy-home','{"minutes_played":97}' from public.fixtures where id like 'report-policy-%';
insert into public.football_match_stats(player_id,fixture_id,team_id,stats) select 'report-policy-support',id,'report-policy-home','{"minutes_played":97}' from public.fixtures where id like 'report-policy-%';
insert into public.player_market_snapshots(id,price,pricing_rule_version,pricing_status) values('report-policy-player',100000,'form-v2','pending');
do $$declare input jsonb;results jsonb;answer jsonb;first_hash text;old_input_hash text;begin
 input:=public.kickx_calculation_input('report-policy-player');first_hash:=input->>'token';
 select jsonb_agg(jsonb_build_object('fixtureId',f.id,'position','FW','score',case when f.id='report-policy-1' then 8 when f.id='report-policy-2' then 10 else null end,
  'status',case when f.id='report-policy-cup' then 'blocked' else 'provisional' end,'ruleVersion','report-v3','breakdown','[]'::jsonb,'warnings','[]'::jsonb)) into results
 from public.fixtures f where f.id like 'report-policy-%';
 answer:=public.kickx_publish_calculation_delta(null,'report-policy-player',first_hash,results);
 if (answer->>'price')::integer<>104040 then raise exception 'Report publication: %',answer;end if;
 if (select count(*) from public.player_price_results where player_id='report-policy-player')<>2 then raise exception 'Cup affected report pricing';end if;
 if exists(select 1 from public.fixture_catalog where id='report-policy-cup') then raise exception 'Cup exposed in report scope';end if;
 if not exists(select 1 from public.fixtures where id='report-policy-cup') then raise exception 'Historical cup was deleted';end if;
 if (public.kickx_publish_calculation_delta(null,'report-policy-player',first_hash,'[]')->>'unchanged')::boolean is distinct from true then raise exception 'Unchanged source was replayed';end if;
 update public.kickx_policy set report_parameters=jsonb_set(report_parameters,'{beta}','0.31');
 perform pg_temp.report_error(format('select public.kickx_publish_calculation_delta(null,%L,%L,%L)','report-policy-player',first_hash,results),'SOURCE_CHANGED');
 select input_hash into old_input_hash from public.player_calculation_state where player_id='report-policy-player';
 answer:=public.kickx_publish_calculation_delta(null,'report-policy-player',public.kickx_calculation_token('report-policy-player'),'[]');
 if (answer->>'unchanged')::boolean is distinct from false or
  (select input_hash from public.player_calculation_state where player_id='report-policy-player')=old_input_hash then
  raise exception 'Changed pricing parameters reused the old calculation';
 end if;
end $$;
select pg_temp.report_error('select public.kickx_save_report_reference(0,''{}'')','REFERENCE_ALREADY_ACTIVE');
do $$begin
 if has_column_privilege('anon','public.kickx_policy','report_reference','select') then raise exception 'Private reference publicly exposed';end if;
 if not has_column_privilege('anon','public.kickx_policy','version','select') then raise exception 'Public policy reads broken';end if;
 if has_function_privilege('authenticated','public.kickx_report_plan(jsonb,jsonb,jsonb)','execute') then raise exception 'Report publication helper exposed';end if;
end $$;
rollback;
