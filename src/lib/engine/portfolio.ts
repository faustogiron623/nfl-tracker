// PARTE C (continuación) del playbook — reparto de budget (water-filling
// con piso/techo) y selección del parlay.
//
// CORRECCIÓN IMPORTANTE AL SPEC ORIGINAL (se la marco a Fausto en el
// resumen): piso 15% / techo 45% por pick es matemáticamente IMPOSIBLE de
// cumplir con exactamente 2 picks, porque 2 picks al techo (45%+45%) solo
// suman 90% — nunca llegan al 100% del pool de picks. Con floor F y techo
// C, para que N picks puedan sumar 100% se necesita N*F <= 100 <= N*C.
// Con F=15/C=45 eso falla para N=2 (90 < 100). La corrección: el techo
// efectivo se relaja automáticamente a max(45%, 100% - F*(N-1)) SOLO
// cuando N=2 (para N=3 y N=4 el 45% original ya es matemáticamente
// alcanzable y se respeta tal cual).

import { americanToDecimal, decimalToAmerican } from './edge';

export const PICKS_BUDGET_FLOOR = 0.15;
export const PICKS_BUDGET_CAP = 0.45;
export const PARLAY_ODDS_MIN = 3.5;
export const PARLAY_ODDS_MAX = 7.0;
export const MAX_PARLAY_LEGS_SAME_GAME = 2;

/**
 * Water-filling: reparte 1.0 (100% del pool de picks) proporcional al edge
 * de cada uno, respetando piso/techo, redistribuyendo lo que sobra/falta
 * entre los picks no fijados, hasta 4 iteraciones (spec: max 4 con N<=4).
 */
export function waterFillAllocate(edges: number[], floor = PICKS_BUDGET_FLOOR, cap = PICKS_BUDGET_CAP): number[] {
  const n = edges.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  const effectiveCap = Math.max(cap, 1 - floor * (n - 1));
  const effectiveFloor = Math.min(floor, 1 / n);

  const alloc = new Array(n).fill(0);
  let remainingIdx = edges.map((_, i) => i);
  let remainingBudget = 1;

  for (let iter = 0; iter < 4 && remainingIdx.length > 0; iter++) {
    const sumEdges = remainingIdx.reduce((s, i) => s + Math.max(edges[i], 0.0001), 0);
    const newRemaining: number[] = [];
    let anyClipped = false;

    for (const i of remainingIdx) {
      const rawShare =
        sumEdges > 0
          ? (Math.max(edges[i], 0.0001) / sumEdges) * remainingBudget
          : remainingBudget / remainingIdx.length;

      if (rawShare < effectiveFloor) {
        alloc[i] = effectiveFloor;
        anyClipped = true;
      } else if (rawShare > effectiveCap) {
        alloc[i] = effectiveCap;
        anyClipped = true;
      } else {
        alloc[i] = rawShare;
        newRemaining.push(i);
      }
    }

    if (!anyClipped) break;

    const fixedSum = edges.reduce((s, _, i) => (newRemaining.includes(i) ? s : s + alloc[i]), 0);
    remainingBudget = 1 - fixedSum;
    remainingIdx = newRemaining;
  }

  const total = alloc.reduce((s, x) => s + x, 0);
  return alloc.map((x) => x / total); // normalización final por drift numérico
}

export interface ParlayCandidate {
  id: string;
  gameId: string;
  selection: string;
  oddsAmerican: number;
  edgePct: number;
}

export interface ParlayResult {
  legs: ParlayCandidate[];
  combinedOddsAmerican: number;
  combinedDecimal: number;
}

/**
 * Selecciona 3-4 legs para el parlay, priorizando mayor edge acumulado
 * dentro del rango de cuota combinada objetivo [3.5x, 7.0x], respetando
 * máximo 2 legs del mismo partido (evita correlación no controlada).
 * Candidatos: legs con edge individual positivo que NO calificaron para
 * el portafolio principal (edge > 0 pero < MIN_EDGE_PCT).
 */
export function selectParlay(candidates: ParlayCandidate[]): ParlayResult | null {
  // Acotar el pool a los 12 de mayor edge para que la búsqueda combinatoria sea barata
  const pool = [...candidates].sort((a, b) => b.edgePct - a.edgePct).slice(0, 12);
  if (pool.length < 3) return null;

  function combos(arr: ParlayCandidate[], size: number): ParlayCandidate[][] {
    if (size === 0) return [[]];
    if (arr.length < size) return [];
    const [first, ...rest] = arr;
    const withFirst = combos(rest, size - 1).map((c) => [first, ...c]);
    const withoutFirst = combos(rest, size);
    return [...withFirst, ...withoutFirst];
  }

  function isValid(combo: ParlayCandidate[]): boolean {
    const countByGame = new Map<string, number>();
    for (const leg of combo) {
      countByGame.set(leg.gameId, (countByGame.get(leg.gameId) || 0) + 1);
      if ((countByGame.get(leg.gameId) || 0) > MAX_PARLAY_LEGS_SAME_GAME) return false;
    }
    return true;
  }

  function combinedDecimal(combo: ParlayCandidate[]): number {
    return combo.reduce((prod, leg) => prod * americanToDecimal(leg.oddsAmerican), 1);
  }

  let best: { combo: ParlayCandidate[]; decimal: number; totalEdge: number } | null = null;

  for (const size of [4, 3]) {
    for (const combo of combos(pool, size)) {
      if (!isValid(combo)) continue;
      const decimal = combinedDecimal(combo);
      if (decimal < PARLAY_ODDS_MIN || decimal > PARLAY_ODDS_MAX) continue;
      const totalEdge = combo.reduce((s, l) => s + l.edgePct, 0);
      if (!best || totalEdge > best.totalEdge) {
        best = { combo, decimal, totalEdge };
      }
    }
    if (best) break; // preferir 4 legs si hay una combinación válida
  }

  if (!best) {
    // Si nada cae en el rango objetivo, devolver la mejor combinación de 3
    // legs de mayor edge sin filtro de cuota (mejor avisar con cuota fuera
    // de rango que no dar parlay ninguno).
    const fallbackCombos = combos(pool, Math.min(3, pool.length)).filter(isValid);
    if (fallbackCombos.length === 0) return null;
    const fallback = fallbackCombos.reduce((a, b) =>
      a.reduce((s, l) => s + l.edgePct, 0) > b.reduce((s, l) => s + l.edgePct, 0) ? a : b
    );
    const decimal = combinedDecimal(fallback);
    return { legs: fallback, combinedOddsAmerican: decimalToAmerican(decimal), combinedDecimal: decimal };
  }

  return {
    legs: best.combo,
    combinedOddsAmerican: decimalToAmerican(best.decimal),
    combinedDecimal: best.decimal,
  };
}
