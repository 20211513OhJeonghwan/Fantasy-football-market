-- Formation changes bench only the exact positional surplus chosen by the member.
-- Reuses the 14-day freeze/settlement, original holdings and existing minute job.
begin;
set local lock_timeout='5s';
alter table public.holdings drop constraint holdings_bench_valid;
alter table public.holdings add constraint holdings_bench_valid check(
 (bench_price is null and bench_started_at is null and bench_reason is null) or
 (bench_price is not null and bench_price>0 and bench_started_at is not null and bench_reason is not null
  and bench_reason in('transfer','position','transfer_position','formation')));

create function kickx_private.formation_positions(p_formation text) returns text[]
language plpgsql immutable set search_path='' as $$
declare lines text[];result text[]:=array['GK'];i integer;j integer;pos text;begin
 if p_formation is null or not p_formation=any(array[
  '4-3-3','4-4-2','4-2-3-1','4-3-1-2','4-2-2-2','4-3-2-1','4-1-4-1','4-1-2-3','4-5-1','4-4-1-1','4-2-4',
  '3-5-2','3-4-3','3-4-1-2','3-4-2-1','3-2-4-1','5-3-2','5-4-1','5-2-3']) then raise exception 'INVALID_FORMATION';end if;
 lines:=string_to_array(p_formation,'-');
 for i in 1..cardinality(lines) loop
  pos:=case when i=1 then 'DF' when i=cardinality(lines) then 'FW' else 'MF' end;
  for j in 1..lines[i]::integer loop result:=array_append(result,pos);end loop;
 end loop;
 return result;
end $$;

create function kickx_private.owned_squad_slots(p_user uuid,p_formation text,p_old text[]) returns text[]
language plpgsql stable set search_path='' as $$
declare f text[]:=kickx_private.formation_positions(p_formation);result text[]:=array_fill(null::text,array[11]);i integer;candidate text;begin
 for i in 1..11 loop
  if p_old[i] is not null and not p_old[i]=any(array_remove(result,null)) and exists(
   select 1 from public.holdings h join public.players p on p.id=h.player_id
    where h.user_id=p_user and h.player_id=p_old[i] and h.bench_started_at is null and p.position=f[i]) then result[i]:=p_old[i];end if;
 end loop;
 for i in 1..11 loop
  if result[i] is null then
   select h.player_id into candidate from public.holdings h join public.players p on p.id=h.player_id
    where h.user_id=p_user and h.bench_started_at is null and p.position=f[i]
    and not h.player_id=any(array_remove(result,null)) order by h.acquired_at,h.player_id limit 1;
   result[i]:=candidate;
  end if;
 end loop;
 return result;
end $$;

create or replace function kickx_private.kickx_sync_owned_squad(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare old public.squads%rowtype;formation text;next_slots text[];begin
 perform public.kickx_economy_lock();
 select * into old from public.squads where user_id=p_user for update;
 formation:=coalesce(old.formation_id,'4-3-3');
 next_slots:=kickx_private.owned_squad_slots(p_user,formation,old.slots);
 insert into public.squads(user_id,formation_id,slots) values(p_user,formation,next_slots)
 on conflict(user_id) do update set slots=excluded.slots,revision=public.squads.revision+1,updated_at=clock_timestamp()
 where public.squads.slots is distinct from excluded.slots;
end $$;

create or replace function public.kickx_require_position_capacity(p_user uuid,p_player text)
returns void language plpgsql set search_path='' as $$
declare pos text;f text[];cap integer;n integer;begin
 select position into pos from public.players where id=p_player;
 if pos is null or pos not in('GK','DF','MF','FW') then raise exception 'POSITION_UNAVAILABLE';end if;
 if exists(select 1 from public.holdings where user_id=p_user and player_id=p_player) then raise exception 'ALREADY_OWNED';end if;
 f:=kickx_private.formation_positions(coalesce((select formation_id from public.squads where user_id=p_user),'4-3-3'));
 if exists(select 1 from public.holdings h join public.players p on p.id=h.player_id
  where h.user_id=p_user and h.bench_started_at is null group by p.position
  having count(*)>(select count(*) from unnest(f) x where x=p.position)) then raise exception 'LEGACY_SQUAD_EXCESS';end if;
 if (select count(*) from public.holdings where user_id=p_user and bench_started_at is null)>=11 then raise exception 'SQUAD_FULL';end if;
 select count(*) into cap from unnest(f) x where x=pos;
 select count(*) into n from public.holdings h join public.players p on p.id=h.player_id
  where h.user_id=p_user and h.bench_started_at is null and p.position=pos;
 if n>=cap then raise exception 'POSITION_FULL';end if;
end $$;

create function public.kickx_change_formation(p_formation text,p_bench text[],p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();s public.squads%rowtype;
 f text[];pos text;required integer;chosen integer;started timestamptz;begin
 perform public.kickx_economy_lock();
 f:=kickx_private.formation_positions(p_formation);
 if p_bench is null or cardinality(p_bench)>11 then raise exception 'INVALID_BENCH_SELECTION';end if;
 if cardinality(p_bench)>0 and (array_ndims(p_bench)<>1 or array_lower(p_bench,1)<>1) then raise exception 'INVALID_BENCH_SELECTION';end if;
 if cardinality(p_bench)<>(select count(distinct id) from unnest(p_bench) id) then raise exception 'INVALID_BENCH_SELECTION';end if;
 select * into s from public.squads where user_id=u for update;
 if not found then
  if p_revision is distinct from 0 then raise exception 'STALE_REVISION';end if;
  perform kickx_private.kickx_sync_owned_squad(u);
  select * into strict s from public.squads where user_id=u for update;
 elsif p_revision is distinct from s.revision then raise exception 'STALE_REVISION';end if;
 if p_formation=s.formation_id then
  if cardinality(p_bench)>0 then raise exception 'INVALID_BENCH_SELECTION';end if;
  return to_jsonb(s);
 end if;
 if exists(select 1 from public.holdings h join public.players p on p.id=h.player_id
  where h.user_id=u and h.bench_started_at is null and (p.position is null or p.position not in('GK','DF','MF','FW'))) then raise exception 'POSITION_UNAVAILABLE';end if;
 if cardinality(p_bench)<>(select count(*) from public.holdings where user_id=u and bench_started_at is null and player_id=any(p_bench)) then raise exception 'INVALID_BENCH_SELECTION';end if;
 foreach pos in array array['GK','DF','MF','FW'] loop
  select greatest(count(*)-(select count(*) from unnest(f) x where x=pos),0)::integer into required
   from public.holdings h join public.players p on p.id=h.player_id where h.user_id=u and h.bench_started_at is null and p.position=pos;
  select count(*) into chosen from public.holdings h join public.players p on p.id=h.player_id
   where h.user_id=u and h.player_id=any(p_bench) and p.position=pos;
  if chosen<>required then raise exception 'INVALID_BENCH_SELECTION';end if;
 end loop;
 -- Voluntary freezes must not bypass the existing match trading lock.
 if exists(select 1 from unnest(p_bench) id where (public.kickx_trade_window(id,clock_timestamp())->>'locked')::boolean) then raise exception 'MATCH_TRADING_LOCKED';end if;
 if exists(select 1 from public.holdings h left join public.player_market_snapshots m on m.id=h.player_id
  where h.user_id=u and h.player_id=any(p_bench) and (m.price is null or m.price<=0)) then raise exception 'ROSTER_PRICE_UNAVAILABLE';end if;
 started:=clock_timestamp();
 update public.holdings h set bench_price=m.price::bigint,bench_started_at=started,bench_reason='formation'
  from public.player_market_snapshots m where h.user_id=u and h.player_id=any(p_bench) and h.bench_started_at is null and m.id=h.player_id;
 update public.squads set formation_id=p_formation,slots=kickx_private.owned_squad_slots(u,p_formation,s.slots),
  revision=revision+1,updated_at=started where user_id=u returning * into s;
 return to_jsonb(s);
end $$;

-- Placement can rearrange active players; it cannot hide a holding or reactivate a frozen bench.
create or replace function public.kickx_save_squad(p_formation text,p_slots text[],p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.kickx_require_active_member();s public.squads%rowtype;f text[];i integer;begin
 perform public.kickx_economy_lock();
 f:=kickx_private.formation_positions(p_formation);
 if p_slots is null or cardinality(p_slots)<>11 or array_ndims(p_slots)<>1 or array_lower(p_slots,1)<>1 then raise exception 'INVALID_SQUAD';end if;
 select * into s from public.squads where user_id=u for update;
 if not found or p_revision is distinct from s.revision then raise exception 'STALE_REVISION';end if;
 if p_formation is distinct from s.formation_id then raise exception 'FORMATION_CHANGE_REQUIRED';end if;
 if cardinality(array_remove(p_slots,null))<>(select count(distinct id) from unnest(p_slots) id) then raise exception 'DUPLICATE_PLAYER';end if;
 for i in 1..11 loop
  if p_slots[i] is not null and not exists(select 1 from public.holdings h join public.players p on p.id=h.player_id
   where h.user_id=u and h.player_id=p_slots[i] and h.bench_started_at is null and p.position=f[i]) then raise exception 'INVALID_SQUAD_PLAYER';end if;
 end loop;
 if exists(select 1 from public.holdings where user_id=u and bench_started_at is null
  and not player_id=any(array_remove(p_slots,null))) then raise exception 'SQUAD_INCOMPLETE';end if;
 if s.slots is distinct from p_slots then
  update public.squads set slots=p_slots,revision=revision+1,updated_at=clock_timestamp() where user_id=u returning * into s;
 end if;
 return to_jsonb(s);
end $$;

revoke all on function kickx_private.formation_positions(text),kickx_private.owned_squad_slots(uuid,text,text[]) from public,anon,authenticated,service_role;
revoke all on function public.kickx_change_formation(text,text[],integer) from public,anon,authenticated,service_role;
grant execute on function public.kickx_change_formation(text,text[],integer) to authenticated;
notify pgrst,'reload schema';
commit;
