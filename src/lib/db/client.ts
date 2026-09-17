import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Cliente server-side con la service_role key: este proyecto no tiene auth,
// corre en API routes de servidor, y necesita bypassear RLS (o RLS puede
// quedar deshabilitado, ya que es de un solo usuario). NUNCA exponer esta
// key al cliente/navegador — solo se usa dentro de src/app/api/**.
let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en las variables de entorno. ' +
        'Revisa .env.local (desarrollo) o las Environment Variables del proyecto en Vercel.'
    );
  }

  _client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  return _client;
}
