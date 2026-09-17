// Ingesta de odds vía SharpAPI (https://sharpapi.io).
//
// ACTUALIZACIÓN 17-sep-2026: confirmado en vivo con la key real de Fausto
// que moneyline Y props SÍ están disponibles en el tier gratis (12 req/min,
// DraftKings+FanDuel). El primer intento falló por nombres de market_type
// mal adivinados (ver PROP_MARKET_KEYS abajo), no por un límite del plan.
// Este módulo sigue siendo defensivo por si acaso: si props devuelve vacío
// o un 403/404 (plan realmente sin acceso), lanza
// SharpApiPropsUnavailableError y el motor cae a modo "solo equipos" en vez
// de romper todo el análisis — pero un 400 (parámetro mal formado) SÍ se
// deja propagar como error real, para que se note y se corrija.

const BASE_URL = 'https://api.sharpapi.io/api/v1';

export class SharpApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'SharpApiError';
  }
}

export class SharpApiPropsUnavailableError extends SharpApiError {
  constructor(message = 'Player props no disponibles en el plan actual de SharpAPI') {
    super(message);
    this.name = 'SharpApiPropsUnavailableError';
  }
}

function getApiKey(): string {
  const key = process.env.SHARPAPI_KEY;
  if (!key) {
    throw new SharpApiError('Falta SHARPAPI_KEY en las variables de entorno.');
  }
  return key;
}

async function sharpApiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': getApiKey() },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SharpApiError(`SharpAPI ${path} -> HTTP ${res.status}: ${body.slice(0, 1000)}`, res.status);
  }
  return res.json() as Promise<T>;
}

export interface SharpApiTeamInfo {
  id: string;
  numerical_id: number;
  name: string;
  abbreviation: string;
}

export interface SharpApiOddsLine {
  id: string;
  sportsbook: string;
  sport: string;
  league?: string;
  event_id: string;
  home_team: string;
  away_team: string;
  commence_time?: string;
  event_start_time?: string;
  market_type: string;
  selection: string;
  team_side?: 'home' | 'away';
  player_name?: string;
  line?: number;
  odds_american: number;
  odds_decimal?: number;
  odds_probability?: number;
  home?: SharpApiTeamInfo;
  away?: SharpApiTeamInfo;
}

interface SharpApiOddsResponse {
  data: SharpApiOddsLine[];
}

function onlyNfl(lines: SharpApiOddsLine[]): SharpApiOddsLine[] {
  return lines.filter((l) => !l.league || l.league === 'nfl');
}

export async function fetchMoneylineOdds(): Promise<SharpApiOddsLine[]> {
  const res = await sharpApiGet<SharpApiOddsResponse>('/odds', {
    sport: 'NFL',
    sportsbooks: 'draftkings,fanduel',
    market_type: 'moneyline',
  });
  return onlyNfl(res.data ?? []);
}

const PROP_MARKET_KEYS: Record<string, string> = {
  pass_yards: 'player_passing_yards',
  pass_attempts: 'player_passing_attempts',
  rush_yards: 'player_rushing_yards',
  rush_attempts: 'player_rushing_attempts',
  anytime_td: 'anytime_touchdown_scorer',
  rec_yards: 'player_receiving_yards',
  receptions: 'player_receptions',
  fg_made: 'player_field_goals_made',
};

export type PropCategory = keyof typeof PROP_MARKET_KEYS;

export async function fetchPlayerProps(categories: PropCategory[]): Promise<SharpApiOddsLine[]> {
  const marketTypes = categories.map((c) => PROP_MARKET_KEYS[c]).join(',');
  try {
    const res = await sharpApiGet<SharpApiOddsResponse>('/odds', {
      sport: 'NFL',
      sportsbooks: 'draftkings,fanduel',
      market_type: marketTypes,
    });
    const lines = onlyNfl(res.data ?? []);
    if (lines.length === 0) {
      throw new SharpApiPropsUnavailableError(
        'SharpAPI devolvió 0 líneas de props — probablemente no incluidas en tu plan actual.'
      );
    }
    return lines;
  } catch (err) {
    if (err instanceof SharpApiError && (err.status === 403 || err.status === 404)) {
      throw new SharpApiPropsUnavailableError();
    }
    throw err;
  }
}

export async function testSharpApiConnection(): Promise<{
  moneylineOk: boolean;
  propsOk: boolean;
  moneylineError?: string;
  propsError?: string;
}> {
  let moneylineOk = false;
  let propsOk = false;
  let moneylineError: string | undefined;
  let propsError: string | undefined;

  try {
    const lines = await fetchMoneylineOdds();
    moneylineOk = lines.length > 0;
  } catch (e) {
    moneylineError = e instanceof Error ? e.message : String(e);
  }

  try {
    const props = await fetchPlayerProps(['pass_yards']);
    propsOk = props.length > 0;
  } catch (e) {
    propsError = e instanceof Error ? e.message : String(e);
  }

  return { moneylineOk, propsOk, moneylineError, propsError };
}
