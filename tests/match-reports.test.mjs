import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const labels=loadTs('../lib/kickx/score-labels.ts');
const model=loadTs('../server/kickx/report-model.ts',{'server-only':{},'@/lib/kickx/score-labels':labels});
const facts={playerName:'테스트 선수',opponent:'테스트 팀',playedAt:'2026-10-18T12:00:00Z',minutes:90,score:57,scoreStatus:'provisional',ruleVersion:'form-v2',contributions:[{metric:'minutes',value:90,points:30},{metric:'goals',value:1,points:30},{metric:'yellow_cards',value:1,points:-3}],warningCount:2,priceBefore:100000,priceAfter:92000,targetPrice:80000,formScore:40,changePercent:-8,windowSize:5};
const text={performance:'득점과 출전 시간이 가점에 기여했고 경고가 일부 감점으로 반영됐습니다.',value:'목표 가격이 직전 가격보다 낮아 하락 방향으로 반영됐습니다.'};
const response=(value,reason='STOP')=>Response.json({candidates:[{finishReason:reason,content:{parts:[{text:JSON.stringify(value)}]}}]});
test('free model is explicit and an absent key cannot issue model requests',()=>{
 assert.equal(model.reportModelConfig({}),null);
 assert.deepEqual(model.reportModelConfig({GEMINI_API_KEY:' test '}),{key:'test',model:'gemini-3.5-flash-lite'});
 assert.equal(model.reportModelConfig({GEMINI_API_KEY:'test',GEMINI_REPORT_MODEL:'../other'}),null);
});
test('positive performance does not imply price rises, and the prompt excludes identities/raw payloads',()=>{
 const prompt=JSON.parse(model.reportPrompt({...facts,raw:'private',portfolio:{balance:1000},userId:'secret'}));
 assert.equal(prompt.direction,'하락');assert.equal(prompt.score,57);
 for(const field of ['playerName','opponent','raw','portfolio','userId','playedAt'])assert.equal(prompt[field],undefined);
 assert.equal(prompt.contributions[1].item,'득점');
});
test('model output cannot replace exact numbers, inject HTML, return excess text, or skip a section',()=>{
 assert.deepEqual(model.parseReportText(text),text);
 for(const value of [{...text,value:'가격이 8% 상승했습니다.'},{...text,performance:'<script>잘못된 내용입니다.</script>'},{...text,value:'가'.repeat(221)},{performance:text.performance},{...text,value:'가격이 ９% 상승했습니다.'}])assert.throws(()=>model.parseReportText(value),/invalid-output/);
});
test('provider request is bounded, has no search tools, and keeps credentials out of URLs',async()=>{
 let calls=0;
 const result=await model.generateReport(facts,{key:'private-key',model:'gemini-3.5-flash-lite'},async(url,init)=>{
  calls++;assert.ok(!url.includes('private-key'));
  assert.equal(init.headers['x-goog-api-key'],'private-key');
  const body=JSON.parse(init.body);assert.equal(body.generationConfig.maxOutputTokens,650);
  assert.equal(body.tools,undefined);assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
  return response(text);
 });
 assert.equal(calls,1);assert.deepEqual(result,text);
});
test('quota errors, truncation, malformed responses and excessive payloads never retry automatically',async()=>{
 for(const reply of [()=>new Response('',{status:429}),()=>response(text,'MAX_TOKENS'),()=>response({value:'설명이 불완전합니다.'}),()=>new Response('a'.repeat(16001))]){
  let calls=0;await assert.rejects(model.generateReport(facts,{key:'test',model:'gemini-3.5-flash-lite'},async()=>{calls++;return reply();}));assert.equal(calls,1);
 }
});

class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
function handlers({existing={status:'missing',facts},claim={status:'claimed',facts,inputHash:'hash',claimToken:'token'},configured=true,providerFailure=false,originAllowed=true,authenticated=true}={}) {
 const calls=[];let generated=0;let completed=false;
 const db={rpc:async(name,args)=>{calls.push({name,args});
  if(name==='kickx_read_match_report')return {data:completed?{status:'ready',facts,text,generatedAt:'2026-10-20'}:existing,error:null};
  if(name==='kickx_claim_match_report')return {data:claim,error:null};
  if(name==='kickx_finish_match_report'){completed=!!args.p_body;return {data:completed,error:null};}
  throw new Error('Unexpected RPC');
 }};
 const api=loadTs('../server/kickx/match-reports.ts',{
  'server-only':{},'./admin-db':{createAdminDatabase:()=>db},
  './http':{authenticatedClient:async()=>{if(!authenticated)throw new HttpError(401,'AUTH');return {user:{id:'verified-user'}};},requireOrigin:()=>{if(!originAllowed)throw new HttpError(403,'ORIGIN');},failure:error=>Response.json({error:error.message},{status:error.status||500}),json:data=>Response.json(data)},
  './prototype':{identity:id=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new HttpError(400,'ID');return id;},checkDatabase:error=>{if(error)throw new Error('DB');}},
  './report-model':{ReportModelError:model.ReportModelError,reportModelConfig:()=>configured?{key:'test',model:'free-model'}:null,generateReport:async()=>{generated++;if(providerFailure)throw new model.ReportModelError('rate-limit');return text;}},
 });
 return {...api,calls,generated:()=>generated};
}
test('a page/report read never generates or writes; its public response omits lease and requester data',async()=>{
 const api=handlers({existing:{status:'ready',facts,text,inputHash:'private-hash',claimToken:'private-token',requestedBy:'private-user'}});
 const response=await api.readMatchReport('player','fixture');const body=await response.json();
 assert.match(response.headers.get('Cache-Control'),/s-maxage=60/);assert.equal(api.generated(),0);
 assert.deepEqual(api.calls.map(c=>c.name),['kickx_read_match_report']);
 for(const key of ['inputHash','claimToken','requestedBy'])assert.equal(body[key],undefined);
});
test('historical initial-price inputs retain their distinct explanation without generating',async()=>{
 const existing={status:'unavailable',facts:null,unavailableReason:'baseline-history'};
 const api=handlers({existing,claim:existing});
 assert.equal((await (await api.readMatchReport('player','fixture')).json()).unavailableReason,'baseline-history');
 assert.equal((await (await api.createMatchReport(new Request('https://kickx.test'),'player','fixture')).json()).unavailableReason,'baseline-history');
 assert.equal(api.generated(),0);
});
test('cached and competing claims skip the provider; missing configuration performs only a read',async()=>{
 for(const claim of [{status:'ready',facts,text},{status:'pending',facts},{status:'limited',facts}]){
  const api=handlers({claim});await api.createMatchReport(new Request('https://kickx.test'),'player','fixture');assert.equal(api.generated(),0);assert.equal(api.calls.length,1);
 }
 const api=handlers({configured:false});const response=await api.createMatchReport(new Request('https://kickx.test'),'player','fixture');
 assert.equal((await response.json()).canGenerate,false);assert.equal(api.generated(),0);assert.deepEqual(api.calls.map(c=>c.name),['kickx_read_match_report']);
});
test('generation finalizes with a lease and then re-reads current facts; failures store no provider message',async()=>{
 const api=handlers();const response=await api.createMatchReport(new Request('https://kickx.test'),'player','fixture');
 assert.equal(api.generated(),1);assert.equal((await response.json()).status,'ready');
 assert.deepEqual(api.calls.map(c=>c.name),['kickx_claim_match_report','kickx_finish_match_report','kickx_read_match_report']);
 assert.equal(api.calls[1].args.p_token,'token');assert.equal(api.calls[1].args.p_hash,'hash');
 const failed=handlers({providerFailure:true});await failed.createMatchReport(new Request('https://kickx.test'),'player','fixture');
 assert.equal(failed.calls[1].args.p_body,null);assert.equal(failed.calls[1].args.p_error,'rate-limit');
});
test('cross-origin, invalid IDs and signed-out writes never reach the DB or model',async()=>{
 for(const options of [{originAllowed:false},{authenticated:false}]){
  const api=handlers(options);const r=await api.createMatchReport(new Request('https://kickx.test'),'player','fixture');
  assert.ok([401,403].includes(r.status));assert.equal(api.calls.length,0);assert.equal(api.generated(),0);
 }
 const api=handlers();assert.equal((await api.readMatchReport('../bad','fixture')).status,400);assert.equal(api.calls.length,0);
});
