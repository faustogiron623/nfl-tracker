// Ingesta de datos públicos de nflverse (github.com/nflverse/nflverse-data).
// Todo son archivos CSV servidos como "release assets" de GitHub, sin API
// key ni Python — se leen directo por HTTP y se parsean con papaparse.
//
// URLs verificadas manualmente (ver notas junto a cada función). El patrón
// general es:
//   https://github.com/nflverse/nflverse-data/releases/download/<tag>/<archivo>
//
// nflverse actualiza estos releases automáticamente unas horas después de
// que terminan los partidos, así que para la semana en curso los datos de
// esta semana estarán incompletos hasta que se jueguen los partidos — lo
// cual es correcto: el análisis de la semana N usa datos consolidados de
// las semanas 1..N-1 más el roster/injuries actual de la semana N.

import Papa from 'papaparse';

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

async function fetchCsv<T = Record<string, string>>(url: string): Promise<T[]> {
  const res = await fetch(url, {
    // nflverse releases no cambian retroactivamente para temporadas
    // pasadas; la temporada actual sí, así que dejamos que Next cachee
    // corto (1 hora) en vez de per-request.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`nflverse fetch failed: ${url} -> HTTP ${res.status}`);
  }
  const text = await res.text();
  const parsed = Papa.parse<T>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    // papaparse reporta errores fila-por-fila típicamente por columnas
    // irregulares al final del archivo; no son fatales, solo los logueamos.
    console.warn(`nflverse CSV parse warnings for ${url}:`, parsed.errors.slice(0, 3));
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Schedules / games — un solo archivo con TODAS las temporadas desde 1999.
// Confirmado: /schedules/games.csv (NO sched_<year>.csv, eso da 404)
// ---------------------------------------------------------------------------
export interface NflverseGame {
  game_id: string;
  season: number;
  game_type: string;
  week: number;
  gameday: string;
  gametime: string | null;
  away_team: string;
  home_team: string;
  away_score: number | null;
  home_score: number | null;
  away_rest: number | null;
  home_rest: number | null;
  div_game: number; // 0 | 1
  roof: string | null; // 'dome' | 'outdoors' | 'closed' | 'open'
  surface: string | null;
  temp: number | null;
  wind: number | null;
  away_moneyline: number | null;
  home_moneyline: number | null;
  spread_line: number | null;
  total_line: number | null;
  away_qb_name: string | null;
  home_qb_name: string | null;
}

let _gamesCache: NflverseGame[] | null = null;

export async function fetchAllGames(): Promise<NflverseGame[]> {
  if (_gamesCache) return _gamesCache;
  const rows = await fetchCsv<NflverseGame>(`${BASE}/schedules/games.csv`);
  _gamesCache = rows;
  return rows;
}

export async function fetchGamesForWeek(season: number, week: number): Promise<NflverseGame[]> {
  const all = await fetchAllGames();
  return all.filter((g) => g.season === season && g.week === week && g.game_type === 'REG');
}

/** Historial de un equipo hasta (sin incluir) la semana dada, para calcular rest days, forma reciente, etc. */
export async function fetchTeamHistory(season: number, beforeWeek: number): Promise<NflverseGame[]> {
  const all = await fetchAllGames();
  return all.filter((g) => g.season === season && g.week < beforeWeek && g.game_type === 'REG');
}

// ---------------------------------------------------------------------------
// Player weekly stats — un archivo por temporada.
// Confirmado: /stats_player/stats_player_week_<year>.csv
// ---------------------------------------------------------------------------
export interface NflversePlayerWeekStats {
  player_id: string;
  player_display_name: string;
  position: string;
  season: number;
  week: number;
  season_type: string;
  team: string;
  opponent_team: string;
  completions: number | null;
  attempts: number | null;
  passing_yards: number | null;
  passing_tds: number | null;
  passing_epa: number | null;
  carries: number | null;
  rushing_yards: number | null;
  rushing_tds: number | null;
  rushing_epa: number | null;
  receptions: number | null;
  targets: number | null;
  receiving_yards: number | null;
  receiving_tds: number | null;
  receiving_epa: number | null;
  target_share: number | null;
  air_yards_share: number | null;
  wopr: number | null;
}

const _playerStatsCache = new Map<number, NflversePlayerWeekStats[]>();

export async function fetchPlayerStatsSeason(season: number): Promise<NflversePlayerWeekStats[]> {
  const cached = _playerStatsCache.get(season);
  if (cached) return cached;
  const rows = await fetchCsv<NflversePlayerWeekStats>(
    `${BASE}/stats_player/stats_player_week_${season}.csv`
  );
  _playerStatsCache.set(season, rows);
  return rows;
}

// ---------------------------------------------------------------------------
// Team weekly stats — usado para EPA ofensivo/defensivo por equipo.
// Confirmado: /stats_team/stats_team_week_<year>.csv
// Ojo: cada fila es la ofensiva de `team` contra `opponent_team`. Para
// obtener lo que un equipo PERMITE (su defensa), se filtra por
// opponent_team = X y se promedian los valores de esas filas (que
// representan la ofensiva rival contra X).
// ---------------------------------------------------------------------------
export interface NflverseTeamWeekStats {
  season: number;
  week: number;
  team: string;
  opponent_team: string;
  season_type: string;
  attempts: number | null;
  passing_yards: number | null;
  passing_epa: number | null;
  carries: number | null;
  rushing_yards: number | null;
  rushing_epa: number | null;
}

const _teamStatsCache = new Map<number, NflverseTeamWeekStats[]>();

export async function fetchTeamStatsSeason(season: number): Promise<NflverseTeamWeekStats[]> {
  const cached = _teamStatsCache.get(season);
  if (cached) return cached;
  const rows = await fetchCsv<NflverseTeamWeekStats>(
    `${BASE}/stats_team/stats_team_week_${season}.csv`
  );
  _teamStatsCache.set(season, rows);
  return rows;
}

// ---------------------------------------------------------------------------
// Injuries — reporte semanal de lesiones (practice report + game status)
// Confirmado: /injuries/injuries_<year>.csv
// ---------------------------------------------------------------------------
export interface NflverseInjury {
  season: number;
  week: number;
  team: string;
  gsis_id: string;
  full_name: string;
  position: string;
  report_status: string | null; // 'Out' | 'Doubtful' | 'Questionable' | null
  report_primary_injury: string | null;
}

export async function fetchInjuriesWeek(season: number, week: number): Promise<NflverseInjury[]> {
  const rows = await fetchCsv<NflverseInjury>(`${BASE}/injuries/injuries_${season}.csv`);
  return rows.filter((r) => r.season === season && r.week === week);
}

// ---------------------------------------------------------------------------
// Weekly rosters — depth chart position + status, usado para detectar
// cambios de rol semana a semana (ej. un RB2 que sube a RB1 por lesión).
// Confirmado: /weekly_rosters/roster_weekly_<year>.csv
// ---------------------------------------------------------------------------
export interface NflverseRosterEntry {
  season: number;
  week: number;
  team: string;
  gsis_id: string;
  full_name: string;
  position: string;
  depth_chart_position: string | null;
  status: string; // 'ACT' | 'RES' | 'DEV' | ...
}

export async function fetchRosterWeek(season: number, week: number): Promise<NflverseRosterEntry[]> {
  const rows = await fetchCsv<NflverseRosterEntry>(
    `${BASE}/weekly_rosters/roster_weekly_${season}.csv`
  );
  return rows.filter((r) => r.season === season && r.week === week);
}
