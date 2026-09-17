'use client';

import { useEffect, useState } from 'react';
import { AnalyzeResponse } from '@/lib/client-types';
import PortfolioCard from './PortfolioCard';
import AskBox from './AskBox';

export default function AnalysisTab() {
  const [season, setSeason] = useState<number | ''>('');
  const [week, setWeek] = useState<number | ''>('');
  const [budget, setBudget] = useState<number | ''>(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/current-week')
      .then((r) => r.json())
      .then((d) => {
        setSeason(d.season);
        setWeek(d.week);
      })
      .catch(() => {});
  }, []);

  async function handleAnalyze() {
    if (!season || !week || !budget) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSavedMsg(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season, week, budgetDollars: budget }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Error desconocido');
      } else {
        setResult(data);
      }
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(portfolioId: string | undefined) {
    if (!portfolioId) return;
    setSelectingId(portfolioId);
    try {
      const res = await fetch('/api/portfolios/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioId }),
      });
      if (res.ok) setSavedMsg('Portafolio guardado en el historial.');
      else setSavedMsg('Error al guardar.');
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <AskBox />

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-semibold text-neutral-300 mb-3">Análisis semanal</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col text-xs text-neutral-500 gap-1">
            Temporada
            <input
              type="number"
              className="w-24 rounded-lg bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-sm"
              value={season}
              onChange={(e) => setSeason(e.target.value ? Number(e.target.value) : '')}
            />
          </label>
          <label className="flex flex-col text-xs text-neutral-500 gap-1">
            Semana
            <input
              type="number"
              className="w-20 rounded-lg bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-sm"
              value={week}
              onChange={(e) => setWeek(e.target.value ? Number(e.target.value) : '')}
            />
          </label>
          <label className="flex flex-col text-xs text-neutral-500 gap-1">
            Budget de esta semana ($)
            <input
              type="number"
              className="w-32 rounded-lg bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-sm"
              value={budget}
              onChange={(e) => setBudget(e.target.value ? Number(e.target.value) : '')}
            />
          </label>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
          >
            {loading ? 'Analizando...' : `Analizar semana ${week || ''}`}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {savedMsg && <p className="mt-3 text-sm text-emerald-400">{savedMsg}</p>}
        {result?.propsWarning && (
          <p className="mt-3 text-sm text-amber-400">⚠️ {result.propsWarning}</p>
        )}
      </div>

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {result.portfolios.map((p) => (
            <PortfolioCard
              key={p.portfolioType}
              portfolio={p}
              onSelect={() => handleSelect(p.portfolioId)}
              selecting={selectingId === p.portfolioId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
