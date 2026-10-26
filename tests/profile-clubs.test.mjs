import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const validation=loadTs('../lib/kickx/validation.ts');
const support=loadTs('../lib/kickx/support.ts');
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
function setup(){
 const writes=[],teams=support.DOMESTIC_LEAGUES.map((league_id,i)=>({id:`club-${i}`,league_id}));teams.push({id:'rival',league_id:'bsd-1'},{id:'outside',league_id:'bsd-7'});
 const client={from(table){let ids=[],values;const q={select(){return q;},in(_key,value){ids=value;return q;},eq(key,value){writes.push({table,key,value});return q;},maybeSingle:async()=>({data:{id:'verified-member'},error:null}),update(value){values=value;return q;},single:async()=>{writes.push(values);return {data:{nickname:values.nickname,team_id:values.team_id,team_ids:values.team_ids},error:null};},then(resolve){return Promise.resolve({data:teams.filter(t=>ids.includes(t.id)),error:null}).then(resolve);}};return q;}};
 const route=loadTs('../app/api/kickx/profile/route.ts',{'@/lib/kickx/validation':validation,'@/lib/kickx/support':support,'@/server/kickx/http':{authenticatedClient:async()=>({client,user:{id:'verified-member'}}),requireOrigin:()=>{},readJson:r=>r.json(),json:(data,status=200)=>Response.json(data,{status}),HttpError,failure:e=>Response.json({error:e.message},{status:e.status??400})}});
 const request=teams=>new Request('https://kickx.invalid/api/kickx/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nickname:'선택 사용자',teams,id:'someone-else',role:'admin'})});
 return {route,writes,request};
}
test('profile API verifies each league, saves all five and binds writes to authenticated identity',async()=>{
 const x=setup();const response=await x.route.POST(x.request(['club-0','club-1','club-2','club-3','club-4']));assert.equal(response.status,200);
 assert.equal((await response.json()).profile.teams.length,5);const saved=x.writes.at(-1);assert.equal(saved.team_id,'club-0');assert.equal(saved.team_ids.length,5);assert.equal(saved.role,undefined);
 assert.ok(x.writes.filter(w=>w.key==='id').every(w=>w.value==='verified-member'));
});
test('profile API rejects two clubs in one league, other competitions and absent clubs before writing',async()=>{
 for(const ids of [['club-0','rival'],['outside'],['missing']]){const x=setup();assert.equal((await x.route.POST(x.request(ids))).status,400);assert.equal(x.writes.length,0);}
});
