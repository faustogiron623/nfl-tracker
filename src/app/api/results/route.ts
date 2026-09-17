import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/db/client';

const bodySchema = z.object({
  kind: z.enum(['pick', 'parlay']),
  id: z.string().uuid(),
  result: z.enum(['pending', 'won', 'lost', 'push']),
});

/** Toggle manual de resultado (pendiente/ganado/perdido) para un pick o parlay — tab Historial. */
export async function PATCH(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { kind, id, result } = parsed.data;

  const db = getSupabaseAdmin();
  const settled_at = result === 'pending' ? null : new Date().toISOString();

  if (kind === 'pick') {
    const { error } = await db.from('picks').update({ result, settled_at }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    if (result === 'push') return NextResponse.json({ error: 'Un parlay no puede quedar en push' }, { status: 400 });
    const { error } = await db.from('parlays').update({ result, settled_at }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** Historial completo: todas las semanas con su portafolio elegido, picks, y parlay. */
export async function GET() {
  const db = getSupabaseAdmin();

  const { data: weeks, error } = await db
    .from('weeks')
    .select(
      `id, season, week_number, budget_cents, status,
       portfolios!inner (
         id, portfolio_type, is_selected, total_budget_cents, picks_budget_cents, parlay_budget_cents,
         picks (*),
         parlays (*, parlay_legs(*))
       )`
    )
    .eq('portfolios.is_selected', true)
    .order('season', { ascending: false })
    .order('week_number', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ weeks });
}
