import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadTs} from './load-ts.mjs';

const {chromium}=await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE||'/tmp/kickx-browser','node_modules/playwright/index.mjs')).href);
const mock=loadTs('../server/kickx/mock-data.ts',{'server-only':{},'@/lib/kickx/squad':loadTs('../lib/kickx/squad.ts')});
const base='http://localhost:3101',out='test-artifacts/ui-errors';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','localhost','-p','3101'],
 {env:{...process.env,KICKX_DATABASE_ENABLED:'false',KICKX_MOCK_DATA:'false'},stdio:['ignore','pipe','pipe']});
let output='',browser;
server.stdout.on('data',chunk=>output+=chunk);server.stderr.on('data',chunk=>output+=chunk);
const report={checks:[],errors:[]};
async function setup({watchCount=13}={}){
 const state=structuredClone({...mock.mockPublicData(),session:mock.mockSession,member:mock.mockMemberData(),policy:{version:'report-v3',initialPoints:1300000,initialPrice:100000,sellFeeBps:200,quoteSeconds:60,
  pricingReferenceAt:'2026-10-14T15:00:00Z',reportParameters:{initialMin:50000,initialMax:150000,minPrice:10000,maxPrice:1000000,valuationStartMs:1791990000000}}});
 const leagues={epl:'bsd-1',laliga:'bsd-3',bundesliga:'bsd-4',seriea:'bsd-5',ligue1:'bsd-6'};
 state.leagues=state.leagues.map(l=>({...l,id:leagues[l.id]}));state.teams=state.teams.map(t=>({...t,leagueId:leagues[t.leagueId]}));
 state.member.watchlist=state.players.slice(0,watchCount).map(p=>p.id);
 state.players.push(...Array.from({length:103-state.players.length},(_,i)=>({...state.players[0],id:'test-extra-'+i,name:'테스트 선수 '+i})));
 const requests=[];
 const c=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Seoul'});
 await c.route('**/api/**',async route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname;
  if(path==='/api/kickx/watchlist'&&req.method()==='PUT'){
   const body=req.postDataJSON();state.member.watchlist=state.member.watchlist.filter(id=>id!==body.playerId);return route.fulfill({json:body});
  }
  if(req.method()!=='GET')return route.fulfill({status:503,json:{error:'Browser test: writes disabled'}});
  if(path==='/api/kickx')return route.fulfill({json:{status:'ready',data:state}});
  if(path==='/api/auth/status')return route.fulfill({json:{enabled:true}});
  if(path==='/api/kickx/players'){
   const q=u.searchParams.get('q')||'',scope=u.searchParams.get('scope'),page=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('size')||12);
   const position=u.searchParams.get('position');requests.push({q,scope,page,size,position});
   if(q.length>100)return route.fulfill({status:400,json:{error:'검색어는 100자 이내로 입력해 주세요.'}});
   let rows=state.players.filter(p=>(!q||p.name.includes(q))&&(!position||p.position===position));if(scope==='watch')rows=rows.filter(p=>state.member.watchlist.includes(p.id));
   return route.fulfill({json:{status:'ready',data:{items:rows.slice((page-1)*size,page*size),total:rows.length,page,size}}});
  }
  return route.fulfill({json:{status:'ready',data:{items:[],total:0,page:1,size:20}}});
 });
 const p=await c.newPage();p.on('pageerror',error=>report.errors.push(error.message));
 return {c,p,state,requests};
}
const goto=async(p,path)=>{const response=await p.goto(base+path,{waitUntil:'networkidle'});if(path.startsWith('/market'))await p.getByRole('button',{name:'목록 보기',exact:true}).click();return response;};
async function check(name,run){await run();report.checks.push(name);console.log('PASS '+name);}
try{
 for(let i=0;i<40;i++){
  try{if((await fetch(base)).ok)break;}catch{}
  if(i===39)throw new Error('App did not start: '+output);
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 await mkdir(out,{recursive:true});
 browser=await chromium.launch({executablePath:process.env.KICKX_CHROMIUM_PATH});
 await check('Selecting a vacant pitch slot opens its market position on desktop and mobile',async()=>{
  for(const width of [1440,390]){
   const {c,p,requests}=await setup();await p.setViewportSize({width,height:900});await goto(p,'/squad');
   await p.locator('.squad-market-positions').getByRole('button',{name:/^FW/}).click();
   await p.getByRole('button',{name:/번 DF 자리/}).first().click();
   await p.waitForFunction(()=>document.querySelector('.squad-market-positions button[aria-pressed=true]')?.textContent.startsWith('DF'));
   await p.locator('.squad-market-list li').first().waitFor();
   assert.equal(requests.at(-1).position,'DF');assert.equal(await p.getByRole('button',{name:'배치',exact:true}).count(),0);
   await p.screenshot({path:`${out}/squad-filter-${width}.png`,fullPage:true});await c.close();
  }
 });
 await check('An empty automatic squad is worth zero; unknown finances stay unknown',async()=>{
  const {c,p,state}=await setup();state.member.holdings=[];state.member.squad=null;await goto(p,'/squad');
  assert.equal(await p.locator('.pitch-player.filled').count(),0);
  assert.equal(await p.locator('.squad-footer>div').first().innerText(),'스쿼드 가치\n0P');
  await p.screenshot({path:out+'/empty-lineup.png',fullPage:true});
  state.member.financialReady=false;await goto(p,'/squad');
  assert((await p.locator('.squad-footer>div').first().innerText()).includes('—'));
  await c.close();
 });
 await check('Removing the last item of watchlist page two fetches valid page one',async()=>{
  const {c,p,requests}=await setup();await goto(p,'/market?watchlist=1');
  await p.getByRole('button',{name:'다음 선수 시장 페이지',exact:true}).click();
  await p.waitForFunction(()=>document.querySelectorAll('.market-browser tbody tr').length===1);
  await p.locator('.market-browser tbody tr').getByRole('button',{name:'관심 선수 해제',exact:true}).click();
  await p.waitForFunction(()=>document.querySelectorAll('.market-browser tbody tr').length===12);
  assert((await p.getByRole('navigation',{name:'선수 시장 페이지 선택',exact:true}).innerText()).includes('1–12 / 12'));
  assert.equal(requests.at(-1).page,1);await c.close();
 });
 await check('Removing the only watched player shows an empty list with no invalid range',async()=>{
  const {c,p}=await setup({watchCount:1});await goto(p,'/market?watchlist=1');
  await p.locator('.market-browser tbody tr').getByRole('button',{name:'관심 선수 해제',exact:true}).click();
  await p.getByRole('heading',{name:'검색 조건에 맞는 결과가 없습니다',exact:true}).waitFor();
  assert.equal(await p.getByRole('navigation',{name:'선수 시장 페이지 선택',exact:true}).count(),0);await c.close();
 });
 await check('Overlong global input and URL searches show input validation and recover',async()=>{
  const {c,p,requests}=await setup();await goto(p,'/market');
  const input=p.getByRole('textbox',{name:'선수, 구단, 리그 통합 검색',exact:true});
  assert.equal(await input.getAttribute('maxlength'),'100');
  await input.evaluate(el=>el.removeAttribute('maxlength'));await input.fill('가'.repeat(101));await input.press('Enter');
  assert((await input.evaluate(el=>el.validationMessage)).includes('100자'));
  assert.equal(new URL(p.url()).search,'');
  await goto(p,'/market?q='+encodeURIComponent('가'.repeat(101)));
  await p.getByRole('heading',{name:'검색어를 확인해 주세요',exact:true}).waitFor();
  assert.equal(requests.filter(r=>r.q.length>100).length,0);
  await p.getByRole('textbox',{name:'선수 검색',exact:true}).fill('');
  await p.locator('.market-browser tbody tr').first().waitFor();assert.equal(await p.locator('.market-browser tbody tr').count(),12);
  await c.close();
 });
 await check('Rules show configured launch date and separate initial/current price bounds',async()=>{
  const {c,p,state}=await setup();await goto(p,'/rules');
  let text=await p.locator('.rules-page').innerText();
  assert(text.includes('2026. 10. 15.'));assert(!text.includes('10월 1일'));
  assert(text.includes('초기 가격 범위 50,000~150,000P'));assert(text.includes('전체 가격 범위 10,000~1,000,000P'));
  assert(text.includes('직전 가격에서 1.5% 하락'));
  state.policy.reportParameters={initialMin:60000,initialMax:160000,minPrice:12000,maxPrice:900000,valuationStartMs:Date.parse('2026-10-19T15:00:00Z')};
  await goto(p,'/rules');text=await p.locator('.rules-page').innerText();
  assert(text.includes('2026. 10. 20.'));assert(text.includes('초기 가격 범위 60,000~160,000P'));assert(text.includes('전체 가격 범위 12,000~900,000P'));
  await p.screenshot({path:out+'/rules.png',fullPage:true});await c.close();
 });
 await check('Manual page jump preserves focus when pagination remounts',async()=>{
  const {c,p}=await setup();await goto(p,'/market');
  await p.getByRole('button',{name:'선수 시장 다음 구간 페이지 직접 입력',exact:true}).click();
  const input=p.getByRole('textbox',{name:'선수 시장 이동할 페이지',exact:true});await input.fill('9');await input.press('Enter');
  await p.getByRole('button',{name:'선수 시장 9페이지',exact:true}).waitFor();
  await p.waitForFunction(()=>document.querySelector('.market-browser .numbered-pagination [aria-current="page"]')?.textContent==='9');
  assert(await p.evaluate(()=>document.activeElement?.matches('.market-browser, .market-browser .numbered-pagination [aria-current="page"]')));
  await c.close();
 });
 await check('Guide modal restores its opener on Escape and close button',async()=>{
  const {c,p}=await setup();await goto(p,'/');const trigger=p.getByRole('button',{name:'지표 읽는 법',exact:true});
  await trigger.focus();await trigger.press('Enter');await p.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).focus();await p.keyboard.press('Escape');
  assert(await trigger.evaluate(el=>el===document.activeElement));
  await trigger.press('Enter');await p.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
  assert(await trigger.evaluate(el=>el===document.activeElement));await c.close();
 });
 await check('Mobile account menu keeps an accessible name',async()=>{
  const {c,p}=await setup();await p.setViewportSize({width:390,height:844});await goto(p,'/');
  const trigger=p.getByRole('button',{name:/계정 메뉴$/});assert(await trigger.isVisible());await trigger.click();assert(await p.getByRole('menu').isVisible());await c.close();
 });
 assert.deepEqual(report.errors,[]);await writeFile(out+'/report.json',JSON.stringify(report,null,2));
 console.log(`${report.checks.length} UI regression checks passed`);
}finally{
 if(browser)await browser.close();server.kill('SIGTERM');
}
