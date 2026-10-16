import test from 'node:test';
import assert from 'node:assert/strict';
import { processBulkTask, initialTasks } from '../scripts/lib/bulk-plan.mjs';
import { checked, dateShift, needsFixtureCheck, runAutomaticFootball, runDailyCollection, drainCalculations } from '../scripts/lib/automatic-football.mjs';
import { createFootballClient, SyncError } from '../scripts/lib/football.mjs';
const season={league_id:1,season:{id:1058,year:2026,start_date:'2026-08-01',end_date:'2027-06-30',is_current:true}};
test('daily calendar uses a bounded correction/upcoming window and validates real dates',async()=>{
 const job={kind:'league',payload:{league:1,phase:'seasons',automatic:true,detail:{id:1,name:'Premier League'}}};
 const r=await processBulkTask({get:async()=>season},job,'2026-10-09');
 assert.equal(r.children.length,2);assert.deepEqual([r.children[1].payload.from,r.children[1].payload.to],['2026-10-02','2026-10-30']);
 await assert.rejects(processBulkTask({get:async()=>({...season,season:{...season.season,start_date:'2026-02-30'}})},job,'2026-10-09'),/INVALID_SEASON_DATES/);
 assert.equal(dateShift('2026-12-31',1),'2027-01-01');
 assert.equal(needsFixtureCheck({retry_at:'2026-10-09T12:01:00Z'},'2026-10-09T12:00:00Z'),false);
 assert.equal(needsFixtureCheck(null,'2026-10-09T12:00:00Z'),true);
});
test('busy database lease prevents all provider/calculation/name work',async()=>{
 let calls=0;const db={rpc:async name=>{assert.equal(name,'kickx_automation_claim');return {data:{busy:true}};}};
 assert.deepEqual(await runAutomaticFootball(db,'test',{calculate:()=>calls++,mapNames:()=>calls++}),{busy:true});assert.equal(calls,0);
});
test('provider reservation failure is never retried as a transport request',async()=>{
 let calls=0;const api=createFootballClient({key:'private-test',fetchImpl:async()=>{calls++;throw new SyncError('LOCAL_DAILY_BUDGET');},wait:async()=>{}});
 await assert.rejects(api.get('/api/v2/leagues/1/'),/LOCAL_DAILY_BUDGET/);assert.equal(calls,1);
 assert.throws(()=>checked({error:{code:'PGRST202',message:'private schema'}}),/AUTOMATION_MIGRATION_REQUIRED/);
});
test('daily task source and continuation commit atomically and resume by database checkpoint',async()=>{
 const task=initialTasks()[0];let complete=false;const calls=[];
 const query={select(){return this;},eq(){return this;},order(){return this;},limit:async()=>({data:complete?[]:[task]})};
 const db={from:()=>query,rpc:async(name,args)=>{calls.push({name,args});if(name==='kickx_automatic_daily_finish_task')complete=true;return {data:0};}};
 const r=await runDailyCollection(db,{get:async()=>({id:1,name:'League'})},{token:'lease',day:'2026-10-09'},Date.now()+1000);
 assert.equal(r.done,true);assert.equal(calls[1].args.p_outcome.done,false);assert.equal(calls[1].args.p_outcome.payload.phase,'seasons');assert.equal(calls[1].args.p_token,'lease');
});
test('calculation acknowledgment uses the exact queue revision; withheld/failures remain retries',async()=>{
 let queried=false;const rows=['okay','withheld','failure'].map(player_id=>({player_id,revision:`rev-${player_id}`}));const ack=[];
 const query={select(){return this;},eq(){return this;},lte(){return this;},order(){return this;},limit:async()=>({data:queried?[]:(queried=true,rows)})};
 const result=await drainCalculations({from:()=>query,rpc:async(n,args)=>{assert.equal(n,'kickx_ack_calculation');ack.push(args);return {data:null};}},async id=>{if(id==='failure')throw Error('private');return {withheld:id==='withheld'};},Date.now()+1000);
 assert.deepEqual(result,{calculated:1,withheld:1,failed:1});assert.equal(ack.find(a=>a.p_player==='withheld').p_error,'CALCULATION_WITHHELD');assert.ok(ack.every(a=>a.p_revision===`rev-${a.p_player}`));
});
