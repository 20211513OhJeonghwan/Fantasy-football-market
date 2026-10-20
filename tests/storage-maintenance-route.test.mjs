import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
function setup({error=null,archiveError=false}={}) {
 const calls=[];
 const route=loadTs('../app/api/internal/storage-maintenance/route.ts',{
  '@supabase/supabase-js':{createClient:()=>({rpc:async name=>{calls.push(name);return {error,data:[]};}})},
  '@/server/kickx/config':{getSupabaseConfig:()=>({url:'https://example.supabase.co',key:'public-key'})},
  '@/scripts/lib/calculation-archives.mjs':{archiveCalculationRevisions:async()=>{calls.push('archive');if(archiveError)throw Error('private detail');return {archived:0,done:true};}},
 });
 return {route,calls,req:key=>new Request('https://kickx.invalid/api/internal/storage-maintenance',{method:'POST',headers:{authorization:'Bearer '+key}})};
}
test('archive route checks database permission before accessing any backup data',async()=>{
 const h=setup({error:{message:'private detail'}});
 assert.equal((await h.route.POST(h.req('public-key'))).status,401);assert.equal(h.calls.length,0);
 assert.equal((await h.route.POST(h.req('member-key'))).status,401);assert.deepEqual(h.calls,['kickx_revision_archive_batch']);
});
test('archive route returns only counters, keeps responses private and redacts failures',async()=>{
 const h=setup();const response=await h.route.POST(h.req('service-key'));
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
 assert.deepEqual(await response.json(),{archived:0,done:true});
 const failed=setup({archiveError:true});const failure=await failed.route.POST(failed.req('service-key'));
 assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{error:'ARCHIVE_RETRY'});
});
