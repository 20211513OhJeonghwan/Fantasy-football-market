import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const validation=loadTs('../lib/kickx/validation.ts');
const config={getSupabaseConfig:()=>({url:'https://test-project.supabase.co',key:'sb_publishable_test'})};

test('public database reads never load visitor cookies or construct an SSR auth client',async()=>{
 const calls=[];
 const adapter=loadTs('../server/kickx/supabase.ts',{
  'server-only':{},'./config':config,
  'next/headers':{cookies:()=>{throw Error('Public read accessed auth cookies');}},
  '@supabase/ssr':{createServerClient:()=>{throw Error('Public read constructed SSR auth');}},
  '@supabase/supabase-js':{createClient:(...args)=>{calls.push(args);return 'anonymous-client';}},
 });
 assert.equal(adapter.createPublicClient(),'anonymous-client');
 assert.deepEqual(calls[0][2].auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
});

test('new OAuth flows ignore old session chunks but preserve the PKCE verifier and write new cookies',async()=>{
 const cookies=[{name:'sb-test-project-auth-token',value:'expired'},{name:'sb-test-project-auth-token.0',value:'expired-chunk'},
  {name:'sb-test-project-auth-token-code-verifier',value:'valid-pkce'},{name:'kickx-auth-next',value:'/market'}];
 let options;const writes=[];
 const adapter=loadTs('../server/kickx/supabase.ts',{
  'server-only':{},'./config':config,'@supabase/supabase-js':{},
  'next/headers':{cookies:async()=>({getAll:()=>cookies,set:(...args)=>{writes.push(args);const stored=cookies.find(x=>x.name===args[0]);if(stored)stored.value=args[1];}})},
  '@supabase/ssr':{createServerClient:(_url,_key,settings)=>{options=settings;return settings;}},
 });
 await adapter.createRequestClient({freshAuth:true});
 assert.deepEqual(options.cookies.getAll().map(x=>x.name),['sb-test-project-auth-token-code-verifier','kickx-auth-next']);
 options.cookies.setAll([{name:'sb-test-project-auth-token',value:'new-session',options:{httpOnly:true}}]);
 assert.deepEqual(writes,[['sb-test-project-auth-token','new-session',{httpOnly:true}]]);
 assert.equal(options.cookies.getAll().find(x=>x.name==='sb-test-project-auth-token').value,'new-session');
 await adapter.createRequestClient();
 assert.equal(options.cookies.getAll().length,4);
});

test('creating a configured catalog repository never starts session refresh, and member checks still verify Auth',async()=>{
 let clients=0,verified=0;
 const db={auth:{getUser:async()=>{verified++;return {data:{user:{id:'verified-user'}},error:null};}},
  from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null})})};
 const {SupabaseKickxRepository}=loadTs('../server/kickx/supabase-repository.ts',{
  'server-only':{},'./supabase':{createRequestClient:async()=>{clients++;return db;}},'./trading':{},'./catalog':{},'./public-cache':{},'./prototype':{},'./ingestion':{},
 });
 const repo=new SupabaseKickxRepository();
 assert.equal(clients,0);
 const [a,b]=await Promise.all([repo.getSession(),repo.getSession()]);
 assert.equal(clients,1);assert.equal(verified,1);assert.equal(a.userId,'verified-user');assert.deepEqual(a,b);
});

test('public list and detail routes use anonymous reads while private filters still require authentication',async()=>{
 const selected=[];let publicClients=0;
 const http=loadTs('../server/kickx/http.ts',{'server-only':{},'@/lib/kickx/validation':validation,'./config':config,'./supabase':{}});
 const {catalogPage,catalogDetail}=loadTs('../server/kickx/catalog-http.ts',{
  'server-only':{},'@/lib/kickx/catalog-query':loadTs('../lib/kickx/catalog-query.ts'),'@/lib/kickx/fixtures':loadTs('../lib/kickx/fixtures.ts'),
  './repository':{getKickxRepository:()=>({configured:true})},'./supabase':{createPublicClient:()=>{publicClients++;return 'public';}},
  './http':{...http,authenticatedClient:async()=>{selected.push('authenticated');return {client:'member'};}},
  './prototype':{prototypeAvailable:async()=>true},'./read-timing':{timedRead:operation=>operation()},
  './catalog-pages':{readPlayerPage:async db=>{selected.push(db);return {items:[]};},readFixturePage:async db=>{selected.push(db);return {items:[]};},readPlayerDetail:async db=>{selected.push(db);return null;}},
  './public-cache':{readCachedPlayerPage:async()=>{publicClients++;selected.push('public');return {items:[]};},readCachedFixturePage:async()=>{publicClients++;selected.push('public');return {items:[]};},readCachedPlayerDetail:async()=>{publicClients++;selected.push('public');return null;}},
 });
 for(const [kind,query] of [['players',''],['fixtures',''],['players','scope=watch'],['players','scope=owned']]){
  assert.equal((await catalogPage(new Request('https://kickx.invalid/api/kickx/'+kind+'?'+query),kind)).status,200);
 }
 assert.equal((await catalogDetail('bsd-330')).status,200);
 assert.equal(publicClients,3);
 assert.deepEqual(selected,['public','public','authenticated','member','authenticated','member','public']);
});

test('OAuth callback trusts the one-time server exchange, never a cookie identity or a redundant user request',async()=>{
 let exchanged='code',profileId,options;
 const next={redirect:(url,status)=>new Response(null,{status,headers:{location:url.toString()}})};
 const route=loadTs('../app/auth/callback/route.ts',{
  'next/headers':{cookies:async()=>({get:()=>({value:'/market'}),set:()=>{}})},'next/server':{NextResponse:next},
  '@/server/kickx/config':config,'@/server/kickx/http':{privateHeaders:{'Cache-Control':'private, no-store'}},'@/lib/kickx/validation':validation,
  '@/server/kickx/supabase':{createRequestClient:async settings=>{options=settings;return {
   auth:{exchangeCodeForSession:async code=>{assert.equal(code,exchanged);return {data:{user:exchanged?{id:'server-verified'}:null},error:null};},getUser:()=>{throw Error('Redundant user call');}},
   from:()=>({select(){return this;},eq(_column,id){profileId=id;return this;},maybeSingle:async()=>({data:{id:profileId},error:null})}),
  };}},
 });
 const response=await route.GET(new Request('https://kickx.invalid/auth/callback?code=code'));
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),'https://kickx.invalid/market');
 assert.deepEqual(options,{freshAuth:true});assert.equal(profileId,'server-verified');
 exchanged='';profileId=null;
 const rejected=await route.GET(new Request('https://kickx.invalid/auth/callback?code='));
 assert.match(rejected.headers.get('location'),/login\?error=oauth/);assert.equal(profileId,null);
});

test('temporary token-refresh conflicts are service failures, not a false logout or leaked error',async()=>{
 const http=loadTs('../server/kickx/http.ts',{'server-only':{},'@/lib/kickx/validation':validation,'./config':config,'./supabase':{}});
 for(const status of [409,500,504]){
  const result=http.failure({__isAuthError:true,status,message:'private token details'});
  assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/private token/);
 }
 assert.equal(http.failure({__isAuthError:true,status:401}).status,401);
});
