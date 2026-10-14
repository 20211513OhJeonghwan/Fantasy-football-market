import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { calculatePlayer } from '../server/kickx/engine/service';
import { runAutomaticFootball, errorCode } from './lib/automatic-football.mjs';
import { nameImportFetch } from './lib/korean-catalog.mjs';
import { mapPlayerNames } from './lib/player-names.mjs';
import { fillMissingKoreanNames } from './lib/missing-korean-names.mjs';

loadEnvConfig(process.cwd());
async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bsd = process.env.BSD_API_KEY;
  if (!url || new URL(url).protocol !== 'https:' || !key || !bsd) throw new Error('AUTOMATION_CONFIG_REQUIRED');
  const db = createClient(url, key, { global: { fetch: nameImportFetch(key) }, auth: { persistSession: false, autoRefreshToken: false } });
  await runAutomaticFootball(db, bsd, {
    calculate: (id: string) => calculatePlayer(db, id, null),
    mapNames: async () => {
      // Fill blanks without an external provider first, then improve provisional names.
      const fallback = await fillMissingKoreanNames(db, { apply: true, limit: 500 });
      const verified = await mapPlayerNames(db, { limit: 100 });
      return { fallback, verified };
    },
    emit: (value: unknown) => console.log(JSON.stringify(value)),
  });
}
main().catch(error => {
  // Never print raw network/DB errors, input records, URLs or credentials.
  console.error(JSON.stringify({ error: error instanceof Error && error.message === 'AUTOMATION_CONFIG_REQUIRED' ? error.message : errorCode(error) }));
  process.exitCode = 1;
});
