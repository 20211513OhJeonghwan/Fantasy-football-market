-- Stage 1: public football catalog, verified profiles and private watchlists.
-- No sample rows, initial grants, trading rules or formation defaults are inserted.
begin;

create table public.leagues (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  external_id bigint unique,
  name text not null check (length(name) > 0),
  updated_at timestamptz not null default now()
);
create table public.teams (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  external_id bigint unique,
  league_id text references public.leagues(id),
  name text not null,
  english text,
  code text,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);
create index teams_league_idx on public.teams(league_id);
create table public.players (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  external_id bigint unique,
  team_id text references public.teams(id),
  name text not null,
  english text,
  short_name text,
  position text check (position in ('GK','DF','MF','FW')),
  shirt_number integer check (shirt_number >= 0),
  country text,
  birth_date date,
  trade_status text,
  updated_at timestamptz not null default now()
);
create index players_team_idx on public.players(team_id);
create index players_position_idx on public.players(position);
create table public.player_market_snapshots (
  id text primary key references public.players(id) on delete cascade,
  price numeric(18,4) check (price >= 0),
  change_percent numeric,
  performance numeric,
  volume bigint check (volume >= 0),
  goals integer check (goals >= 0),
  assists integer check (assists >= 0),
  minutes integer check (minutes >= 0),
  performance_rule_version text,
  pricing_rule_version text,
  updated_at timestamptz not null default now(),
  check (price is null or pricing_rule_version is not null),
  check (performance is null or performance_rule_version is not null)
);
create table public.fixtures (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  external_id bigint unique,
  league_id text references public.leagues(id),
  home_team_id text not null references public.teams(id),
  away_team_id text not null references public.teams(id),
  starts_at timestamptz not null,
  status text not null,
  home_score integer check (home_score >= 0),
  away_score integer check (away_score >= 0),
  updated_at timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create index fixtures_start_idx on public.fixtures(starts_at);
create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id) on delete cascade,
  recorded_at timestamptz not null,
  value numeric(18,4) not null check (value >= 0),
  rule_version text not null,
  unique(player_id, recorded_at)
);
create index price_history_player_time_idx on public.price_history(player_id, recorded_at desc);
create index price_history_time_idx on public.price_history(recorded_at);
create table public.player_match_records (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id) on delete cascade,
  fixture_id text not null references public.fixtures(id),
  played_at timestamptz not null,
  opponent text not null,
  result text,
  minutes integer check (minutes >= 0),
  goals integer check (goals >= 0),
  assists integer check (assists >= 0),
  performance numeric,
  rule_version text,
  unique(player_id, fixture_id),
  check (performance is null or rule_version is not null)
);
create index player_records_time_idx on public.player_match_records(played_at);
create table public.player_analyses (
  id text primary key references public.players(id) on delete cascade,
  body text not null,
  source_updated_at timestamptz not null,
  generated_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (
    char_length(nickname) between 2 and 20 and nickname = btrim(nickname)
    and nickname ~ '^[[:alnum:]_ -]+$'
  ),
  team_id text references public.teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_nickname_unique on public.profiles(lower(nickname));
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('member','admin'))
);
create table public.watchlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, player_id)
);
create index watchlists_player_idx on public.watchlists(player_id);

create function public.touch_profile_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.touch_profile_updated_at();

-- Public data is readable but never writable with a browser/publishable key.
do $$
declare t text;
begin
  foreach t in array array['leagues','teams','players','player_market_snapshots','fixtures','price_history','player_match_records','player_analyses']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.watchlists enable row level security;
revoke all on public.profiles, public.user_roles, public.watchlists from anon, authenticated;
grant select on public.profiles, public.user_roles, public.watchlists to authenticated;
grant insert(id, nickname, team_id), update(nickname, team_id) on public.profiles to authenticated;
grant insert(user_id, player_id), delete on public.watchlists to authenticated;
grant all on public.profiles, public.user_roles, public.watchlists to service_role;
create policy profile_read_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profile_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profile_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy role_read_own on public.user_roles for select to authenticated using ((select auth.uid()) = user_id);
create policy watch_read_own on public.watchlists for select to authenticated using ((select auth.uid()) = user_id);
create policy watch_insert_own on public.watchlists for insert to authenticated with check ((select auth.uid()) = user_id);
create policy watch_delete_own on public.watchlists for delete to authenticated using ((select auth.uid()) = user_id);

commit;
