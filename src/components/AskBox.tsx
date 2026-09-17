'use client';

import { useState } from 'react';
import { AskResponse } from '@/lib/client-types';
import { formatOdds, formatPct } from '@/lib/format';

export default function AskBox() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
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

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="text-sm font-semibold text-neutral-300 mb-2">
        Preguntá por un partido específico
      </h3>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          placeholder='ej. "¿qué opinas del partido de bills vs lions?"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
        />
        <button
          onClick={handleAsk}
          disabled={loading}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
        >
          {loading ? 'Analizando...' : 'Preguntar'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="whitespace-pre-line text-sm text-neutral-200 leading-relaxed">
            {result.answer}
          </div>

          {result.suggestedLegs.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                Legs sugeridas para armar tu SGP (edge individual, sin cuota combinada — arma la combinación en el book)
              </p>
              <ul className="space-y-1">
                {result.suggestedLegs.map((leg, i) => (
                  <li key={i} className="flex justify-between text-sm bg-neutral-800/60 rounded-md px-3 py-1.5">
                    <span>{leg.selection}</span>
                    <span className="text-neutral-400">
                      {formatOdds(leg.oddsAmerican)} · edge {formatPct(leg.edgePct)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
