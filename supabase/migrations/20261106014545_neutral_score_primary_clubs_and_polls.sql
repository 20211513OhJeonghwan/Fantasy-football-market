-- Current-match scoring, immutable primary club, scheduled subteams and bounded polls.
begin;
alter table public.profiles add column primary_team_id text references public.teams(id);
alter table public.profiles add column primary_confirmed_at timestamptz;
alter table public.profiles add column support_change_window text;
alter table public.profiles add column support_changed_leagues text[] not null default '{}';
alter table public.profiles add constraint primary_confirmation_pair check((primary_team_id is null)=(primary_confirmed_at is null));
alter table public.profiles add constraint support_changed_leagues_bound check(cardinality(support_changed_leagues)<=5);

create function kickx_private.support_window(p_at timestamptz) returns text language sql immutable set search_path='' as $$
 select case when extract(month from p_at at time zone 'Asia/Seoul') in(2,9) and extract(day from p_at at time zone 'Asia/Seoul') between 1 and 7 then to_char(p_at at time zone 'Asia/Seoul','YYYY-MM') end
$$;
revoke all on function kickx_private.support_window(timestamptz) from public,anon,authenticated;
create function kickx_private.guard_primary_support() returns trigger language plpgsql security definer set search_path='' as $$
declare w text:=kickx_private.support_window(clock_timestamp()); l text; old_team text;new_team text; used text[]; primary_league text;begin
 if TG_OP='UPDATE' and old.primary_team_id is not null and (new.primary_team_id,new.primary_confirmed_at) is distinct from (old.primary_team_id,old.primary_confirmed_at) then raise exception 'PRIMARY_TEAM_IMMUTABLE';end if;
 if new.primary_team_id is not null and not(new.primary_team_id=any(new.team_ids)) then raise exception 'PRIMARY_TEAM_REQUIRED';end if;
 if TG_OP='UPDATE' then
  -- The primary is selected once with explicit confirmation; old members are not assigned one.
  select league_id into primary_league from public.teams where id=new.primary_team_id;
  used:=case when old.support_change_window=w then old.support_changed_leagues else '{}'::text[] end;
  for l in select unnest(array['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6']) loop
   select id into old_team from public.teams where id=any(old.team_ids) and league_id=l;
   select id into new_team from public.teams where id=any(new.team_ids) and league_id=l;
   if old_team is distinct from new_team and not(old.primary_team_id is null and new.primary_team_id is not null and l=primary_league) then
    if clock_timestamp()>=old.created_at+interval '1 hour' then
     if w is null then raise exception 'SUBTEAM_WINDOW_CLOSED';end if;
     if l=any(used) then raise exception 'SUBTEAM_ALREADY_CHANGED';end if;
     used:=array_append(used,l);
    end if;
   end if;
  end loop;
  if new.team_ids is distinct from old.team_ids then new.support_change_window:=w;new.support_changed_leagues:=used;
  else new.support_change_window:=old.support_change_window;new.support_changed_leagues:=old.support_changed_leagues;end if;
  new.created_at:=old.created_at;
 end if;
 return new;
end $$;
revoke all on function kickx_private.guard_primary_support() from public,anon,authenticated;
create trigger profiles_z_primary_support before insert or update on public.profiles for each row execute function kickx_private.guard_primary_support();

-- Direct REST writes cannot bypass confirmation or the per-league change budget.
revoke insert,update on public.profiles from authenticated;
revoke insert(team_id,team_ids),update(team_id,team_ids) on public.profiles from authenticated;
revoke insert(id,nickname,avatar),update(nickname,avatar) on public.profiles from authenticated;
grant update(nickname,avatar,match_notifications,comment_notifications,reply_notifications) on public.profiles to authenticated;
create function public.kickx_save_profile(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); old_p public.profiles%rowtype; p public.profiles%rowtype; ids text[]; main text; nick text; joined timestamptz;begin
 if u is null then raise exception 'LOGIN_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:profile:'||u::text,0));
 select * into old_p from public.profiles where id=u for update;
 nick:=btrim(p_input->>'nickname');
 if char_length(nick) not between 2 and 20 or nick !~ '^[[:alnum:]가-힣_ -]+$' then raise exception 'INVALID_INPUT';end if;
 if jsonb_typeof(p_input->'teams') is distinct from 'array' or jsonb_array_length(p_input->'teams')>5 then raise exception 'INVALID_SUPPORTED_CLUBS';end if;
 select coalesce(array_agg(value),'{}') into ids from jsonb_array_elements_text(p_input->'teams');
 if array_position(ids,null) is not null or (select count(distinct x)from unnest(ids)x)<>cardinality(ids) then raise exception 'INVALID_SUPPORTED_CLUBS';end if;
 main:=coalesce(old_p.primary_team_id,nullif(p_input->>'primaryTeam',''));
 if old_p.primary_team_id is not null and p_input?'primaryTeam' and nullif(p_input->>'primaryTeam','') is distinct from old_p.primary_team_id then raise exception 'PRIMARY_TEAM_IMMUTABLE';end if;
 if (main is null and old_p.id is null) or (main is not null and not(main=any(ids))) then raise exception 'PRIMARY_TEAM_REQUIRED';end if;
 if main is not null and old_p.primary_team_id is null and coalesce((p_input->>'confirmPrimary')::boolean,false) is not true then raise exception 'PRIMARY_CONFIRMATION_REQUIRED';end if;
 if main is not null then ids:=array_prepend(main,array_remove(ids,main));end if;
 if p_input->>'avatar' like 'club:%' and not(substr(p_input->>'avatar',6)=any(ids)) then raise exception 'INVALID_AVATAR';end if;
 if old_p.id is null then
  select created_at into joined from auth.users where id=u;
  insert into public.profiles(id,nickname,team_id,team_ids,avatar,primary_team_id,primary_confirmed_at,created_at)
  values(u,nick,main,ids,p_input->>'avatar',main,clock_timestamp(),coalesce(joined,clock_timestamp())) returning * into p;
 else
  update public.profiles set nickname=nick,team_id=main,team_ids=ids,
   avatar=case when p_input?'avatar' then p_input->>'avatar' else avatar end,primary_team_id=main,
   primary_confirmed_at=case when main is not null then coalesce(primary_confirmed_at,clock_timestamp()) end,updated_at=clock_timestamp() where id=u returning * into p;
 end if;
 return jsonb_build_object('nickname',p.nickname,'team',p.team_id,'teams',p.team_ids,'avatar',p.avatar,'primaryTeam',p.primary_team_id,'createdAt',p.created_at,'supportChangeWindow',p.support_change_window,'supportChangedLeagues',p.support_changed_leagues);
end $$;
revoke all on function public.kickx_save_profile(jsonb) from public,anon;
grant execute on function public.kickx_save_profile(jsonb) to authenticated;

create or replace function public.kickx_can_write_lounge(u uuid,s text,t text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=u and (s='player' or s='club' and t=p.primary_team_id))
$$;
create function kickx_private.can_participate(u uuid,s text,t text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=u and (s='player' or s='club' and t=any(p.team_ids)))
$$;
revoke all on function kickx_private.can_participate(uuid,text,text) from public,anon,authenticated;

alter table public.community_posts add column poll jsonb;
alter table public.community_posts add constraint community_poll_shape check(poll is null or jsonb_typeof(poll)='object' and jsonb_typeof(poll->'question')='string' and jsonb_typeof(poll->'options')='array' and jsonb_array_length(poll->'options') between 2 and 6);
create table public.community_poll_votes(
 post_id uuid not null references public.community_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 option_index smallint not null check(option_index between 0 and 5),
 primary key(post_id,user_id)
);
create index community_poll_votes_count_idx on public.community_poll_votes(post_id,option_index);
alter table public.community_poll_votes enable row level security;
revoke all on public.community_poll_votes from public,anon,authenticated;
create function kickx_private.poll_summary(p public.community_posts) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p.poll is not null and p.status='published' then p.poll||jsonb_build_object(
 'counts',(select jsonb_agg((select count(*) from public.community_poll_votes v where v.post_id=p.id and v.option_index=i) order by i) from generate_series(0,jsonb_array_length(p.poll->'options')-1)i),
 'myVote',(select option_index from public.community_poll_votes where post_id=p.id and user_id=auth.uid()),
 'total',(select count(*) from public.community_poll_votes where post_id=p.id),
 'closed',now()>=(p.poll->>'endsAt')::timestamptz) end
$$;
revoke all on function kickx_private.poll_summary(public.community_posts) from public,anon,authenticated;

-- Each assessment starts neutral; missing optional statistics are still excluded.
create function kickx_private.score_points(metric text,v numeric,pos text) returns numeric language sql immutable set search_path='' as $$
 select round(case metric
 when 'minutes' then 6
 when 'goals' then v*case pos when 'GK' then 4 when 'DF' then 3 when 'MF' then 2.5 else 2 end
 when 'assists' then v*case pos when 'GK' then 2 else 1.5 end
 when 'yellow_cards' then -.7*v when 'red_cards' then -2.5*v when 'own_goals' then -1.5*v
 when 'shots_on_target' then v*case pos when 'MF' then .2 else .25 end
 when 'key_passes' then v*case pos when 'MF' then .25 else .15 end
 when 'crosses_completed' then v*.1 when 'pass_accuracy' then case when v>=85 then .3 else 0 end
 when 'defensive_actions' then case pos when 'DF' then floor(v/3)*.3 else v*.15 end
 when 'clean_sheet' then v*case pos when 'MF' then .3 when 'FW' then 0 else 1 end
 when 'conceded' then -floor(v/2)*.5 when 'saves' then floor(v/3)*.5 when 'penalty_saves' then v*3 else 0 end,2)
$$;
revoke all on function kickx_private.score_points(text,numeric,text) from public,anon,authenticated;
create function kickx_private.recalibrated_breakdown(items jsonb,pos text) returns jsonb language sql immutable set search_path='' as $$
 with parts as(select (b||jsonb_build_object('points',kickx_private.score_points(b->>'metric',(b->>'value')::numeric,pos))||case b->>'metric' when 'minutes' then jsonb_build_object('evidence','verified appearance; neutral starting assessment, not a minutes bonus') when 'defensive_actions' then jsonb_build_object('evidence','won_tackle + interception; verified actions only') else '{}'::jsonb end) item,ord
 from jsonb_array_elements(items) with ordinality x(b,ord) where b->>'metric'<>'score_range'),
 agg as(select coalesce(jsonb_agg(item order by ord),'[]') items,coalesce(sum((item->>'points')::numeric),0) total from parts)
 select items||case when total not between 0 and 10 then jsonb_build_array(jsonb_build_object('metric','score_range','value',total,'points',greatest(0,least(10,total))-total,'evidence','assessment bounded to 0–10')) else '[]'::jsonb end from agg
$$;
revoke all on function kickx_private.recalibrated_breakdown(jsonb,text) from public,anon,authenticated;

-- Frozen initial prices stay unchanged. The current match determines the return;
-- the prior cumulative target can no longer move a low assessment upwards.
do $$declare d text;begin
 d:=pg_get_functiondef('public.kickx_report_plan(jsonb,jsonb,jsonb)'::regprocedure);
 d:=replace(d,'public.kickx_report_plan(', 'kickx_private.legacy_report_plan(');execute d;
end $$;
revoke all on function kickx_private.legacy_report_plan(jsonb,jsonb,jsonb) from public,anon,authenticated;
create or replace function public.kickx_report_plan(p_results jsonb,p_baseline jsonb,p_parameters jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare r jsonb;steps jsonb:='[]';v bigint;before_v bigint;rate numeric;exposure numeric;t numeric;at text;begin
 if jsonb_typeof(p_results) is distinct from 'array' or p_baseline is null then raise exception 'INVALID_REPORT_BASELINE';end if;
 if not(p_parameters?'neutralScore') then return kickx_private.legacy_report_plan(p_results,p_baseline,p_parameters);end if;
 v:=(p_baseline->>'price')::bigint;
 for r in select value from jsonb_array_elements(p_results) where (value->>'season')::integer>(p_baseline->>'season')::integer
 and ((value->>'status' in('ready','provisional') and jsonb_typeof(value->'score')='number' and (value->>'minutes')::numeric>0 and (value->>'minutes')::numeric<=180) or(value->>'status'='not-played' and (value->>'minutes')::numeric=0))
 order by coalesce(value->>'endedAt',value->>'startedAt')::timestamptz,value->>'fixtureId' loop
  at:=coalesce(r->>'endedAt',r->>'startedAt');
  if extract(epoch from at::timestamptz)*1000<coalesce((p_parameters->>'valuationStartMs')::numeric,0) then continue;end if;
  exposure:=least((r->>'minutes')::numeric/60,1);
  rate:=case when r->>'status'='not-played' then -coalesce((p_parameters->>'nonParticipationRate')::numeric,.015)
   else greatest(-(p_parameters->>'maxDown')::numeric,least((p_parameters->>'maxUp')::numeric,((r->>'score')::numeric-6)*.025*exposure)) end;
  before_v:=v;t:=greatest((p_parameters->>'minPrice')::numeric,least((p_parameters->>'maxPrice')::numeric,v*(1+rate)));
  v:=greatest((p_parameters->>'minPrice')::bigint,ceil(before_v*(1-(p_parameters->>'maxDown')::numeric))::bigint,least((p_parameters->>'maxPrice')::bigint,floor(before_v*(1+(p_parameters->>'maxUp')::numeric))::bigint,floor(t+.5)::bigint));
  steps:=steps||jsonb_build_array(jsonb_build_object('fixtureId',r->>'fixtureId','playedAt',at,'priceBefore',before_v,'priceAfter',v,'targetPrice',floor(t+.5)::bigint,
   'formScore',coalesce((r->>'score')::numeric,6),'changePercent',floor((v-before_v)*100.0/before_v*10000+.5)/10000,'window',jsonb_build_array(r->>'fixtureId'),
   'evidence',jsonb_build_object('reason',case when r->>'status'='not-played' then 'NON_PARTICIPATION' else 'MATCH_SCORE' end,'neutralScore',6,'rawScore',r->'score','exposure',exposure,'rate',rate)));
 end loop;
 return jsonb_build_object('version','report-v3','baseline',p_baseline,'price',v,'steps',steps);
end $$;


-- Modify the existing writer, preserving idempotency, moderation, notifications and trade checks.
do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.kickx_community_write(text,jsonb)'::regprocedure);
 d:=replace(d,'title_value text; begin','title_value text; poll_value jsonb; options jsonb; days integer; choice integer; begin');
 d:=replace(d,$q$if not public.kickx_can_write_lounge(u,post.scope,post.target) then raise exception 'FAN_REQUIRED';end if;
  if exists(select 1 from public.community_comments$q$, $q$if not kickx_private.can_participate(u,post.scope,post.target) then raise exception 'PARTICIPATION_REQUIRED';end if;
  if exists(select 1 from public.community_comments$q$);
 d:=replace(d,$q$if p_action='editComment' and not public.kickx_can_write_lounge(u,post.scope,post.target)$q$,$q$if p_action='editComment' and not kickx_private.can_participate(u,post.scope,post.target)$q$);
 d:=replace(d,$q$elsif p_action='like' then$q$,$body$elsif p_action='vote' then
  if not kickx_private.can_participate(u,post.scope,post.target) then raise exception 'PARTICIPATION_REQUIRED';end if;
  if post.poll is null or now()>=(post.poll->>'endsAt')::timestamptz then raise exception 'POLL_CLOSED';end if;
  if jsonb_typeof(p_input->'option') is distinct from 'number' or (p_input->>'option')::numeric<>trunc((p_input->>'option')::numeric) then raise exception 'INVALID_INPUT';end if;
  choice:=(p_input->>'option')::integer;
  if choice<0 or choice>=jsonb_array_length(post.poll->'options') then raise exception 'INVALID_INPUT';end if;
  insert into public.community_poll_votes(post_id,user_id,option_index) values(post.id,u,choice::smallint)
  on conflict(post_id,user_id) do update set option_index=excluded.option_index where community_poll_votes.option_index<>excluded.option_index;
 elsif p_action='like' then
  if not kickx_private.can_participate(u,post.scope,post.target) then raise exception 'PARTICIPATION_REQUIRED';end if;$body$);
 d:=replace(d,'insert into public.community_posts(author_id,scope,target,title,body,trade_id,request_id)', $body$poll_value:=p_input->'poll';
  if poll_value is not null and poll_value<>'null'::jsonb then
   options:=poll_value->'options';
   if jsonb_typeof(options) is distinct from 'array' then raise exception 'INVALID_POLL';end if;
   if jsonb_array_length(options) not between 2 and 6 or char_length(btrim(poll_value->>'question')) not between 2 and 120
    or jsonb_typeof(poll_value->'question') is distinct from 'string'
    or exists(select 1 from jsonb_array_elements(options)x where jsonb_typeof(x)<>'string' or char_length(btrim(x#>>'{}')) not between 1 and 80)
    or (select count(distinct lower(btrim(x))) from jsonb_array_elements_text(options)x)<>jsonb_array_length(options) then raise exception 'INVALID_POLL';end if;
   days:=coalesce((poll_value->>'days')::integer,7);if days not between 1 and 14 then raise exception 'INVALID_POLL';end if;
   poll_value:=jsonb_build_object('question',btrim(poll_value->>'question'),'options',(select jsonb_agg(btrim(x)) from jsonb_array_elements_text(options)x),'endsAt',now()+make_interval(days=>days));
  else poll_value:=null;end if;
  insert into public.community_posts(author_id,scope,target,title,body,trade_id,request_id)$body$);
 d:=replace(d,'t,req) returning * into post;', 't,req) returning * into post;
  if poll_value is not null then update public.community_posts set poll=poll_value where id=post.id;end if;');
 execute d;
end $patch$;

-- Public DTOs expose a permanent club crest and a current ownership boolean, never balances/costs.
do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.kickx_post_json(public.community_posts)'::regprocedure);
 d:=replace(d,$q$'scope',p.scope$q$, $q$'authorPrimaryTeam',(select primary_team_id from public.profiles where id=p.author_id),'authorHoldsPlayer',p.scope='player' and exists(select 1 from public.holdings h where h.user_id=p.author_id and h.player_id=p.target),'poll',kickx_private.poll_summary(p),'scope',p.scope$q$);
 execute d;
 d:=pg_get_functiondef('public.kickx_post_detail(uuid,integer)'::regprocedure);
 d:=replace(d,$q$'authorAvatar',author.avatar,$q$, $q$'authorAvatar',author.avatar,'authorPrimaryTeam',author.primary_team_id,'authorHoldsPlayer',p.scope='player' and exists(select 1 from public.holdings h where h.user_id=c.author_id and h.player_id=p.target),$q$);execute d;
 d:=pg_get_functiondef('kickx_private.community_activity(uuid,text,integer,integer)'::regprocedure);
 d:=replace(d,$q$'avatar',avatar)$q$,$q$'avatar',avatar,'primaryTeam',primary_team_id)$q$);execute d;
end $patch$;
create or replace function kickx_private.ranking_avatars() returns jsonb language sql stable security definer set search_path='' as $$
 with snapshots as((select rows from public.ranking_snapshots where period='weekly' and ends_at>now() order by calculated_at desc limit 1)
 union all(select rows from public.ranking_snapshots where period='monthly' and ends_at>now() order by calculated_at desc limit 1)),
 users as(select distinct (entry->>'userId')::uuid id from snapshots cross join lateral jsonb_array_elements(rows)entry)
 select coalesce(jsonb_object_agg(p.id::text,jsonb_build_object('avatar',p.avatar,'primaryTeam',p.primary_team_id)),'{}') from users u join public.profiles p on p.id=u.id
$$;

-- Prompt cache includes the actual price outcome. Existing reports regenerate lazily, on demand.
do $patch$ declare d text;sig text;begin
 foreach sig in array array['public.kickx_read_match_report(text,text)','public.kickx_claim_match_report(text,text,uuid)','public.kickx_finish_match_report(text,text,uuid,text,jsonb,text,text)'] loop
  d:=pg_get_functiondef(sig::regprocedure);
  d:=replace(d,'match-report-performance-v2','match-report-outcome-v3');
  d:=replace(d,$q$'contributions',facts->'contributions')$q$, $q$'contributions',facts->'contributions','priceBefore',facts->'priceBefore','priceAfter',facts->'priceAfter','changePercent',facts->'changePercent')$q$);execute d;
 end loop;
 foreach sig in array array['public.kickx_publish_calculation_delta(uuid,text,text,jsonb)','public.kickx_publish_calculation(uuid,text,text,jsonb,jsonb)'] loop
  d:=pg_get_functiondef(sig::regprocedure);
  d:=replace(d,$q$x->>'scoringRevision' is distinct from 'regular-season-20261030'$q$, $q$x->>'scoringRevision' is distinct from coalesce(p.report_parameters->>'scoringRevision','regular-season-20261030')$q$);
  d:=replace(d,$from$case when p.version='report-v3' then '{"scoringRevision":"regular-season-20261030"}'::jsonb$from$,
 $to$case when p.version='report-v3' then jsonb_build_object('scoringRevision',coalesce(p.report_parameters->>'scoringRevision','regular-season-20261030'))$to$);d:=replace(d,'price_changed:=old_value is distinct from value_now',
 $latest$if p.version='report-v3' and p.report_parameters?'neutralScore' then
 select case when r.status='not-played' then null else r.score end into latest from public.performance_results r join public.fixtures f on f.id=r.fixture_id where r.player_id=p_player and r.status in('ready','provisional','not-played') and public.kickx_regular_fixture(f.id) is true order by f.starts_at desc,f.id desc limit 1;end if;
 price_changed:=old_value is distinct from value_now$latest$);execute d;
 end loop;
 d:=pg_get_functiondef('public.kickx_calculation_sources(text)'::regprocedure);
 d:=replace(d,$from$select m.fixture_id,h.signature,coalesce(r.rule_version=p.version and r.source_hash=h.signature,false)$from$,
 $to$select m.fixture_id,md5(h.signature||coalesce(p.report_parameters->>'scoringRevision','')),coalesce(r.rule_version=p.version and r.source_hash=md5(h.signature||coalesce(p.report_parameters->>'scoringRevision','')),false)$to$);
 execute d;
end $patch$;

-- One compressed private checkpoint, never a growing log. No raw BSD payload is copied.
create table kickx_private.valuation_checkpoint(id text primary key,created_at timestamptz not null default now(),data jsonb not null);
revoke all on kickx_private.valuation_checkpoint from public,anon,authenticated,service_role;
create function public.kickx_apply_neutral_assessments(p_expected_integrity jsonb) returns jsonb
language plpgsql security invoker set search_path='' set jit=off as $$
declare before_hash jsonb;changed integer;price_count integer;begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 before_hash:=public.kickx_valuation_integrity();
 if before_hash is distinct from p_expected_integrity then raise exception 'VALUATION_FINANCIAL_INTEGRITY';end if;
 if exists(select 1 from public.kickx_policy where report_parameters->>'scoringRevision'='neutral-six-20261106') then return '{"unchanged":true}';end if;
 if not exists(select 1 from public.kickx_policy where version='report-v3' and report_parameters->>'valuationStartMs'='1791990000000') then raise exception 'RESET_POLICY_REQUIRED';end if;
 insert into kickx_private.valuation_checkpoint(id,data)values('neutral-six-20261106',jsonb_build_object(
  'integrity',before_hash,'parameters',(select report_parameters from public.kickx_policy),
  'performance',(select jsonb_agg(to_jsonb(x)) from public.performance_results x),
  'prices',(select jsonb_agg(to_jsonb(x)) from public.player_price_results x),
  'snapshots',(select jsonb_agg(to_jsonb(x)) from public.player_market_snapshots x),
  'history',(select jsonb_agg(to_jsonb(x)) from public.price_history x),
  'records',(select jsonb_agg(jsonb_build_object('id',id,'performance',performance,'rule_version',rule_version)) from public.player_match_records),
  'assets',(select jsonb_agg(to_jsonb(x)) from public.asset_snapshots x),
  'rankings',(select jsonb_agg(to_jsonb(x)) from public.ranking_snapshots x)))on conflict(id)do nothing;
 update public.kickx_policy set report_parameters=(report_parameters-'capChangeAtMs'-'previousMaxUp'-'previousMaxDown')||'{"neutralScore":6,"pointRate":0.025,"maxUp":0.1,"maxDown":0.1,"scoringRevision":"neutral-six-20261106"}'::jsonb where id=true;
 with converted as materialized(select player_id,fixture_id,kickx_private.recalibrated_breakdown(breakdown,position) parts
 from public.performance_results where rule_version='report-v3' and status in('ready','provisional') and score is not null)
 update public.performance_results r set breakdown=c.parts,score=(select sum((b->>'points')::numeric)from jsonb_array_elements(c.parts)b),
 input_hash=md5(r.input_hash||':neutral-six-20261106'),calculated_at=clock_timestamp() from converted c where r.player_id=c.player_id and r.fixture_id=c.fixture_id;
 get diagnostics changed=row_count;
 update public.performance_results set source_hash=md5(source_hash||'neutral-six-20261106') where source_hash is not null;
 update public.player_match_records m set performance=r.score,rule_version=r.rule_version from public.performance_results r
 where r.player_id=m.player_id and r.fixture_id=m.fixture_id and r.status in('ready','provisional');
 create temporary table neutral_plans on commit drop as
 select i.player_id,public.kickx_report_plan(coalesce((select jsonb_agg(jsonb_build_object('fixtureId',r.fixture_id,'score',r.score,'status',r.status,'season',f.season,
 'minutes',m.stats->'minutes_played','startedAt',f.starts_at,'endedAt',public.kickx_fixture_valuation_at(f.id)))
 from public.performance_results r join public.fixtures f on f.id=r.fixture_id join public.football_match_stats m on m.player_id=r.player_id and m.fixture_id=r.fixture_id
 where r.player_id=i.player_id and r.rule_version='report-v3' and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and public.kickx_regular_fixture(f.id) is true),'[]'),i.detail,p.report_parameters)plan
 from public.player_initial_values i cross join public.kickx_policy p where i.rule_version='report-v3' and i.detail is not null and public.kickx_market_eligible(i.player_id);
 delete from public.player_price_results r using pg_temp.neutral_plans p where r.player_id=p.player_id;
 insert into public.player_price_results(player_id,fixture_id,rule_version,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids,input_hash)
 select p.player_id,x->>'fixtureId','report-v3',(x->>'playedAt')::timestamptz,(x->>'priceBefore')::bigint,(x->>'priceAfter')::bigint,(x->>'targetPrice')::bigint,(x->>'formScore')::numeric,(x->>'changePercent')::numeric,x->'window',r.input_hash
 from pg_temp.neutral_plans p cross join lateral jsonb_array_elements(plan->'steps')x join public.performance_results r on r.player_id=p.player_id and r.fixture_id=x->>'fixtureId';
 get diagnostics price_count=row_count;
 delete from public.price_history h using pg_temp.neutral_plans p where h.player_id=p.player_id;
 insert into public.price_history(player_id,recorded_at,value,rule_version)
 select p.player_id,to_timestamp((k.report_parameters->>'valuationStartMs')::numeric/1000),(plan#>>'{baseline,price}')::numeric,'report-v3' from pg_temp.neutral_plans p cross join public.kickx_policy k
 union all select p.player_id,(x->>'playedAt')::timestamptz,(x->>'priceAfter')::numeric,'report-v3' from pg_temp.neutral_plans p cross join lateral jsonb_array_elements(plan->'steps')x;
 update public.player_market_snapshots s set performance_rule_version='report-v3',pricing_rule_version='report-v3',price=(p.plan->>'price')::numeric,change_percent=coalesce((p.plan#>>'{steps,-1,changePercent}')::numeric,0),
 performance=(select case when r.status='not-played' then null else r.score end from public.performance_results r join public.fixtures f on f.id=r.fixture_id where r.player_id=s.id and r.status in('ready','provisional','not-played') and f.league_id in('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6') and public.kickx_regular_fixture(f.id) is true order by f.starts_at desc,f.id desc limit 1),updated_at=clock_timestamp()
 from pg_temp.neutral_plans p where p.player_id=s.id;
 -- Store only the latest derived plan, not another copy of raw source statistics.
 insert into public.calculation_revisions(player_id,input_hash,rule_version,previous_price,new_price,results,pricing)
 select player_id,md5(player_id||':neutral-six-20261106'),'report-v3',null,(plan->>'price')::bigint,'[]',plan from pg_temp.neutral_plans;
 delete from public.player_calculation_state c using pg_temp.neutral_plans p where c.player_id=p.player_id;
 update public.asset_snapshots a set value=public.kickx_assets_at(a.user_id,a.recorded_at) where a.recorded_at>=timestamptz '2026-10-14T15:00:00Z';
 perform public.kickx_auto_refresh_rankings();
 if before_hash is distinct from public.kickx_valuation_integrity() then raise exception 'VALUATION_FINANCIAL_INTEGRITY';end if;
 insert into public.operation_audit(action,detail)values('policy.neutral-assessment',jsonb_build_object('scores',changed,'priceSteps',price_count,'financialIntegrityUnchanged',true,'providerRequests',0));
 return jsonb_build_object('scores',changed,'priceSteps',price_count,'players',(select count(*)from pg_temp.neutral_plans),'financialIntegrityUnchanged',true,'providerRequests',0);
end $$;
revoke all on function public.kickx_apply_neutral_assessments(jsonb) from public,anon,authenticated,service_role;
-- Bounded full-history chart: retain endpoints, downsample only when over 800 rows.
create function public.kickx_player_value_history(p_player text) returns jsonb language sql stable security invoker set search_path='' as $$
 with bounds as(select count(*) n,min(recorded_at) lo,max(recorded_at) hi from public.price_history where player_id=p_player),
 samples as(select distinct on(bucket) h.recorded_at,h.value from public.price_history h cross join bounds b
 cross join lateral(select case when b.n<=798 then extract(epoch from h.recorded_at) else floor(extract(epoch from h.recorded_at-b.lo)/greatest(1,extract(epoch from b.hi-b.lo)/797)) end bucket)x
 where h.player_id=p_player order by bucket,h.recorded_at desc,h.id desc),
 endpoints as((select recorded_at,value from public.price_history where player_id=p_player order by recorded_at,id limit 1)
 union(select recorded_at,value from public.price_history where player_id=p_player order by recorded_at desc,id desc limit 1)),
 points as(select * from samples union select * from endpoints)
 select coalesce(jsonb_agg(jsonb_build_object('at',recorded_at,'value',value) order by recorded_at),'[]') from points
$$;
revoke all on function public.kickx_player_value_history(text) from public;
grant execute on function public.kickx_player_value_history(text) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
