// PARTE D del playbook — bullets de razonamiento generados por template,
// CERO LLM. Rankea los factores de mayor magnitud numérica detrás de cada
// pick y los rellena en frases fijas.

import { SituationalAdjustment } from './situational';

export function buildMoneylineReasoning(
  edgePct: number,
  situational: SituationalAdjustment[],
  homeTeam: string,
  awayTeam: string,
  pickedHome: boolean
): string[] {
  const bullets: string[] = [];
  const favoredTeam = pickedHome ? homeTeam : awayTeam;

  bullets.push(
    `${favoredTeam} tiene un edge de EPA ajustado por rival de ${edgePct >= 0 ? '+' : ''}${edgePct.toFixed(1)}% sobre la probabilidad de mercado.`
  );

  // Rankear los 2 ajustes situacionales de mayor |delta|
  const ranked = [...situational]
    .map((s) => ({ ...s, magnitude: Math.abs(s.homeDelta) + Math.abs(s.awayDelta) }))
    .sort((a, b) => b.magnitude - a.magnitude)
    .filter((s) => s.magnitude > 0)
    .slice(0, 2);

  for (const r of ranked) {
    bullets.push(r.label);
  }

  if (bullets.length < 2) {
    bullets.push('Sin ajustes situacionales relevantes esta semana (sin lesiones clave reportadas, descanso normal).');
  }

  return bullets.slice(0, 3);
}

export function buildPropReasoning(
  playerName: string,
  marketLabel: string,
  line: number | null,
  projectionInputs: Record<string, number>,
  edgePct: number,
  opponent: string
): string[] {
  const bullets: string[] = [];
  bullets.push(
    `${playerName} — ${marketLabel}${line !== null ? ` (línea ${line})` : ''}: edge de ${edgePct >= 0 ? '+' : ''}${edgePct.toFixed(1)}% vs. mercado.`
  );

  if (projectionInputs.defRatio !== undefined) {
    const pct = ((projectionInputs.defRatio - 1) * 100).toFixed(0);
    const direction = projectionInputs.defRatio > 1 ? 'permite más de lo normal' : 'permite menos de lo normal';
    bullets.push(`${opponent} ${direction} en esta categoría (${pct}% vs. promedio de liga).`);
  }
  if (projectionInputs.projTargetShare !== undefined) {
    bullets.push(`Target share reciente proyectado: ${(projectionInputs.projTargetShare * 100).toFixed(1)}%.`);
  }
  if (projectionInputs.projShare !== undefined) {
    bullets.push(`Share de acarreos reciente proyectado: ${(projectionInputs.projShare * 100).toFixed(1)}%.`);
  }
  if (projectionInputs.weatherPassMult !== undefined && projectionInputs.weatherPassMult < 1) {
    bullets.push(`Clima reduce la eficiencia de pase esperada (x${projectionInputs.weatherPassMult.toFixed(2)}).`);
  }
  if (projectionInputs.weatherRushMult !== undefined && projectionInputs.weatherRushMult > 1) {
    bullets.push(`Clima favorece el juego terrestre (x${projectionInputs.weatherRushMult.toFixed(2)}).`);
  }

  return bullets.slice(0, 3);
}
