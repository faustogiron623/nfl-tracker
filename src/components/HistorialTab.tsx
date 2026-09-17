'use client';

import { useEffect, useState } from 'react';
import { HistoryWeek } from '@/lib/client-types';
import { centsToDollars, formatOdds, formatPct, MARKET_LABELS, PORTFOLIO_LABELS } from '@/lib/format';

const RESULT_COLORS: Record<string, string> = {
  pending: 'text-neutral-400',
  won: 'text-emerald-400',
  lost: 'text-red-400',
  push: 'text-neutral-400',
};

export default function HistorialTab() {
  const [weeks, setWeeks] = useState<HistoryWeek[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/results');
    const data = await res.json();
    setWeeks(data.weeks ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleResult(kind: 'pick' | 'parlay', id: string, current: string) {
    const order = kind === 'pick' ? ['pending', 'won', 'lost', 'push'] : ['pending', 'won', 'lost'];
    const next = order[(order.indexOf(current) + 1) % order.length];
    await fetch('/api/results', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, result: next }),
    });
    load();
  }

  if (loading) return <p className="text-sm text-neutral-500">Cargando...</p>;
  if (weeks.length === 0) return <p className="text-sm text-neutral-500">Todavía no guardaste ningún portafolio.</p>;

  return (
    <div className="space-y-4">
      {weeks.map((w) => {
        const portfolio = w.portfolios[0];
        if (!portfolio) return null;
        return (
          <div key={w.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex justify-between items-baseline mb-3">
              <h3 className="font-semibold">
                Semana {w.week_number}, {w.season} — {PORTFOLIO_LABELS[portfolio.portfolio_type]}
              </h3>
              <span className="text-xs text-neutral-500">{centsToDollars(w.budget_cents)} budget</span>
            </div>

            <ul className="space-y-2">
              {portfolio.picks.map((pick) => (
                <li key={pick.id} className="flex justify-between items-center rounded-lg bg-neutral-800/60 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{pick.selection}</p>
                    <p className="text-xs text-neutral-500">
                      {MARKET_LABELS[pick.market_type] ?? pick.market_type} · {formatOdds(pick.odds_american)} ·{' '}
                      {centsToDollars(pick.stake_cents)} · edge {formatPct(pick.edge_pct)}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleResult('pick', pick.id, pick.result)}
                    className={`text-xs font-semibold uppercase px-2 py-1 rounded ${RESULT_COLORS[pick.result]} border border-current`}
                  >
                    {pick.result}
                  </button>
                </li>
              ))}

              {portfolio.parlays.map((parlay) => (
                <li key={parlay.id} className="flex justify-between items-center rounded-lg bg-amber-950/20 border border-amber-900/40 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">Parlay ({parlay.parlay_legs.length} legs)</p>
                    <p className="text-xs text-neutral-500">
                      {formatOdds(parlay.combined_odds_american)} · {centsToDollars(parlay.stake_cents)}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleResult('parlay', parlay.id, parlay.result)}
                    className={`text-xs font-semibold uppercase px-2 py-1 rounded ${RESULT_COLORS[parlay.result]} border border-current`}
                  >
                    {parlay.result}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
