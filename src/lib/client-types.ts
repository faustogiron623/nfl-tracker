// Tipos del lado del cliente para las respuestas de las API routes
// (deliberadamente sueltos respecto a los tipos internos del engine/db,
// son solo lo que el frontend necesita renderizar).

export interface ClientPick {
  marketType: string;
  selection: string;
  playerName: string | null;
  team: string | null;
  gameId: string;
  line: number | null;
  oddsAmerican: number;
  modelProb: number;
  fairProb: number;
  edgePct: number;
  reasoning: string[];
  stakeCents: number;
}

export interface ClientParlay {
  legs: { id: string; gameId: string; selection: string; oddsAmerican: number; edgePct: number }[];
  combinedOddsAmerican: number;
  stakeCents: number;
}

export interface ClientPortfolio {
  portfolioId: string | undefined;
  portfolioType: 'team_only' | 'props_only' | 'mixed';
  picks: ClientPick[];
  parlay: ClientParlay | null;
  totalBudgetCents: number;
  picksBudgetCents: number;
  parlayBudgetCents: number;
}

export interface AnalyzeResponse {
  weekId: string;
  propsAvailable: boolean;
  propsWarning: string | null;
  portfolios: ClientPortfolio[];
}

export interface AskResponse {
  homeTeam: string;
  awayTeam: string;
  answer: string;
  suggestedLegs: { selection: string; marketType: string; oddsAmerican: number; edgePct: number }[];
}

export interface DashboardResponse {
  totalStakedCents: number;
  totalProfitCents: number;
  roiPct: number;
  byMarketType: Record<string, { stakedCents: number; profitCents: number }>;
  byPortfolioType: Record<string, { stakedCents: number; profitCents: number }>;
  weekly: { season: number; weekNumber: number; stakedCents: number; profitCents: number }[];
}

export interface HistoryPickRow {
  id: string;
  market_type: string;
  selection: string;
  odds_american: number;
  stake_cents: number;
  edge_pct: number;
  reasoning: string[];
  result: 'pending' | 'won' | 'lost' | 'push';
}

export interface HistoryParlayLeg {
  id: string;
  selection: string;
  odds_american: number;
  edge_pct: number;
}

export interface HistoryParlay {
  id: string;
  combined_odds_american: number;
  stake_cents: number;
  result: 'pending' | 'won' | 'lost';
  parlay_legs: HistoryParlayLeg[];
}

export interface HistoryPortfolio {
  id: string;
  portfolio_type: string;
  is_selected: boolean;
  total_budget_cents: number;
  picks: HistoryPickRow[];
  parlays: HistoryParlay[];
}

export interface HistoryWeek {
  id: string;
  season: number;
  week_number: number;
  budget_cents: number;
  status: string;
  portfolios: HistoryPortfolio[];
}
