import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";
const query=loadTs("../lib/kickx/catalog-query.ts");
const catalog=loadTs("../server/kickx/catalog.ts",{"./trading":{attachTradeWindows:async(db,players)=>players},"server-only":{},"./public-prototype":{readPrototypePublic:async()=>({})},"@/lib/kickx/data":loadTs("../lib/kickx/data.ts")});
const {readPlayerPage,readFixturePage,readPlayerDetail}=loadTs("../server/kickx/catalog-pages.ts",{"./trading":{attachTradeWindows:async(db,players)=>players},"server-only":{},"./public-prototype":{readPrototypePublic:async()=>({})},"@/lib/kickx/catalog-query":query,"./catalog":catalog,"./prototype":{checkDatabase:()=>{},migrationMissing:()=>false}});
function client(calls,rows=[],count=72){
 const q=new Proxy({then(resolve){return Promise.resolve({data:rows,error:null,count}).then(resolve);}}, {get(target,key){return key in target ? target[key] : (...args)=>{calls.push([key,...args]);return q;};}});
 return {from(...args){calls.push(["from",...args]);return q;},rpc(...args){calls.push(["rpc",...args]);return q;}};
}
test("search rejects invalid pages, sizes, filters and non-calendar dates",()=>{
 for(const params of ["page=0","page=1.5","size=1000","sort=raw_sql","league=a,b","day=2026-02-30"])
   assert.throws(()=>query.parseCatalogQuery(new URLSearchParams(params),"players"),query.CatalogInputError);
 assert.equal(query.literalLike("50%_\\"),"50\\%\\_\\\\");
});
test("player search is filtered before page range and has deterministic null-last ordering",async()=>{
 const calls=[];
 const result=await readPlayerPage(client(calls),query.parseCatalogQuery(new URLSearchParams("page=3&size=12&q=50%25&league=af-39&position=FW"),"players"));
 assert.equal(result.total,72);assert.deepEqual(calls.find(c=>c[0]==="range"),["range",24,35]);
 assert.deepEqual(calls.filter(c=>c[0]==="order"),[["order","name",{ascending:true,nullsFirst:false}],["order","name"],["order","id"]]);
 assert.deepEqual(calls.find(c=>c[0]==="ilike"),["ilike","search_text","%50\\%%"]);
});
test("watchlist search uses authenticated RLS-backed relation rather than a supplied user ID",async()=>{
 const calls=[];
 await readPlayerPage(client(calls),query.parseCatalogQuery(new URLSearchParams("scope=watch&userId=someone-else"),"players"));
 assert.deepEqual(calls[0],["rpc","watched_player_catalog",{},{count:"exact"}]);
});
test("KST day filter includes UTC previous evening and excludes next midnight boundary",async()=>{
 const calls=[];
 await readFixturePage(client(calls),query.parseCatalogQuery(new URLSearchParams("day=2026-10-01"),"fixtures"));
 assert.deepEqual(calls.find(c=>c[0]==="gte"),["gte","starts_at","2026-09-30T15:00:00.000Z"]);
 assert.deepEqual(calls.find(c=>c[0]==="lt"),["lt","starts_at","2026-10-01T15:00:00.000Z"]);
});
test("detail marks only ended matches with their own price result as reportable without extra report reads",async()=>{
 const rows={
  player_catalog:{id:'report-player',name:'Report Player'},price_history:[],teams:[],performance_results:[],player_initial_values:null,
  player_match_records:[
   {id:'priced',fixture_id:'priced',performance:0,minutes:90,opponent:'Away'},
   {id:'baseline',fixture_id:'baseline',performance:70,minutes:90,opponent:'Away'},
   {id:'live',fixture_id:'live',performance:30,minutes:45,opponent:'Away'},
   {id:'dnp',fixture_id:'dnp',performance:0,minutes:0,opponent:'Away'},
  ],
  player_price_results:[{fixture_id:'priced'},{fixture_id:'live'},{fixture_id:'dnp'}],
  fixtures:[{id:'priced',status:'FT'},{id:'baseline',status:'FT'},{id:'live',status:'HT'},{id:'dnp',status:'FT'}],
 };
 const calls=[];
 const db={from(table){calls.push(table);const q=new Proxy({then(resolve){return Promise.resolve({data:rows[table],error:null}).then(resolve);}},{get(target,key){return key in target?target[key]:()=>q;}});return q;}};
 const player=await readPlayerDetail(db,'report-player');
 assert.deepEqual(player.records.map(r=>r.reportAvailable),[true,false,false,false]);
 assert.equal(calls.filter(t=>t==='player_price_results').length,1);
 assert.ok(!calls.includes('player_analyses'));
});
