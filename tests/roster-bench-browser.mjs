import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTs } from './load-ts.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE || '/tmp/kickx-browser', 'node_modules/playwright/index.mjs')).href);
const { emptyPlatformData } = loadTs('../lib/kickx/data.ts');
const base = 'http://localhost:3112', out = 'test-artifacts/roster-bench';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', 'localhost', '-p', '3112'], { stdio: 'ignore' });
let browser;
const report = { widths: [320, 390, 1440], checks: [], errors: [] };
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i === 39) throw Error('App did not start'); await new Promise(r => setTimeout(r, 500)); }
  browser = await chromium.launch({ executablePath: process.env.KICKX_BROWSER_EXECUTABLE || undefined }); await mkdir(out, { recursive: true });
  for (const width of report.widths) {
    const frozen = { price: 70000, startedAt: new Date(Date.now() - 2 * 86400000).toISOString(), expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(), reason: 'transfer_position' };
    const players = [
      { id: 'bench-player', name: '이적한 테스트 선수', position: 'DF', price: 120000, status: '거래 중지', tradeWindow: { locked: true }, team: 'new-club' },
      { id: 'active-player', name: '주전 테스트 선수', position: 'GK', price: 50000, team: 'new-club' },
    ].map(p => ({ ...p, change: 0, performance: 8, history: [], records: [], analysis: null }));
    const state = { ...emptyPlatformData(), players, leagues: [{ id: 'bsd-1', name: 'Premier League' }], teams: [{ id: 'new-club', name: '현재 소속 구단', leagueId: 'bsd-1' }], session: { userId: 'member', role: 'member', profile: { nickname: '벤치 테스트', team: 'new-club', teams: ['new-club'], primaryTeam: 'new-club' } }, member: { financialReady: true, points: 1000000, totalAssets: 1120000, playerAssets: 120000, profit: 20000, returnRate: 2, holdings: [{ id: 'bench-player', playerId: 'bench-player', playerName: players[0].name, cost: 50000, value: 70000, profit: 20000, returnRate: 40, quantity: 1, bench: frozen }, { id: 'active-player', playerId: 'active-player', cost: 50000, value: 50000, profit: 0, returnRate: 0, quantity: 1 }], ownedPlayers: players, transactions: [], watchlist: [], assetHistory: [], squad: { formationId: '4-3-3', slots: ['active-player', ...Array(10).fill(null)], revision: 1, value: 50000 } } };
    const c = await browser.newContext({ viewport: { width, height: 960 }, timezoneId: 'Asia/Seoul' });
    await c.route(/^https:\/\//, r => r.abort());
    let quotes = 0, submissions = 0;
    await c.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const ready = data => route.fulfill({ json: { status: 'ready', data } });
      if (path === '/api/kickx') return ready(state);
      if (path === '/api/kickx/players') return ready({ items: players, total: 2, page: 1, size: 12 });
      if (path === '/api/kickx/notifications') return ready({ hasUnread: false, matchNotifications: true });
      if (path === '/api/kickx/trades/quote') {
        quotes++; assert.deepEqual(req.postDataJSON(), { playerId: 'bench-player', side: 'sell' });
        return route.fulfill({ json: { id: 'frozen-quote', playerId: 'bench-player', side: 'sell', quantity: 1, price: 70000, fee: 1400, settlement: 68600, balance: 1000000, balanceAfter: 1068600, quotedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() } });
      }
      if (path === '/api/kickx/trades' && req.method() === 'POST') {
        submissions++; assert.equal(req.postDataJSON().quoteId, 'frozen-quote');
        state.member.holdings = state.member.holdings.filter(h => !h.bench); state.member.points = 1068600;
        state.member.playerAssets = 50000; state.member.totalAssets = 1118600;
        return route.fulfill({ json: { accepted: true } });
      }
      return ready({ items: [], total: 0, page: 1, size: 20 });
    });
    const p = await c.newPage(); p.on('pageerror', e => report.errors.push(e.message));
    await p.goto(base + '/portfolio', { waitUntil: 'networkidle' });
    const holding = p.locator('.holding-row').filter({ hasText: players[0].name });
    assert.equal(await holding.getByText('벤치', { exact: true }).count(), 1); assert.match(await holding.innerText(), /70,000/);
    await p.goto(base + '/squad', { waitUntil: 'networkidle' });
    const bench = p.locator('.squad-bench'); await bench.getByText(players[0].name, { exact: true }).waitFor();
    assert.match(await p.locator('.squad-count').innerText(), /1\s*\/\s*11/);
    assert.equal(await p.locator('.pitch').getByText(players[0].name, { exact: true }).count(), 0);
    assert(await bench.getByRole('button', { name: '매각', exact: true }).isEnabled());
    assert((await bench.locator('.roster-bench-player > span').first().boundingBox()).width >= 120, `Bench reason is too narrow at ${width}`);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Squad overflow at ${width}`);
    await p.screenshot({ path: `${out}/bench-${width}.png`, fullPage: true });
    await bench.getByRole('button', { name: '매각', exact: true }).click();
    const dialog = p.getByRole('dialog');
    await p.waitForFunction(() => document.querySelector('.trade-summary')?.textContent.includes('70,000'));
    assert.match(await dialog.locator('.trade-summary').innerText(), /매각 기준가\s*70,000/);
    assert.match(await dialog.innerText(), /1,400/); assert.equal(await dialog.locator('.trade-capacity').count(), 0);
    assert.equal(quotes, 1); assert(await dialog.getByRole('button', { name: '매각 확정', exact: true }).isEnabled());
    await p.screenshot({ path: `${out}/sale-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: '매각 확정', exact: true }).click();
    await p.waitForFunction(() => !document.querySelector('.squad-bench'));
    assert.equal(submissions, 1); assert.equal(state.member.points, 1068600);
    report.checks.push({ width, frozenPrice: 70000, net: 68600, quotes, submissions }); await c.close();
  }
  assert.deepEqual(report.errors, []); console.log(JSON.stringify(report));
} finally {
  await mkdir(out, { recursive: true }); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.kill('SIGTERM');
}
