import assert from 'node:assert/strict';
import {spawn}from 'node:child_process';
import {mkdir}from 'node:fs/promises';
import {resolve}from 'node:path';
import {pathToFileURL}from 'node:url';
import {loadTs}from './load-ts.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE||'/tmp/kickx-browser','node_modules/playwright/index.mjs')).href);
const base='http://localhost:3105';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','localhost','-p','3105'],{stdio:'ignore'});
let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===39)throw Error('App did not start');await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch();const context=await browser.newContext();
 const empty=loadTs('../lib/kickx/data.ts').emptyPlatformData();
 const player={id:'notification-player',name:'알림 확인 선수',team:'notification-team',position:'FW',price:102000,change:2,performance:8,history:[],records:[]};
 const state={...empty,players:[player],teams:[{id:'notification-team',name:'응원 구단',leagueId:'bsd-1'}],leagues:[{id:'bsd-1',name:'Premier League'}],session:{userId:'notification-member',role:'member',profile:{nickname:'알림 확인',team:'notification-team'}},member:{financialReady:false,holdings:[],transactions:[],watchlist:[],assetHistory:[],squad:null}};
 let summary={hasUnread:true,matchNotifications:true};
 const mutations=[],reads=[],errors=[];
 const items=Array.from({length:21},(_,i)=>({id:String(30-i),kind:i%2?'match':'price',playerId:player.id,playerName:player.name,teamId:player.team,fixtureId:'notification-fixture',homeName:'홈 구단',awayName:'원정 구단',startsAt:'2026-11-04T10:00:00Z',priceBefore:100000,priceAfter:102000,createdAt:'2026-11-03T10:00:00Z',readAt:null}));
 await context.route(/\/api\/kickx$/,route=>route.fulfill({json:{status:'ready',data:state}}));
 await context.route(/\/api\/kickx\/players\?/,route=>{const p=new URL(route.request().url()).searchParams;return route.fulfill({json:{status:'ready',data:{items:[player],total:1,page:1,size:Number(p.get('size')||4)}}});});
 await context.route(/\/api\/kickx\/community\?/,route=>route.fulfill({json:{status:'ready',data:{items:[],total:0,page:1,size:20}}}));
 await context.route(/\/api\/kickx\/notifications(?:\?.*)?$/,async route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==='PUT'){
   const input=route.request().postDataJSON();mutations.push(input);
   if(input.action==='preferences')summary.matchNotifications=input.matchNotifications;
   if(input.action==='read'){for(const item of items)if(input.all||input.ids.includes(item.id))item.readAt=new Date().toISOString();summary.hasUnread=items.some(item=>!item.readAt);}
   return route.fulfill({json:summary});
  }
  reads.push(url.search);
  return route.fulfill({json:{status:'ready',data:url.searchParams.has('summary')?summary:{items:url.searchParams.has('before')?items.slice(20):items.slice(0,20),hasMore:!url.searchParams.has('before'),hasUnread:summary.hasUnread}}});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await mkdir('test-artifacts',{recursive:true});
 for(const width of [1440,390]){
  summary.hasUnread=true;for(const item of items)item.readAt=null;
  await page.setViewportSize({width,height:900});await page.goto(base+'/market',{waitUntil:'networkidle'});
  await page.locator('.player-grid .pcard').waitFor();assert.equal(await page.locator('.market-table').count(),0);
  const bell=page.getByRole('button',{name:'알림함 · 읽지 않은 알림 있음',exact:true});await bell.waitFor();
  const position=await page.locator('.masthead-account:visible').evaluate(el=>{const bell=el.querySelector('.notification-trigger').getBoundingClientRect(),account=el.querySelector('.account').getBoundingClientRect();return bell.right<=account.left;});assert.ok(position);
  await bell.click();const inbox=page.getByRole('dialog',{name:'알림함',exact:true});await inbox.locator('li').first().waitFor();
  assert.equal(await inbox.locator('li').count(),20);await inbox.getByRole('button',{name:'이전 알림 더 보기'}).click();await inbox.locator('li').nth(20).waitFor();assert.ok(reads.includes('?before=11'));
  await inbox.getByRole('button',{name:'모두 읽음',exact:true}).click();await page.getByRole('button',{name:'알림함',exact:true}).waitFor();assert.equal(await inbox.locator('li.unread').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`test-artifacts/notifications-${width}.png`,fullPage:true});await page.keyboard.press('Escape');assert.equal(await inbox.count(),0);
 }
 await page.goto(base+'/squad',{waitUntil:'networkidle'});const toggle=page.getByRole('switch');assert.equal(await toggle.isChecked(),true);await toggle.click();await page.getByText('경기 알림을 껐습니다.',{exact:true}).waitFor();assert.equal(await toggle.isChecked(),false);
 await page.reload({waitUntil:'networkidle'});assert.equal(await toggle.isChecked(),false);assert.ok(mutations.some(m=>m.action==='preferences'&&m.matchNotifications===false));
 await page.goto(base+'/community/clubs',{waitUntil:'networkidle'});assert.equal(await page.getByRole('combobox',{name:'게시판 구단',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'응원 구단',exact:true}).count(),1);
 state.session=null;await page.goto(base+'/market',{waitUntil:'networkidle'});assert.equal(await page.locator('.notification-trigger').count(),0);
 assert.deepEqual(errors,[]);console.log('Passed: desktop/mobile inbox, red dot, pagination, read-all, Escape, persistent squad mute, club filter removal, grid default and guest state');
}finally{await browser?.close();server.kill('SIGTERM');}
