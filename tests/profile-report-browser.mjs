import assert from 'node:assert/strict';
import {spawn}from 'node:child_process';
import {mkdir}from 'node:fs/promises';
import {resolve}from 'node:path';
import {pathToFileURL}from 'node:url';
import {loadTs}from './load-ts.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE||'/tmp/kickx-browser','node_modules/playwright/index.mjs')).href);
const mock=loadTs('../server/kickx/mock-data.ts',{'server-only':{},'@/lib/kickx/squad':loadTs('../lib/kickx/squad.ts')});
const base='http://localhost:3106';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','localhost','-p','3106'],{stdio:'ignore'});
let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===39)throw Error('App did not start');await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch();await mkdir('test-artifacts',{recursive:true});const errors=[];
 for(const width of[1440,390]){
  const state=structuredClone({...mock.mockPublicData(),session:mock.mockSession,member:mock.mockMemberData()});
  const leagueIds={epl:'bsd-1',laliga:'bsd-3',bundesliga:'bsd-4',seriea:'bsd-5',ligue1:'bsd-6'};
  state.leagues=state.leagues.map(l=>({...l,id:leagueIds[l.id]}));state.teams=state.teams.map(t=>({...t,leagueId:leagueIds[t.leagueId]}));
  state.session.profile={...state.session.profile,teams:[state.session.profile.team],avatar:null};
  const player=state.players[0],large=state.players[1];
  player.photo='https://sports.bzzoiro.com/img/player/9000001/?sor=true&bg=transparent';large.photo='https://sports.bzzoiro.com/img/player/9000002/?sor=true&bg=transparent';
  player.records=[{id:'report-row',fixtureId:'report-browser-match',reportAvailable:true,playedAt:'2026-11-01T12:00:00Z',opponent:'지연 확인 상대',result:'승',minutes:90,goals:1,assists:0,performance:10}];
  const facts={position:'FW',referenceScore:8,priceSensitivity:.1,priceExposure:1,playerName:player.name,opponent:'지연 확인 상대',playedAt:'2026-11-01T12:00:00Z',minutes:90,score:10,scoreStatus:'ready',ruleVersion:'report-v3',contributions:[{metric:'minutes',value:90,points:2},{metric:'goals',value:1,points:4},{metric:'shots_on_target',value:4,points:4}],warningCount:0,priceBefore:100000,priceAfter:102500,targetPrice:102500,formScore:10,changePercent:2.5,windowSize:6};
  const missing={status:'missing',facts,text:null,generatedAt:null,canGenerate:true};
  let reportGets=0,reportPosts=0,release,hang=false;
  const generated=new Promise(r=>{release=r;});
  const c=await browser.newContext({viewport:{width,height:950},timezoneId:'Asia/Seoul'});
  await c.route('https://sports.bzzoiro.com/img/player/900000*/**',route=>{
   const size=route.request().url().includes('9000001')?150:480;
   return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 150 150"><rect width="150" height="150" fill="#eee"/><circle cx="75" cy="52" r="31" fill="#bbb"/><path d="M17 150v-8a58 58 0 0 1 116 0v8" fill="#444"/></svg>`});
  });
  await c.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname;
   if(path==='/api/kickx/profile'&&req.method()==='POST'){
    const body=req.postDataJSON();assert.equal(body.userId,undefined);state.session.profile=body;return route.fulfill({json:{profile:body}});
   }
   if(path.endsWith('/report')){
    if(req.method()==='GET'){reportGets++;if(hang){await new Promise(r=>setTimeout(r,12000));return route.fulfill({json:missing}).catch(()=>{});}return route.fulfill({json:missing});}
    reportPosts++;await generated;return route.fulfill({json:{...missing,status:'ready',text:{performance:'득점이 가장 큰 가점을 만들었습니다. 출전 시간과 유효 슈팅도 점수에 반영됐습니다.'}}});
   }
   if(path==='/api/kickx')return route.fulfill({json:{status:'ready',data:state}});
   if(path==='/api/kickx/notifications')return route.fulfill({json:{status:'ready',data:{hasUnread:false,matchNotifications:true}}});
   if(path==='/api/kickx/players'){
    const size=Number(u.searchParams.get('size')||4),p=Number(u.searchParams.get('page')||1);
    return route.fulfill({json:{status:'ready',data:{items:state.players.slice((p-1)*size,p*size),total:state.players.length,page:p,size}}});
   }
   if(path.startsWith('/api/kickx/players/'))return route.fulfill({json:{status:'ready',data:{player:state.players.find(p=>path.endsWith('/'+p.id))??null}}});
   return route.fulfill({json:{status:'ready',data:{items:[],total:0,page:1,size:20}}});
  });
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/mypage',{waitUntil:'networkidle'});
  const picker=p.locator('.avatar-picker'),trophy=picker.getByRole('radio',{name:'트로피',exact:true});await trophy.click();
  assert.equal(await trophy.innerText(),'');assert.equal(await picker.getByRole('radio',{name:'기본 아이콘',exact:true}).innerText(),'');
  const clubName=state.teams.find(t=>t.id===state.session.profile.team).name;assert.ok(await picker.getByText(clubName,{exact:true}).isVisible());
  await p.getByRole('button',{name:'변경사항 저장',exact:true}).click();await p.getByText('프로필을 저장했습니다.',{exact:true}).waitFor();assert.equal(state.session.profile.avatar,'icon:trophy');
  await p.reload({waitUntil:'networkidle'});assert.equal(await trophy.getAttribute('aria-checked'),'true');
  await p.screenshot({path:`test-artifacts/profile-icons-${width}.png`,fullPage:true});
  await p.goto(base+'/market',{waitUntil:'networkidle'});
  const small=p.locator('.player-grid .pcard').filter({has:p.getByRole('heading',{name:player.name,exact:true})});
  await small.locator('.pcard-photo').scrollIntoViewIfNeeded();await p.waitForFunction(()=>!!document.querySelector('.player-grid .pcard.small-source'));
  assert.ok((await small.getAttribute('class')).includes('small-source'));assert.ok((await small.locator('img').boundingBox()).width<=150);
  const high=p.locator('.player-grid .pcard').filter({has:p.getByRole('heading',{name:large.name,exact:true})});await high.locator('.pcard-photo').scrollIntoViewIfNeeded();assert.ok(!(await high.getAttribute('class')).includes('small-source'));
  await p.screenshot({path:`test-artifacts/photo-presentation-${width}.png`,fullPage:true});
  await p.goto(base+'/players/'+player.id,{waitUntil:'networkidle'});assert.equal(reportGets+reportPosts,0);
  await p.locator('.detail-photo .portrait.small-source img').waitFor();
  await p.getByRole('button',{name:'지연 확인 상대 경기 리포트',exact:true}).click();const dialog=p.getByRole('dialog');await dialog.locator('.report-numbers').waitFor();
  assert.ok((await dialog.innerText()).includes('102,500'));assert.equal(reportPosts,1);assert.ok((await dialog.innerText()).includes('포지션 기준 8.00점'));assert.ok(await dialog.getByRole('status').getByText(/AI 경기력 설명을 작성/).isVisible());
  assert.equal(await dialog.getByText('리포트를 준비하고 있습니다.',{exact:true}).count(),0);
  release();await dialog.getByRole('heading',{name:'AI 경기력 설명',exact:true}).waitFor();assert.equal(await dialog.locator('.report-explanation p').count(),2);
  await p.screenshot({path:`test-artifacts/report-progress-${width}.png`,fullPage:true});await p.keyboard.press('Escape');
  await p.getByRole('button',{name:'지연 확인 상대 경기 리포트',exact:true}).click();await p.getByRole('heading',{name:'AI 경기력 설명',exact:true}).waitFor();assert.equal(reportGets,1);assert.equal(reportPosts,1);await p.keyboard.press('Escape');
  if(width===1440){
   hang=true;player.records[0].fixtureId='report-network-hang';await p.goto(base+'/players/'+player.id,{waitUntil:'networkidle'});await p.getByRole('button',{name:'지연 확인 상대 경기 리포트',exact:true}).click();
   await p.getByRole('dialog').getByRole('alert').waitFor({timeout:15000});assert.equal(await p.getByText('리포트를 준비하고 있습니다.',{exact:true}).count(),0);assert.equal(reportPosts,1);
  }
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await c.close();
 }
 assert.deepEqual(errors,[]);console.log('Passed desktop/mobile: persistent icon save, glyph names hidden, club names retained, resolution-aware photos, early report facts, shared generation/cache and bounded stuck request');
}finally{await browser?.close();server.kill('SIGTERM');}
