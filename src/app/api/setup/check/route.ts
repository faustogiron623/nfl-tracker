import { NextResponse } from 'next/server';
import { testSharpApiConnection } from '@/lib/ingest/sharpapi';
import { getSupabaseAdmin } from '@/lib/db/client';

/** Botón "Probar conexión" — para confirmar en 5 segundos si SharpAPI sirve props en tu plan y si Supabase responde. */
export async function GET() {
  const sharpApi = await testSharpApiConnection().catch((e) => ({
    moneylineOk: false,
    propsOk: false,
    error: e instanceof Error ? e.message : String(e),
  }));

  let supabaseOk = false;
  let supabaseError: string | undefined;
  try {
    const db = getSupabaseAdmin();
    const { error } = await db.from('weeks').select('id').limit(1);
    if (error) supabaseError = error.message;
    else supabaseOk = true;
  } catch (e) {
    supabaseError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({ sharpApi, supabase: { ok: supabaseOk, error: supabaseError } });
}
