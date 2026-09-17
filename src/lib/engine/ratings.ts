// PARTE A del playbook — power ratings de equipo, ajustados por rival,
// con decaimiento exponencial por antigüedad y conversión logística
// calibrada con datos históricos reales (ver /tmp/calibrate.mjs — 2019-2024,
// n=1298 partidos, accuracy 55.5% sobre ganador de temporada regular).
//
// HONESTIDAD: 55.5% de accuracy está apenas sobre el "pick siempre al
// local" (~55-57% base rate histórico de la NFL). Esto es normal para un
// modelo simple de EPA — vencer a Vegas en predicción pura de ganador es
// muy difícil. El edge real de este sistema no viene de "saber más que el
// mercado", sino de comparar la probabilidad del modelo contra el precio
// de un book BLANDO (DraftKings/FanDuel) buscando divergencias puntuales.
// Este archivo calcula la probabilidad del modelo; edge.ts hace la
// comparación contra el mercado.

import {
  NflverseGame,
  NflverseTeamWeekStats,
  fetchAllGames,
  fetchTeamStatsSeason,
} from '../ingest/nflverse';

// Calibrado por regresión logística sobre 2019-2024 (ver comentario arriba).
// Para recalibrar: correr el script de calibración con temporadas más
// recientes y actualizar estos dos valores.
export const CALIBRATION = {
  intercept: 0.223, // home field advantage en espacio logit
  k: 10.0, // pendiente: edge de EPA/jugada -> logit
};

const HALF_LIFE_WEEKS = 4; // peso se reduce a la mitad cada 4 semanas de antigüedad
const MIN_GAMES_FULL_CONFIDENCE = 6; // semanas 1-6: blend con temporada anterior

export interface TeamRating {
  team: string;
  offEpaAdj: number;
  defEpaAdj: number;
  sampleGames: number;
}

function epaPerPlay(row: NflverseTeamWeekStats | undefined): number | null {
  if (!row) return null;
  const plays = (row.attempts || 0) + (row.carries || 0);
  if (plays === 0) return null;
  return ((row.passing_epa || 0) + (row.rushing_epa || 0)) / plays;
}

function decayWeight(gameWeek: number, currentWeek: number): number {
  const age = Math.max(0, currentWeek - gameWeek);
  return Math.pow(0.5, age / HALF_LIFE_WEEKS);
}

/**
 * Calcula power ratings opponent-adjusted para todos los equipos, como se
 * verían ANTES de la semana `week` de la temporada `season` (usa solo
 * semanas 1..week-1, sin fuga de datos). Si week <= 6, hace blend con el
 * rating final de la temporada anterior, peso = partidos_jugados/6.
 */
export async function computeTeamRatings(season: number, week: number): Promise<TeamRating[]> {
  const [currentStats, allGames] = await Promise.all([
    fetchTeamStatsSeason(season),
    fetchAllGames(),
  ]);

  const regCurrent = currentStats.filter((r) => r.season_type === 'REG' && r.week < week);
  const teams = Array.from(new Set(regCurrent.map((r) => r.team))).sort();

  if (teams.length === 0) {
    throw new Error(
      `No hay datos de stats_team_week_${season}.csv para semanas anteriores a ${week}. ` +
        `¿Es la semana 1 de una temporada que todavía no arranca?`
    );
  }

  // Índice rápido: team+week -> row (para lookup de "qué le hicieron a X")
  const byTeamWeek = new Map<string, NflverseTeamWeekStats>();
  for (const r of regCurrent) byTeamWeek.set(`${r.team}_${r.week}`, r);

  const byOpponentWeek = new Map<string, NflverseTeamWeekStats[]>();
  for (const r of regCurrent) {
    const k = `${r.opponent_team}_${r.week}`;
    if (!byOpponentWeek.has(k)) byOpponentWeek.set(k, []);
    byOpponentWeek.get(k)!.push(r);
  }

  // Paso 0: rating crudo (sin ajuste por rival), decay-weighted
  const raw = new Map<string, { off: number; def: number; games: number }>();
  for (const team of teams) {
    let offNum = 0, offDen = 0, defNum = 0, defDen = 0, games = 0;
    for (let w = 1; w < week; w++) {
      const wgt = decayWeight(w, week);
      const offRow = byTeamWeek.get(`${team}_${w}`);
      const off = epaPerPlay(offRow);
      if (off !== null) {
        offNum += off * wgt;
        offDen += wgt;
        games++;
      }
      // defensa: lo que el rival anotó/produjo contra `team` esa semana
      const oppRows = byOpponentWeek.get(`${team}_${w}`) ?? [];
      for (const oppRow of oppRows) {
        const def = epaPerPlay(oppRow);
        if (def !== null) {
          defNum += def * wgt;
          defDen += wgt;
        }
      }
    }
    raw.set(team, {
      off: offDen > 0 ? offNum / offDen : 0,
      def: defDen > 0 ? defNum / defDen : 0,
      games,
    });
  }

  const leagueAvgOff =
    Array.from(raw.values()).reduce((s, r) => s + r.off, 0) / Math.max(1, raw.size);
  const leagueAvgDef =
    Array.from(raw.values()).reduce((s, r) => s + r.def, 0) / Math.max(1, raw.size);

  // Pasadas iterativas de ajuste por rival (estilo SRS simplificado)
  let adjOff = new Map(teams.map((t) => [t, raw.get(t)!.off]));
  let adjDef = new Map(teams.map((t) => [t, raw.get(t)!.def]));

  for (let pass = 0; pass < 4; pass++) {
    const nextOff = new Map<string, number>();
    const nextDef = new Map<string, number>();

    for (const team of teams) {
      let offNum = 0, offDen = 0, defNum = 0, defDen = 0;
      for (let w = 1; w < week; w++) {
        const wgt = decayWeight(w, week);
        const offRow = byTeamWeek.get(`${team}_${w}`);
        if (offRow) {
          const opp = offRow.opponent_team;
          const oppDef = adjDef.get(opp) ?? leagueAvgDef;
          const off = epaPerPlay(offRow);
          if (off !== null) {
            // "off ajustado" = qué tan bien lo hizo vs. lo que se esperaría contra una defensa promedio
            offNum += (off - (oppDef - leagueAvgDef)) * wgt;
            offDen += wgt;
          }
        }
        const oppRows = byOpponentWeek.get(`${team}_${w}`) ?? [];
        for (const oppRow of oppRows) {
          const opp = oppRow.team;
          const oppOff = adjOff.get(opp) ?? leagueAvgOff;
          const def = epaPerPlay(oppRow);
          if (def !== null) {
            defNum += (def - (oppOff - leagueAvgOff)) * wgt;
            defDen += wgt;
          }
        }
      }
      nextOff.set(team, offDen > 0 ? offNum / offDen : leagueAvgOff);
      nextDef.set(team, defDen > 0 ? defNum / defDen : leagueAvgDef);
    }
    adjOff = nextOff;
    adjDef = nextDef;
  }

  // Blend con temporada anterior si estamos en semanas 1-6
  let prevRatings: Map<string, TeamRating> | null = null;
  if (week <= MIN_GAMES_FULL_CONFIDENCE) {
    try {
      prevRatings = await computeFinalSeasonRatings(season - 1, allGames);
    } catch {
      prevRatings = null; // si no hay temporada anterior (ej. proyecto nuevo), seguimos sin blend
    }
  }

  return teams.map((team) => {
    const gamesPlayed = raw.get(team)!.games;
    let offEpaAdj = adjOff.get(team) ?? leagueAvgOff;
    let defEpaAdj = adjDef.get(team) ?? leagueAvgDef;

    if (prevRatings && week <= MIN_GAMES_FULL_CONFIDENCE) {
      const prev = prevRatings.get(team);
      if (prev) {
        const wCurrent = Math.min(1, gamesPlayed / MIN_GAMES_FULL_CONFIDENCE);
        offEpaAdj = offEpaAdj * wCurrent + prev.offEpaAdj * (1 - wCurrent);
        defEpaAdj = defEpaAdj * wCurrent + prev.defEpaAdj * (1 - wCurrent);
      }
    }

    return { team, offEpaAdj, defEpaAdj, sampleGames: gamesPlayed };
  });
}

/** Rating final (post-semana 18) de una temporada completa, para blend de inicio de temporada siguiente. */
async function computeFinalSeasonRatings(
  season: number,
  _allGames: NflverseGame[]
): Promise<Map<string, TeamRating>> {
  const ratings = await computeTeamRatings(season, 19); // semana 19 = "después de toda la regular season"
  return new Map(ratings.map((r) => [r.team, r]));
}

/**
 * Edge de matchup + ajuste de local. NO incluye ajustes situacionales
 * (clima, descanso, lesiones) — eso lo aplica situational.ts encima de esto.
 */
export function computeBaseEdge(home: TeamRating, away: TeamRating): number {
  return home.offEpaAdj - away.defEpaAdj - (away.offEpaAdj - home.defEpaAdj);
}

/** Convierte edge (ya con todos los ajustes situacionales aplicados) a probabilidad de victoria del home team. */
export function edgeToHomeWinProb(edgeWithAdjustments: number): number {
  const z = CALIBRATION.intercept + CALIBRATION.k * edgeWithAdjustments;
  return 1 / (1 + Math.exp(-z));
}
