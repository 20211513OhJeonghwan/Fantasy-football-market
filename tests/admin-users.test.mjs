import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const validation=loadTs('../lib/kickx/validation.ts');
const http=loadTs('../server/kickx/http.ts',{'server-only':{},'@/lib/kickx/validation':validation,'./config':{},'./supabase':{}});
const prototype=loadTs('../server/kickx/prototype.ts',{'server-only':{},'./http':http});
const catalog=loadTs('../lib/kickx/catalog-query.ts');
const request=(input,origin='https://kickx.invalid')=>new Request('https://kickx.invalid/api/kickx/admin/users',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(input)});
test('member management requires verified admin and same origin before a mutation',async()=>{
 let status=403,calls=0;
 const client={rpc:async(name,args)=>{calls++;assert.equal(name,'kickx_restrict_member');assert.equal(args.p_user,'00000000-0000-0000-0000-000000000003');assert.equal(args.p_days,7);assert.equal(args.p_actor,undefined);return {data:null,error:null};}};
 const route=loadTs('../app/api/kickx/admin/users/route.ts',{
  '@/server/kickx/http':{...http,authenticatedClient:async()=>({client})},
  '@/server/kickx/admin-db':{requireAdmin:async()=>{if(status)throw new http.HttpError(status,'denied');},createAdminDatabase:()=>{throw new Error('unused');}},
  '@/server/kickx/prototype':prototype,'@/lib/kickx/catalog-query':catalog,
 });
 const body={userId:'00000000-0000-0000-0000-000000000003',days:7,reason:'Repeated spam',role:'admin'};
 assert.equal((await route.POST(request(body))).status,403);assert.equal(calls,0);
 status=0;assert.equal((await route.POST(request(body,'https://foreign.invalid'))).status,403);
 for(const days of [-1,365,'7'])assert.equal((await route.POST(request({...body,days}))).status,400);
 assert.equal((await route.POST(request({...body,reason:'x'}))).status,400);assert.equal(calls,0);
 assert.equal((await route.POST(request(body))).status,200);assert.equal(calls,1);
});
