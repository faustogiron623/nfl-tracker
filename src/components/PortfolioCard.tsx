'use client';

import { ClientPortfolio } from '@/lib/client-types';
import { centsToDollars, formatOdds, formatPct, MARKET_LABELS, PORTFOLIO_LABELS } from '@/lib/format';

export default function PortfolioCard({
  portfolio,
  onSelect,
  selecting,
}: {
  portfolio: ClientPortfolio;
  onSelect: () => void;
  selecting: boolean;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-emerald-400">{PORTFOLIO_LABELS[portfolio.portfolioType]}</h3>
        <span className="text-xs text-neutral-500">{centsToDollars(portfolio.totalBudgetCents)} total</span>
      </div>

      {portfolio.picks.length === 0 ? (
        <p className="text-sm text-neutral-500">Sin picks que califiquen esta semana en esta categoría.</p>
      ) : (
        <ul className="space-y-2">
          {portfolio.picks.map((pick, i) => (
            <li key={i} className="rounded-lg bg-neutral-800/60 p-3">
              <div className="flex justify-between items-baseline">
                <span className="font-medium text-sm">{pick.selection}</span>
                <span className="text-sm text-neutral-300">{formatOdds(pick.oddsAmerican)}</span>
              </div>
              <div className="flex justify-between text-xs text-neutral-500 mt-0.5">
                <span>{MARKET_LABELS[pick.marketType] ?? pick.marketType}</span>
                <span>
                  {centsToDollars(pick.stakeCents)} · edge {formatPct(pick.edgePct)}
                </span>
              </div>
              <ul className="mt-2 space-y-0.5">
                {pick.reasoning.map((r, j) => (
                  <li key={j} className="text-xs text-neutral-400">
                    · {r}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {portfolio.parlay && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-sm font-medium text-amber-400">Parlay ({portfolio.parlay.legs.length} legs)</span>
            <span className="text-sm text-neutral-300">{formatOdds(portfolio.parlay.combinedOddsAmerican)}</span>
          </div>
          <p className="text-xs text-neutral-500 mb-1">{centsToDollars(portfolio.parlay.stakeCents)}</p>
          <ul className="space-y-0.5">
            {portfolio.parlay.legs.map((leg, i) => (
              <li key={i} className="text-xs text-neutral-400">
                · {leg.selection} ({formatOdds(leg.oddsAmerican)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onSelect}
        disabled={selecting || portfolio.picks.length === 0}
        className="mt-auto rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 py-2 text-sm font-medium"
      >
        {selecting ? 'Guardando...' : 'Guardar este portafolio'}
      </button>
    </div>
  );
}
