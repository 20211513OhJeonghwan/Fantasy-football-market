import test from 'node:test';import assert from 'node:assert/strict';
import { compatibleName, matchKoreanName, lookupKoreanName, mapPlayerNames, nameSignature } from '../scripts/lib/player-names.mjs';
const claim=value=>({mainsnak:{datavalue:{value}}});
const entity={id:'Q439722',labels:{en:{value:'Son Heung-min'},ko:{value:'손흥민'}},claims:{P31:[claim({id:'Q5'})],P106:[claim({id:'Q937857'})],P569:[claim({time:'+1992-07-08T00:00:00Z',precision:11})]}};
const player={id:'bsd-1',name:'Son Heung-min',english:null,birth_date:'1992-07-08'};
test('automatic Korean names require unique exact-DOB footballer identity and published Hangul label',()=>{
 assert.equal(matchKoreanName(player,{a:entity}).displayName,'손흥민');
 assert.equal(matchKoreanName({...player,birth_date:null},{a:entity}),null);
 assert.equal(matchKoreanName({...player,birth_date:'1992-07-09'},{a:entity}),null);
 assert.equal(matchKoreanName(player,{a:entity,b:{...entity,id:'Q2'}}),null);
 assert.equal(matchKoreanName(player,{a:{...entity,claims:{...entity.claims,P106:[]}}}),null);
 assert.equal(matchKoreanName(player,{a:{...entity,labels:{en:{value:'Son Heung-min'}}}}),null);
 assert.equal(compatibleName('S. Heung-min','Son Heung-min'),true);assert.equal(compatibleName('S. Min','Son Heung-min'),false);
});
test('lookup obeys provider backoff, selects candidate IDs and never uses unverified labels',async()=>{
 const waits=[],urls=[];const result=await lookupKoreanName(player,{wait:async ms=>waits.push(ms),fetchImpl:async url=>{urls.push(url);return {ok:true,json:async()=>urls.length===1?{search:[{id:'Q439722'}]}:{entities:{Q439722:entity}}};}});
 assert.equal(result.sourceId,'Q439722');assert.deepEqual(waits,[500,500]);assert.equal(urls[1].searchParams.get('ids'),'Q439722');
});
test('manual overrides and unchanged cached misses skip lookup; new identities use source CAS',async()=>{
 let offset=0,calls=0;const applied=[];const checks=[];const now='2026-10-09T12:00:00Z';
 const rows=[{...player,id:'manual',player_names:{source:'manual'}},{...player,id:'cached',name_mapping_checks:{checked_at:now,status:'unmatched',input_signature:nameSignature(player)}},{...player,id:'new'}];
 const query={select(){return this;},eq(){return this;},order(){return this;},range:async()=>({data:offset++?[]:rows})};
 const db={from:table=>table==='players'?query:{upsert:async value=>{checks.push(value);return {data:null};}},rpc:async(_,args)=>{applied.push(args);return {data:true};}};
 const r=await mapPlayerNames(db,{now,lookup:async()=>{calls++;return {displayName:'손흥민',aliases:['Son Heung-min'],sourceId:'Q439722'};}});
 assert.equal(calls,1);assert.equal(r.matched,1);assert.deepEqual(applied[0].p_expected,{name:player.name,english:null,birth_date:player.birth_date});assert.equal(checks[0].player_id,'new');
});
test('name mapping checkpoints completed identity and stops at the time ceiling before the next lookup',async t=>{
 let clock=1000;t.mock.method(Date,'now',()=>clock);const checks=[];let calls=0;
 const query={select(){return this;},eq(){return this;},order(){return this;},range:async()=>({data:[{...player,id:'first'},{...player,id:'second'}]})};
 const db={from:table=>table==='players'?query:{upsert:async value=>{checks.push(value);return {data:null};}}};
 const r=await mapPlayerNames(db,{deadline:2000,lookup:async()=>{calls++;clock=3000;return null;}});
 assert.equal(r.processed,1);assert.equal(calls,1);assert.equal(checks[0].player_id,'first');
});
