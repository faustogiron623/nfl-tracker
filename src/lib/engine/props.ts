// PARTE B del playbook — modelo de props de jugadores.
//
// Distribuciones:
// - Yardas (pase/carrera/recepción): Normal. La yardagem por jugada NFL es
//   aproximadamente simétrica alrededor de la media para una muestra de
//   ~15-30 intentos/targets por partido (CLT ya aplica razonablemente),
//   así que Normal es una aproximación estándar y common practice en la
//   industria (mejor que lognormal para líneas medias, evita la
//   complejidad extra sin ganancia real a este volumen de intentos).
// - TD anytime / FG made: Poisson. Eventos raros y discretos por partido,
//   Poisson es el estándar para conteos de baja frecuencia.
//
// Inputs de cada distribución: volumen (EWMA de target/carry/attempt share
// del jugador, half-life corto de 2 semanas para capturar cambios de rol
// por lesión) x eficiencia ajustada por la defensa RIVAL específica en esa
// categoría (yardas de pase permitidas vs. yardas de carrera permitidas,
// tal como pediste) x multiplicador de clima.

import { NflversePlayerWeekStats, NflverseTeamWeekStats } from '../ingest/nflverse';

const ROLE_HALF_LIFE_WEEKS = 2; // corto: capturar cambios de rol rápido
const YARDAGE_CV = 0.38; // coeficiente de variación típico para props de yardas (sd = mean * CV)

function decayWeight(gameWeek: number, currentWeek: number, halfLife: number): number {
  const age = Math.max(0, currentWeek - gameWeek);
  return Math.pow(0.5, age / halfLife);
}

function ewma(values: { week: number; value: number }[], currentWeek: number, halfLife: number): number {
  let num = 0, den = 0;
  for (const { week, value } of values) {
    const w = decayWeight(week, currentWeek, halfLife);
    num += value * w;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

// ---------------------------------------------------------------------------
// Factores defensivos por equipo: cuánto permite cada equipo en cada
// categoría, como RATIO contra el promedio de la liga (1.0 = promedio,
// 1.15 = permite 15% más de lo normal). Se calcula una vez por semana y se
// reutiliza para todas las props de esa semana.
// ---------------------------------------------------------------------------
export interface DefensiveFactors {
  passYardsPerAttemptAllowed: Record<string, number>; // ratio vs liga
  rushYardsPerCarryAllowed: Record<string, number>;
  recYardsPerTargetAllowed: Record<string, number>;
}

export function computeDefensiveFactors(
  teamStats: NflverseTeamWeekStats[],
  currentWeek: number
): DefensiveFactors {
  const past = teamStats.filter((r) => r.season_type === 'REG' && r.week < currentWeek);
  const teams = Array.from(new Set(past.map((r) => r.team)));

  // Para cada equipo, "lo que permite" = agregando las filas donde
  // opponent_team = ese equipo (la ofensiva rival contra él).
  const passYdsPerAtt: Record<string, number> = {};
  const rushYdsPerCarry: Record<string, number> = {};
  const recYdsPerTarget: Record<string, number> = {};

  let leaguePassSum = 0, leaguePassN = 0;
  let leagueRushSum = 0, leagueRushN = 0;
  let leagueRecSum = 0, leagueRecN = 0;

  for (const team of teams) {
    const allowedRows = past.filter((r) => r.opponent_team === team);
    let passYds = 0, passAtt = 0, rushYds = 0, carries = 0, recYds = 0, targets = 0;
    for (const r of allowedRows) {
      const w = decayWeight(r.week, currentWeek, 4);
      passYds += (r.passing_yards || 0) * w;
      passAtt += (r.attempts || 0) * w;
      rushYds += (r.rushing_yards || 0) * w;
      carries += (r.carries || 0) * w;
      // usamos passing_yards como proxy de receiving yards permitidas (son el mismo total)
      recYds += (r.passing_yards || 0) * w;
      targets += (r.attempts || 0) * w;
    }
    const passRate = passAtt > 0 ? passYds / passAtt : null;
    const rushRate = carries > 0 ? rushYds / carries : null;
    const recRate = targets > 0 ? recYds / targets : null;

    if (passRate !== null) { passYdsPerAtt[team] = passRate; leaguePassSum += passRate; leaguePassN++; }
    if (rushRate !== null) { rushYdsPerCarry[team] = rushRate; leagueRushSum += rushRate; leagueRushN++; }
    if (recRate !== null) { recYdsPerTarget[team] = recRate; leagueRecSum += recRate; leagueRecN++; }
  }

  const leaguePassAvg = leaguePassN > 0 ? leaguePassSum / leaguePassN : 7;
  const leagueRushAvg = leagueRushN > 0 ? leagueRushSum / leagueRushN : 4.3;
  const leagueRecAvg = leagueRecN > 0 ? leagueRecSum / leagueRecN : 7;

  const toRatio = (obj: Record<string, number>, avg: number) => {
    const out: Record<string, number> = {};
    for (const [team, val] of Object.entries(obj)) out[team] = val / avg;
    return out;
  };

  return {
    passYardsPerAttemptAllowed: toRatio(passYdsPerAtt, leaguePassAvg),
    rushYardsPerCarryAllowed: toRatio(rushYdsPerCarry, leagueRushAvg),
    recYardsPerTargetAllowed: toRatio(recYdsPerTarget, leagueRecAvg),
  };
}

export interface PropProjection {
  distribution: 'normal' | 'poisson';
  mean: number;
  sd?: number;
  lambda?: number;
  inputs: Record<string, number>; // para armar los bullets de razonamiento
}

function playerGamesBefore(
  stats: NflversePlayerWeekStats[],
  playerId: string,
  currentWeek: number
): NflversePlayerWeekStats[] {
  return stats.filter((r) => r.player_id === playerId && r.week < currentWeek && r.season_type === 'REG');
}

export function projectPassYards(
  playerStats: NflversePlayerWeekStats[],
  playerId: string,
  currentWeek: number,
  opponent: string,
  defFactors: DefensiveFactors,
  weatherPassMult: number
): PropProjection | null {
  const games = playerGamesBefore(playerStats, playerId, currentWeek);
  if (games.length < 2) return null;

  const attemptsSeries = games.map((g) => ({ week: g.week, value: g.attempts || 0 }));
  const ypaSeries = games
    .filter((g) => (g.attempts || 0) > 0)
    .map((g) => ({ week: g.week, value: (g.passing_yards || 0) / (g.attempts || 1) }));

  const projAttempts = ewma(attemptsSeries, currentWeek, ROLE_HALF_LIFE_WEEKS);
  const baseYpa = ewma(ypaSeries, currentWeek, ROLE_HALF_LIFE_WEEKS);
  const defRatio = defFactors.passYardsPerAttemptAllowed[opponent] ?? 1;

  const mean = projAttempts * baseYpa * defRatio * weatherPassMult;
  return {
    distribution: 'normal',
    mean,
    sd: mean * YARDAGE_CV,
    inputs: { projAttempts, baseYpa, defRatio, weatherPassMult },
  };
}

export function projectRushYards(
  playerStats: NflversePlayerWeekStats[],
  teamStats: NflverseTeamWeekStats[],
  playerId: string,
  team: string,
  currentWeek: number,
  opponent: string,
  defFactors: DefensiveFactors,
  weatherRushMult: number
): PropProjection | null {
  const games = playerGamesBefore(playerStats, playerId, currentWeek);
  if (games.length < 2) return null;

  const teamCarriesSeries = teamStats
    .filter((r) => r.team === team && r.week < currentWeek && r.season_type === 'REG')
    .map((r) => ({ week: r.week, value: r.carries || 0 }));
  const projTeamCarries = ewma(teamCarriesSeries, currentWeek, 4);

  const shareSeries = games
    .filter((g) => (g.carries ?? null) !== null)
    .map((g) => {
      const teamRow = teamStats.find((r) => r.team === team && r.week === g.week && r.season_type === 'REG');
      const teamCarries = teamRow?.carries || 1;
      return { week: g.week, value: (g.carries || 0) / teamCarries };
    });
  const projShare = ewma(shareSeries, currentWeek, ROLE_HALF_LIFE_WEEKS);

  const yprSeries = games
    .filter((g) => (g.carries || 0) > 0)
    .map((g) => ({ week: g.week, value: (g.rushing_yards || 0) / (g.carries || 1) }));
  const baseYpc = ewma(yprSeries, currentWeek, ROLE_HALF_LIFE_WEEKS);

  const defRatio = defFactors.rushYardsPerCarryAllowed[opponent] ?? 1;
  const projCarries = projTeamCarries * projShare;
  const mean = projCarries * baseYpc * defRatio * weatherRushMult;

  return {
    distribution: 'normal',
    mean,
    sd: mean * YARDAGE_CV,
    inputs: { projCarries, baseYpc, defRatio, weatherRushMult, projShare },
  };
}

export function projectReceivingYards(
  playerStats: NflversePlayerWeekStats[],
  teamStats: NflverseTeamWeekStats[],
  playerId: string,
  team: string,
  currentWeek: number,
  opponent: string,
  defFactors: DefensiveFactors,
  weatherPassMult: number
): PropProjection | null {
  const games = playerGamesBefore(playerStats, playerId, currentWeek);
  if (games.length < 2) return null;

  const teamAttemptsSeries = teamStats
    .filter((r) => r.team === team && r.week < currentWeek && r.season_type === 'REG')
    .map((r) => ({ week: r.week, value: r.attempts || 0 }));
  const projTeamAttempts = ewma(teamAttemptsSeries, currentWeek, 4);

  const targetShareSeries = games
    .map((g) => ({ week: g.week, value: g.target_share ?? 0 }))
    .filter((g) => g.value > 0);
  const projTargetShare = ewma(targetShareSeries, currentWeek, ROLE_HALF_LIFE_WEEKS);

  const yptSeries = games
    .filter((g) => (g.targets || 0) > 0)
    .map((g) => ({ week: g.week, value: (g.receiving_yards || 0) / (g.targets || 1) }));
  const baseYpt = ewma(yptSeries, currentWeek, ROLE_HALF_LIFE_WEEKS);

  const defRatio = defFactors.recYardsPerTargetAllowed[opponent] ?? 1;
  const projTargets = projTeamAttempts * projTargetShare;
  const mean = projTargets * baseYpt * defRatio * weatherPassMult;

  return {
    distribution: 'normal',
    mean,
    sd: mean * YARDAGE_CV,
    inputs: { projTargets, baseYpt, defRatio, weatherPassMult, projTargetShare },
  };
}

export function projectReceptions(
  playerStats: NflversePlayerWeekStats[],
  playerId: string,
  currentWeek: number
): PropProjection | null {
  const games = playerGamesBefore(playerStats, playerId, currentWeek);
  if (games.length < 2) return null;
  const recSeries = games.map((g) => ({ week: g.week, value: g.receptions || 0 }));
  const mean = ewma(recSeries, currentWeek, ROLE_HALF_LIFE_WEEKS);
  return { distribution: 'normal', mean, sd: mean * 0.3, inputs: { mean } };
}

export function projectAnytimeTd(
  playerStats: NflversePlayerWeekStats[],
  playerId: string,
  currentWeek: number,
  positionGroup: 'rush' | 'rec'
): PropProjection | null {
  const games = playerGamesBefore(playerStats, playerId, currentWeek);
  if (games.length < 2) return null;
  const tdSeries = games.map((g) => ({
    week: g.week,
    value: positionGroup === 'rush' ? g.rushing_tds || 0 : g.receiving_tds || 0,
  }));
  const lambda = Math.max(0.05, ewma(tdSeries, currentWeek, ROLE_HALF_LIFE_WEEKS));
  return { distribution: 'poisson', mean: lambda, lambda, inputs: { lambda } };
}

export function poissonProbAtLeastOne(lambda: number): number {
  return 1 - Math.exp(-lambda);
}

// Normal CDF (aproximación Abramowitz-Stegun)
export function normalCdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return x >= mean ? 1 : 0;
  const z = (x - mean) / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

/** P(over line) para una prop de yardas modelada como Normal. */
export function probOverLine(projection: PropProjection, line: number): number {
  if (projection.distribution === 'poisson' && projection.lambda !== undefined) {
    // para props tipo "TD anytime" la "línea" no aplica; se usa poissonProbAtLeastOne aparte
    return poissonProbAtLeastOne(projection.lambda);
  }
  return 1 - normalCdf(line, projection.mean, projection.sd || projection.mean * YARDAGE_CV);
}
