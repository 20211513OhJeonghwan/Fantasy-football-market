import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadTs} from './load-ts.mjs';
const policy=loadTs('../server/kickx/engine/policy.ts');
const performance=loadTs('../server/kickx/engine/performance.ts',{'./policy':policy});
const legacy=loadTs('../server/kickx/engine/legacy-performance.ts');
const pricing=loadTs('../server/kickx/engine/pricing.ts',{'./policy':policy});
const {calculatePlayer}=loadTs('../server/kickx/engine/service.ts',{'server-only':{},'node:crypto':{createHash},'./performance':performance,'./legacy-performance':legacy,'./pricing':pricing,'../http':{HttpError:class extends Error{}},'../prototype':{checkDatabase:error=>{if(error)throw Error(error.message);}}});

test('removing event-wide raw payloads preserves legacy/v2 scores, prices, hashes and correction revisions',async()=>{
 const source={detail:{home_score:0,away_score:0},lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players:Array.from({length:11},(_,i)=>({id:i+1,position:'D'}))},away:{team_id:3,players:Array.from({length:11},(_,i)=>({id:i+12,position:'D'}))}}},incidents:{incidents:[]},updated_at:'2026-10-19T00:00:00Z'};
 const record={player_id:'bsd-2',fixture_id:'bsd-100',team_id:'bsd-1',stats:{minutes_played:90,goals:0,won_tackle:3,interception:3,total_pass:40,accurate_pass:36},legacy_stats:null,updated_at:'2026-10-19T00:00:01Z',fixtures:{id:'bsd-100',status:'FT',home_team_id:'bsd-1',away_team_id:'bsd-3',home_score:0,away_score:0,starts_at:'2026-10-18T12:00:00Z',season:2026,updated_at:'2026-10-19T00:00:02Z'}};
 for(const version of ['prototype-v1','form-v2']){
  const publications=[];
  for(const extra of [{player_stats:{unrelated_players:Array(100).fill({stats:'unused raw payload'})},legacy_stats:{raw:'unused'}},{}]){
   const row={...record,fixtures:{...record.fixtures,football_event_sources:{...source,...extra}}};
   const db={from:table=>{
    const result=table==='kickx_policy'?{data:{version,club_competitions_enabled:true,pricing_reference_at:'2026-08-01T00:00:00Z',pricing_reference_season:2026}}:{data:[row]};
    const q=new Proxy({then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)},{get:(target,key)=>key in target?target[key]:()=>q});return q;
   },rpc:async(name,args)=>{if(name==='kickx_calculation_input')return {error:{code:'PGRST202'}};assert.equal(name,'kickx_publish_calculation');publications.push(args);return {data:{unchanged:false}};}};
   await calculatePlayer(db,'bsd-2',null);
  }
  assert.deepEqual(publications[0],publications[1]);
  assert.equal(publications[0].p_expected[0].sourceAt,source.updated_at);
  assert.equal(publications[0].p_expected[0].statsAt,record.updated_at);
  assert.equal(publications[0].p_expected[0].fixtureAt,record.fixtures.updated_at);
  assert.equal(publications[0].p_results[0].status,'provisional');
 }
});

test('a cached calculation never downloads historical records or policy rows',async()=>{
 const calls=[];
 const db={from:()=>{throw Error('Historical read');},rpc:async(name,args)=>{
  calls.push({name,args});
  return name==='kickx_calculation_input'?{data:{policy:{version:'form-v2',club_competitions_enabled:true},token:'source-revision',records:[]}}:{data:{unchanged:true}};
 }};
 assert.equal((await calculatePlayer(db,'bsd-2',null)).unchanged,true);
 assert.deepEqual(calls.map(x=>x.name),['kickx_calculation_input','kickx_publish_calculation_delta']);
 assert.deepEqual(calls[1].args,{p_actor:null,p_player:'bsd-2',p_token:'source-revision',p_results:[]});
});

test('incremental read failures never fall back to an unbounded historical read',async()=>{
 const db={from:()=>{throw Error('Historical read');},rpc:async()=>({error:{code:'57014',message:'QUERY_TIMEOUT'}})};
 await assert.rejects(calculatePlayer(db,'bsd-2',null),/QUERY_TIMEOUT/);
});
