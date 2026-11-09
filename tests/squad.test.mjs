import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {SQUAD_FORMATION, POSITION_LIMITS, fixedSquadSlots, ownedSquadSlots, squadCapacity, purchaseBlock} = loadTs('../lib/kickx/squad.ts');

test('fixed lineup retains valid slots, removes stale/duplicate assignments, and fills 11 slots', () => {
  const players = new Map([['keeper',{id:'keeper',position:'GK'}],['defender',{id:'defender',position:'DF'}]]);
  const slots = fixedSquadSlots(['keeper','defender','defender','gone','keeper'], '4-3-3', id=>players.get(id));
  assert.equal(slots.length,11);
  assert.deepEqual(slots.slice(0,5), ['keeper','defender',null,null,null]);
  assert.deepEqual(POSITION_LIMITS, {GK:1,DF:4,MF:3,FW:3});
  assert.equal(SQUAD_FORMATION.positions.length,11);
});

test('purchase capacity counts holdings, blocks unknown/legacy excess and keeps sales outside the buy guard', () => {
  const players=new Map([['g1',{position:'GK'}],['g2',{position:'GK'}],['f1',{position:'FW'}],['f2',{position:'FW'}],['f3',{position:'FW'}]]);
  const get=id=>players.get(id),held=['g1','f1','f2','f3'].map(playerId=>({playerId}));
  assert.deepEqual(squadCapacity(held,get).counts,{GK:1,DF:0,MF:0,FW:3});
  assert.match(purchaseBlock({id:'g2',position:'GK'},held,get),/정원 1명/);
  assert.match(purchaseBlock({id:'f1',position:'FW'},held,get),/이미 보유/);
  assert.equal(purchaseBlock({id:'new',position:'DF'},held,get),null);
  assert.match(purchaseBlock({id:'new',position:'DF'},[...held,{playerId:'missing'}],get),/확인하고/);
  assert.match(purchaseBlock({id:'new',position:'DF'},[...held,{playerId:'g2'}],get),/초과/);
});

test('automatic slots fill purchased holdings and free a sold player without touching legacy excess assets',()=>{
  const players=['g1','g2','d1'].map((id,i)=>({id,position:i<2?'GK':'DF'}));
  const get=id=>players.find(p=>p.id===id),held=players.map(p=>({playerId:p.id}));
  const slots=ownedSquadSlots(held,[], '4-3-3',get);
  assert.deepEqual(slots.slice(0,3),['g1','d1',null]);
  assert.equal(held.length,3);
  assert.equal(ownedSquadSlots(held.filter(h=>h.playerId!=='g1'),slots,'4-3-3',get)[0],'g2');
});

test('old formation converts by position without moving a midfielder into a forward slot', () => {
  const positions = ['GK','DF','DF','DF','MF','MF','MF','MF','MF','FW','FW'];
  const players = positions.map((position,i)=>({id:`p${i}`,position}));
  const get = id=>players.find(p=>p.id===id);
  const slots = fixedSquadSlots(players.map(p=>p.id),'3-5-2',get,'4-3-3');
  assert.deepEqual(slots,['p0','p1','p2','p3',null,'p4','p5','p6','p9','p10',null]);
  assert.equal(players.length,11,'conversion does not mutate owned players');
});
