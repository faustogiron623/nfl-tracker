// PARTE C del playbook — conversión de odds, de-vig, edge, y umbral mínimo.

/** American odds -> probabilidad implícita (con vig incluido). */
export function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

export function americanToDecimal(odds: number): number {
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / -odds;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

/**
 * De-vig proporcional (método estándar, no el más preciso — Pinnacle usa
 * un método más sofisticado (Shin), pero de-vig proporcional es suficiente
 * y simple para un two-way market como moneyline/over-under de props).
 * fair_prob_A = implied_A / (implied_A + implied_B)
 */
export function deVigTwoWay(oddsA: number, oddsB: number): { fairProbA: number; fairProbB: number } {
  const impliedA = americanToImpliedProb(oddsA);
  const impliedB = americanToImpliedProb(oddsB);
  const total = impliedA + impliedB;
  return { fairProbA: impliedA / total, fairProbB: impliedB / total };
}

export const MIN_EDGE_PCT = 3; // umbral mínimo de EV% para calificar

export interface EdgeEvaluation {
  modelProb: number;
  fairMarketProb: number;
  edgePct: number; // (modelProb - fairMarketProb) / fairMarketProb * 100 -- EV%
  qualifies: boolean;
}

/**
 * EV% = (probabilidad del modelo / probabilidad justa del mercado - 1) * 100
 * Ejemplo: modelo dice 60%, el mercado (de-vigged) dice 54% -> EV% = 11.1%
 */
export function evaluateEdge(modelProb: number, fairMarketProb: number): EdgeEvaluation {
  const edgePct = ((modelProb - fairMarketProb) / fairMarketProb) * 100;
  return {
    modelProb,
    fairMarketProb,
    edgePct,
    qualifies: edgePct >= MIN_EDGE_PCT,
  };
}
