import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const validation=loadTs('../lib/kickx/validation.ts');
const helpers=loadTs('../lib/kickx/community.ts',{'./validation':validation});
const http=loadTs('../server/kickx/http.ts',{'server-only':{},'@/lib/kickx/validation':validation,'./config':{},'./supabase':{}});
const prototype=loadTs('../server/kickx/prototype.ts',{'server-only':{},'./http':http});
const parse=q=>helpers.parseCommunityQuery(new URLSearchParams(q),prototype.CATEGORIES);
test('community lists select exactly one scope and reject invalid filters',()=>{
 assert.equal(parse('').scope,'player');assert.equal(parse('scope=club').scope,'club');
 for(const q of ['scope=all','scope=','scope=team','sort=random','page=0','page=NaN','page=1.5','page=10001','target=bad%20id','category=unknown','q='+ 'x'.repeat(101)])assert.throws(()=>parse(q));
 assert.deepEqual(parse('scope=player&target=bsd-19&sort=popular&page=2&q=%20hello%20'),{scope:'player',target:'bsd-19',category:null,sort:'popular',page:2,query:'hello'});
});
test('optional titles use a bounded Unicode-safe body excerpt without changing explicit titles',()=>{
 assert.equal(helpers.postTitle('  경기 분석  ','내용입니다'),'경기 분석');
 assert.equal(helpers.postTitle('', '  첫 줄\n다음 줄  '),'첫 줄 다음 줄');
 const body='⚽'.repeat(100);assert.equal([...helpers.postTitle('',body)].length,80);
 assert.equal(helpers.postHeading(helpers.postTitle('',body),body),'');
 assert.equal(helpers.postHeading('직접 쓴 제목',body),'직접 쓴 제목');
 assert.equal(helpers.postTitle('', '가'.repeat(100)), '가'.repeat(80));
});
function setup(){
 const calls=[];const current={scope:'player',target:'bsd-19'};
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='kickx_post_detail'?{post:current}:{id:'11111111-1111-1111-1111-111111111111',items:[],total:0},error:null};},from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='profiles'?{team_id:'bsd-10'}:{id:'bsd-19'},error:null})})})})};
 const route=loadTs('../app/api/kickx/community/route.ts',{'@/server/kickx/http':{...http,authenticatedClient:async()=>({client,user:{id:'verified'}})},'@/server/kickx/prototype':prototype,'@/server/kickx/supabase':{createRequestClient:async()=>client},'@/server/kickx/config':{getSupabaseConfig:()=>({})},'@/lib/kickx/validation':validation,'@/lib/kickx/community':helpers});
 return {calls,route,current};
}
const req=body=>new Request('https://kickx.invalid/api/kickx/community',{method:'POST',headers:{origin:'https://kickx.invalid','content-type':'application/json'},body:JSON.stringify(body)});
test('feed API forwards scope, target and pagination instead of requesting a mixed feed',async()=>{
 const {calls,route}=setup();
 for(const scope of ['club','player']){
  assert.equal((await route.GET(new Request(`https://kickx.invalid/api/kickx/community?scope=${scope}&target=bsd-19&page=2`))).status,200);
  assert.deepEqual(calls.at(-1).args,{p_scope:scope,p_target:'bsd-19',p_query:'',p_category:null,p_sort:'new',p_page:2,p_size:20});
 }
 const count=calls.length;
 for(const query of ['scope=all','page=NaN','postId=11111111-1111-1111-1111-111111111111&page=-1'])assert.equal((await route.GET(new Request('https://kickx.invalid/api/kickx/community?'+query))).status,400);
 assert.equal(calls.length,count);
});
test('quick posts derive their title on the server and preserve scoped fan validation',async()=>{
 const {calls,route}=setup();
 const body={action:'createPost',scope:'player',target:'bsd-19',title:'',body:'제목 없이 남기는 선수 이야기입니다.',category:'자유',transaction:'',requestId:'11111111-1111-1111-1111-111111111111'};
 assert.equal((await route.POST(req(body))).status,200);
 const saved=calls.at(-1);assert.equal(saved.name,'kickx_community_write');assert.equal(saved.args.p_input.title,body.body);assert.equal(saved.args.p_input.scope,'player');
 const count=calls.length;
 assert.equal((await route.POST(req({...body,scope:'club',target:'bsd-20'}))).status,400);
 assert.equal(calls.length,count);
 assert.equal((await route.POST(req({...body,body:'짧음'}))).status,400);
});
test('editing cannot move an existing post between player and club communities',async()=>{
 const {calls,route}=setup();
 const body={action:'editPost',postId:'11111111-1111-1111-1111-111111111111',revision:1,scope:'club',target:'bsd-10',title:'제목',body:'수정하는 게시글 내용입니다.',category:'자유',transaction:''};
 assert.equal((await route.POST(req(body))).status,409);assert.equal(calls.some(c=>c.name==='kickx_community_write'),false);
 assert.equal((await route.POST(req({...body,scope:'player',target:'bsd-20'}))).status,409);
 assert.equal((await route.POST(req({...body,scope:'player',target:'bsd-19'}))).status,200);
});
