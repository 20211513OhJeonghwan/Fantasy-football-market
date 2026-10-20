begin;
-- Storage metadata fixtures exist only in this disposable test transaction.
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key,public boolean not null default false);
create table if not exists storage.objects(bucket_id text,name text);
grant usage on schema storage to service_role;
grant select,insert on storage.buckets,storage.objects to service_role;
insert into storage.buckets(id,public) values('kickx-calculation-archives',false) on conflict do nothing;
update public.kickx_policy set club_competitions_enabled=false,version='form-v2',pricing_reference_at=now()-interval '10 days',pricing_reference_season=2026;
insert into public.leagues(id,name,provider,external_id) values('bsd-93001','Incremental test','bsd',93001);
insert into public.teams(id,name,provider,external_id,league_id) values
 ('bsd-93001','Home','bsd',93001,'bsd-93001'),('bsd-93002','Away','bsd',93002,'bsd-93001');
insert into public.players(id,name,provider,external_id,team_id) values('bsd-93001','Incremental player','bsd',93001,'bsd-93001');
insert into public.fixtures(id,provider,home_team_id,away_team_id,starts_at,status,home_score,away_score,season)
 select 'bsd-'||id,'bsd','bsd-93001','bsd-93002',now()-(12-i)*interval '1 day','FT',0,0,2026
 from (values(93001,0),(93002,3),(93003,4)) f(id,i);
insert into public.football_match_stats(player_id,fixture_id,team_id,stats)
 select 'bsd-93001',id,'bsd-93001','{"minutes_played":90}' from public.fixtures where id in('bsd-93001','bsd-93002','bsd-93003');
insert into public.player_match_records(player_id,fixture_id,played_at,opponent,minutes)
 select 'bsd-93001',id,starts_at,'Away',90 from public.fixtures where id in('bsd-93001','bsd-93002','bsd-93003');

set local role service_role;
do $$declare input jsonb;results jsonb;answer jsonb;reference jsonb;old_time timestamptz;old_token text;before_revisions integer;archived jsonb;path text;begin
 input:=public.kickx_calculation_input('bsd-93001');
 if jsonb_array_length(input->'records')<>3 then raise exception 'Cold source cache incomplete';end if;
 select jsonb_agg(jsonb_build_object('fixtureId',id,'score',case id when 'bsd-93001' then 50 when 'bsd-93002' then 100 else 70 end,
 'status','provisional','position','MF','breakdown','[]'::jsonb,'warnings','[]'::jsonb,'ruleVersion','form-v2') order by starts_at,id) into results
 from public.fixtures where id in('bsd-93001','bsd-93002','bsd-93003');
 answer:=public.kickx_publish_calculation_delta(null,'bsd-93001',input->>'token',results);
 select public.kickx_market_plan(jsonb_agg(x||jsonb_build_object('startedAt',f.starts_at,'season',f.season,'minutes',90) order by f.starts_at,f.id),p.pricing_reference_at,p.pricing_reference_season)
 into reference from jsonb_array_elements(results) x join public.fixtures f on f.id=x->>'fixtureId' cross join public.kickx_policy p group by p.pricing_reference_at,p.pricing_reference_season;
 if (answer->>'price')::bigint<>(reference->>'price')::bigint then raise exception 'Cold price differs from full reference';end if;
 select calculated_at into old_time from public.performance_results where player_id='bsd-93001' and fixture_id='bsd-93001';
 select count(*) into before_revisions from public.calculation_revisions where player_id='bsd-93001';
 input:=public.kickx_calculation_input('bsd-93001');
 if jsonb_array_length(input->'records')<>0 or (input->>'reused')::int<>3 then raise exception 'Unchanged sources downloaded again';end if;
 answer:=public.kickx_publish_calculation_delta(null,'bsd-93001',input->>'token','[]');
 if not (answer->>'unchanged')::boolean or (select count(*) from public.calculation_revisions where player_id='bsd-93001')<>before_revisions then raise exception 'Cache hit created a revision';end if;
 old_token:=input->>'token';
 update public.football_match_stats set stats='{"minutes_played":90,"goals":1}',updated_at=clock_timestamp() where player_id='bsd-93001' and fixture_id='bsd-93002';
 begin perform public.kickx_publish_calculation_delta(null,'bsd-93001',old_token,'[]');raise exception 'STALE_ACCEPTED';exception when others then if sqlerrm<>'SOURCE_CHANGED' then raise;end if;end;
 input:=public.kickx_calculation_input('bsd-93001');
 if jsonb_array_length(input->'records')<>1 or input#>>'{records,0,fixture_id}'<>'bsd-93002' then raise exception 'Correction transferred unrelated history';end if;
 answer:=public.kickx_publish_calculation_delta(null,'bsd-93001',input->>'token',jsonb_build_array((results->1)||'{"score":80}'));
 results:=jsonb_set(results,'{1,score}','80');
 select public.kickx_market_plan(jsonb_agg(x||jsonb_build_object('startedAt',f.starts_at,'season',f.season,'minutes',90) order by f.starts_at,f.id),p.pricing_reference_at,p.pricing_reference_season)
 into reference from jsonb_array_elements(results) x join public.fixtures f on f.id=x->>'fixtureId' cross join public.kickx_policy p group by p.pricing_reference_at,p.pricing_reference_season;
 if (answer->>'price')::bigint<>(reference->>'price')::bigint then raise exception 'Historical correction differs from full reference';end if;
 if (select calculated_at from public.performance_results where player_id='bsd-93001' and fixture_id='bsd-93001')<>old_time then raise exception 'Unchanged evidence rewritten';end if;
 if exists(select 1 from public.player_price_results v join public.performance_results r using(player_id,fixture_id) where v.player_id='bsd-93001' and v.input_hash<>r.input_hash) then raise exception 'Report evidence no longer matches price';end if;
 -- Minutes and fixture dates affect pricing even when the score itself is unchanged.
 update public.football_match_stats set stats='{"minutes_played":30,"goals":1}',updated_at=clock_timestamp() where player_id='bsd-93001' and fixture_id='bsd-93002';
 input:=public.kickx_calculation_input('bsd-93001');
 answer:=public.kickx_publish_calculation_delta(null,'bsd-93001',input->>'token',jsonb_build_array(results->1));
 if (answer->>'unchanged')::boolean is true then raise exception 'Equal-score minutes correction skipped repricing';end if;
 select public.kickx_market_plan(jsonb_agg(x||jsonb_build_object('startedAt',f.starts_at,'season',f.season,'minutes',m.stats->'minutes_played') order by f.starts_at,f.id),p.pricing_reference_at,p.pricing_reference_season)
 into reference from jsonb_array_elements(results) x join public.fixtures f on f.id=x->>'fixtureId' join public.football_match_stats m on m.fixture_id=f.id and m.player_id='bsd-93001' cross join public.kickx_policy p group by p.pricing_reference_at,p.pricing_reference_season;
 if (answer->>'price')::bigint<>(reference->>'price')::bigint then raise exception 'Minutes correction differs from reference';end if;
 update public.fixtures set starts_at=starts_at-interval '1 hour',updated_at=clock_timestamp() where id='bsd-93002';
 input:=public.kickx_calculation_input('bsd-93001');
 answer:=public.kickx_publish_calculation_delta(null,'bsd-93001',input->>'token',jsonb_build_array(results->1));
 if (answer->>'unchanged')::boolean is true then raise exception 'Fixture time correction skipped repricing';end if;
 begin perform public.kickx_finish_revision_archive(null,'[]');raise exception 'NULL_PATH_ACCEPTED';exception when others then if sqlerrm<>'INVALID_ARCHIVE' then raise;end if;end;
 -- Missing source fixtures must preserve previously published values.
 begin perform public.kickx_publish_calculation_delta(null,'bsd-93001',public.kickx_calculation_token('bsd-93001'),'[{"fixtureId":"bsd-99999"}]');raise exception 'FOREIGN_ACCEPTED';exception when others then if sqlerrm<>'INVALID_DELTA' then raise;end if;end;
 -- The archived copy is acknowledged by ID + original full-JSON fingerprint.
 archived:=public.kickx_revision_archive_batch(250);
 path:='calculation-revisions/'||repeat('a',64)||'.json.gz';
 begin perform public.kickx_finish_revision_archive(path,archived);raise exception 'UNBACKED_ARCHIVE_ACCEPTED';exception when others then if sqlerrm<>'ARCHIVE_OBJECT_REQUIRED' then raise;end if;end;
 insert into storage.objects(bucket_id,name) values('kickx-calculation-archives',path);
 if not exists(select 1 from jsonb_array_elements(archived) x where x->>'player_id'='bsd-93001') then raise exception 'No older revision to archive';end if;
 if public.kickx_finish_revision_archive(path,'[{"id":"00000000-0000-0000-0000-000000000000","archive_hash":"wrong"}]')<>0 then raise exception 'Wrong fingerprint compacted a row';end if;
 perform public.kickx_finish_revision_archive(path,archived);
 if not exists(select 1 from public.calculation_revisions cr where cr.player_id='bsd-93001' and cr.archive_path=path and cr.results='[]'::jsonb and cr.pricing is null) then raise exception 'Acknowledged revision was not compacted';end if;
 if not exists(select 1 from public.calculation_revisions cr where cr.player_id='bsd-93001' and cr.archive_path is null and cr.pricing is not null and cr.results<>'[]'::jsonb) then raise exception 'Latest full calculation lost';end if;
 if public.kickx_finish_revision_archive(path,archived)<>0 then raise exception 'Archive acknowledgment not idempotent';end if;
 -- Changing score policy invalidates scores, but pricing reference changes can reuse them.
 update public.kickx_policy set pricing_reference_at=pricing_reference_at-interval '1 second' where id=true;
 if jsonb_array_length(public.kickx_calculation_input('bsd-93001')->'records')<>0 then raise exception 'Price policy invalidated match scores';end if;
 update public.kickx_policy set club_competitions_enabled=true where id=true;
 if jsonb_array_length(public.kickx_calculation_input('bsd-93001')->'records')<>3 then raise exception 'Scoring policy reused stale scores';end if;
end $$;
reset role;
insert into public.automation_daily_tasks(day,key,kind,priority,payload,label,completed)
 values(current_date,'retention-test','match',0,'{"raw":"discard"}','Completed test',true),
 (current_date,'retention-active','match',0,'{"phase":"stats"}','Active test',false);
do $$begin
 if (select payload from public.automation_daily_tasks where key='retention-test')='{}'::jsonb then raise exception 'Completed payload lost before verified backup';end if;
 insert into storage.objects(bucket_id,name) values('kickx-calculation-archives','checkpoint-payloads/'||repeat('b',64)||'.json.gz');
 perform public.kickx_finish_checkpoint_archive('checkpoint-payloads/'||repeat('b',64)||'.json.gz',public.kickx_checkpoint_archive_batch(250));
 if (select payload from public.automation_daily_tasks where key='retention-test')<>'{}'::jsonb then raise exception 'Verified completed payload not compacted';end if;
 if (select payload from public.automation_daily_tasks where key='retention-active')->>'phase'<>'stats' then raise exception 'Active checkpoint lost';end if;
end $$;
set local role anon;
do $$begin
 if has_function_privilege(current_user,'public.kickx_calculation_input(text,boolean)','execute')
 or has_function_privilege(current_user,'public.kickx_publish_calculation_delta(uuid,text,text,jsonb)','execute')
 or has_function_privilege(current_user,'public.kickx_revision_archive_batch(integer)','execute')
 or has_function_privilege(current_user,'public.kickx_finish_revision_archive(text,jsonb)','execute')
 or has_function_privilege(current_user,'public.kickx_checkpoint_archive_batch(integer)','execute')
 or has_function_privilege(current_user,'public.kickx_finish_checkpoint_archive(text,jsonb)','execute') then raise exception 'Internal operation exposed';end if;
end $$;
reset role;
rollback;
