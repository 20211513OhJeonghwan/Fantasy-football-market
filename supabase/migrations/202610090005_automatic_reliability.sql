-- Additive reliability update; do not rerun or edit already-applied 004.
begin;
create or replace function public.kickx_queue_match_change() returns trigger language plpgsql security definer set search_path='' as $$
declare f text; m record;begin
 if TG_OP='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new;end if;
 if TG_TABLE_NAME='football_event_sources' then
  if TG_OP='UPDATE' and (new.player_stats,new.lineups,new.incidents,new.legacy_stats) is not distinct from (old.player_stats,old.lineups,old.incidents,old.legacy_stats) then return new;end if;
 end if;
 if TG_TABLE_NAME='football_match_stats' then
  if TG_OP<>'DELETE' then perform public.kickx_queue_player(new.player_id);end if;
  if TG_OP<>'INSERT' then perform public.kickx_queue_player(old.player_id);end if;
 elsif TG_TABLE_NAME='fixtures' then
  if TG_OP='UPDATE' and (new.status,new.starts_at,new.home_score,new.away_score,new.home_team_id,new.away_team_id) is not distinct from (old.status,old.starts_at,old.home_score,old.away_score,old.home_team_id,old.away_team_id) then return new;end if;
  f:=case when TG_OP='DELETE' then old.id else new.id end;
 else f:=case when TG_OP='DELETE' then old.fixture_id else new.fixture_id end;
 end if;
 if f is not null then for m in select player_id from public.football_match_stats where fixture_id=f loop perform public.kickx_queue_player(m.player_id);end loop;end if;
 return case when TG_OP='DELETE' then old else new end;
end $$;
create or replace function public.kickx_require_active_member() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_member();begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:member:'||u::text,0));
 if exists(select 1 from public.member_restrictions where user_id=u and suspended_until>now()) then raise exception 'MEMBER_SUSPENDED';end if;
 return u;
end $$;
create or replace function public.kickx_restrict_member(p_user uuid,p_days integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare a uuid:=public.kickx_require_admin();begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kickx:member:'||p_user::text,0));
 if p_days not in(0,1,7,30) or p_days is null or char_length(btrim(p_reason)) not between 5 and 500 or p_reason is null then raise exception 'INVALID_INPUT';end if;
 if p_user=a or exists(select 1 from public.user_roles where user_id=p_user and role='admin') then raise exception 'PROTECTED_ADMIN';end if;
 insert into public.member_restrictions(user_id,suspended_until,reason,updated_by) values(p_user,case when p_days=0 then null else now()+make_interval(days=>p_days) end,btrim(p_reason),a) on conflict(user_id) do update set suspended_until=excluded.suspended_until,reason=excluded.reason,updated_by=a,updated_at=now();
 insert into public.operation_audit(actor,action,target,detail) values(a,case when p_days=0 then 'member.restore' else 'member.suspend' end,p_user::text,jsonb_build_object('days',p_days,'reason',btrim(p_reason)));
end $$;
commit;
