import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';

test('public policy carries live rule display values without the private reference',async()=>{
 const policy={version:'report-v3',initial_points:1300000,initial_price:100000,sell_fee_bps:200,quote_seconds:60,
  pricing_reference_at:'2026-10-14T15:00:00Z',report_parameters:{initialMin:50000,initialMax:150000,minPrice:10000,maxPrice:1000000,valuationStartMs:1791990000000,beta:.3},report_reference:{private:'never publish'}};
 let selected;
 const db={from(table){
  const result=table==='kickx_policy'?{data:policy}:{data:[]};
  const query=new Proxy({then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)},
   {get(target,key){if(key==='select')return columns=>{if(table==='kickx_policy')selected=columns;return query;};return key in target?target[key]:()=>query;}});
  return query;
 },rpc:async name=>({data:name==='kickx_posts'?{items:[]}:null})};
 const {readPrototypePublic}=loadTs('../server/kickx/public-prototype.ts',{'server-only':{},'./prototype':{FORMATIONS:[],checkDatabase:error=>{if(error)throw error;},migrationMissing:()=>false}});
 const result=await readPrototypePublic(db);
 assert.equal(result.policy.pricingReferenceAt,policy.pricing_reference_at);
 assert.deepEqual(result.policy.reportParameters,{initialMin:50000,initialMax:150000,minPrice:10000,maxPrice:1000000,valuationStartMs:1791990000000});
 assert(selected.split(',').includes('report_parameters'));
 assert(!selected.split(',').includes('report_reference'));
 assert(!JSON.stringify(result).includes('never publish'));
});
