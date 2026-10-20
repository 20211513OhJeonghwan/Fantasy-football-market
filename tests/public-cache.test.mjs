import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';

test('shared public caches use an anonymous client, separate keys, and reject member-specific lists',async()=>{
 const reads=[];
 const unstable_cache=(fn,keys,options)=>{
  assert.equal(options.revalidate,15);assert.deepEqual(options.tags,['kickx-public']);
  const entries=new Map();return async(...args)=>{const key=JSON.stringify([keys,args]);if(!entries.has(key))entries.set(key,await fn(...args));return entries.get(key);};
 };
 const page=(db,input)=>{assert.equal(db,'anonymous');reads.push(input);return {items:[input]};};
 const cache=loadTs('../server/kickx/public-cache.ts',{'server-only':{},'next/cache':{unstable_cache},
  './supabase':{createPublicClient:()=> 'anonymous'},'./catalog':{readCatalog:db=>page(db,'bootstrap')},
  './catalog-pages':{readPlayerPage:page,readFixturePage:page,readPlayerDetail:page}});
 await cache.readCachedCatalog();await cache.readCachedCatalog();
 await cache.readCachedPlayerPage({scope:'all',page:1});await cache.readCachedPlayerPage({scope:'all',page:1});
 await cache.readCachedPlayerPage({scope:'all',page:2});
 await cache.readCachedFixturePage({scope:'all',page:1});
 await cache.readCachedPlayerDetail('bsd-1');await cache.readCachedPlayerDetail('bsd-1');
 assert.equal(reads.length,5);
 for(const scope of ['owned','watch'])await assert.rejects(cache.readCachedPlayerPage({scope}),/Private catalog/);
});

test('member likes are read outside the shared public cache and never mutate its object',async()=>{
 const publicData={players:[],posts:[{id:'post',liked:false}]};
 const repository=loadTs('../server/kickx/supabase-repository.ts',{'server-only':{},'./trading':{},'./catalog':{},
  './public-cache':{readCachedCatalog:async()=>publicData},'./supabase':{createRequestClient:async()=>({rpc:async name=>{assert.equal(name,'kickx_posts');return {data:{items:[{id:'post',liked:true}]}};}})},
  './prototype':{checkDatabase:error=>{if(error)throw error;}},'./ingestion':{}});
 const repo=new repository.SupabaseKickxRepository();repo.getSession=async()=>({userId:'member'});
 assert.equal((await repo.getPublicData()).posts[0].liked,true);
 assert.equal(publicData.posts[0].liked,false);
 repo.getSession=async()=>null;
 assert.equal((await repo.getPublicData()).posts[0].liked,false);
});
