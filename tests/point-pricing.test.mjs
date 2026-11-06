import test from'node:test';import assert from'node:assert/strict';import{loadTs}from'./load-ts.mjs';
const policy=loadTs('../server/kickx/engine/report-policy.ts');const{calculateReportPricing:price}=loadTs('../server/kickx/engine/report-pricing.ts',{'./report-policy':policy});
const p={...policy.REPORT_PARAMETERS,pricingModel:'position-points',positionBenchmarks:{GK:8,DF:8,MF:8,FW:8},valuationStartMs:Date.parse('2026-10-15T00:00:00+09:00'),benchmarkCutoffMs:Date.parse('2026-10-15T00:00:00+09:00')};
const baseline={source:'previous-season',season:2025,gameCount:10,meanScore:8,seedScore:8,percentile:.5,price:100000,lower:0,upper:30,referenceHash:'frozen',fixtures:[],warnings:[]};
const game=(n,score=12)=>({fixtureId:'point-'+n,score,position:'MF',status:'ready',minutes:90,season:2026,startedAt:new Date(Date.parse('2026-10-16T12:00Z')+n*86400000).toISOString()});
test('the same positive contribution adds fixed points after the percentage safety cap, rather than compounding',()=>{
 const plan=price(Array.from({length:20},(_,n)=>game(n)),baseline,p);assert.equal(plan.price,200000);assert.equal(plan.steps[0].priceAfter,105000);assert.equal(plan.steps[1].priceAfter,110000);
 assert.equal(price([game(0)],{...baseline,price:500000},p).price,505000);assert.equal(price([game(0)],{...baseline,price:50000},p).price,55000);
});
test('excellent repeat contributions can pass the former one-million ceiling without violating per-match caps',()=>{
 const plan=price(Array.from({length:100},(_,n)=>game(n,40)),baseline,p);assert(plan.price>1000000);for(const s of plan.steps){assert(s.priceAfter<=Math.floor(s.priceBefore*1.1));assert(s.priceAfter>=Math.ceil(s.priceBefore*.9));}
});
test('bad performances, verified DNP and floor outcomes retain distinct evidence, and prelaunch games never issue prices',()=>{
 const rows=[{...game(0,100),endedAt:'2026-10-14T14:59:59.999Z'},game(1,4),{...game(2,null),status:'not-played',minutes:0,position:null}];const plan=price(rows,baseline,p);
 assert.equal(plan.steps.length,2);assert.equal(plan.steps[0].priceAfter,95000);assert.equal(plan.price,93575);assert.equal(plan.steps[1].evidence.reason,'NON_PARTICIPATION');assert.equal(plan.steps[0].evidence.reason,'POSITION_MATCH_SCORE');
 assert.equal(price([game(0,-100)],{...baseline,price:10000},p).price,10000);
});
