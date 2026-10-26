import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {loadTs} from './load-ts.mjs';
const policy=loadTs('../server/kickx/engine/report-policy.ts');
const performance=loadTs('../server/kickx/engine/report-performance.ts',{'./report-policy':policy});
const pricing=loadTs('../server/kickx/engine/report-pricing.ts',{'./report-policy':policy});
function setup({missingSeason=false,remaining=7000}={}) {
 const calls=[],objects=new Map();let current={version:'form-v2',report_parameters:{...policy.REPORT_PARAMETERS},report_reference:null};
 const externalId=id=>`bsd-${id}`;
 const api={requests:0,remaining,async get(path){calls.push(path);this.requests++;
  if(path.includes('/leagues/')&&path.endsWith('/season/'))return {season:{year:2026}};
  if(path.includes('/leagues/')&&path.endsWith('/seasons/'))return {seasons:missingSeason?[]:[{id:2025,year:2025}]};
  const id=Number(path.split('/')[4]);
  const players=Array.from({length:11},(_,i)=>({id:id*100+i+1,position:['G','D','M','F'][i%4]}));
  if(path.endsWith('lineups/'))return {event_id:id,lineup_status:'confirmed',lineups:{home:{team_id:1,players},away:{team_id:2,players:players.map(p=>({...p,id:p.id+30}))}}};
  if(path.endsWith('player-stats/'))return {event_id:id,player_stats:players.slice(0,4).map(p=>({player_id:p.id,team_id:1,minutes_played:97,goals:0}))};
  if(path.endsWith('incidents/'))return {event_id:id,incidents:[]};
  return {id,league_id:Math.floor(id/100),season_id:2025,status:'finished',home_team_id:1,away_team_id:2,home_score:0,away_score:0};
 },async page(_path,p){this.requests++;return {results:[{id:p.league_id*100+1}],next:null};}};
 const db={from(){const q={select(){return q;},eq(){return q;},single:async()=>({data:structuredClone(current),error:null}),maybeSingle:async()=>({data:{requests:0},error:null})};return q;},async rpc(name,args){
  if(name==='kickx_save_report_reference'){assert.equal(args.p_revision,current.report_reference?.revision??0);const revision=args.p_revision+1;current.report_reference={...structuredClone(args.p_reference),revision};return {data:revision,error:null};}
  if(name==='kickx_activate_report_policy'){assert.equal(current.report_reference.status,'ready');current.version='report-v3';return {data:20,error:null};}
  throw Error(name);
 },storage:{getBucket:async()=>({data:{public:false},error:null}),from(){return {upload:async(path,bytes)=>{objects.set(path,bytes);return {error:null};},download:async path=>({data:new Blob([objects.get(path)]),error:null}),remove:async paths=>{for(const path of paths)objects.delete(path);return {error:null};}};}}};
 const mod=loadTs('../scripts/lib/report-reference.ts',{'node:crypto':{createHash},'node:zlib':{gzipSync,gunzipSync},'./football.mjs':{externalId,normalizeStatus:()=> 'FT',createFootballClient:()=>api},'../../server/kickx/engine/report-performance':performance,'../../server/kickx/engine/report-pricing':pricing});
 return {mod,api,db,calls,objects,current:()=>current};
}
test('full previous-season discovery freezes all four cohorts, verifies private archives and activates once',async()=>{
 const x=setup();const answer=await x.mod.prepareReportReference(x.db,'test-only-key',{runtimeReady:async()=>true});
 assert.equal(answer.active,true);assert.equal(x.current().report_reference.completed,5);assert.equal(x.objects.size,5);
 for(const pos of ['GK','DF','MF','FW'])assert.equal(x.current().report_reference.groups[pos].baselines.length,5);
 const calls=x.calls.length;assert.equal((await x.mod.prepareReportReference(x.db,'test-only-key',{runtimeReady:async()=>true})).active,true);assert.equal(x.calls.length,calls);
 assert.ok(!x.calls.some(p=>p.includes('/players/')),'History must not generate player-profile calls');
});
test('no historical season never invents a baseline or activates the policy',async()=>{
 const x=setup({missingSeason:true});const answer=await x.mod.prepareReportReference(x.db,'test-only-key',{runtimeReady:async()=>true});
 assert.equal(answer.pending,'REFERENCE_SEASON_UNAVAILABLE');assert.equal(x.current().version,'form-v2');assert.equal(x.objects.size,0);
});
test('history reserves API capacity for live matches and resumes without duplicate baseline contributions',async()=>{
 const x=setup({remaining:1000});const first=await x.mod.prepareReportReference(x.db,'test-only-key',{runtimeReady:async()=>true});assert.equal(first.completed,0);assert.equal([...x.objects.keys()].filter(k=>!k.includes('/checkpoints/')).length,0);assert.ok(JSON.stringify(x.current().report_reference).length<1000);
 x.api.remaining=7000;const second=await x.mod.prepareReportReference(x.db,'test-only-key',{runtimeReady:async()=>true});assert.equal(second.active,true);assert.equal(x.current().report_reference.archives.length,5);
});
test('added-time clock requires corroboration and rejects a single extreme counter',()=>{
 const {mod}=setup();assert.equal(mod.observedMatchDuration([97,97,45,180]),97);assert.equal(mod.observedMatchDuration([180]),90);assert.equal(mod.observedMatchDuration([96,97,90]),97);
});

test('a complete reference cannot activate before compatible production code is deployed',async()=>{
 const x=setup();const result=await x.mod.prepareReportReference(x.db,'test-only-key',{runtimeReady:async()=>false});
 assert.equal(result.pending,'WAITING_FOR_DEPLOYMENT');assert.equal(x.current().version,'form-v2');assert.equal(x.current().report_reference.status,'ready');
 assert.equal((await x.mod.prepareReportReference(x.db,'test-only-key',{runtimeReady:async()=>true})).active,true);
});
