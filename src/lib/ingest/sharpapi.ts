// Ingesta de odds vía SharpAPI (https://sharpapi.io).
//
// OJO — riesgo conocido documentado para Fausto: la documentación pública
// de SharpAPI confirma moneyline/spread/totals en el tier gratis, pero NO
// confirma player props en ningún tier de forma explícita. Este módulo está
// escrito de forma defensiva: si el endpoint de props devuelve vacío, 4xx,
// o un shape inesperado, lanza SharpApiPropsUnavailableError en vez de
// fallar en cascada, y el motor de cálculo (engine) cae a modo
// "solo equipos" avisando al usuario en vez de romperse.

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
    // Odds cambian; no cachear más de 5 minutos en el tier free (delay de 60s de por sí)
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SharpApiError(`SharpAPI ${path} -> HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  return res.json() as Promise<T>;
}

export interface SharpApiOddsLine {
  id: string;
  sportsbook: string; // 'draftkings' | 'fanduel'
  sport: string;
  event_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  market_type: string; // 'moneyline' | 'spread' | 'total' | prop market keys
  selection: string;
  player_name?: string;
  line?: number;
  odds_american: number;
  odds_decimal?: number;
  odds_probability?: number;
}

interface SharpApiOddsResponse {
  data: SharpApiOddsLine[];
}

/** Moneyline de NFL para DraftKings + FanDuel. Confirmado por docs: disponible en free tier. */
export async function fetchMoneylineOdds(): Promise<SharpApiOddsLine[]> {
  const res = await sharpApiGet<SharpApiOddsResponse>('/odds', {
    sport: 'NFL',
    sportsbooks: 'draftkings,fanduel',
    market_type: 'moneyline',
  });
  return res.data ?? [];
}

// Mapeo de nuestras categorías de prop a los market_type keys que
// (según la documentación de marketing, no confirmado en la referencia
// técnica) SharpAPI usaría. Si estos keys no existen en tu plan, la
// llamada trae 0 resultados o un 4xx, y se maneja como "no disponible".
const PROP_MARKET_KEYS: Record<string, string> = {
  pass_yards: 'player_pass_yards',
  pass_attempts: 'player_pass_attempts',
  rush_yards: 'player_rush_yards',
  rush_attempts: 'player_rush_attempts',
  anytime_td: 'player_anytime_td',
  rec_yards: 'player_reception_yards',
  receptions: 'player_receptions',
  fg_made: 'player_field_goals',
};

export type PropCategory = keyof typeof PROP_MARKET_KEYS;

/**
 * Trae props de jugadores. Lanza SharpApiPropsUnavailableError si el plan
 * actual no los sirve (404/403) para que el caller pueda degradar el
 * portafolio a "solo equipos" en vez de tronar.
 */
export async function fetchPlayerProps(categories: PropCategory[]): Promise<SharpApiOddsLine[]> {
  const marketTypes = categories.map((c) => PROP_MARKET_KEYS[c]).join(',');
  try {
    const res = await sharpApiGet<SharpApiOddsResponse>('/odds', {
      sport: 'NFL',
      sportsbooks: 'draftkings,fanduel',
      market_type: marketTypes,
    });
    const lines = res.data ?? [];
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

/** Quick healthcheck para el botón "Probar conexión" en la UI de setup. */
export async function testSharpApiConnection(): Promise<{
  moneylineOk: boolean;
  propsOk: boolean;
  error?: string;
}> {
  let moneylineOk = false;
  let propsOk = false;
  let error: string | undefined;

  try {
    const lines = await fetchMoneylineOdds();
    moneylineOk = lines.length > 0;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  try {
    const props = await fetchPlayerProps(['pass_yards']);
    propsOk = props.length > 0;
  } catch {
    propsOk = false;
  }

  return { moneylineOk, propsOk, error };
}
