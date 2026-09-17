'use client';

import { useState } from 'react';
import AnalysisTab from '@/components/AnalysisTab';
import HistorialTab from '@/components/HistorialTab';
import DashboardTab from '@/components/DashboardTab';

type Tab = 'analisis' | 'historial' | 'dashboard';

const TABS: { id: Tab; label: string }[] = [
  { id: 'analisis', label: 'Análisis' },
  { id: 'historial', label: 'Historial' },
  { id: 'dashboard', label: 'Dashboard' },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>('analisis');

  return (
    <main className="max-w-5xl mx-auto w-full px-4 py-6 flex-1">
      <h1 className="text-lg font-bold mb-4">🏈 NFL Betting Tracker</h1>

      <div className="flex gap-1 mb-6 border-b border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'analisis' && <AnalysisTab />}
      {tab === 'historial' && <HistorialTab />}
      {tab === 'dashboard' && <DashboardTab />}
    </main>
  );
}
