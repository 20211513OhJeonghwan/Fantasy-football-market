import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const helpers = loadTs('../lib/kickx/community-activity.ts');
const { createViewRecorder, viewDay } = loadTs('../lib/kickx/community-views.ts');
const notifications = loadTs('../lib/kickx/notifications.ts', { './community-activity': helpers });
test('activity queries are bounded and comment destinations retain their exact target', () => {
  assert.deepEqual(helpers.parseActivityQuery(new URLSearchParams()), { author: null, kind: 'posts', page: 1 });
  for (const q of ['author=someone', 'author=', 'kind=private', 'page=0', 'page=1.5', 'page=10001']) assert.throws(() => helpers.parseActivityQuery(new URLSearchParams(q)));
  assert.equal(helpers.activityHref('post', 'reply'), '/community/posts/post?comment=reply#comment-reply');
  assert.equal(notifications.notificationHref({ kind: 'reply', postId: 'post', commentId: 'reply' }), '/community/posts/post?comment=reply#comment-reply');
  assert.equal(notifications.notificationHref({ kind: 'price', playerId: 'bsd-1' }), '/players/bsd-1');
});
test('post views coalesce pending sends and survive route remounts and reloads without mixing accounts or Korean days', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let calls = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const send = async () => { calls++; await waiting; };
  const record = createViewRecorder(send, () => storage);
  const first = record('user-a', 'post', '2026-11-04'), second = record('user-a', 'post', '2026-11-04');
  assert.equal(first, second); release(); await first;
  await record('user-a', 'post', '2026-11-04');
  await createViewRecorder(send, () => storage)('user-a', 'post', '2026-11-04');
  assert.equal(calls, 1);
  await record('user-b', 'post', '2026-11-04'); await record('user-a', 'post', '2026-11-05');
  assert.equal(calls, 3);
  assert.equal(viewDay(new Date('2026-11-03T15:00:00Z')), '2026-11-04');
});
test('failed view requests have a retry cooldown and never poison the successful journal', async () => {
  let now = 0, calls = 0;
  const record = createViewRecorder(async () => { calls++; if (calls === 1) throw Error('offline'); }, () => { throw Error('storage disabled'); }, () => now);
  await record('u', 'p', 'day'); await record('u', 'p', 'day'); assert.equal(calls, 1);
  now = 30001; await record('u', 'p', 'day'); await record('u', 'p', 'day'); assert.equal(calls, 2);
});
test('own activity verifies a session while public author activity only forwards a bounded read', async () => {
  let verified = 0; const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: helpers.emptyActivity(), error: null }; } };
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const route = loadTs('../app/api/kickx/community/activity/route.ts', {
    '@/lib/kickx/community-activity': helpers,
    '@/server/kickx/config': { getSupabaseConfig: () => ({}) },
    '@/server/kickx/http': { HttpError, authenticatedClient: async () => { verified++; return { client }; }, json: Response.json, failure: e => Response.json({ error: e.message }, { status: e.status ?? 500 }) },
    '@/server/kickx/prototype': { checkDatabase: e => { if (e) throw e; } },
    '@/server/kickx/supabase': { createRequestClient: async () => client },
  });
  assert.equal((await route.GET(new Request('https://example.invalid/api/kickx/community/activity?kind=comments&page=2'))).status, 200);
  assert.equal(verified, 1); assert.deepEqual(calls[0].args, { p_author: null, p_kind: 'comments', p_page: 2, p_size: 20 });
  await route.GET(new Request('https://example.invalid/api/kickx/community/activity?author=11111111-1111-1111-1111-111111111111'));
  assert.equal(verified, 1);
  assert.equal((await route.GET(new Request('https://example.invalid/api/kickx/community/activity?author=private&page=2'))).status, 400);
  assert.equal(calls.length, 2);
});
