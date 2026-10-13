import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const policy=loadTs('../server/kickx/engine/policy.ts');
export const { calculatePricing }=loadTs('../server/kickx/engine/pricing.ts',{'./policy':policy});
const cutoff='2026-08-01T00:00:00Z';
const game=(id,score,date,season=2026,minutes=90,status='provisional')=>({fixtureId:`bsd-${id}`,score,startedAt:date,season,minutes,status});
test('initial price uses previous-season mean with a five-game neutral prior, current season is replayed',()=>{
 const games=Array.from({length:10},(_,i)=>game(i,80,`2026-05-${String(i+1).padStart(2,'0')}T12:00:00Z`,2025));
 games.push(game(20,100,'2026-07-15T12:00:00Z'));
 const p=calculatePricing(games,cutoff,2026);assert.equal(p.baseline.price,140000);assert.equal(p.baseline.meanScore,80);assert.equal(p.baseline.source,'previous-season');
 assert.equal(p.steps.length,1);assert.equal(p.price,151200);assert.equal(p.steps[0].formScore,86.666667);
});
test('one exceptional historical game is not given the same confidence as a full season',()=>{
 const p=calculatePricing([game(1,110,'2026-07-01T12:00:00Z')],cutoff,2026);
 assert.equal(p.baseline.price,120000);assert.equal(p.baseline.source,'available-history');assert.ok(p.baseline.warnings.includes('SMALL_SAMPLE_PRIOR'));
});
test('latest five appearances have weights 5:4:3:2:1; a sixth oldest score cannot influence their target',()=>{
 const games=[10,20,30,40,50,100].map((s,i)=>game(i,s,`2026-08-${String(i+2).padStart(2,'0')}T12:00:00Z`));
 const p=calculatePricing(games,cutoff);const last=p.steps.at(-1);
 assert.equal(last.formScore,60);assert.deepEqual(last.window,['bsd-5','bsd-4','bsd-3','bsd-2','bsd-1']);
 const changed=calculatePricing(games.map((g,i)=>i===0?{...g,score:1000}:g),cutoff);assert.equal(changed.steps.at(-1).targetPrice,last.targetPrice);
});
test('DNP never enters the window or changes price; missing slots use the seed rather than zero',()=>{
 const g=game(1,80,'2026-08-02T12:00:00Z');const p=calculatePricing([g],cutoff);
 assert.equal(p.steps[0].formScore,60);assert.equal(p.price,108000);
 const dnp=game(2,null,'2026-08-03T12:00:00Z',2026,0,'not-played');assert.deepEqual(calculatePricing([g,dnp],cutoff),p);
});
test('future matches cannot leak into initial value; chronological replay is deterministic under shuffled imports',()=>{
 const games=[game(1,60,'2026-07-01T12:00:00Z'),game(2,120,'2026-08-03T12:00:00Z')];
 const p=calculatePricing(games,cutoff);assert.equal(p.baseline.price,103333);assert.deepEqual(calculatePricing([...games].reverse(),cutoff),p);
 assert.equal(calculatePricing(games.slice(0,1),cutoff).baseline.price,p.baseline.price);
 assert.throws(()=>calculatePricing([games[0],games[0]],cutoff),/INVALID_PRICING_MATCH/);
});
test('short substitute appearances have a smaller movement limit',()=>{
 const p=calculatePricing([game(1,150,'2026-08-03T12:00:00Z',2026,15)],cutoff);
 assert.equal(p.price,102000);assert.equal(p.steps[0].changePercent,2);
});
test('constant form converges to its target, has no unlimited compounding and respects bounds',()=>{
 const games=Array.from({length:100},(_,i)=>game(i,80,new Date(Date.parse(cutoff)+(i+1)*86400000).toISOString()));
 const p=calculatePricing(games,cutoff);assert.ok(Math.abs(p.price-160000)<=1);
 const high=calculatePricing(games.map(g=>({...g,score:1000})),cutoff);assert.ok(high.price<=1000000);
 const low=calculatePricing(games.map(g=>({...g,score:-100})),cutoff);assert.ok(low.price>=10000);
 for(const step of p.steps)assert.ok(Math.abs(step.priceAfter-step.priceBefore)<=step.priceBefore*.08+1);
});
