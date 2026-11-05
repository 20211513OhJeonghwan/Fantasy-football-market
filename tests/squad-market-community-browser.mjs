import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadTs} from './load-ts.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE||'/tmp/kickx-browser','node_modules/playwright/index.mjs')).href);
const {emptyPlatformData}=loadTs('../lib/kickx/data.ts');
const {ownedSquadSlots}=loadTs('../lib/kickx/squad.ts');
const base='http://localhost:3109',out='test-artifacts/squad-market-community';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','localhost','-p','3109'],{stdio:'ignore'});
let browser;
const report={widths:[320,390,768,1024,1440],checks:[],errors:[]};
async function setup(width){
 const state={...emptyPlatformData(),teams:[{id:'club-one',name:'응원 구단',leagueId:'bsd-1'},{id:'club-two',name:'다른 구단',leagueId:'bsd-1'}],leagues:[{id:'bsd-1',name:'Premier League'}],session:{userId:'current-member',role:'member',profile:{nickname:'스쿼드 테스트',team:'club-one',teams:['club-one']}},member:{financialReady:true,points:1300000,totalAssets:1300000,playerAssets:0,holdings:[],ownedPlayers:[],transactions:[],watchlist:[],assetHistory:[],squad:null}};
 state.players=['GK','DF','MF','FW'].flatMap((position,i)=>Array.from({length:i===0?2:i===1?5:4},(_,n)=>({id:`${position}-${n+1}`,name:`${position} 테스트 선수 ${n+1}`,short:null,team:'club-one',position,price:50000,change:0,performance:6,volume:0,goals:0,assists:0,minutes:90,history:[],records:[],analysis:null,status:null})));
 const c=await browser.newContext({viewport:{width,height:960},timezoneId:'Asia/Seoul'});await c.route(/^https:\/\//,r=>r.abort());
 const quotes=new Map(),queries=[],posts=[];let quotesIssued=0,sequence=0;
 await c.route('**/api/**',async route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname;
  const ready=data=>route.fulfill({json:{status:'ready',data}});
  if(path==='/api/kickx')return ready(state);
  if(path==='/api/kickx/players'){
   const q=u.searchParams.get('q')||'',position=u.searchParams.get('position'),page=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('size')||12);queries.push({q,position,page,size});
   const rows=state.players.filter(p=>(!position||p.position===position)&&p.name.includes(q));return ready({items:rows.slice((page-1)*size,page*size),total:rows.length,page,size});
  }
  if(path.startsWith('/api/kickx/players/'))return ready({player:state.players.find(p=>p.id===path.split('/').at(-1))||null});
  if(path==='/api/kickx/trades/quote'){
   quotesIssued++;const b=req.postDataJSON(),p=state.players.find(p=>p.id===b.playerId),id='q'+quotesIssued;
   const quote={id,playerId:p.id,side:b.side,quantity:1,price:p.price,fee:b.side==='sell'?1000:0,settlement:b.side==='sell'?49000:50000,balance:state.member.points,balanceAfter:state.member.points+(b.side==='sell'?49000:-50000),quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};quotes.set(id,quote);return route.fulfill({json:quote});
  }
  if(path==='/api/kickx/trades'&&req.method()==='POST'){
   const b=req.postDataJSON(),q=quotes.get(b.quoteId),p=state.players.find(p=>p.id===q.playerId);sequence++;
   const t={id:`11111111-1111-1111-1111-${String(sequence).padStart(12,'0')}`,playerId:p.id,playerName:p.name,type:q.side,price:q.price,fee:q.fee,net:q.settlement,date:new Date().toISOString(),quantity:1};
   state.member.points=q.balanceAfter;state.member.transactions.unshift(t);
   if(q.side==='buy'){state.member.holdings.push({playerId:p.id,cost:p.price});state.member.ownedPlayers.push(p);}else{state.member.holdings=state.member.holdings.filter(h=>h.playerId!==p.id);state.member.ownedPlayers=state.member.ownedPlayers.filter(x=>x.id!==p.id);}
   state.member.squad={formationId:'4-3-3',slots:ownedSquadSlots(state.member.holdings,state.member.squad?.slots??[],'4-3-3',id=>state.players.find(x=>x.id===id)),revision:sequence,performance:6};
   return route.fulfill({json:{accepted:true}});
  }
  if(path==='/api/kickx/community'){
   if(req.method()==='POST'){posts.push(req.postDataJSON());return route.fulfill({json:{id:'22222222-2222-2222-2222-222222222222'}});}
   return ready({items:[],total:0,page:1,size:20});
  }
  if(path==='/api/kickx/notifications')return ready({hasUnread:false,matchNotifications:true,commentNotifications:true,replyNotifications:true,items:[],hasMore:false});
  return ready({items:[],total:0,page:1,size:50});
 });
 const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.on('dialog',d=>d.accept());
 return {c,p,state,queries,posts,quotesIssued:()=>quotesIssued};
}
async function go(p,path){await p.goto(base+path,{waitUntil:'domcontentloaded'});await p.locator('.masthead-account .account-avatar').waitFor();}
async function fits(p,label){assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label);}
try{
 for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===39)throw Error('App did not start');await new Promise(r=>setTimeout(r,500));}
 await mkdir(out,{recursive:true});browser=await chromium.launch();
 for(const width of report.widths){
  const {c,p,state,queries,posts,quotesIssued}=await setup(width);await go(p,'/squad');
  await p.getByRole('button',{name:'1번 GK 자리 빈 자리',exact:true}).click();
  await p.locator('.squad-market-list li').first().waitFor();assert.equal(queries.at(-1).position,'GK');
  await p.locator('.squad-market-list li').first().getByRole('button',{name:'매입',exact:true}).click();
  await p.getByRole('dialog').getByRole('region',{name:'현재 포지션별 보유 현황'}).waitFor();
  await p.getByRole('button',{name:'매입 확정',exact:true}).click();await p.getByRole('heading',{name:'매입이 완료되었습니다',exact:true}).waitFor();await p.getByRole('button',{name:'확인',exact:true}).click();
  await p.locator('.pitch-player.filled').waitFor();assert.equal(state.member.squad.slots[0],'GK-1');
  assert.equal(await p.getByRole('button',{name:'스쿼드 저장',exact:true}).count(),0);
  await p.locator('.squad-market-list li').nth(1).getByRole('button',{name:'매입',exact:true}).click();
  await p.getByRole('dialog').getByText(/GK 보유 정원 1명이 찼습니다/).waitFor();assert.equal(quotesIssued(),1);assert(await p.getByRole('button',{name:'매입 확정',exact:true}).isDisabled());await p.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
  await p.getByRole('button',{name:'1번 GK 자리 GK 테스트 선수 1',exact:true}).click();await p.getByRole('button',{name:'1번 GK 자리 GK 테스트 선수 1',exact:true}).click();
  await p.locator('.squad-selected-player').getByRole('button',{name:'매각',exact:true}).click();await p.getByRole('button',{name:'매각 확정',exact:true}).click();await p.getByRole('heading',{name:'매각이 완료되었습니다',exact:true}).waitFor();await p.getByRole('button',{name:'확인',exact:true}).click();
  await p.waitForFunction(()=>document.querySelectorAll('.pitch-player.filled').length===0);assert.equal(state.member.squad.slots[0],null);
  await fits(p,'squad '+width);await p.screenshot({path:`${out}/squad-${width}.png`,fullPage:true});
  // Fixed target, required title, filtered attachment, removal, cancellation and a fresh editor.
  state.member.transactions.push({id:'11111111-1111-1111-1111-999999999999',playerId:'GK-2',playerName:'다른 선수 거래',type:'buy',price:50000,net:50000,date:new Date().toISOString()});
  await go(p,'/community/write?scope=player&target=GK-1');await p.getByText('GK 테스트 선수 1 커뮤니티',{exact:true}).waitFor();
  assert.equal(await p.getByRole('textbox',{name:'게시글 대상 선수 검색',exact:true}).count(),0);assert.equal(await p.getByRole('combobox',{name:/대상 선수/}).count(),0);
  await p.locator('#post-body').fill('이 선수의 경기를 보고 작성하는 게시글입니다.');await p.getByRole('button',{name:'게시글 등록',exact:true}).click();await p.locator('#post-title-error').waitFor();assert.equal(posts.length,0);
  await p.locator('#post-title').fill('선수 경기 이야기');await p.locator('#post-transaction').click();assert.equal(await p.getByRole('option',{name:/다른 선수 거래/}).count(),0);await p.getByRole('option').filter({hasText:'GK 테스트 선수 1'}).first().click();
  await p.getByRole('button',{name:'거래 첨부 취소',exact:true}).click();assert.equal(await p.locator('.attached-trade').count(),0);
  await p.locator('#post-transaction').click();await p.getByRole('option').filter({hasText:'GK 테스트 선수 1'}).first().click();await p.getByRole('link',{name:'취소',exact:true}).click();
  await p.locator('.player-lounge-cta').click();await p.locator('.lounge-head h1').waitFor();await p.locator('.lounge-head').getByRole('link',{name:'글쓰기',exact:true}).click();await p.waitForURL(u=>u.pathname==='/community/write'&&u.searchParams.get('target')==='GK-1');await p.locator('#post-title').waitFor();assert.equal(await p.locator('#post-title').inputValue(),'');assert.equal(await p.locator('.attached-trade').count(),0);
  await p.locator('#post-title').fill('초기화 이후 새 글');await p.locator('#post-body').fill('첨부 기록 없이 새로 작성하는 게시글입니다.');await p.getByRole('button',{name:'게시글 등록',exact:true}).click();await p.getByRole('heading',{name:'게시글을 등록했습니다',exact:true}).waitFor();assert.equal(posts.at(-1).target,'GK-1');assert.equal(posts.at(-1).transaction,'');
  await go(p,'/community/players/GK-1');await p.locator('.feed-composer-open').click();await p.getByLabel('빠른 글 제목',{exact:true}).fill('빠른 글');await p.getByLabel('빠른 글 내용',{exact:true}).fill('이 선수에 대한 빠른 글을 작성합니다.');await p.getByRole('button',{name:'거래 내역 첨부 추가',exact:true}).click();await p.getByRole('combobox',{name:'빠른 글 거래 첨부',exact:true}).click();assert.equal(await p.getByRole('option',{name:/다른 선수 거래/}).count(),0);await p.getByRole('option').filter({hasText:'GK 테스트 선수 1'}).first().click();await p.getByRole('button',{name:'빠른 글 거래 첨부 취소',exact:true}).click();
  await p.getByRole('button',{name:'빠른 글쓰기 닫기',exact:true}).click();await p.locator('.feed-composer-open').click();assert.equal(await p.getByLabel('빠른 글 제목',{exact:true}).inputValue(),'');assert.equal(await p.getByRole('combobox',{name:'빠른 글 거래 첨부',exact:true}).count(),0);
  await fits(p,'composer '+width);await p.screenshot({path:`${out}/composer-${width}.png`,fullPage:true});
  await go(p,'/community/clubs');await p.getByRole('combobox',{name:'게시판 구단 선택',exact:true}).click();await p.getByRole('option',{name:'다른 구단',exact:true}).click();await p.getByRole('heading',{name:/다른 구단 게시판/}).waitFor();assert.equal(await p.locator('.page-heading-action').getByRole('link',{name:'글쓰기',exact:true}).count(),0);await fits(p,'club selector '+width);
  await go(p,'/players/GK-1');await p.locator('.player-lounge-cta').waitFor();assert((await p.locator('.player-lounge-cta').boundingBox()).height>=40);await fits(p,'player community '+width);await p.screenshot({path:`${out}/player-${width}.png`,fullPage:true});
  report.checks.push(`${width}px: position market, auto buy/sell, capacity before quote, fixed-target title/attachment/remove/reset, non-fan club filter, player community entry`);await c.close();
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
