import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const ARCHIVE_BUCKET = 'kickx-calculation-archives';
const checked = reply => { if (reply.error) throw new Error('ARCHIVE_RETRY'); return reply.data; };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function privateBucket(db) {
  let reply = await db.storage.getBucket(ARCHIVE_BUCKET);
  if (reply.error) {
    if (!['400','404'].includes(String(reply.error.statusCode))) throw new Error('ARCHIVE_BUCKET_UNAVAILABLE');
    const created = await db.storage.createBucket(ARCHIVE_BUCKET, { public: false, fileSizeLimit: 20 * 1024 * 1024 });
    // An overlapping runner may have created the same private bucket.
    if (created.error && !['409','400'].includes(String(created.error.statusCode))) throw new Error('ARCHIVE_BUCKET_UNAVAILABLE');
    reply = await db.storage.getBucket(ARCHIVE_BUCKET);
  }
  const bucket = checked(reply);
  if (!bucket || bucket.public !== false) throw new Error('ARCHIVE_BUCKET_MUST_BE_PRIVATE');
  return db.storage.from(ARCHIVE_BUCKET);
}

/** A verified gzip copy is required before compacting any full revision JSON.
 * The row CAS and newest-per-player/rule check are repeated inside PostgreSQL.
 * Content-addressed names make retries safe after upload/acknowledgment failures.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{initialBatch?: Array<{id: string, archive_hash: string, [key: string]: unknown}>, maxBatches?: number, deadline?: number}} options
 */
export async function archiveCalculationRevisions(db, { initialBatch, maxBatches = 8, deadline = Date.now() + 40000 } = {}) {
  let bucket, archived = 0, bytes = 0, batches = 0;
  let rows = initialBatch;
  while (batches < maxBatches && Date.now() < deadline) {
    rows ??= checked(await db.rpc('kickx_revision_archive_batch', { p_limit: 250 }));
    if (!Array.isArray(rows)) throw new Error('ARCHIVE_INVALID_BATCH');
    if (!rows.length) return { archived, bytes, batches, done: true };
    bucket ??= await privateBucket(db);
    const payload = Buffer.from(JSON.stringify({ format: 'kickx-calculation-revisions-v1', rows }));
    if (payload.length > 20 * 1024 * 1024) throw new Error('ARCHIVE_BATCH_TOO_LARGE');
    const compressed = gzipSync(payload, { level: 9 });
    const checksum = digest(compressed);
    const path = `calculation-revisions/${checksum}.json.gz`;
    const uploaded = await bucket.upload(path, compressed, { contentType: 'application/gzip', upsert: false });
    if (uploaded.error && !['409','400'].includes(String(uploaded.error.statusCode))) throw new Error('ARCHIVE_UPLOAD_FAILED');
    // Check the actual bytes returned by Storage, including after an ambiguous
    // previous upload. A failed/mismatched download never acknowledges the rows.
    const restored = checked(await bucket.download(path));
    if (digest(Buffer.from(await restored.arrayBuffer())) !== checksum) throw new Error('ARCHIVE_VERIFICATION_FAILED');
    archived += checked(await db.rpc('kickx_finish_revision_archive', {
      p_path: path, p_rows: rows.map(({ id, archive_hash }) => ({ id, archive_hash })),
    }));
    bytes += compressed.length; batches++; rows = undefined;
  }
  return { archived, bytes, batches, done: false };
}
