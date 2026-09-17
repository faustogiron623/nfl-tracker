import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/db/client';
import { analyzeWeek } from '@/lib/engine';

export const maxDuration = 60; // el fetch+cálculo puede tardar por los CSVs grandes de nflverse

const bodySchema = z.object({
  season: z.number().int(),
  week: z.number().int().min(1).max(22),
  budgetDollars: z.number().positive(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { season, week, budgetDollars } = parsed.data;
  const budgetCents = Math.round(budgetDollars * 100);

  let result;
  try {
    result = await analyzeWeek(season, week, budgetCents);
  } catch (err) {
    console.error('analyzeWeek failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error desconocido analizando la semana' },
      { status: 500 }
    );
  }

  const db = getSupabaseAdmin();

  // Upsert de la semana
  const { data: weekRow, error: weekErr } = await db
    .from('weeks')
    .upsert({ season, week_number: week, budget_cents: budgetCents, status: 'analyzed', analyzed_at: new Date().toISOString() }, { onConflict: 'season,week_number' })
    .select()
    .single();
  if (weekErr || !weekRow) {
    return NextResponse.json({ error: weekErr?.message ?? 'No se pudo guardar la semana' }, { status: 500 });
  }
  const weekId = weekRow.id as string;

  // Limpiar portafolios previos de esta semana (re-análisis sobrescribe)
  await db.from('portfolios').delete().eq('week_id', weekId);
  await db.from('games_snapshot').delete().eq('week_id', weekId);
  await db.from('team_ratings_snapshot').delete().eq('week_id', weekId);

  // Guardar snapshot de partidos
  await db.from('games_snapshot').insert(
    result.games.map((g) => ({
      week_id: weekId,
      home_team: g.home_team,
      away_team: g.away_team,
      kickoff: g.gametime ? `${g.gameday}T${g.gametime}` : g.gameday,
      is_divisional: g.div_game === 1,
      home_rest_days: g.home_rest,
      away_rest_days: g.away_rest,
      wind_mph: g.wind,
      is_dome: g.roof === 'dome' || g.roof === 'closed',
    }))
  );

  const portfolioIds: Record<string, string> = {};

  for (const p of result.portfolios) {
    const { data: portfolioRow, error: pErr } = await db
      .from('portfolios')
      .insert({
        week_id: weekId,
        portfolio_type: p.portfolioType,
        total_budget_cents: p.totalBudgetCents,
        picks_budget_cents: p.picksBudgetCents,
        parlay_budget_cents: p.parlayBudgetCents,
      })
      .select()
      .single();
    if (pErr || !portfolioRow) continue;
    portfolioIds[p.portfolioType] = portfolioRow.id;

    if (p.picks.length > 0) {
      await db.from('picks').insert(
        p.picks.map((pick) => ({
          portfolio_id: portfolioRow.id,
          market_type: pick.marketType,
          selection: pick.selection,
          player_name: pick.playerName,
          team: pick.team,
          line: pick.line,
          odds_american: pick.oddsAmerican,
          model_prob: pick.modelProb,
          fair_prob: pick.fairProb,
          edge_pct: pick.edgePct,
          stake_cents: pick.stakeCents,
          reasoning: pick.reasoning,
        }))
      );
    }

    if (p.parlay) {
      const { data: parlayRow } = await db
        .from('parlays')
        .insert({
          portfolio_id: portfolioRow.id,
          combined_odds_american: p.parlay.combinedOddsAmerican,
          stake_cents: p.parlay.stakeCents,
        })
        .select()
        .single();
      if (parlayRow) {
        await db.from('parlay_legs').insert(
          p.parlay.legs.map((leg, i) => ({
            portfolio_id: portfolioRow.id,
            market_type: 'mixed',
            selection: leg.selection,
            odds_american: leg.oddsAmerican,
            edge_pct: leg.edgePct,
            leg_order: i,
          }))
        );
      }
    }
  }

  return NextResponse.json({
    weekId,
    propsAvailable: result.propsAvailable,
    propsWarning: result.propsWarning,
    portfolios: result.portfolios.map((p) => ({
      portfolioId: portfolioIds[p.portfolioType],
      portfolioType: p.portfolioType,
      picks: p.picks,
      parlay: p.parlay,
      totalBudgetCents: p.totalBudgetCents,
      picksBudgetCents: p.picksBudgetCents,
      parlayBudgetCents: p.parlayBudgetCents,
    })),
  });
}
