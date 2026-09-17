'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DashboardResponse } from '@/lib/client-types';
import { centsToDollars, formatPct, MARKET_LABELS, PORTFOLIO_LABELS } from '@/lib/format';

export default function DashboardTab() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-neutral-500">Cargando...</p>;
  if (!data) return <p className="text-sm text-red-400">Error cargando el dashboard.</p>;

  let cumulative = 0;
  const chartData = data.weekly.map((w) => {
    cumulative += w.profitCents / 100;
    return { label: `S${w.weekNumber}`, pnl: Number(cumulative.toFixed(2)) };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total apostado" value={centsToDollars(data.totalStakedCents)} />
        <Stat
          label="Ganado/perdido"
          value={centsToDollars(data.totalProfitCents)}
          positive={data.totalProfitCents >= 0}
        />
        <Stat label="ROI" value={formatPct(data.roiPct)} positive={data.roiPct >= 0} />
      </div>

      {chartData.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="label" stroke="#888" fontSize={12} />
              <YAxis stroke="#888" fontSize={12} />
              <Tooltip contentStyle={{ background: '#171717', border: '1px solid #333' }} />
              <Line type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownTable title="Por tipo de mercado" data={data.byMarketType} labels={MARKET_LABELS} />
        <BreakdownTable title="Por portafolio" data={data.byPortfolioType} labels={PORTFOLIO_LABELS} />
      </div>
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const color = positive === undefined ? 'text-neutral-100' : positive ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function BreakdownTable({
  title,
  data,
  labels,
}: {
  title: string;
  data: Record<string, { stakedCents: number; profitCents: number }>;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(data);
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="text-sm font-semibold text-neutral-300 mb-3">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-500">Sin datos todavía.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {entries.map(([key, v]) => (
              <tr key={key} className="border-t border-neutral-800">
                <td className="py-1.5 text-neutral-300">{labels[key] ?? key}</td>
                <td className="py-1.5 text-right text-neutral-500">{centsToDollars(v.stakedCents)}</td>
                <td className={`py-1.5 text-right font-medium ${v.profitCents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {centsToDollars(v.profitCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
