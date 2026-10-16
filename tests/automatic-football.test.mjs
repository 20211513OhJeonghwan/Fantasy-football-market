import test from 'node:test';
import assert from 'node:assert/strict';
import { checked, drainCalculations, needsFixtureCheck, runDailyCollection, runAutomaticFootball } from '../scripts/lib/automatic-football.mjs';
import { compatibleName, matchKoreanName, lookupKoreanName, nameSignature } from '../scripts/lib/player-names.mjs';
const claim=(property,value)=>({mainsnak:{datavalue:{value}},rank:'normal'});
const footballer=(id='Q123',name='Lionel Messi',date='1987-06-24')=>({id,labels:{en:{value:name},ko:{value:'리오넬 메시'}},claims:{P31:[claim('',{id:'Q5'})],P106:[claim('',{id:'Q937857'})],P569:[claim('',{time:`+${date}T00:00:00Z`,precision:11})]}});
test('name matching requires one footballer, exact DOB and compatible name; manual aliases can remain separate',()=>{
 const p={name:'L. Messi',birth_date:'1987-06-24'};
 assert.equal(compatibleName('L. Messi','Lionel Messi'),true);
 assert.equal(compatibleName('Messi','Lionel Messi'),false);
 assert.equal(matchKoreanName(p,{Q123:footballer()}).displayName,'리오넬 메시');
 assert.equal(matchKoreanName({...p,birth_date:'1987-06-25'},{Q123:footballer()}),null);
 assert.equal(matchKoreanName(p,{Q123:footballer(),Q124:footballer('Q124')}),null);
 assert.equal(matchKoreanName({...p,birth_date:null},{Q123:footballer()}),null);
 const entity=footballer();delete entity.claims.P106;assert.equal(matchKoreanName(p,{Q123:entity}),null);
 assert.notEqual(nameSignature(p),nameSignature({...p,name:'Other'}));
});
test('published Korean names use API results and service failures are explicit',async()=>{
 let calls=0;
 const result=await lookupKoreanName({name:'Lionel Messi',birth_date:'1987-06-24'},{wait:async()=>{},fetchImpl:async url=>{
  calls++;assert.equal(url.hostname,'www.wikidata.org');
  return {ok:true,json:async()=>calls===1?{search:[{id:'Q123'}]}:{entities:{Q123:footballer()}}};
 }});
 assert.equal(result.displayName,'리오넬 메시');assert.equal(calls,2);
 await assert.rejects(lookupKoreanName({name:'x',birth_date:'2000-01-01'},{wait:async()=>{},fetchImpl:async()=>({ok:false})}),/NAME_PROVIDER_UNAVAILABLE/);
});
test('fixture checks respect retry windows and incomplete feeds are retried',()=>{
 assert.equal(needsFixtureCheck(null,'2026-10-09T10:00:00Z'),true);
 assert.equal(needsFixtureCheck({retry_at:'2026-10-09T10:15:00Z'},'2026-10-09T10:00:00Z'),false);
 assert.equal(needsFixtureCheck({retry_at:'2026-10-09T10:15:00Z'},'2026-10-09T10:15:00Z'),true);
 assert.throws(()=>checked({error:{code:'PGRST202'}}),/AUTOMATION_MIGRATION_REQUIRED/);
 assert.throws(()=>checked({error:{message:'LOCAL_DAILY_BUDGET'}}),/LOCAL_DAILY_BUDGET/);
});
test('queue acknowledgments carry the read revision; blocked results and failures retry',async()=>{
 let reads=0;const acknowledgments=[];
 const rows=[{player_id:'bsd-1',revision:'old'},{player_id:'bsd-2',revision:'two'},{player_id:'bsd-3',revision:'three'}];
 const query={select(){return this;},eq(){return this;},lte(){return this;},order(){return this;},limit:async()=>({data:reads++===0?rows:[],error:null})};
 const db={from:()=>query,rpc:async(name,args)=>{assert.equal(name,'kickx_ack_calculation');acknowledgments.push(args);return {data:null,error:null};}};
 const result=await drainCalculations(db,async id=>{if(id==='bsd-2')return {withheld:true};if(id==='bsd-3')throw new Error('secret');return {};},Date.now()+10000);
 assert.deepEqual(result,{calculated:1,withheld:1,failed:1});
 assert.deepEqual(acknowledgments.map(a=>[a.p_revision,a.p_error]),[['old',null],['two','CALCULATION_WITHHELD'],['three','CALCULATION_RETRY']]);
});
test('daily catalog resumes a persisted phase and stops before the runner deadline',async()=>{
 const task={key:'league:1',kind:'league',priority:0,payload:{league:1,phase:'detail',automatic:true},label:'league'};
 let phase=task,finished=0;const query={select(){return this;},eq(){return this;},order(){return this;},limit:async()=>({data:phase?[phase]:[],error:null})};
 const db={from:()=>query,rpc:async(name,args)=>{
  if(name==='kickx_automatic_daily_finish_task'){assert.equal(args.p_outcome.payload.phase,'seasons');phase=null;finished++;return {data:0,error:null};}
  assert.equal(name,'kickx_automatic_daily_start');return {data:null,error:null};
 }};
 const result=await runDailyCollection(db,{get:async()=>({id:1})},{token:'lease',day:'2026-10-09'},Date.now()+10000);
 assert.equal(result.done,true);assert.equal(finished,1);
 assert.equal((await runDailyCollection(db,{}, {token:'lease',day:'2026-10-09'},Date.now()-1)).done,false);
});
test('busy lease performs no requests or publication',async()=>{
 let calls=0;const result=await runAutomaticFootball({rpc:async name=>{calls++;assert.equal(name,'kickx_automation_claim');return {data:{busy:true},error:null};}},'unused',{calculate:()=>{throw new Error('must not calculate');}});
 assert.deepEqual(result,{busy:true});assert.equal(calls,1);
});
