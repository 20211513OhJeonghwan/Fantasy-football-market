import test from 'node:test';
import assert from 'node:assert/strict';
import { fixturePollDelay, leagueContexts, runRealtimeFootball } from '../scripts/lib/realtime-football.mjs';
import { SyncError } from '../scripts/lib/football.mjs';
const now='2026-10-17T12:00:00Z';
test('polling checks live and just-finished matches quickly, but backs off old corrections and cancellations',()=>{
 assert.equal(fixturePollDelay({status:'LIVE',starts_at:'2026-10-17T10:00:00Z'},now),60000);
 assert.equal(fixturePollDelay({status:'NS',starts_at:'2026-10-17T12:05:00Z'},now),300000);
 assert.equal(fixturePollDelay({status:'PEN',starts_at:'2026-10-17T09:00:00Z',finished_observed_at:'2026-10-17T11:59:00Z'},now),120000);
 assert.equal(fixturePollDelay({status:'FT',finished_observed_at:'2026-10-17T09:00:00Z'},now),86400000);
 assert.equal(fixturePollDelay({status:'CANC'},now),21600000);
});
test('regular and supplemental competitions share polling while stale seasons and disabled cups are excluded',()=>{
 const row=(id,end='2027-06-30')=>({external_id:id,raw:{currentSeason:{season:{id:id+100,year:2026,is_current:true,start_date:'2026-07-01',end_date:end}}}});
 assert.deepEqual(leagueContexts([row(1),row(7),row(44,'2026-06-30')],now,true).map(c=>c.league),[1,7]);
 assert.deepEqual(leagueContexts([row(1),row(7)],now,false).map(c=>c.league),[1]);
});
function harness({task=null,fixture=null,providerFailure=false}={}) {
 if(task && !task.retry_at)task.retry_at=now;
 const calls=[],store={kickx_policy:{club_competitions_enabled:true},football_entity_sources:[{external_id:1,raw:{currentSeason:{season:{id:101,year:2026,is_current:true,start_date:'2026-07-01',end_date:'2027-06-30'}}}}],teams:[{external_id:10}],realtime_fixture_tasks:task?[task]:[],realtime_calendar_checks:[{league_id:'bsd-1',season_id:101,retry_at:'2027-01-01'}],calculation_queue:[],realtime_fixture_checks:task?[{fixture_id:task.fixture_id,retry_at:now}]:[]};
 const db={rpc:async(name,args)=>{calls.push({name,args});if(name==='kickx_realtime_due_fixtures')return {data:fixture?[fixture]:[]};if(name==='kickx_realtime_claim')return {data:{token:'lease',now}};return {data:0};},from(table){
  let mode='read',value,filters=[],upper=[];
  const q=new Proxy({then(resolve){let data=store[table]??[];if(Array.isArray(data))for(const [key,val] of filters)data=data.filter(row=>row[key]===val);
    if(Array.isArray(data))for(const [key,val] of upper)data=data.filter(row=>String(row[key])<=String(val));
    if(mode==='delete')store[table]=store[table].filter(row=>!data.includes(row));
    if(mode==='update')for(const row of data)Object.assign(row,value);
    if(mode==='upsert'){store[table]??=[];store[table].push(value);}
    calls.push({table,mode,value});return Promise.resolve({data}).then(resolve);}}, {get(target,key){if(key in target)return target[key];return (...args)=>{if(key==='eq')filters.push(args);if(key==='lte')upper.push(args);if(['update','upsert'].includes(key)){mode=key;value=args[0];}if(key==='delete')mode=key;return q;};}});return q;
 }};
 const api={requests:0,async get(path){this.requests++;if(providerFailure)throw new SyncError('PROVIDER_NETWORK_ERROR');assert.match(path,/player-stats/);return {event_id:9,count:0,player_stats:[]};}};
 return {db,api,calls,store};
}
test('unfinished match phases persist across ticks; empty post-match statistics retry instead of publishing zero points',async()=>{
 const task={fixture_id:'bsd-9',payload:{context:{league:1,seasonId:101,seasonYear:2026},eventId:9,phase:'stats',detail:{id:9,league_id:1,season_id:101,home_team_id:10,away_team_id:11,home_team:'Home',away_team:'Away',event_date:'2026-10-17T10:00:00Z',status:'finished',home_score:1,away_score:0}},attempts:0};
 const h=harness({task});const result=await runRealtimeFootball(h.db,'private',{api:h.api,calculate:async()=>({}),now});
 assert.equal(result.imported,1);assert.equal(result.calculated,0);assert.equal(result.error,null);
 assert.equal(h.store.realtime_fixture_tasks.length,0);
 assert.ok(h.calls.some(c=>c.table==='realtime_fixture_checks' && c.mode==='update' && c.value.retry_at==='2026-10-17T12:01:00.000Z'));
 assert.ok(h.calls.some(c=>c.name==='kickx_apply_automatic_task'));
 assert.ok(h.calls.some(c=>c.name==='kickx_realtime_finish' && c.args.p_token==='lease'));
});
test('provider failures retain the original task payload and use backoff, never leaking an error body',async()=>{
 const task={fixture_id:'bsd-9',payload:{eventId:9,context:{league:1},phase:'stats'},attempts:2};
 const h=harness({task,providerFailure:true});const result=await runRealtimeFootball(h.db,'private',{api:h.api,calculate:async()=>({}),now});
 assert.equal(result.failed,1);assert.equal(h.store.realtime_fixture_tasks[0].payload,task.payload);
 assert.equal(task.error_code,'PROVIDER_NETWORK_ERROR');assert.equal(task.attempts,3);
 assert.equal(task.retry_at,'2026-10-17T12:03:00.000Z');
});
test('a busy minute lease performs no provider requests or calculations',async()=>{
 let calls=0;const result=await runRealtimeFootball({rpc:async()=>({data:{busy:true}})},'private',{calculate:async()=>{calls++;},api:{get:()=>calls++}});
 assert.equal(result.busy,true);assert.equal(calls,0);
});
