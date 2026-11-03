import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs}from './load-ts.mjs';
const {createReportLoader}=loadTs('../lib/kickx/report-client.ts');
const facts={score:8,minutes:90,contributions:[],priceBefore:100000,priceAfter:102000};
const missing={status:'missing',facts,text:null,canGenerate:true};
const ready={...missing,status:'ready',text:{performance:'득점과 출전 시간이 가점에 기여했습니다.'}};
function watcher(loader,user='one',url='/report'){
 const states=[];let finish;
 const done=new Promise(resolve=>{finish=resolve;});
 const stop=loader.subscribe(user,url,state=>{states.push(state);if(!state.loading&&!state.generating)finish(state);});
 return {states,done,stop};
}
test('numeric facts appear before generation; reopen and concurrent dialogs share one account request',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const calls=[];
 const loader=createReportLoader({fetcher:async(url,init)=>{calls.push(init.method);if(init.method==='POST')await gate;return Response.json(init.method==='GET'?missing:ready);}});
 const first=watcher(loader);await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(calls,['GET','POST']);assert.equal(first.states.at(-1).report.facts.score,8);assert.equal(first.states.at(-1).loading,false);assert.equal(first.states.at(-1).generating,true);
 const second=watcher(loader);assert.equal(second.states.at(-1).generating,true);first.stop();release();
 assert.equal((await second.done).report.status,'ready');assert.equal((await watcher(loader).done).report.status,'ready');assert.deepEqual(calls,['GET','POST']);
});
test('a stuck initial response stops loading and allows a fresh manual request without auto polling',async()=>{
 let calls=0;const loader=createReportLoader({getTimeoutMs:15,fetcher:async()=>{calls++;if(calls===1)return new Promise(()=>{});return Response.json(ready);}});
 const failed=await watcher(loader).done;assert.equal(failed.loading,false);assert.equal(failed.report,null);assert.match(failed.error,/지연/);assert.equal(calls,1);
 assert.equal((await watcher(loader).done).report.status,'ready');assert.equal(calls,2);
});
test('a stuck response body and a stuck generation are bounded while keeping known facts',async()=>{
 for(const stuckBody of[false,true]){
  let calls=0;const loader=createReportLoader({getTimeoutMs:15,postTimeoutMs:15,fetcher:async(_url,init)=>{calls++;if(init.method==='GET')return Response.json(missing);return stuckBody?{ok:true,json:()=>new Promise(()=>{})}:new Promise(()=>{});}});
  const failed=await watcher(loader).done;assert.equal(failed.loading,false);assert.equal(failed.generating,false);assert.equal(failed.report.facts.score,8);assert.match(failed.error,/산정 요약/);assert.equal(calls,2);
 }
});
test('cache is per account and expires; pending, cooldown and quota responses never start generation',async()=>{
 let calls=0,t=0;const loader=createReportLoader({now:()=>t,fetcher:async()=>{calls++;return Response.json(ready);}});
 await watcher(loader).done;await watcher(loader).done;assert.equal(calls,1);await watcher(loader,'other').done;assert.equal(calls,2);t=60001;await watcher(loader).done;assert.equal(calls,3);
 for(const status of['pending','cooldown','limited','unavailable']){
  const methods=[];const onlyRead=createReportLoader({fetcher:async(_url,init)=>{methods.push(init.method);return Response.json({...missing,status});}});
  assert.equal((await watcher(onlyRead).done).report.status,status);assert.deepEqual(methods,['GET']);
 }
});
test('transport errors and invalid responses produce an error instead of indefinite loading',async()=>{
 for(const reply of[()=>new Response('<html>error</html>',{status:502}),()=>Response.json({status:'ready'}),()=>Response.json({error:'로그인이 필요합니다.'},{status:401})]){
  const loader=createReportLoader({fetcher:async()=>reply()});const result=await watcher(loader).done;assert.equal(result.loading,false);assert.ok(result.error);assert.equal(result.report,null);
 }
});
