import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTs } from './load-ts.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE || '/tmp/kickx-browser', 'node_modules/playwright/index.mjs')).href);
const mock = loadTs('../server/kickx/mock-data.ts', { 'server-only': {}, '@/lib/kickx/squad': loadTs('../lib/kickx/squad.ts') });
const base = 'http://localhost:3108', out = 'test-artifacts/community-activity';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', 'localhost', '-p', '3108'], { stdio: 'ignore' });
const report = { checks: [], errors: [], widths: [320, 390, 768, 1024, 1440] };
const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222', postId = '33333333-3333-3333-3333-333333333333';
const parentId = '44444444-4444-4444-4444-444444444444', replyId = '55555555-5555-5555-5555-555555555555';
let browser;
async function setup(width) {
  const state = structuredClone({ ...mock.mockPublicData(), session: mock.mockSession, member: mock.mockMemberData() });
  const leagues = { epl: 'bsd-1', laliga: 'bsd-3', bundesliga: 'bsd-4', seriea: 'bsd-5', ligue1: 'bsd-6' };
  state.leagues = state.leagues.map(l => ({ ...l, id: leagues[l.id] })); state.teams = state.teams.map(t => ({ ...t, leagueId: leagues[t.leagueId] }));
  state.session.userId = a; state.session.profile.avatar = 'icon:ball';
  const name = '아주긴닉네임으로작은화면에서도확인', post = { id: postId, authorId: b, author: name, authorAvatar: 'icon:trophy', scope: 'player', target: state.players[0].id, targetName: state.players[0].name, title: '모바일 경기 이야기', body: '긴 본문과 줄바꿈을 확인합니다.\n' + '축구'.repeat(100), date: '2026-11-04T00:00:00Z', views: 1, likes: 0, liked: false, commentCount: 60, transaction: null };
  const comments = [{ id: parentId, postId, authorId: b, author: name, authorAvatar: 'icon:whistle', body: '다른 작성자의 댓글입니다. ' + '긴댓글'.repeat(60), date: post.date }, { id: replyId, postId, authorId: a, author: '내 닉네임', body: '답글입니다.', parentId, date: post.date }];
  const summary = { hasUnread: true, matchNotifications: true, commentNotifications: true, replyNotifications: true };
  const views = [], mutations = [], reads = [];
  let failRefresh = false;
  const c = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Seoul' });
  await c.route(/^https:\/\//, route => route.abort());
  await c.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const ready = data => route.fulfill({ json: { status: 'ready', data } });
    if (path === '/api/kickx') return failRefresh ? route.fulfill({ status: 503, json: { error: 'temporary outage' } }) : ready(state);
    if (path === '/api/kickx/notifications') {
      if (req.method() === 'PUT') {
        const body = req.postDataJSON(); mutations.push(body);
        if (body.action === 'preferences') for (const key of ['commentNotifications', 'replyNotifications', 'matchNotifications']) if (typeof body[key] === 'boolean') summary[key] = body[key];
        if (body.action === 'read') summary.hasUnread = false;
        return route.fulfill({ json: summary });
      }
      return ready(url.searchParams.has('summary') ? summary : { items: [{ id: '10', kind: 'reply', postId, commentId: replyId, actorName: name, postTitle: post.title, body: '새로운 답글입니다.', createdAt: post.date, readAt: null }], hasUnread: summary.hasUnread, hasMore: false });
    }
    if (path === '/api/kickx/community/activity') {
      reads.push(url.search);
      const kind = url.searchParams.get('kind') || 'posts', author = url.searchParams.get('author') || a, page = Math.min(2, Number(url.searchParams.get('page') || 1));
      return ready({ author: { id: author, nickname: author === a ? '나의 활동' : name, avatar: 'icon:trophy' }, items: [{ id: kind === 'comments' ? replyId : postId, postId, title: post.title, body: '활동 목록 본문입니다. ' + '긴본문'.repeat(20), date: post.date, reply: true, scope: 'player', target: post.target, targetName: post.targetName }], total: 21, page, size: 20, postCount: 21, commentCount: 21 });
    }
    if (path === '/api/kickx/community') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON(); if (body.action === 'view') views.push(body); if (body.action === 'like') { post.liked = body.liked; post.likes = body.liked ? 1 : 0; }
        return route.fulfill({ json: { id: postId } });
      }
      if (url.searchParams.has('postId')) return ready({ post, comments, page: url.searchParams.has('comment') ? 2 : Number(url.searchParams.get('page') || 1), pages: 2 });
      return ready({ items: [post], total: 1, page: 1, size: 20 });
    }
    if (path === '/api/kickx/players') {
      const page = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('size') || 12);
      return ready({ items: state.players.slice((page - 1) * size, page * size), total: state.players.length, page, size });
    }
    if (path.startsWith('/api/kickx/players/')) return ready({ player: state.players.find(p => p.id === decodeURIComponent(path.split('/').at(-1))) || null });
    if (path === '/api/kickx/fixtures') return ready({ items: state.fixtures || [], total: state.fixtures?.length || 0, page: 1, size: 100 });
    return ready({ items: [], total: 0, page: 1, size: 20 });
  });
  const p = await c.newPage(); p.on('pageerror', e => report.errors.push(e.message));
  return { c, p, state, views, mutations, reads, summary, fail: value => { failRefresh = value; } };
}
async function goto(page, path) { await page.goto(base + path, { waitUntil: 'domcontentloaded' }); await page.locator('.masthead-account .account-avatar').waitFor(); }
async function fits(page, label) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' has page-level overflow'); }
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i === 39) throw Error('App did not start'); await new Promise(r => setTimeout(r, 500)); }
  await mkdir(out, { recursive: true }); browser = await chromium.launch();
  for (const width of report.widths) {
    const { c, p, state, views, mutations, reads, fail } = await setup(width);
    await goto(p, '/mypage');
    const activity = p.getByRole('region', { name: '내 커뮤니티 활동', exact: true });
    await activity.getByRole('link', { name: /모바일 경기 이야기/ }).waitFor();
    await activity.getByRole('tab', { name: /내 댓글/ }).click();
    await p.waitForFunction(() => document.querySelector('.activity-tabs [aria-selected=true]')?.textContent?.includes('내 댓글'));
    await activity.getByRole('link', { name: /모바일 경기 이야기/ }).waitFor();
    assert.ok((await activity.locator('.activity-list a').getAttribute('href')).includes('?comment=' + replyId));
    await activity.getByRole('button', { name: '활동 2페이지', exact: true }).click();
    await p.waitForFunction(() => document.querySelector('.community-activity [aria-current=page]')?.textContent === '2');
    assert.ok(reads.some(q => q.includes('kind=comments') && q.includes('page=2')));
    const commentSwitch = p.getByRole('switch', { name: '내 글의 댓글 알림', exact: true });
    await commentSwitch.click(); await p.getByText('커뮤니티 알림 설정을 저장했습니다.', { exact: true }).waitFor();
    assert.equal(await commentSwitch.isChecked(), false); assert.equal(await p.getByRole('switch', { name: '내 댓글의 답글 알림', exact: true }).isChecked(), true);
    await goto(p, '/mypage'); await p.waitForFunction(() => { const el = document.querySelector('input[aria-label="내 글의 댓글 알림"]'); return el && !el.disabled && !el.checked; }); await fits(p, '/mypage ' + width);
    await p.screenshot({ path: out + '/mypage-' + width + '.png', fullPage: true });
    await goto(p, '/community/posts/' + postId); await p.locator('.article-body').waitFor();
    await p.waitForTimeout(100); assert.equal(views.length, 1);
    assert.equal(await p.locator('.article-author .avatar-glyph path').first().getAttribute('d'), 'M6 2.5h12v6a6 6 0 0 1-12 0Z');
    assert.equal(await p.locator('#comment-' + parentId + ' .avatar-glyph circle').first().getAttribute('cx'), '9.2');
    await p.getByRole('button', { name: '공감 0', exact: true }).click(); await p.getByRole('button', { name: '공감 1', exact: true }).waitFor();
    assert.equal(views.length, 1);
    await p.getByRole('textbox', { name: '댓글 내용', exact: true }).fill('새로고침 중에도 작성 내용 유지');
    fail(true); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.locator('.kx-stale-notice').waitFor();
    assert.equal(await p.getByRole('textbox', { name: '댓글 내용', exact: true }).inputValue(), '새로고침 중에도 작성 내용 유지');
    fail(false); state.session.profile = { ...state.session.profile }; await p.getByRole('button', { name: '다시 확인', exact: true }).click(); await p.locator('.kx-stale-notice').waitFor({ state: 'detached' });
    assert.equal(views.length, 1); await fits(p, '/community/posts ' + width);
    await p.screenshot({ path: out + '/post-' + width + '.png', fullPage: true });
    await p.getByRole('button', { name: '알림함 · 읽지 않은 알림 있음', exact: true }).click();
    const inbox = p.getByRole('dialog', { name: '알림함', exact: true }); await inbox.locator('li a').waitFor();
    assert.ok((await inbox.locator('li a').getAttribute('href')).includes('?comment=' + replyId));
    await inbox.locator('li a').click(); await p.locator('#comment-' + replyId).waitFor();
    await p.waitForFunction(() => document.querySelector('.comment-pages .num')?.textContent === '2 / 2'); assert.equal(views.length, 1);
    await goto(p, '/community/authors/' + b); await p.getByRole('heading', { name: '아주긴닉네임으로작은화면에서도확인', exact: true }).waitFor(); await fits(p, '/community/authors ' + width);
    await p.screenshot({ path: out + '/author-' + width + '.png', fullPage: true });
    assert.ok(mutations.some(m => m.commentNotifications === false));
    for (const path of ['/', '/market', '/squad', '/portfolio', '/transactions', '/ranking', '/fixtures', '/players/' + state.players[0].id, '/community/clubs']) {
      await goto(p, path); await p.waitForTimeout(120); await fits(p, path + ' ' + width);
    }
    report.checks.push('Activity, avatars, independent preferences, read-link focus, view dedup, offline draft preservation and main routes at ' + width + 'px');
    console.log('PASS ' + report.checks.at(-1)); await c.close();
  }
  assert.deepEqual(report.errors, []);
} finally { await writeFile(out + '/result.json', JSON.stringify(report, null, 2)); await browser?.close(); server.kill('SIGTERM'); }
