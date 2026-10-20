import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/server/kickx/config';
import { archiveCalculationRevisions } from '@/scripts/lib/calculation-archives.mjs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const config = getSupabaseConfig(), authorization = request.headers.get('authorization') ?? '';
  const key = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!config || !key || key === config.key || key.length > 2048)
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers });
  const db = createClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) }) } });
  try {
    // PostgreSQL authenticates this credential; PUBLIC/member roles cannot call it.
    const access = await db.rpc('kickx_revision_archive_batch', { p_limit: 250 });
    if (access.error) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers });
    return Response.json(await archiveCalculationRevisions(db, { initialBatch: access.data }), { headers });
  } catch {
    return Response.json({ error: 'ARCHIVE_RETRY' }, { status: 503, headers });
  }
}
