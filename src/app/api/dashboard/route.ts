import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/db/client';
import { americanToDecimal } from '@/lib/engine/edge';
import { PickRow, ParlayRow, PortfolioType, MarketType } from '@/lib/db/types';

interface WeeklyPnl {
  season: number;
  weekNumber: number;
  stakedCents: number;
  profitCents: number;
}

/** P&L agregado para el tab Dashboard: total staked/won/lost, ROI%, serie semanal, desglose por tipo. */
export async function GET() {
  const db = getSupabaseAdmin();

  const { data: weeks, error } = await db
    .from('weeks')
    .select(
      `id, season, week_number,
       portfolios!inner (
         id, portfolio_type, is_selected,
         picks (*),
         parlays (*)
       )`
    )
    .eq('portfolios.is_selected', true)
    .order('season')
    .order('week_number');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let totalStakedCents = 0;
  let totalProfitCents = 0;
  const byMarketType: Record<string, { stakedCents: number; profitCents: number }> = {};
  const byPortfolioType: Record<string, { stakedCents: number; profitCents: number }> = {};
  const weekly: WeeklyPnl[] = [];

  function profitForPick(pick: PickRow): number {
    if (pick.result === 'pending') return 0;
    if (pick.result === 'push') return 0;
    if (pick.result === 'lost') return -pick.stake_cents;
    const decimal = americanToDecimal(pick.odds_american);
    return Math.round(pick.stake_cents * (decimal - 1));
  }

  function profitForParlay(parlay: ParlayRow): number {
    if (parlay.result === 'pending') return 0;
    if (parlay.result === 'lost') return -parlay.stake_cents;
    const decimal = americanToDecimal(parlay.combined_odds_american);
    return Math.round(parlay.stake_cents * (decimal - 1));
  }

  for (const week of weeks ?? []) {
    let weekStaked = 0;
    let weekProfit = 0;
    for (const portfolio of week.portfolios as unknown as {
      portfolio_type: PortfolioType;
      picks: PickRow[];
      parlays: ParlayRow[];
    }[]) {
      for (const pick of portfolio.picks) {
        if (pick.result === 'pending') continue;
        const profit = profitForPick(pick);
        totalStakedCents += pick.stake_cents;
        totalProfitCents += profit;
        weekStaked += pick.stake_cents;
        weekProfit += profit;

        const mt = pick.market_type as MarketType;
        byMarketType[mt] ??= { stakedCents: 0, profitCents: 0 };
        byMarketType[mt].stakedCents += pick.stake_cents;
        byMarketType[mt].profitCents += profit;

        byPortfolioType[portfolio.portfolio_type] ??= { stakedCents: 0, profitCents: 0 };
        byPortfolioType[portfolio.portfolio_type].stakedCents += pick.stake_cents;
        byPortfolioType[portfolio.portfolio_type].profitCents += profit;
      }
      for (const parlay of portfolio.parlays) {
        if (parlay.result === 'pending') continue;
        const profit = profitForParlay(parlay);
        totalStakedCents += parlay.stake_cents;
        totalProfitCents += profit;
        weekStaked += parlay.stake_cents;
        weekProfit += profit;

        byMarketType['parlay'] ??= { stakedCents: 0, profitCents: 0 };
        byMarketType['parlay'].stakedCents += parlay.stake_cents;
        byMarketType['parlay'].profitCents += profit;

        byPortfolioType[portfolio.portfolio_type] ??= { stakedCents: 0, profitCents: 0 };
        byPortfolioType[portfolio.portfolio_type].stakedCents += parlay.stake_cents;
        byPortfolioType[portfolio.portfolio_type].profitCents += profit;
      }
    }
    if (weekStaked > 0) {
      weekly.push({ season: week.season, weekNumber: week.week_number, stakedCents: weekStaked, profitCents: weekProfit });
    }
  }

  const roiPct = totalStakedCents > 0 ? (totalProfitCents / totalStakedCents) * 100 : 0;

  return NextResponse.json({
    totalStakedCents,
    totalProfitCents,
    roiPct,
    byMarketType,
    byPortfolioType,
    weekly,
  });
}
