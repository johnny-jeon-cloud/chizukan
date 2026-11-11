create schema if not exists chizukan;
revoke all on schema chizukan from public, anon, authenticated;
create table chizukan.players (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  ip_hash text,
  win_start timestamptz not null default now(),
  win_n int not null default 0,
  banned boolean not null default false
);
create index players_ip_created_idx on chizukan.players (ip_hash, created_at);
create table chizukan.battle_log (
  id bigint generated always as identity primary key,
  player_id uuid not null references chizukan.players(id) on delete cascade,
  seed bigint not null, team_a int[] not null, team_b int[] not null, plan jsonb not null,
  res smallint not null, rounds smallint not null, pts smallint not null, rules_ver text not null,
  forfeit boolean not null default false, created_at timestamptz not null default now()
);
create index battle_log_player_idx on chizukan.battle_log (player_id, created_at desc);
create table chizukan.feedback (
  id bigint generated always as identity primary key,
  player_id uuid references chizukan.players(id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  ua text, rules_ver text, created_at timestamptz not null default now()
);
alter table chizukan.players enable row level security;
alter table chizukan.battle_log enable row level security;
alter table chizukan.feedback enable row level security;
