import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './load-ts.mjs';
const policy=loadTs('../server/kickx/engine/policy.ts');
const {calculatePricing}=loadTs('../server/kickx/engine/pricing.ts',{'./policy':policy});
test('TypeScript and independent PostgreSQL pricing agree across 60 historical/rolling-window cases',async()=>{
 const db=new PGlite();
 try {
  const sql=readFileSync(new URL('../supabase/migrations/202610130001_performance_market_v2.sql',import.meta.url),'utf8');
  await db.exec(sql.match(/create function public\.kickx_market_plan\([\s\S]*?end \$\$;/)[0]);
  let seed=20261013;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const cutoff='2026-08-01T00:00:00Z';
  for(let c=0;c<60;c++){
   const previousCount=c%3===0?Math.floor(random()*20):0;
   const currentCount=Math.floor(random()*12),futureCount=Math.floor(random()*18);
   const games=[];
   const add=(count,start,season,prefix)=>{for(let i=0;i<count;i++)games.push({fixtureId:`bsd-${prefix+i}`,startedAt:new Date(Date.parse(start)+i*86400000).toISOString(),season,minutes:[15,30,45,60,90][Math.floor(random()*5)],score:Math.round((random()*160-20)*4)/4,status:'provisional'});};
   add(previousCount,'2026-05-01T12:00:00Z',2025,1000);add(currentCount,'2026-07-01T12:00:00Z',2026,2000);add(futureCount,'2026-08-02T12:00:00Z',2026,3000);
   if(c%2===0)games.push({fixtureId:'bsd-9000',startedAt:'2026-08-10T12:00:00Z',season:2026,score:null,minutes:0,status:'not-played'});
   const ts=calculatePricing([...games].reverse(),cutoff,2026);
   const {rows}=await db.query('select public.kickx_market_plan($1::jsonb,$2::timestamptz,2026) as plan',[JSON.stringify(games),cutoff]);const pg=rows[0].plan;
   assert.equal(pg.price,ts.price,`final case ${c}`);assert.equal(pg.baseline.price,ts.baseline.price,`seed case ${c}`);
   assert.equal(pg.baseline.source,ts.baseline.source);assert.deepEqual(pg.baseline.fixtures,ts.baseline.fixtures);
   assert.ok(Math.abs(pg.baseline.seedScore-ts.baseline.seedScore)<1e-8);
   assert.equal(pg.steps.length,ts.steps.length);
   for(let i=0;i<ts.steps.length;i++)for(const key of ['fixtureId','priceBefore','priceAfter','targetPrice','formScore','changePercent','window'])assert.deepEqual(pg.steps[i][key],ts.steps[i][key],`${c}/${i}/${key}`);
  }
 } finally {await db.close();}
});
test('120-minute appearances use the same SQL/TypeScript rolling formula and retain the eight-percent cap',async()=>{
 const db=new PGlite();
 try{
  const sql=readFileSync(new URL('../supabase/migrations/202610140001_club_competitions.sql',import.meta.url),'utf8');
  await db.exec(sql.match(/create or replace function public\.kickx_market_plan\([\s\S]*?end \$\$;/)[0]);
  const rows=[{fixtureId:'bsd-1',startedAt:'2026-08-02T12:00:00Z',season:2026,minutes:120,score:120,status:'provisional'},{fixtureId:'bsd-2',startedAt:'2026-08-03T12:00:00Z',season:2026,minutes:30,score:20,status:'provisional'}];
  const ts=calculatePricing(rows,'2026-08-01T00:00:00Z',2026,120);
  const pg=(await db.query('select public.kickx_market_plan($1::jsonb,$2::timestamptz,2026) plan',[JSON.stringify(rows),'2026-08-01T00:00:00Z'])).rows[0].plan;
  assert.equal(ts.steps.length,2);assert.equal(ts.steps[0].priceAfter,108000);assert.equal(pg.price,ts.price);assert.deepEqual(pg.steps.map(s=>s.priceAfter),ts.steps.map(s=>s.priceAfter));
 }finally{await db.close();}
});
