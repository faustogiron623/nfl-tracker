import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/db/client';

const bodySchema = z.object({ portfolioId: z.string().uuid() });

/** "Guardar este portafolio": marca cuál de los 3 eligió Fausto para ejecutar. */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data: portfolio, error: findErr } = await db
    .from('portfolios')
    .select('id, week_id')
    .eq('id', parsed.data.portfolioId)
    .single();
  if (findErr || !portfolio) return NextResponse.json({ error: 'Portafolio no encontrado' }, { status: 404 });

  await db.from('portfolios').update({ is_selected: false }).eq('week_id', portfolio.week_id);
  await db.from('portfolios').update({ is_selected: true }).eq('id', portfolio.id);
  await db.from('weeks').update({ status: 'committed' }).eq('id', portfolio.week_id);

  return NextResponse.json({ ok: true });
}
