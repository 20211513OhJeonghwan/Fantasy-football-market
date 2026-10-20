-- Reuse each existing row for the performance-only explanation; no extra tables or history.
-- The version changes lazily on the next eligible member request, never a batch regeneration.
begin;
create or replace function public.kickx_read_match_report(p_player text,p_fixture text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare facts jsonb:=public.kickx_match_report_context(p_player,p_fixture); h text; a public.player_analyses%rowtype;
begin
 if facts is null then
  return jsonb_build_object('promptVersion','match-report-performance-v2','status','unavailable','facts',null,'unavailableReason',case when exists(
   select 1 from public.player_initial_values i where i.player_id=p_player
    and i.rule_version=(select version from public.kickx_policy where id=true)
    and i.detail->'fixtures' ? p_fixture
    and not exists(select 1 from public.player_price_results v where v.player_id=p_player and v.fixture_id=p_fixture)
  ) then 'baseline-history' else 'awaiting-results' end);
 end if;
 -- Hash only this match's explanatory facts, not replay timestamps or whole-player history.
 h:=md5(jsonb_build_object('score',facts->'score','minutes',facts->'minutes','contributions',facts->'contributions')::text||':match-report-performance-v2');
 select * into a from public.player_analyses where id=p_player and fixture_id=p_fixture;
 if a.input_hash=h and a.prompt_version='match-report-performance-v2' then
  if a.status='ready' then return jsonb_build_object('promptVersion','match-report-performance-v2','status','ready','facts',facts,'text',a.body::jsonb,'generatedAt',a.generated_at,'inputHash',h);end if;
  if a.status='pending' and a.retry_at>now() then return jsonb_build_object('promptVersion','match-report-performance-v2','status','pending','facts',facts,'retryAt',a.retry_at);end if;
  if a.attempts>=2 and a.source_updated_at>now()-interval '1 day' then return jsonb_build_object('promptVersion','match-report-performance-v2','status','limited','facts',facts);end if;
  if a.retry_at>now() then return jsonb_build_object('promptVersion','match-report-performance-v2','status','cooldown','facts',facts,'retryAt',a.retry_at);end if;
 end if;
 return jsonb_build_object('promptVersion','match-report-performance-v2','status','missing','facts',facts,'inputHash',h);
end $$;

create or replace function public.kickx_claim_match_report(p_player text,p_fixture text,p_user uuid)
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
 select ai_report_usage into strict usage from public.kickx_policy where id=true for update;
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
 values(p_player,p_fixture,'',clock_timestamp(),h,'match-report-performance-v2','pending',token,now()+interval '45 seconds',1,p_user)
 on conflict on constraint player_analyses_match_unique do update set body='',source_updated_at=excluded.source_updated_at,
  input_hash=excluded.input_hash,prompt_version=excluded.prompt_version,status='pending',claim_token=token,retry_at=excluded.retry_at,
  attempts=case when player_analyses.input_hash=h and player_analyses.source_updated_at>now()-interval '1 day' then player_analyses.attempts+1 else 1 end,requested_by=p_user;
 update public.kickx_policy set ai_report_usage=jsonb_build_object('day',day_key,'daily',daily+1,'minute',minute_key,'perMinute',per_minute+1) where id=true;
 return result||jsonb_build_object('status','claimed','claimToken',token);
end $$;

create or replace function public.kickx_finish_match_report(p_player text,p_fixture text,p_token uuid,p_hash text,p_body jsonb,p_model text,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare facts jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:ai-reports',0));
 if p_body is not null and (
  jsonb_typeof(p_body)<>'object' or jsonb_typeof(p_body->'performance') is distinct from 'string' or (p_body-'performance')<>'{}'::jsonb
  or char_length(p_body->>'performance') not between 10 and 420
  or octet_length(p_body::text)>1600 or (p_body->>'performance')~'[0-9<>]'
 ) then raise exception 'INVALID_INPUT';end if;
 facts:=public.kickx_match_report_context(p_player,p_fixture);
 if p_body is not null and facts is not null and md5(jsonb_build_object('score',facts->'score','minutes',facts->'minutes','contributions',facts->'contributions')::text||':match-report-performance-v2')=p_hash then
  update public.player_analyses set body=p_body::text,status='ready',model=left(p_model,100),generated_at=clock_timestamp(),claim_token=null,retry_at=null
  where id=p_player and fixture_id=p_fixture and status='pending' and claim_token=p_token and input_hash=p_hash and retry_at>now();
  return found;
 end if;
 update public.player_analyses set status='failed',body='',claim_token=null,
  retry_at=now()+case when p_error='rate-limit' then interval '1 hour' else interval '5 minutes' end
 where id=p_player and fixture_id=p_fixture and status='pending' and claim_token=p_token and input_hash=p_hash;
 return false;
end $$;

commit;
