-- Member profile icon: a built-in football glyph or the crest of one of the member's supported clubs.
alter table public.profiles add column if not exists avatar text
  check (avatar is null or avatar ~ '^icon:(ball|jersey|trophy|boot|whistle|goal)$' or avatar ~ '^club:[A-Za-z0-9_-]{1,100}$');

-- A club crest is only valid while that club stays among the member's supported clubs.
create or replace function public.kickx_profile_avatar_club() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.avatar like 'club:%' and not (substr(new.avatar, 6) = any(coalesce(new.team_ids, '{}'))) then
    new.avatar := null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_avatar_club on public.profiles;
create trigger profiles_avatar_club before insert or update of avatar, team_ids on public.profiles
  for each row execute function public.kickx_profile_avatar_club();

grant insert(avatar), update(avatar) on public.profiles to authenticated;
notify pgrst, 'reload schema';
