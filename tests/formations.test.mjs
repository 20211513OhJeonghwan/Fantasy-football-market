import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const squad = loadTs('../lib/kickx/squad.ts');
const bench = loadTs('../lib/kickx/bench.ts');

test('nineteen supported formations have eleven unique row slots; excluded systems are absent', () => {
  assert.equal(squad.FORMATIONS.length,19);
  for (const excluded of ['4-6-0','3-6-1','3-3-3-1']) assert(!squad.FORMATIONS.some(f=>f.id===excluded));
  for (const f of squad.FORMATIONS) {
    assert.equal(f.positions.length,11,f.id);
    assert.equal(f.positions.filter(p=>p==='GK').length,1);
    assert.deepEqual(f.rows.flatMap(r=>r.slots),Array.from({length:11},(_,i)=>i));
    assert.equal(Object.values(squad.positionLimits(f.id)).reduce((a,b)=>a+b),11);
  }
  assert.deepEqual(squad.positionLimits('3-5-2'),{GK:1,DF:3,MF:5,FW:2});
  assert.deepEqual(squad.positionLimits('4-2-3-1'),{GK:1,DF:4,MF:5,FW:1});
  assert.deepEqual(squad.positionLimits('5-2-3'),{GK:1,DF:5,MF:2,FW:3});
});
test('formation preview asks only for exact active positional surplus and preserves input data', () => {
  const players=squad.SQUAD_FORMATION.positions.map((position,i)=>({id:`p${i}`,position}));
  const get=id=>players.find(p=>p.id===id), held=players.map(p=>({playerId:p.id}));
  const before=JSON.stringify(held);
  held.push({playerId:'old-bench',bench:{price:70000}});
  const plan=squad.formationChangePlan(held,get,'3-5-2');
  assert.deepEqual(plan.required,{GK:0,DF:1,MF:0,FW:1});
  assert.equal(plan.benchCount,2); assert.equal(plan.unknown,0);
  assert.equal(JSON.stringify(held.slice(0,-1)),before);
  assert.equal(squad.formationChangePlan(held,get,'4-1-2-3').benchCount,0);
});
test('purchase quotas use the actual formation after a change, while frozen duplicates remain blocked', () => {
  const players=['m1','m2','m3','m4','m5'].map(id=>({id,position:'MF'}));
  const get=id=>players.find(p=>p.id===id),held=players.slice(0,3).map(p=>({playerId:p.id}));
  assert.match(squad.purchaseBlock(players[3],held,get,'4-3-3'),/정원 3명/);
  assert.equal(squad.purchaseBlock(players[3],held,get,'3-5-2'),null);
  assert.equal(squad.purchaseBlock(players[3],[...held,{playerId:'m4',bench:{price:1}}],get,'3-5-2'),'이미 보유한 선수입니다.');
});
test('new formation rows preserve active players and exclude frozen players even if legacy slots contain them', () => {
  const positions=['GK','DF','DF','DF','MF','MF','MF','MF','MF','FW','FW'];
  const players=positions.map((position,i)=>({id:`p${i}`,position})),get=id=>players.find(p=>p.id===id);
  const held=players.map(p=>({playerId:p.id}));held[4].bench={price:1};
  const slots=squad.ownedSquadSlots(held,players.map(p=>p.id),'3-5-2',get);
  assert.equal(slots.length,11); assert.equal(slots.includes('p4'),false);
  assert.equal(slots.filter(Boolean).length,10);
  assert.equal(slots[9],'p9');assert.equal(slots[10],'p10');
});
test('bench countdown is client-derived, timezone independent, and switches to processing at the exact deadline', () => {
  const end='2026-11-23T09:00:00Z',at=Date.parse(end);
  assert.equal(bench.benchTimeRemaining(end,at-7*86400000),'자동 매각까지 7일 0분');
  assert.equal(bench.benchTimeRemaining(end,at-2*86400000-3*3600000-5*60000),'자동 매각까지 2일 3시간 5분');
  assert.equal(bench.benchTimeRemaining(end,at-500),'자동 매각까지 1분 미만');
  assert.equal(bench.benchTimeRemaining(end,at),'자동 매각 처리 중');
  assert.equal(bench.benchTimeRemaining('bad',at),'자동 매각 기한 확인 중');
  assert.equal(bench.benchReason('formation'),'포메이션 변경');
});

test('compact pitch keeps single-word registered names and uses the last part of spaced names', () => {
  assert.equal(squad.compactPlayerName('엘링 홀란드'),'홀란드');
  assert.equal(squad.compactPlayerName('해리 케인'),'케인');
  assert.equal(squad.compactPlayerName('하피냐'),'하피냐');
  assert.equal(squad.compactPlayerName('  손흥민  '),'손흥민');
  assert.equal(squad.compactPlayerName('주드   벨링엄'),'벨링엄');
  assert.equal(squad.compactPlayerName(''),'');
  assert.equal(bench.BENCH_DAYS,7);
});
