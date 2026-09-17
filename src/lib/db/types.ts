// Tipos que reflejan el schema de supabase/migrations/0001_init.sql
// Mantener sincronizado a mano (proyecto sin auth/multiusuario, sin
// generación automática de tipos por ahora).

export type PortfolioType = 'team_only' | 'props_only' | 'mixed';

export type MarketType =
  | 'moneyline'
  | 'pass_yards'
  | 'pass_attempts'
  | 'rush_yards'
  | 'rush_attempts'
  | 'anytime_td'
  | 'rec_yards'
  | 'receptions'
  | 'fg_made';

export type PickResult = 'pending' | 'won' | 'lost' | 'push';

export interface WeekRow {
  id: string;
  season: number;
  week_number: number;
  budget_cents: number | null;
  status: 'draft' | 'analyzed' | 'committed' | 'closed';
  analyzed_at: string | null;
  created_at: string;
}

export interface TeamRatingSnapshotRow {
  id: string;
  week_id: string;
  team: string;
  off_epa_adj: number;
  def_epa_adj: number;
  sample_games: number;
  created_at: string;
}

export interface GameSnapshotRow {
  id: string;
  week_id: string;
  home_team: string;
  away_team: string;
  kickoff: string | null;
  is_divisional: boolean;
  home_rest_days: number | null;
  away_rest_days: number | null;
  wind_mph: number | null;
  precip: 'none' | 'rain' | 'snow' | null;
  is_dome: boolean;
  home_qb_out: boolean;
  away_qb_out: boolean;
  model_home_win_prob: number | null;
  market_home_win_prob: number | null;
  created_at: string;
}

export interface PortfolioRow {
  id: string;
  week_id: string;
  portfolio_type: PortfolioType;
  total_budget_cents: number;
  picks_budget_cents: number;
  parlay_budget_cents: number;
  is_selected: boolean;
  created_at: string;
}

export interface PickRow {
  id: string;
  portfolio_id: string;
  market_type: MarketType;
  selection: string;
  player_name: string | null;
  team: string | null;
  line: number | null;
  odds_american: number;
  model_prob: number;
  fair_prob: number;
  edge_pct: number;
  stake_cents: number;
  reasoning: string[];
  result: PickResult;
  settled_at: string | null;
  created_at: string;
}

export interface ParlayLegRow {
  id: string;
  portfolio_id: string;
  market_type: string;
  selection: string;
  player_name: string | null;
  team: string | null;
  line: number | null;
  odds_american: number;
  edge_pct: number;
  leg_order: number;
  created_at: string;
}

export interface ParlayRow {
  id: string;
  portfolio_id: string;
  combined_odds_american: number;
  stake_cents: number;
  result: 'pending' | 'won' | 'lost';
  settled_at: string | null;
  created_at: string;
}

export interface MatchupQuestionRow {
  id: string;
  week_id: string | null;
  question: string;
  home_team: string | null;
  away_team: string | null;
  answer: string;
  suggested_legs: SuggestedLeg[];
  created_at: string;
}

export interface SuggestedLeg {
  selection: string;
  market_type: string;
  odds_american: number;
  edge_pct: number;
}
