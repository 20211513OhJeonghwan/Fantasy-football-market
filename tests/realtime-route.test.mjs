import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
function setup({claimError=null,busy=false}={}) {
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push({name,args});return name==='kickx_realtime_claim'?{data:busy?{busy:true}:{token:'lease'},error:claimError}:{data:null};}};
 const route=loadTs('../app/api/internal/football/route.ts',{'@supabase/supabase-js':{createClient:()=>db},'@/server/kickx/config':{getSupabaseConfig:()=>({url:'https://project.supabase.co',key:'public-key'})},'@/server/kickx/engine/service':{calculatePlayer:()=>{}},'@/scripts/lib/realtime-football.mjs':{runRealtimeFootball:async()=>({error:null,checked:1})}});
 const req=(key,body='not JSON')=>new Request('https://kickx.invalid/api/internal/football',{method:'POST',headers:{authorization:'Bearer '+key},body});
 return {route,calls,req};
}
test('worker endpoint rejects public keys and invalid service credentials before parsing its body',async()=>{
 const h=setup({claimError:{message:'private database detail'}});
 assert.equal((await h.route.POST(h.req('public-key'))).status,401);
 assert.equal(h.calls.length,0);
 const rejected=await h.route.POST(h.req('invalid-key'));
 assert.equal(rejected.status,401);assert.deepEqual(await rejected.json(),{error:'UNAUTHORIZED'});
 assert.equal(h.calls.length,1);
});
test('overlapping minute requests stop at the DB lease without reading BSD credentials',async()=>{
 const h=setup({busy:true});const response=await h.route.POST(h.req('service-key'));
 assert.deepEqual(await response.json(),{busy:true});assert.equal(h.calls.length,1);
});
test('authenticated malformed input releases its lease and redacts all credential/error details',async()=>{
 const h=setup();const response=await h.route.POST(h.req('service-key'));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'WORKER_RETRY'});
 assert.equal(h.calls.at(-1).name,'kickx_realtime_finish');assert.equal(h.calls.at(-1).args.p_token,'lease');
});
test('authenticated worker passes only a bounded job and exposes no credentials in the response',async()=>{
 const h=setup();const response=await h.route.POST(h.req('service-key',JSON.stringify({bsdKey:'private-bsd-token'})));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{error:null,checked:1});
});
