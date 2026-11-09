import assert from 'node:assert/strict';
import {spawn}from 'node:child_process';
import {mkdir,writeFile}from 'node:fs/promises';
import {resolve}from 'node:path';
import {pathToFileURL}from 'node:url';
import {loadTs}from './load-ts.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE||'/tmp/kickx-browser','node_modules/playwright/index.mjs')).href);
const mock=loadTs('../server/kickx/mock-data.ts',{'server-only':{},'@/lib/kickx/squad':loadTs('../lib/kickx/squad.ts')});
const {koreanDay}=loadTs('../lib/kickx/fixtures.ts');
const base='http://localhost:3110',server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','localhost','-p','3110'],{stdio:'ignore'});
let browser;const checks=[],errors=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===39)throw Error('App did not start');await new Promise(r=>setTimeout(r,500));}
 await mkdir('test-artifacts',{recursive:true});browser=await chromium.launch();
 for(const width of[320,390,768,1440]){
  const state=structuredClone({...mock.mockPublicData(),session:mock.mockSession,member:mock.mockMemberData()});
  const ids=['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'],old=state.leagues.map(l=>l.id);
  state.leagues=state.leagues.slice(0,5).map((l,i)=>({...l,id:ids[i]}));state.teams=state.teams.map(t=>({...t,leagueId:ids[old.indexOf(t.leagueId)]??null}));
  const team=state.teams.find(t=>t.id===state.session.profile.team),sub=state.teams.find(t=>t.leagueId&&t.leagueId!==team.leagueId);
  state.session.profile={...state.session.profile,primaryTeam:team.id,teams:[team.id,sub.id],createdAt:'2026-01-01T00:00Z'};
  const player=state.players[0];player.history=[{at:new Date(Date.now()-110*86400000).toISOString(),value:80000},{at:new Date(Date.now()-60*86400000).toISOString(),value:90000},{at:new Date().toISOString(),value:100000}];
  const today=koreanDay(new Date().toISOString());
  state.fixtures=[{id:'later-league',leagueId:'bsd-3',home:team.id,away:sub.id,startsAt:`${today}T01:00:00+09:00`,status:'NS'},{id:'pl-late',leagueId:'bsd-1',home:team.id,away:sub.id,startsAt:`${today}T04:00:00+09:00`,status:'NS'},{id:'pl-early',leagueId:'bsd-1',home:team.id,away:sub.id,startsAt:`${today}T02:00:00+09:00`,status:'NS'}];
  let profileWrites=0,payload=null;
  const post={id:'primary-poll-post',scope:'club',target:sub.id,targetName:sub.name,author:'다른 회원',authorId:'another-member',authorPrimaryTeam:sub.id,title:'다음 경기 예상 투표',body:'다음 경기 결과에 대해 함께 의견을 나눠 봅시다.',date:new Date().toISOString(),likes:0,views:1,commentCount:0,transaction:null,poll:{question:'다음 경기 결과는?',options:['승리','무승부','패배'],endsAt:new Date(Date.now()+86400000).toISOString(),counts:[2,1,0],total:3,myVote:null,closed:false}};
  state.posts=[{...post,id:'sidebar-player-post',scope:'player',target:player.id,authorHoldsPlayer:true}];
  const c=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Seoul'});
  await c.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),path=u.pathname;
   if(path==='/api/kickx')return route.fulfill({json:{status:'ready',data:state}});
   if(path==='/api/kickx/profile'){const input=req.postDataJSON();profileWrites++;state.session.profile={...input,createdAt:new Date().toISOString()};return route.fulfill({json:{profile:state.session.profile}});}
   if(path==='/api/kickx/community'){
    if(req.method()==='GET')return route.fulfill({json:{status:'ready',data:u.searchParams.has('postId')?{post,comments:[],page:1,pages:1}:{items:[],total:0,page:1,size:20}}});
    const input=req.postDataJSON();if(input.action==='vote'){post.poll.myVote=input.option;post.poll.counts[input.option]++;post.poll.total++;}if(input.action==='createPost')payload=input;
    return route.fulfill({json:{id:post.id}});
   }
   if(path==='/api/kickx/fixtures')return route.fulfill({json:{status:'ready',data:{items:state.fixtures,total:3,page:1,size:500}}});
   if(path==='/api/kickx/players')return route.fulfill({json:{status:'ready',data:{items:state.players,total:state.players.length,page:1,size:12}}});
   if(path.startsWith('/api/kickx/players/'))return route.fulfill({json:{status:'ready',data:{player}}});
   return route.fulfill({json:{status:'ready',data:{items:[],hasUnread:false,matchNotifications:true,total:0,page:1,size:20}}});
  });
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  async function go(path){await p.goto(base+path,{waitUntil:'networkidle'});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}:${path} overflow`);}
  await go('/mypage');assert(await p.locator('.profile-primary-locked').isVisible());assert.equal(await p.getByRole('combobox',{name:'메인 응원 구단',exact:true}).count(),0);
  const subLeague=state.leagues.find(l=>l.id===sub.leagueId);assert(await p.getByRole('combobox',{name:`${subLeague.name} 응원 구단`,exact:true}).isDisabled());await p.screenshot({path:`test-artifacts/primary-profile-${width}.png`,fullPage:true});
  await go('/community/posts/'+post.id);await p.locator('.community-poll').waitFor();assert(await p.locator('.article-author .primary-name-crest').isVisible());
  await p.getByRole('button',{name:/승리.*2표/}).click();await p.getByRole('button',{name:'투표하기',exact:true}).click();await p.getByRole('button',{name:'투표 변경',exact:true}).waitFor();assert.equal(post.poll.myVote,0);await p.screenshot({path:`test-artifacts/community-poll-${width}.png`,fullPage:true});
  await go('/community/write?scope=player&target='+player.id);await p.locator('#post-title').fill('교체 출전도 기준점으로 평가되네요');await p.locator('#post-body').fill('출전 시간만으로 낮은 평가를 받지 않고 실제 활약을 구분할 수 있어서 이해하기 쉬워졌습니다.');
  await p.getByRole('button',{name:'투표 추가',exact:true}).click();await p.getByLabel('투표 질문',{exact:true}).fill('다음 경기 선발로 나올까요?');await p.getByLabel('선택지 1',{exact:true}).fill('선발 예상');await p.getByLabel('선택지 2',{exact:true}).fill('교체 예상');await p.getByRole('button',{name:'게시글 등록',exact:true}).click();await p.getByRole('heading',{name:'게시글을 등록했습니다',exact:true}).waitFor();assert.equal(payload.target,player.id);assert.equal(payload.poll.options.length,2);
  await go('/players/'+player.id);assert.equal(await p.locator('.player-community-entry .ownership-badge').count(),1);assert.equal(await p.locator('.player-community-entry .primary-name-crest').count(),1);for(const period of['1개월','3개월','전체']){const button=p.getByRole('button',{name:period,exact:true});await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');}
  await go('/fixtures');const leagueGroups=p.locator('.match-day.today .match-league-group');assert.equal(await leagueGroups.count(),2);assert.match(await leagueGroups.nth(0).innerText(),new RegExp(state.leagues[0].name));assert.equal(await leagueGroups.nth(0).locator('.match-meta time').first().innerText(),'02:00');await p.screenshot({path:`test-artifacts/league-schedule-${width}.png`,fullPage:true});
  if(width===390){state.session.profile=null;await go('/onboarding');await p.locator('#profile-nickname').fill('본진 새 회원');await p.getByRole('combobox',{name:'메인 응원 구단',exact:true}).click();await p.getByRole('option',{name:team.name,exact:true}).click();let warning='';p.once('dialog',async d=>{warning=d.message();await d.accept();});await p.getByRole('button',{name:'프로필 등록',exact:true}).click();await p.waitForURL(base+'/');assert.match(warning,/영구/);assert.match(warning,/변경.*없/);assert.equal(profileWrites,1);assert.equal(state.session.profile.primaryTeam,team.id);assert.equal(state.session.profile.confirmPrimary,true);}
  checks.push({width,primaryLocked:true,subteamWindow:true,pollVoted:true,playerPostWithPoll:true,chartPeriods:true,leagueSchedule:true});await c.close();
 }
 assert.deepEqual(errors,[]);await writeFile('test-artifacts/primary-polls-browser.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
