// Ajustes situacionales codificados con número exacto, tal como lo pidió
// el playbook — nada de "restar un poco". Estos números son puntos de
// partida razonables basados en literatura pública de análisis NFL
// (footballoutsiders/PFF-style), NO recalibrados con backtesting propio
// todavía. Están centralizados aquí para que ajustarlos después de ver
// resultados reales sea un cambio en un solo archivo.

import { NflverseGame } from '../ingest/nflverse';

export interface SituationalAdjustment {
  label: string;
  homeDelta: number; // se suma al edge (positivo ayuda al home)
  awayDelta: number; // ídem para el away, en la misma escala de edge
}

const REST_SHORT_PENALTY = -0.03; // EPA/jugada, descanso < 6 días
const REST_BYE_BONUS = 0.02; // 10+ días de descanso (post-bye)
const WIND_MODERATE_PASS_MULT = 0.92; // >15mph
const WIND_HIGH_PASS_MULT = 0.85; // >20mph
const PRECIP_PASS_MULT = 0.95;
const PRECIP_RUSH_MULT = 1.05;
const QB_OUT_PENALTY = -0.12; // el ajuste individual más grande, por lejos
const SKILL_PLAYER_OUT_PENALTY = -0.02; // RB1/WR1 titular fuera
const PASS_RUSHER_OUT_BONUS = 0.03; // EDGE1 rival fuera → ayuda a la ofensiva contraria
const DIVISIONAL_DAMPENING = 0.9; // multiplicador sobre el edge total

export interface GameContext {
  game: NflverseGame;
  homeQbOut: boolean;
  awayQbOut: boolean;
  homeSkillPlayerOut: boolean;
  awaySkillPlayerOut: boolean;
  homePassRusherOut: boolean; // ayuda a la ofensiva AWAY
  awayPassRusherOut: boolean; // ayuda a la ofensiva HOME
}

export interface SituationalResult {
  adjustedEdge: number;
  breakdown: SituationalAdjustment[];
}

/**
 * Aplica todos los ajustes situacionales sobre un edge base (ya calculado
 * por ratings.ts) y devuelve el edge final + el desglose (usado luego por
 * reasoning.ts para armar los bullets).
 */
export function applySituationalAdjustments(baseEdge: number, ctx: GameContext): SituationalResult {
  const breakdown: SituationalAdjustment[] = [];
  let edge = baseEdge;

  // --- Descanso ---
  const homeRest = ctx.game.home_rest ?? 7;
  const awayRest = ctx.game.away_rest ?? 7;

  if (homeRest < 6) {
    edge += REST_SHORT_PENALTY;
    breakdown.push({ label: `Local con descanso corto (${homeRest}d)`, homeDelta: REST_SHORT_PENALTY, awayDelta: 0 });
  } else if (homeRest >= 10) {
    edge += REST_BYE_BONUS;
    breakdown.push({ label: `Local post-bye (${homeRest}d de descanso)`, homeDelta: REST_BYE_BONUS, awayDelta: 0 });
  }
  if (awayRest < 6) {
    edge -= REST_SHORT_PENALTY; // penaliza al away = ayuda al edge del home
    breakdown.push({ label: `Visitante con descanso corto (${awayRest}d)`, homeDelta: 0, awayDelta: REST_SHORT_PENALTY });
  } else if (awayRest >= 10) {
    edge -= REST_BYE_BONUS;
    breakdown.push({ label: `Visitante post-bye (${awayRest}d de descanso)`, homeDelta: 0, awayDelta: REST_BYE_BONUS });
  }

  // --- Clima (afecta a AMBOS equipos por igual, así que no mueve el edge
  //     relativo salvo que un equipo dependa mucho más del pase — eso lo
  //     dejamos para el módulo de props, aquí solo documentamos el factor) ---
  const wind = ctx.game.wind ?? 0;
  const isDome = ctx.game.roof === 'dome' || ctx.game.roof === 'closed';
  if (!isDome && wind > 20) {
    breakdown.push({ label: `Viento fuerte (${wind}mph) — reduce eficiencia de pase de ambos equipos`, homeDelta: 0, awayDelta: 0 });
  } else if (!isDome && wind > 15) {
    breakdown.push({ label: `Viento moderado (${wind}mph)`, homeDelta: 0, awayDelta: 0 });
  }

  // --- Lesiones ---
  if (ctx.homeQbOut) {
    edge += QB_OUT_PENALTY;
    breakdown.push({ label: 'QB titular local fuera', homeDelta: QB_OUT_PENALTY, awayDelta: 0 });
  }
  if (ctx.awayQbOut) {
    edge -= QB_OUT_PENALTY;
    breakdown.push({ label: 'QB titular visitante fuera', homeDelta: 0, awayDelta: QB_OUT_PENALTY });
  }
  if (ctx.homeSkillPlayerOut) {
    edge += SKILL_PLAYER_OUT_PENALTY;
    breakdown.push({ label: 'RB1/WR1 titular local fuera', homeDelta: SKILL_PLAYER_OUT_PENALTY, awayDelta: 0 });
  }
  if (ctx.awaySkillPlayerOut) {
    edge -= SKILL_PLAYER_OUT_PENALTY;
    breakdown.push({ label: 'RB1/WR1 titular visitante fuera', homeDelta: 0, awayDelta: SKILL_PLAYER_OUT_PENALTY });
  }
  if (ctx.homePassRusherOut) {
    // EDGE1 del HOME fuera → ayuda a la ofensiva AWAY → resta al edge del home
    edge -= PASS_RUSHER_OUT_BONUS;
    breakdown.push({ label: 'EDGE1 local fuera (ayuda a la ofensiva visitante)', homeDelta: -PASS_RUSHER_OUT_BONUS, awayDelta: 0 });
  }
  if (ctx.awayPassRusherOut) {
    edge += PASS_RUSHER_OUT_BONUS;
    breakdown.push({ label: 'EDGE1 visitante fuera (ayuda a la ofensiva local)', homeDelta: PASS_RUSHER_OUT_BONUS, awayDelta: 0 });
  }

  // --- Divisional / revancha: amortigua el edge total ---
  if (ctx.game.div_game === 1) {
    edge *= DIVISIONAL_DAMPENING;
    breakdown.push({ label: 'Partido divisional (edge amortiguado x0.9)', homeDelta: 0, awayDelta: 0 });
  }

  return { adjustedEdge: edge, breakdown };
}

/** Multiplicadores de clima para usar en el módulo de props (yardas de pase/carrera). */
export function weatherMultipliers(game: NflverseGame): { passMult: number; rushMult: number } {
  const isDome = game.roof === 'dome' || game.roof === 'closed';
  if (isDome) return { passMult: 1, rushMult: 1 };

  let passMult = 1;
  let rushMult = 1;
  const wind = game.wind ?? 0;

  if (wind > 20) passMult *= WIND_HIGH_PASS_MULT;
  else if (wind > 15) passMult *= WIND_MODERATE_PASS_MULT;

  // nflverse no trae "precip" directo en games.csv; se infiere de temp/wind
  // combinados con condiciones extremas como proxy razonable hasta que se
  // conecte una fuente de clima dedicada (ver nota en ingest/nflverse.ts).
  const temp = game.temp;
  if (temp !== null && temp !== undefined && temp <= 32 && wind > 10) {
    passMult *= PRECIP_PASS_MULT;
    rushMult *= PRECIP_RUSH_MULT;
  }

  return { passMult, rushMult };
}
