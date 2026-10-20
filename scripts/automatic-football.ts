import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { calculatePlayer } from '../server/kickx/engine/service';
import { runAutomaticFootball, errorCode } from './lib/automatic-football.mjs';
import { nameImportFetch } from './lib/korean-catalog.mjs';
import { mapPlayerNames } from './lib/player-names.mjs';
import { fillMissingKoreanNames } from './lib/missing-korean-names.mjs';
import { archiveCalculationRevisions, archiveCheckpointPayloads } from './lib/calculation-archives.mjs';

loadEnvConfig(process.cwd());
async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bsd = process.env.BSD_API_KEY;
  const archivesOnly = process.argv.includes('--archives-only');
  if (!url || new URL(url).protocol !== 'https:' || !key || (!bsd && !archivesOnly)) throw new Error('AUTOMATION_CONFIG_REQUIRED');
  const db = createClient(url, key, { global: { fetch: nameImportFetch(key) }, auth: { persistSession: false, autoRefreshToken: false } });
  let footballFailure: unknown;
  if (!archivesOnly) try { await runAutomaticFootball(db, bsd, {
    maintenance: process.argv.includes('--maintenance'),
    calculate: (id: string) => calculatePlayer(db, id, null),
    mapNames: async () => {
      // Fill blanks without an external provider first, then improve provisional names.
      const fallback = await fillMissingKoreanNames(db, { apply: true, limit: 500 });
      const verified = await mapPlayerNames(db, { limit: 100 });
      return { fallback, verified };
    },
    emit: (value: unknown) => console.log(JSON.stringify(value)),
  }); } catch (error) { footballFailure = error; }
  if (archivesOnly || process.argv.includes('--maintenance')) {
    // Reuse this runner's existing Supabase client and credentials. There is no
    // new webhook, Vault forwarding, scheduler or privileged public endpoint.
    try {
      const checkpoints = await archiveCheckpointPayloads(db, { maxBatches: 16, deadline: Date.now() + 90000 });
      const revisions = await archiveCalculationRevisions(db, { maxBatches: 32, deadline: Date.now() + 120000 });
      console.log(JSON.stringify({ stage: 'verified-archives', checkpoints, revisions }));
    } catch {
      console.error(JSON.stringify({ stage: 'verified-archives', error: 'ARCHIVE_RETRY' }));
      process.exitCode = 1;
    }
  }
  if (footballFailure) throw footballFailure;
}
main().catch(error => {
  // Never print raw network/DB errors, input records, URLs or credentials.
  console.error(JSON.stringify({ error: error instanceof Error && error.message === 'AUTOMATION_CONFIG_REQUIRED' ? error.message : errorCode(error) }));
  process.exitCode = 1;
});
