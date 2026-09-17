export function centsToDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function formatPct(x: number, digits = 1): string {
  return `${x.toFixed(digits)}%`;
}

export const MARKET_LABELS: Record<string, string> = {
  moneyline: 'Moneyline',
  pass_yards: 'Yds de pase',
  pass_attempts: 'Intentos de pase',
  rush_yards: 'Yds de carrera',
  rush_attempts: 'Intentos de carrera',
  anytime_td: 'TD en cualquier momento',
  rec_yards: 'Yds de recepción',
  receptions: 'Recepciones',
  fg_made: 'Goles de campo',
};

export const PORTFOLIO_LABELS: Record<string, string> = {
  team_only: 'Solo equipos',
  props_only: 'Solo props',
  mixed: 'Mixto',
};
