import { NextResponse } from 'next/server';
import { fetchAllGames } from '@/lib/ingest/nflverse';
import { seasonForDate } from '@/lib/teams';

/** Detecta la semana NFL "actual" comparando la fecha de hoy contra el calendario de nflverse. */
export async function GET() {
  const now = new Date();
  const season = seasonForDate(now);
  const games = await fetchAllGames();
  const seasonGames = games.filter((g) => g.season === season && g.game_type === 'REG');

  if (seasonGames.length === 0) {
    return NextResponse.json({ season, week: 1 });
  }

  // La semana cuyo rango de fechas está más cerca de hoy
  const byWeek = new Map<number, Date[]>();
  for (const g of seasonGames) {
    if (!g.gameday) continue;
    const arr = byWeek.get(g.week) ?? [];
    arr.push(new Date(g.gameday));
    byWeek.set(g.week, arr);
  }

  let bestWeek = 1;
  let bestDiff = Infinity;
  for (const [week, dates] of byWeek.entries()) {
    const avg = dates.reduce((s, d) => s + d.getTime(), 0) / dates.length;
    const diff = Math.abs(avg - now.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      bestWeek = week;
    }
  }

  return NextResponse.json({ season, week: bestWeek });
}
