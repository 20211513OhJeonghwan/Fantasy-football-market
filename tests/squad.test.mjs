import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {SQUAD_FORMATION, POSITION_LIMITS, fixedSquadSlots, positionCapacity} = loadTs('../lib/kickx/squad.ts');

test('fixed lineup retains valid slots, removes stale/duplicate assignments, and fills 11 slots', () => {
  const players = new Map([['keeper',{id:'keeper',position:'GK'}],['defender',{id:'defender',position:'DF'}]]);
  const slots = fixedSquadSlots(['keeper','defender','defender','gone','keeper'], '4-3-3', id=>players.get(id));
  assert.equal(slots.length,11);
  assert.deepEqual(slots.slice(0,5), ['keeper','defender',null,null,null]);
  assert.deepEqual(POSITION_LIMITS, {GK:1,DF:4,MF:3,FW:3});
  assert.equal(SQUAD_FORMATION.positions.length,11);
});

test('old formation converts by position without moving a midfielder into a forward slot', () => {
  const positions = ['GK','DF','DF','DF','MF','MF','MF','MF','MF','FW','FW'];
  const players = positions.map((position,i)=>({id:`p${i}`,position}));
  const get = id=>players.find(p=>p.id===id);
  const slots = fixedSquadSlots(players.map(p=>p.id),'3-5-2',get);
  assert.deepEqual(slots,['p0','p1','p2','p3',null,'p4','p5','p6','p9','p10',null]);
  assert.equal(players.length,11,'conversion does not mutate owned players');
});

test('capacity uses all holdings regardless of saved lineup, isolates positions, and frees after sale', () => {
  const players = [{id:'g',position:'GK'},{id:'m',position:'MF'}];
  const get = id=>players.find(p=>p.id===id);
  const member = {holdings:[{playerId:'g'},{playerId:'m'}],squad:{slots:[]}};
  assert.deepEqual(positionCapacity(member,'GK',get),{count:1,limit:1,full:true});
  assert.deepEqual(positionCapacity(member,'MF',get),{count:1,limit:3,full:false});
  member.holdings.shift();
  assert.deepEqual(positionCapacity(member,'GK',get),{count:0,limit:1,full:false});
  assert.equal(positionCapacity(member,null,get),null);
});
