-- NFL Betting Tracker — schema inicial
-- Uso individual (sin auth/multiusuario). Todo corre bajo un solo "owner" implícito.

create extension if not exists "pgcrypto";

-- ==========================================================================
-- 1. Semanas: una fila por semana de temporada regular/playoffs analizada
-- ==========================================================================
create table if not exists weeks (
  id uuid primary key default gen_random_uuid(),
  season int not null,                -- ej. 2026
  week_number int not null,           -- 1-18 regular season, 19+ playoffs
  budget_cents bigint,                -- budget semanal que Fausto ingresó (null hasta que corre el análisis)
  status text not null default 'draft' check (status in ('draft', 'analyzed', 'committed', 'closed')),
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (season, week_number)
);

-- ==========================================================================
-- 2. Snapshot de power ratings por equipo, congelado en el momento del análisis
--    (para que un portafolio guardado sea auditable/reproducible después,
--    aunque el rating del equipo cambie la semana siguiente)
-- ==========================================================================
create table if not exists team_ratings_snapshot (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  team text not null,                  -- código de equipo, ej. 'BUF'
  off_epa_adj numeric not null,
  def_epa_adj numeric not null,
  sample_games int not null,
  created_at timestamptz not null default now(),
  unique (week_id, team)
);

-- ==========================================================================
-- 3. Partidos de la semana con su contexto (clima, descanso, lesiones clave)
-- ==========================================================================
create table if not exists games_snapshot (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  home_team text not null,
  away_team text not null,
  kickoff timestamptz,
  is_divisional boolean not null default false,
  home_rest_days int,
  away_rest_days int,
  wind_mph numeric,
  precip text,                         -- 'none' | 'rain' | 'snow'
  is_dome boolean not null default false,
  home_qb_out boolean not null default false,
  away_qb_out boolean not null default false,
  model_home_win_prob numeric,         -- probabilidad del modelo (post-ajustes)
  market_home_win_prob numeric,        -- fair probability de-vig del mercado
  created_at timestamptz not null default now()
);

-- ==========================================================================
-- 4. Portafolios: 3 por semana (team_only / props_only / mixed) + el elegido
-- ==========================================================================
create table if not exists portfolios (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  portfolio_type text not null check (portfolio_type in ('team_only', 'props_only', 'mixed')),
  total_budget_cents bigint not null,
  picks_budget_cents bigint not null,   -- 90%
  parlay_budget_cents bigint not null,  -- 10%
  is_selected boolean not null default false,  -- cuál eligió Fausto para ejecutar
  created_at timestamptz not null default now(),
  unique (week_id, portfolio_type)
);

-- ==========================================================================
-- 5. Picks individuales dentro de un portafolio (2-4, dinámico)
-- ==========================================================================
create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  market_type text not null check (market_type in (
    'moneyline', 'pass_yards', 'pass_attempts', 'rush_yards', 'rush_attempts',
    'anytime_td', 'rec_yards', 'receptions', 'fg_made'
  )),
  selection text not null,             -- ej. 'Buffalo Bills ML' o 'Josh Allen o245.5 pass yards'
  player_name text,                    -- null para moneyline
  team text,
  line numeric,                        -- la línea de la prop (null para TD/ML)
  odds_american int not null,
  model_prob numeric not null,
  fair_prob numeric not null,
  edge_pct numeric not null,
  stake_cents bigint not null,
  reasoning text[] not null default '{}',  -- 2-3 bullets generados por template
  result text not null default 'pending' check (result in ('pending', 'won', 'lost', 'push')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

-- ==========================================================================
-- 6. Legs del parlay (3-4 por portafolio)
-- ==========================================================================
create table if not exists parlay_legs (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  market_type text not null,
  selection text not null,
  player_name text,
  team text,
  line numeric,
  odds_american int not null,
  edge_pct numeric not null,
  leg_order int not null,
  created_at timestamptz not null default now()
);

create table if not exists parlays (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade unique,
  combined_odds_american int not null,
  stake_cents bigint not null,
  result text not null default 'pending' check (result in ('pending', 'won', 'lost')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

-- ==========================================================================
-- 7. Preguntas libres sobre un partido específico (feature de chat + SGP)
-- ==========================================================================
create table if not exists matchup_questions (
  id uuid primary key default gen_random_uuid(),
  week_id uuid references weeks(id) on delete set null,
  question text not null,
  home_team text,
  away_team text,
  answer text not null,
  suggested_legs jsonb not null default '[]',  -- [{selection, market_type, odds_american, edge_pct}]
  created_at timestamptz not null default now()
);

create index if not exists idx_picks_portfolio on picks(portfolio_id);
create index if not exists idx_parlay_legs_portfolio on parlay_legs(portfolio_id);
create index if not exists idx_games_week on games_snapshot(week_id);
create index if not exists idx_ratings_week on team_ratings_snapshot(week_id);
