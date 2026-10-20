-- Shared, bounded match reports. Reuse the unused analysis table; no new tables.
-- Legacy per-player rows (fixture_id IS NULL) and their public read contract survive.
begin;
alter table public.player_analyses
  add column report_id uuid not null default gen_random_uuid(),
  add column fixture_id text references public.fixtures(id) on delete cascade,
  add column input_hash text,
  add column prompt_version text,
  add column model text,
  add column status text not null default 'ready' check(status in('pending','ready','failed')),
  add column claim_token uuid,
  add column retry_at timestamptz,
  add column attempts integer not null default 0 check(attempts between 0 and 2),
  add column requested_by uuid references auth.users(id) on delete set null,
  add constraint match_report_body_size check(fixture_id is null or octet_length(body)<=1600);
alter table public.player_analyses drop constraint player_analyses_pkey;
alter table public.player_analyses add primary key(report_id);
alter table public.player_analyses add constraint player_analyses_match_unique unique nulls not distinct(id,fixture_id);
create index player_analyses_fixture_idx on public.player_analyses(fixture_id);
create index player_analyses_requester_idx on public.player_analyses(requested_by,source_updated_at desc);
create index player_analyses_retention_idx on public.player_analyses(source_updated_at) where fixture_id is not null;
comment on table public.player_analyses is 'Shared compact match AI reports, at most 3000 match rows; legacy player rows retained.';

-- The existing singleton policy holds constant-size, atomic daily/minute counters.
-- No per-request audit rows, provider payloads, or prompts are persisted.
alter table public.kickx_policy add column ai_report_usage jsonb not null default '{}';
alter policy public_read on public.player_analyses using(fixture_id is null);
revoke all on public.player_analyses from anon,authenticated;
grant select(id,body,source_updated_at,generated_at) on public.player_analyses to anon,authenticated;

create function public.kickx_match_report_context(p_player text,p_fixture text)
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
   and jsonb_array_length(v.window_fixture_ids) between 1 and 5
$$;

create function public.kickx_read_match_report(p_player text,p_fixture text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare facts jsonb:=public.kickx_match_report_context(p_player,p_fixture); h text; a public.player_analyses%rowtype;
begin
 if facts is null then return jsonb_build_object('status','unavailable','facts',null);end if;
 -- Hash only this match's explanatory facts, not replay timestamps or whole-player history.
 h:=md5(facts::text||':match-report-v1');
 select * into a from public.player_analyses where id=p_player and fixture_id=p_fixture;
 if a.input_hash=h and a.prompt_version='match-report-v1' then
  if a.status='ready' then return jsonb_build_object('status','ready','facts',facts,'text',a.body::jsonb,'generatedAt',a.generated_at,'inputHash',h);end if;
  if a.status='pending' and a.retry_at>now() then return jsonb_build_object('status','pending','facts',facts,'retryAt',a.retry_at);end if;
  if a.attempts>=2 and a.source_updated_at>now()-interval '1 day' then return jsonb_build_object('status','limited','facts',facts);end if;
  if a.retry_at>now() then return jsonb_build_object('status','cooldown','facts',facts,'retryAt',a.retry_at);end if;
 end if;
 return jsonb_build_object('status','missing','facts',facts,'inputHash',h);
end $$;

create function public.kickx_claim_match_report(p_player text,p_fixture text,p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; a public.player_analyses%rowtype; usage jsonb; h text; token uuid:=gen_random_uuid();
 day_key text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD');
 minute_key text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD HH24:MI');
 daily integer; per_minute integer; total_rows integer;
begin
 if p_user is null or not exists(select 1 from public.profiles where id=p_user) then raise exception 'PROFILE_REQUIRED';end if;
 if exists(select 1 from public.member_restrictions where user_id=p_user and suspended_until>now()) then raise exception 'MEMBER_SUSPENDED';end if;
 -- Short claim transaction; the external model is called only after this lock is released.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:ai-reports',0));
 result:=public.kickx_read_match_report(p_player,p_fixture);
 if result->>'status'<>'missing' then return result;end if;
 h:=result->>'inputHash';
 select * into a from public.player_analyses where id=p_player and fixture_id=p_fixture;
 select ai_report_usage into strict usage from public.kickx_policy for update;
 daily:=case when usage->>'day'=day_key then coalesce((usage->>'daily')::integer,0) else 0 end;
 per_minute:=case when usage->>'minute'=minute_key then coalesce((usage->>'perMinute')::integer,0) else 0 end;
 if daily>=100 or per_minute>=4 or (select count(*) from public.player_analyses where requested_by=p_user and source_updated_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=10 then
  return (result-'inputHash')||jsonb_build_object('status','limited');
 end if;
 -- Expire old cache entries gradually. Never delete legacy rows or active claims.
 delete from public.player_analyses where report_id in(
  select report_id from public.player_analyses where fixture_id is not null and report_id is distinct from a.report_id
    and source_updated_at<now()-interval '90 days' and (status<>'pending' or retry_at<=now())
  order by source_updated_at limit 100
 );
 if a.report_id is null then
  select count(*) into total_rows from public.player_analyses where fixture_id is not null;
  if total_rows>=3000 then
   delete from public.player_analyses where report_id in(
    select report_id from public.player_analyses where fixture_id is not null and (status<>'pending' or retry_at<=now())
    order by source_updated_at limit (total_rows-2999)
   );
   if (select count(*) from public.player_analyses where fixture_id is not null)>=3000 then
    return (result-'inputHash')||jsonb_build_object('status','limited');
   end if;
  end if;
 end if;
 insert into public.player_analyses(id,fixture_id,body,source_updated_at,input_hash,prompt_version,status,claim_token,retry_at,attempts,requested_by)
 values(p_player,p_fixture,'',clock_timestamp(),h,'match-report-v1','pending',token,now()+interval '45 seconds',1,p_user)
 on conflict on constraint player_analyses_match_unique do update set body='',source_updated_at=excluded.source_updated_at,
  input_hash=excluded.input_hash,prompt_version=excluded.prompt_version,status='pending',claim_token=token,retry_at=excluded.retry_at,
  attempts=case when player_analyses.input_hash=h and player_analyses.source_updated_at>now()-interval '1 day' then player_analyses.attempts+1 else 1 end,requested_by=p_user;
 update public.kickx_policy set ai_report_usage=jsonb_build_object('day',day_key,'daily',daily+1,'minute',minute_key,'perMinute',per_minute+1);
 return result||jsonb_build_object('status','claimed','claimToken',token);
end $$;

create function public.kickx_finish_match_report(p_player text,p_fixture text,p_token uuid,p_hash text,p_body jsonb,p_model text,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare facts jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:ai-reports',0));
 if p_body is not null and (
  jsonb_typeof(p_body)<>'object' or jsonb_typeof(p_body->'performance') is distinct from 'string' or jsonb_typeof(p_body->'value') is distinct from 'string'
  or char_length(p_body->>'performance') not between 10 and 220 or char_length(p_body->>'value') not between 10 and 220
  or octet_length(p_body::text)>1600 or (p_body->>'performance')~'[0-9<>]' or (p_body->>'value')~'[0-9<>]'
 ) then raise exception 'INVALID_INPUT';end if;
 facts:=public.kickx_match_report_context(p_player,p_fixture);
 if p_body is not null and facts is not null and md5(facts::text||':match-report-v1')=p_hash then
  update public.player_analyses set body=p_body::text,status='ready',model=left(p_model,100),generated_at=clock_timestamp(),claim_token=null,retry_at=null
  where id=p_player and fixture_id=p_fixture and status='pending' and claim_token=p_token and input_hash=p_hash and retry_at>now();
  return found;
 end if;
 update public.player_analyses set status='failed',body='',claim_token=null,
  retry_at=now()+case when p_error='rate-limit' then interval '1 hour' else interval '5 minutes' end
 where id=p_player and fixture_id=p_fixture and status='pending' and claim_token=p_token and input_hash=p_hash;
 return false;
end $$;

revoke all on function public.kickx_match_report_context(text,text),public.kickx_read_match_report(text,text),public.kickx_claim_match_report(text,text,uuid),public.kickx_finish_match_report(text,text,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.kickx_match_report_context(text,text),public.kickx_read_match_report(text,text),public.kickx_claim_match_report(text,text,uuid),public.kickx_finish_match_report(text,text,uuid,text,jsonb,text,text) to service_role;
commit;
