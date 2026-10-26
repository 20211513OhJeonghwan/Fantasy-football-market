import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const data=loadTs('../lib/kickx/data.ts');
const checkDatabase=error=>{if(error)throw new Error(error.message||'DB_FAILURE');};
const migrationMissing=error=>error?.code==='PGRST202';
const trading={attachTradeWindows:async(_db,players)=>players};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function queryFor(table, started, replies, gates={}) {
  const query=new Proxy({then(resolve,reject){started.push(table);return (async()=>{
    if(gates[table])await gates[table].promise;
    return replies[table]??{data:[],error:null,count:0};
  })().then(resolve,reject);}}, {get(target,key){return key in target?target[key]:()=>query;}});
  return query;
}

test('dashboard policy, community, rankings and freshness start without waiting for one another',async()=>{
  const started=[],gate=deferred(), policy={data:{version:'test'},error:null};
  const replies={kickx_policy:policy,kickx_posts:{data:{items:[]},error:null},kickx_community_counts:{data:[],error:null},kickx_market_summary:{data:{volume:0},error:null},kickx_data_freshness:{data:{lastCheckedAt:'2026-10-18'},error:null}};
  const db={from:table=>queryFor(table,started,replies,{kickx_policy:gate}),rpc:name=>queryFor(name,started,replies)};
  const {readPrototypePublic}=loadTs('../server/kickx/public-prototype.ts',{'server-only':{},'./prototype':{FORMATIONS:[],checkDatabase,migrationMissing}});
  const result=readPrototypePublic(db);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(started.includes('kickx_data_freshness'));
  assert.ok(started.includes('kickx_posts'));
  assert.equal(started.filter(name=>name==='ranking_snapshots').length,2);
  gate.resolve();
  assert.equal((await result).freshness.lastCheckedAt,'2026-10-18');
});

test('catalog previews and trade windows can complete while dashboard extras are still pending',async()=>{
  const gate=deferred(),started=[],window=deferred();
  const catalog=loadTs('../server/kickx/catalog.ts',{'server-only':{},'@/lib/kickx/data':data,'./trading':{attachTradeWindows:async(_db,players)=>{window.resolve();return players;}},'./public-prototype':{readPrototypePublic:async()=>{started.push('prototype');await gate.promise;return {};}}});
  const replies={player_catalog:{data:[{id:'test-player',name:'Test'}],error:null,count:1}};
  const operation=catalog.readCatalog({from:table=>queryFor(table,started,replies)});
  await window.promise;
  assert.ok(started.includes('prototype'));
  gate.resolve();
  assert.equal((await operation).players.length,1);
});

test('player history, scores, pricing and trading restrictions run together after identity is found',async()=>{
  const started=[],historyGate=deferred();
  const base=loadTs('../server/kickx/catalog.ts',{'server-only':{},'@/lib/kickx/data':data,'./trading':trading,'./public-prototype':{readPrototypePublic:async()=>({})}});
  const replies={player_catalog:{data:{id:'test-player',name:'Test'},error:null},price_history:{data:[],error:null},player_analyses:{data:null,error:null},player_initial_values:{data:null,error:null}};
  const db={from:table=>queryFor(table,started,replies,{price_history:historyGate})};
  const {readPlayerDetail}=loadTs('../server/kickx/catalog-pages.ts',{'server-only':{},'./catalog':base,'./prototype':{checkDatabase,migrationMissing},'./trading':{attachTradeWindows:async(_db,players)=>{started.push('windows');return players;}},'@/lib/kickx/catalog-query':{}});
  const operation=readPlayerDetail(db,'test-player');
  await new Promise(resolve=>setImmediate(resolve));
  for(const name of ['price_history','scoped_player_match_records','scoped_performance_results','player_initial_values','player_price_results','windows'])assert.ok(started.includes(name),name);
  historyGate.resolve();
  const player=await operation;
  assert.equal(player.id,'test-player');assert.deepEqual(player.records,[]);assert.deepEqual(player.pricing.recent,[]);
});

function memberRepository(replies) {
  const calls=[];
  const db={rpc:async name=>{calls.push(name);return replies[name].shift();}};
  const {SupabaseKickxRepository}=loadTs('../server/kickx/supabase-repository.ts',{'server-only':{},'./trading':trading,'./supabase':{createRequestClient:async()=>db},'./catalog':{mapPlayer:row=>row},'./public-cache':{},'./prototype':{checkDatabase,migrationMissing},'./ingestion':{readOperations:async()=>{throw new Error('Unexpected admin read');}}});
  const repo=new SupabaseKickxRepository();
  repo.getSession=async()=>({userId:'verified-user',profile:{nickname:'Test'},role:'member'});
  return {repo,calls};
}
test('existing-member refreshes do not take the global wallet initialization lock',async()=>{
  const {repo,calls}=memberRepository({kickx_member_data:[{data:{points:0,ownedPlayers:[]},error:null}]});
  assert.equal((await repo.getMemberData('verified-user')).points,0);
  assert.deepEqual(calls,['kickx_member_data']);
});
test('a new member initializes its wallet once and re-reads confirmed member data',async()=>{
  const {repo,calls}=memberRepository({kickx_member_data:[{data:null,error:{code:'P0001',message:'PROFILE_REQUIRED'}},{data:{points:123,ownedPlayers:[]},error:null}],kickx_open_wallet:[{data:{balance:123},error:null}]});
  assert.equal((await repo.getMemberData('verified-user')).points,123);
  assert.deepEqual(calls,['kickx_member_data','kickx_open_wallet','kickx_member_data']);
});
test('member read errors and a different supplied user never trigger wallet initialization',async()=>{
  const first=memberRepository({kickx_member_data:[{data:null,error:{code:'XX000',message:'DB_FAILURE'}}]});
  await assert.rejects(first.repo.getMemberData('verified-user'),/DB_FAILURE/);
  assert.deepEqual(first.calls,['kickx_member_data']);
  const second=memberRepository({});
  await assert.rejects(second.repo.getMemberData('different-user'),/identity mismatch/);
  assert.deepEqual(second.calls,[]);
});
