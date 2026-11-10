import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { benchExpired, benchSalePlayer, benchRestoreBlock, tradeExecutionStatus } = loadTs('../lib/kickx/bench.ts');
const { squadCapacity, purchaseBlock, ownedSquadSlots } = loadTs('../lib/kickx/squad.ts');
const bench = { price: 70000, startedAt: '2026-11-01T12:00:00Z', expiresAt: '2026-11-08T12:00:00Z', reason: 'position' };

test('bench holding releases the active position but keeps duplicate ownership blocked', () => {
  const players = [{ id: 'moved', position: 'FW' }, { id: 'replacement', position: 'FW' }];
  const get = id => players.find(p => p.id === id), holdings = [{ playerId: 'moved', bench }];
  assert.deepEqual(squadCapacity(holdings, get).counts, { GK: 0, DF: 0, MF: 0, FW: 0 });
  assert.equal(squadCapacity(holdings, get).total, 0);
  assert.equal(purchaseBlock(players[1], holdings, get), null);
  assert.match(purchaseBlock(players[0], holdings, get), /이미 보유/);
  assert.deepEqual(ownedSquadSlots(holdings, Array(11).fill('moved'), '4-3-3', get), Array(11).fill(null));
});

test('bench sale follows current market prices and retains match locks', () => {
  const player = { id: 'moved', price: 99000, change: 8, status: '거래 중지', tradeWindow: { locked: true } };
  const frozen = benchSalePlayer(player, { bench });
  assert.equal(frozen.price, 99000);
  assert.equal(benchSalePlayer({ ...player, price: null }, { bench }).price, 70000);
  assert.equal(frozen.status, null);
  assert.equal(frozen.tradeWindow.locked, true);
  assert.equal(player.price, 99000);
  assert.equal(player.tradeWindow.locked, true);
  assert.equal(benchSalePlayer(player, {}), player);
});

test('deadline is exclusive for manual sale and receipts distinguish automatic liquidation', () => {
  assert.equal(benchExpired(bench, Date.parse(bench.expiresAt) - 1), false);
  assert.equal(benchExpired(bench, Date.parse(bench.expiresAt)), true);
  assert.equal(benchExpired(null), false);
  assert.equal(tradeExecutionStatus('bench_expired'), '벤치 자동 매각');
  assert.equal(tradeExecutionStatus('bench_manual'), '벤치 매각');
  assert.equal(tradeExecutionStatus(null), '체결');
});

test('bench restoration checks current player, deadline and active capacity', () => {
 const p = { id: 'returning', position: 'FW', price: 99000, status: null, tradeWindow: { locked: false } };
 const c = { counts: { GK: 1, DF: 4, MF: 3, FW: 2 }, limits: { GK: 1, DF: 4, MF: 3, FW: 3 }, total: 10, unknown: 0, excess: false };
 const now = Date.parse(bench.expiresAt) - 1;
 assert.equal(benchRestoreBlock(p, bench, c, true, now), null);
 assert.match(benchRestoreBlock(p, bench, { ...c, counts: { ...c.counts, FW: 3 } }, true, now), /FW 정원/);
 assert.match(benchRestoreBlock(p, bench, { ...c, total: 11 }, true, now), /주전 정원/);
 assert.match(benchRestoreBlock(p, bench, c, false, now), /5대 리그/);
 assert.match(benchRestoreBlock(p, bench, c, true, now + 1), /자동 매각/);
 assert.match(benchRestoreBlock({ ...p, tradeWindow: { locked: true } }, bench, c, true, now), /경기 거래 제한/);
});
