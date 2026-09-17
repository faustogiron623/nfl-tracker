// Identifica titulares (QB1/RB1/WR1/EDGE1) por volumen de temporada, y
// cruza contra el reporte de lesiones de la semana para producir los
// booleans que usa situational.ts (homeQbOut, awaySkillPlayerOut, etc).
//
// LIMITACIÓN CONOCIDA: nflverse no trae un campo "posición del rusher de
// pase" limpio (EDGE vs otros LB/DL); usamos def_sacks de temporada como
// proxy para identificar al pass rusher principal del equipo. Es una
// aproximación razonable, no perfecta — un DT con muchos sacks también
// calificaría como "EDGE1", lo cual no es exactamente incorrecto para el
// propósito (afecta la protección del QB rival de cualquier forma).

import { NflverseInjury, NflversePlayerWeekStats } from '../ingest/nflverse';

export interface TeamStarters {
  qbId: string | null;
  qbName: string | null;
  rb1Id: string | null;
  rb1Name: string | null;
  wr1Id: string | null;
  wr1Name: string | null;
  edge1Id: string | null;
  edge1Name: string | null;
}

export function identifyStarters(
  team: string,
  seasonStats: NflversePlayerWeekStats[]
): TeamStarters {
  const teamRows = seasonStats.filter((r) => r.team === team);

  function topByVolume(
    filterFn: (r: NflversePlayerWeekStats) => boolean,
    volumeFn: (r: NflversePlayerWeekStats) => number
  ): { id: string; name: string } | null {
    const totals = new Map<string, { name: string; volume: number }>();
    for (const r of teamRows.filter(filterFn)) {
      const cur = totals.get(r.player_id) || { name: r.player_display_name, volume: 0 };
      cur.volume += volumeFn(r);
      totals.set(r.player_id, cur);
    }
    let best: { id: string; name: string; volume: number } | null = null;
    for (const [id, v] of totals.entries()) {
      if (!best || v.volume > best.volume) best = { id, name: v.name, volume: v.volume };
    }
    return best ? { id: best.id, name: best.name } : null;
  }

  const qb = topByVolume((r) => r.position === 'QB', (r) => r.attempts || 0);
  const rb1 = topByVolume((r) => r.position === 'RB', (r) => r.carries || 0);
  const wr1 = topByVolume((r) => r.position === 'WR', (r) => r.targets || 0);
  // proxy de EDGE1: cualquier fila con def_sacks (no está tipado arriba
  // porque NflversePlayerWeekStats no declara ese campo; lo leemos como any)
  const edge1 = topByVolume(
    (r) => ['OLB', 'DE', 'DT', 'LB'].includes(r.position),
    (r) => Number((r as unknown as Record<string, unknown>).def_sacks ?? 0)
  );

  return {
    qbId: qb?.id ?? null,
    qbName: qb?.name ?? null,
    rb1Id: rb1?.id ?? null,
    rb1Name: rb1?.name ?? null,
    wr1Id: wr1?.id ?? null,
    wr1Name: wr1?.name ?? null,
    edge1Id: edge1?.id ?? null,
    edge1Name: edge1?.name ?? null,
  };
}

export function isPlayerOut(injuries: NflverseInjury[], playerId: string | null): boolean {
  if (!playerId) return false;
  return injuries.some((i) => i.gsis_id === playerId && i.report_status === 'Out');
}
