import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadTs } from "./load-ts.mjs";
const { chromium } = await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE || "/tmp/kickx-browser", "node_modules/playwright/index.mjs")).href);
// NextRequest normalizes loopback IPs to localhost. Use the same canonical origin.
const base = "http://localhost:3100";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next","start","-H","localhost","-p","3100"], {stdio:["ignore","pipe","pipe"]});
let output = "";
server.stdout.on("data", chunk => {output += chunk;});
server.stderr.on("data", chunk => {output += chunk;});
let browser;
// Dynamic Next.js prefetch streams can stay open after the screen is ready.
// Wait for the app's bounded API requests, rather than unrelated network idleness.
const pendingApi = new WeakMap();
function trackApi(page) {
  if (pendingApi.has(page)) return;
  const state = { pending: new Set(), bootstrap: false }; pendingApi.set(page, state);
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/')) state.pending.add(request); if (path === '/api/kickx') state.bootstrap = true; });
  for (const event of ['requestfinished', 'requestfailed']) page.on(event, request => state.pending.delete(request));
}
async function visit(page, url, options = {}) {
  trackApi(page);
  pendingApi.get(page).bootstrap = false;
  const response = await page.goto(url, { ...options, waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + 10000; let quietSince = Date.now();
  while (Date.now() < deadline) {
    try { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); }
    catch (error) { if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error; quietSince = Date.now(); continue; }
    if (!pendingApi.get(page).bootstrap || pendingApi.get(page).pending.size) quietSince = Date.now();
    else if (Date.now() - quietSince >= 100) return response;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('App API requests did not finish: ' + [...pendingApi.get(page).pending].map(r => r.url()).join(', '));
}
const revisit = (page, options) => visit(page, page.url(), options);
const report = {routes:[],checks:[]};
const errors = [];
try {
  for(let i=0;i<60;i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if(i===59) throw new Error("App did not start");
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  await mkdir("test-artifacts",{recursive:true});
  browser = await chromium.launch();
  const context=await browser.newContext();
  await context.route(/^https:\/\//,route=>route.abort());
  const page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  const routes=["/","/login","/onboarding","/players","/players/missing","/market","/portfolio","/transactions","/squad","/ranking","/community","/community/clubs","/community/players","/community/clubs/missing","/community/players/missing","/community/posts/missing","/community/write","/mypage","/admin","/admin/data","/admin/users","/admin/trades","/admin/community","/fixtures","/teams/missing","/rules"];
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    for(const path of routes) {
      const response=await visit(page,base+path,{});
      assert.ok(response?.ok(),path+" did not load");
      const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
      assert.ok(size.scroll<=size.width+1,path+" overflows at "+viewport.width+": "+size.scroll);
      report.routes.push({path,width:viewport.width});
      if(["/","/fixtures","/players","/squad","/login"].includes(path)) await page.screenshot({path:"test-artifacts/"+(path==="/"?"home":path.slice(1))+"-"+viewport.width+".png",fullPage:true});
    }
  }
  await visit(page,base,{});
  await page.getByRole("button",{name:"지표 읽는 법",exact:true}).click();
  assert.ok(await page.getByRole("dialog").isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(),0);
  report.checks.push("Guide opens and closes with Escape");
  await page.getByLabel("선수 이름 검색",{exact:true}).fill("not-present");
  await page.locator(".yb-search-button").click();
  assert.ok(await page.getByText("검색 결과", {exact:false}).count());
  await page.getByRole("button",{name:/필터 초기화/}).click();
  assert.equal(await page.getByLabel("선수 이름 검색",{exact:true}).inputValue(),"");
  report.checks.push("Home search and reset");
  await visit(page,base+"/login",{});
  assert.equal(await page.getByRole("button",{name:"Google로 계속하기"}).isDisabled(),true);
  const status=await context.request.get(base+"/api/auth/status");
  assert.equal((await status.json()).enabled,false);
  const denied=await context.request.put(base+"/api/kickx/watchlist",{data:{playerId:"test-player",watched:true}});
  assert.equal(denied.status(),403);
  const disconnected=await context.request.put(base+"/api/kickx/watchlist",{headers:{origin:base},data:{playerId:"test-player",watched:true}});
  assert.equal(disconnected.status(),503);
  report.checks.push("Disconnected services and cross-origin writes stay blocked");
  for (const path of ["/community/clubs"]) {
    await visit(page,base + path, {});
    assert.ok(await page.locator(".community-feed").getByRole("heading", {name:"게시글 정보를 준비하고 있습니다",exact:true}).isVisible());
    assert.equal(await page.locator(".community-feed .loading-state").count(),0);
  }
  report.checks.push("Disconnected community feeds show their actual state without indefinite loading");
  for(const endpoint of ["/api/kickx/players?page=0","/api/kickx/fixtures?day=2026-02-30"]) {
    assert.equal((await context.request.get(base+endpoint)).status(),400);
  }
  for(const endpoint of ["/api/kickx/players","/api/kickx/fixtures","/api/kickx/players/missing"]) {
    assert.equal((await (await context.request.get(base+endpoint)).json()).status,"not-configured");
  }
  report.checks.push("Catalog API validates parameters and keeps disconnected reads explicit");
  await context.close();

  // UI-only injected responses: these records never ship in application data or SQL seeds.
  const mock=await browser.newContext({viewport:{width:1440,height:1000}});
  await mock.route(/^https:\/\//,route=>route.abort());
  await mock.route(/\/api\/kickx\/notifications(?:\?.*)?$/,route=>route.fulfill({json:{status:'ready',data:{hasUnread:false,matchNotifications:true,commentNotifications:true,replyNotifications:true,items:[],hasMore:false}}}));
  await mock.route(/\/api\/kickx\/community\/activity(?:\?.*)?$/,route=>route.fulfill({json:{status:'ready',data:{author:null,items:[],total:0,page:1,size:20,postCount:0,commentCount:0}}}));
  const mockPage=await mock.newPage();
  mockPage.on("pageerror",error=>errors.push(error.message));
  const empty=loadTs("../lib/kickx/data.ts").emptyPlatformData();
  const state={...empty,
    players:[{id:"test-player",name:"CI-only player",english:null,short:null,team:null,position:"FW",country:null,age:null,price:0,change:0,performance:0,volume:0,goals:0,assists:0,minutes:0,history:[],records:[],analysis:null,updatedAt:null,status:null}],
    session:{userId:"test-account",role:"member",profile:{nickname:"테스트 사용자",team:null}},
    member:{financialReady:false,points:null,totalAssets:null,playerAssets:null,profit:null,returnRate:null,weeklyRank:null,holdings:[],transactions:[],watchlist:[],assetHistory:[],squad:null},
  };
  // Public page requests must start before a deliberately blocked dashboard.
  // This tests ordering, rather than asserting a machine-dependent time limit.
  for(const detail of [false,true]) {
    const concurrent=await browser.newContext();
    await concurrent.route(/^https:\/\//,route=>route.abort());
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    let released=false;
    await concurrent.route(/\/api\/kickx$/,async route=>{await gate;await route.fulfill({json:{status:'ready',data:state}});});
    const endpoint=detail?/\/api\/kickx\/players\/test-player$/:/\/api\/kickx\/players\?/;
    await concurrent.route(endpoint,route=>route.fulfill({json:{status:'ready',data:detail?{player:state.players[0]}:{items:state.players,total:1,page:1,size:12}}}));
    const concurrentPage=await concurrent.newPage();
    try {
      const requested=concurrentPage.waitForRequest(request=>endpoint.test(request.url()),{timeout:10000});
      await concurrentPage.goto(base+(detail?'/players/test-player':'/market'),{waitUntil:'domcontentloaded'});
      await requested;
      assert.equal(released,false);
      await concurrentPage.getByRole('heading',{name:'CI-only player',exact:true}).waitFor({timeout:10000});
    } finally {
      const completed=concurrentPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/kickx',{timeout:5000}).catch(()=>null);
      released=true;release();await completed;await concurrent.close();
    }
  }
  report.checks.push('Public player list and detail render while dashboard bootstrap is still pending');
  await mock.route(/\/api\/kickx$/,route=>route.fulfill({json:{status:"ready",data:state}}));
  const catalogRequests=[];
  let failSearch=false;
  const extra=Array.from({length:74},(_,i)=>({...state.players[0],id:"catalog-"+i,name:"목록 선수 "+i}));
  await mock.route(/\/api\/kickx\/players\?/,route=>{
    const url=new URL(route.request().url()),params=url.searchParams;
    catalogRequests.push(url.search);
    if(failSearch) {failSearch=false;return route.fulfill({status:500,json:{error:"테스트 목록 조회 오류"}});}
    const page=Number(params.get("page")||1),size=Number(params.get("size")||12),q=params.get("q")||"";
    let items=q === "서버에서만 조회" ? extra : state.players;
    if(params.get("scope")==="watch") items=items.filter(p=>state.member.watchlist.includes(p.id));
    return route.fulfill({json:{status:"ready",data:{items:items.slice((page-1)*size,page*size),total:items.length,page,size}}});
  });
  await mock.route(/\/api\/kickx\/players\/[^?]+$/,route=>{
    const id=new URL(route.request().url()).pathname.split("/").at(-1);
    return route.fulfill({json:{status:"ready",data:{player:[...state.players,...extra].find(p=>p.id===id)||null}}});
  });
  const fixtureRequests=[];
  await mock.route(/\/api\/kickx\/fixtures\?/,route=>{
    const params=new URL(route.request().url()).searchParams;fixtureRequests.push(params.toString());
    const {koreanDay}=loadTs('../lib/kickx/fixtures.ts');
    const teams=params.get('team');
    const fixtures=state.fixtures.filter(f=>(teams?(f.home===teams||f.away===teams):['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'].includes(f.leagueId))&&(!params.get('month')||koreanDay(f.startsAt).startsWith(params.get('month'))));
    return route.fulfill({json:{status:'ready',data:{items:fixtures,total:fixtures.length,page:Number(params.get('page')||1),size:Number(params.get('size')||20)}}});
  });
  let watchCalls=0;
  await mock.route("**/api/kickx/watchlist",async route=>{
    watchCalls++;
    const input=route.request().postDataJSON();
    assert.equal(input.userId,undefined);
    if(watchCalls===1) return route.fulfill({status:500,json:{error:"테스트 저장 오류"}});
    state.member.watchlist=input.watched?[input.playerId]:[];
    return route.fulfill({json:input});
  });
  await visit(mockPage,base,{});
  assert.equal(await mockPage.getByText('KICK-X / FOOTBALL MARKET',{exact:true}).count(),0);
  assert.equal(await mockPage.getByText('가상 포인트 전용 서비스',{exact:true}).count(),0);
  assert.equal(await mockPage.locator('.home-market .board-foot').count(),0);
  assert.ok(await mockPage.getByRole('heading',{name:'선수 시세 동향',exact:true}).isVisible());
  assert.equal(await mockPage.getByText('MARKET MOVERS',{exact:true}).count(),0);
  assert.match(await mockPage.locator(".yb-price").innerText(),/^0/);
  const watch=mockPage.getByRole("button",{name:"관심 선수 추가",exact:true});
  await watch.click();
  await mockPage.getByText("테스트 저장 오류",{exact:true}).waitFor();
  assert.equal(await watch.getAttribute("aria-pressed"),"false");
  await watch.click();
  await mockPage.getByRole("button",{name:"관심 선수 해제",exact:true}).first().waitFor();
  assert.deepEqual(state.member.watchlist,["test-player"]);
  report.checks.push("Zero price renders; failed watchlist writes do not pretend to succeed");
  await visit(mockPage,base+"/market?watchlist=1",{});
  await mockPage.getByRole('button',{name:'목록 보기',exact:true}).click();
  await mockPage.locator('.market-table').getByText("CI-only player",{exact:true}).waitFor();
  report.checks.push("Saved watchlist feeds the filtered player list");
  await mockPage.getByRole("button",{name:"전체 선수",exact:true}).click();
  await mockPage.getByLabel("선수 검색",{exact:true}).fill("서버에서만 조회");
  await mockPage.locator('.market-table').getByText("목록 선수 0",{exact:true}).waitFor();
  await mockPage.getByRole("button",{name:"다음 선수 시장 페이지",exact:true}).click();
  await mockPage.locator('.market-table').getByText("목록 선수 12",{exact:true}).waitFor();
  assert.ok(catalogRequests.some(url=>url.includes("page=2")));
  await mockPage.getByLabel("선수 검색",{exact:true}).fill("");
  await mockPage.locator('.market-table').getByText("CI-only player",{exact:true}).waitFor();
  failSearch=true;
  await mockPage.getByLabel("선수 검색",{exact:true}).fill("서버에서만 조회");
  await mockPage.getByRole("heading",{name:"데이터를 불러오지 못했습니다",exact:true}).waitFor();
  await mockPage.getByRole("button",{name:"다시 시도",exact:true}).click();
  await mockPage.locator('.market-table').getByText("목록 선수 0",{exact:true}).waitFor();
  await visit(mockPage,base+"/players/catalog-23",{});
  await mockPage.getByRole("heading",{name:"목록 선수 23",exact:true}).waitFor();
  report.checks.push("Server search, second page, retry and direct detail outside bootstrap");
  await visit(mockPage,base,{});
  await mockPage.getByLabel('선수 이름 검색',{exact:true}).fill('서버에서만 조회');await mockPage.locator('.yb-search-button').click();
  await mockPage.locator('.board-table').getByText('목록 선수 0',{exact:true}).waitFor();
  assert.equal(await mockPage.locator('.board-table tbody tr').count(),10);assert.equal(await mockPage.locator('.board-more').count(),0);
  await mockPage.getByRole('button',{name:'다음 홈 선수 페이지',exact:true}).click();await mockPage.locator('.board-table').getByText('목록 선수 10',{exact:true}).waitFor();
  assert.equal(await mockPage.locator('.board-table tbody tr').count(),10);
  report.checks.push('Home uses fixed ten-row server pages instead of expanding the board');
  const homePages=mockPage.getByRole('navigation',{name:'홈 선수 페이지 선택',exact:true});
  const center=await homePages.evaluate(nav=>{const pages=nav.querySelector('.pagination-pages').getBoundingClientRect(),bounds=nav.getBoundingClientRect();return Math.abs((pages.left+pages.right)-(bounds.left+bounds.right))/2;});
  assert.ok(center<2,'Home page buttons are not centered in the board');
  await homePages.getByRole('button',{name:'홈 선수 다음 구간 페이지 직접 입력',exact:true}).click();
  const pageInput=homePages.getByRole('textbox',{name:'홈 선수 이동할 페이지',exact:true});
  await mockPage.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='홈 선수 이동할 페이지');
  const beforeInvalid=catalogRequests.length;
  for(const invalid of ['0','9','2.5','abc','']){
    await pageInput.fill(invalid);await pageInput.press('Enter');await homePages.getByRole('alert').waitFor();
    assert.equal(catalogRequests.length,beforeInvalid,'Invalid page requested data');
  }
  await pageInput.fill('7');await pageInput.press('Enter');
  await mockPage.locator('.board-table').getByText('목록 선수 60',{exact:true}).waitFor();
  assert.equal(await homePages.getByRole('textbox').count(),0);
  await homePages.getByRole('button',{name:'다음 홈 선수 페이지',exact:true}).click();
  await mockPage.locator('.board-table').getByText('목록 선수 70',{exact:true}).waitFor();
  assert.equal(await mockPage.locator('.board-table tbody tr').count(),4);
  assert.equal(await homePages.getByRole('button',{name:'다음 홈 선수 페이지',exact:true}).isDisabled(),true);
  await mockPage.setViewportSize({width:390,height:844});
  await homePages.getByRole('button',{name:'홈 선수 이전 구간 페이지 직접 입력',exact:true}).click();
  assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await mockPage.screenshot({path:'test-artifacts/home-page-input-mobile.png',fullPage:true});
  await pageInput.press('Escape');assert.equal(await homePages.getByRole('textbox').count(),0);
  assert.equal(await homePages.getByRole('button',{name:'홈 선수 이전 구간 페이지 직접 입력',exact:true}).evaluate(el=>el===document.activeElement),true);
  await homePages.getByRole('button',{name:'홈 선수 이전 구간 페이지 직접 입력',exact:true}).click();
  await pageInput.fill('1');await homePages.getByRole('button',{name:'이동',exact:true}).click();
  await mockPage.locator('.board-table').getByText('목록 선수 0',{exact:true}).waitFor();
  assert.equal(await homePages.getByRole('button',{name:'이전 홈 선수 페이지',exact:true}).isDisabled(),true);
  await mockPage.setViewportSize({width:1440,height:1000});
  await homePages.getByRole('button',{name:'홈 선수 다음 구간 페이지 직접 입력',exact:true}).click();
  await mockPage.screenshot({path:'test-artifacts/home-page-input-desktop.png',fullPage:true});
  await homePages.getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await homePages.getByRole('textbox').count(),0);
  report.checks.push('Home copy and shared header are simplified; centered pagination validates manual jumps, boundaries, Escape and mobile layout');
  state.players[0].photo="https://sports.bzzoiro.com/img/player/9/";
  state.players[0].statsScope="imported_matches";
  state.players[0].importedMatches=2;
  await mock.route("https://sports.bzzoiro.com/img/player/9/",route=>route.fulfill({status:204}));
  await visit(mockPage,base+"/players/test-player",{});
  await mockPage.locator(".detail-photo .portrait svg").waitFor();
  assert.equal(await mockPage.locator(".detail-photo .portrait img").count(),0);
  // The 11-03 player detail removed the stat strip below the banner.
  assert.equal(await mockPage.getByText("수집된 2경기 득점 · 도움",{exact:true}).count(),0);
  report.checks.push("BSD missing photo falls back; the removed stat strip stays removed");
  // Opening a match report is the only trigger; reopening shares the cached result.
  const reportFacts={playerName:"CI-only player",opponent:"리포트 상대",playedAt:"2026-10-18T12:00:00Z",minutes:90,score:57,scoreStatus:"provisional",ruleVersion:"form-v2",contributions:[{metric:"minutes",value:90,points:30},{metric:"goals",value:1,points:30},{metric:"yellow_cards",value:1,points:-3}],warningCount:1,priceBefore:100000,priceAfter:92000,targetPrice:80000,formScore:40,changePercent:-8,windowSize:5};
  state.players[0].records=[{id:"report-record",fixtureId:"test-fixture",reportAvailable:true,playedAt:reportFacts.playedAt,opponent:reportFacts.opponent,result:"승",minutes:90,goals:1,assists:0,performance:57}];
  let reportGets=0,reportPosts=0;
  await mock.route("**/api/kickx/players/test-player/matches/test-fixture/report",route=>{
    const creating=route.request().method()==="POST";
    if(creating)reportPosts++;else reportGets++;
    return route.fulfill({json:{status:creating||reportPosts?"ready":"missing",facts:reportFacts,text:creating||reportPosts?{performance:"출전 시간과 득점 기록이 경기력 점수의 중심을 이뤘습니다. 출전에 따른 기본 점수와 직접적인 득점 기여가 함께 총점을 끌어올렸습니다. 경고로 인한 감점도 있었지만, 주요 가점에 비해 차감 영향은 작았습니다."}:null,generatedAt:"2026-10-20T00:00:00Z",canGenerate:true}});
  });
  await visit(mockPage,base+"/players/test-player",{});
  assert.equal(reportGets+reportPosts,0,"Player detail fetched a report eagerly");
  await mockPage.getByRole("button",{name:"리포트 상대 경기 리포트",exact:true}).click();
  await mockPage.getByRole("heading",{name:"AI 경기력 설명",exact:true}).waitFor();
  assert.equal(reportGets,1);assert.equal(reportPosts,1);
  assert.ok((await mockPage.locator('.modal-heading').innerText()).includes('2026. 10. 18.'));
  assert.ok(!(await mockPage.getByRole('dialog').innerText()).match(/AI 가치 변동 설명|경기별 Performance와 가치 변동|미확인 통계|추후 정정/));
  assert.ok((await mockPage.getByRole("dialog").innerText()).includes("92,000"));
  assert.ok(await mockPage.locator('.report-explanation p').count()>=3);
  await mockPage.getByRole("button",{name:"닫기",exact:true}).click();
  await mockPage.getByRole("button",{name:"리포트 상대 경기 리포트",exact:true}).click();
  await mockPage.getByRole("heading",{name:"AI 경기력 설명",exact:true}).waitFor();
  assert.equal(reportGets,1);assert.equal(reportPosts,1,"Reopening generated/read a report again");
  await mockPage.setViewportSize({width:390,height:844});
  assert.ok(await mockPage.getByRole("dialog").evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await mockPage.screenshot({path:"test-artifacts/match-report-mobile.png",fullPage:true});
  await mockPage.keyboard.press("Escape");
  assert.equal(await mockPage.getByRole("dialog").count(),0);
  await mockPage.setViewportSize({width:1440,height:1000});
  report.checks.push("Match report loads only on open, generates once, shares cached text, and fits mobile");
  // A failed model/claim request must not discard the successful numerical read.
  state.players[0].records[0].fixtureId="failed-report-fixture";
  let failedReportPosts=0;
  await mock.route("**/api/kickx/players/test-player/matches/failed-report-fixture/report",route=>{
    if(route.request().method()==="POST") {
      failedReportPosts++;
      return route.fulfill({status:500,json:{error:"요청을 처리하지 못했습니다."}});
    }
    return route.fulfill({json:{status:"missing",facts:reportFacts,text:null,generatedAt:null,canGenerate:true}});
  });
  await visit(mockPage,base+"/players/test-player",{});
  await mockPage.getByRole("button",{name:"리포트 상대 경기 리포트",exact:true}).click();
  await mockPage.getByRole("dialog").getByRole("alert").waitFor();
  assert.ok(await mockPage.getByRole("heading",{name:"경기력 산정 요약",exact:true}).isVisible());
  assert.ok((await mockPage.getByRole("dialog").innerText()).includes("92,000"));
  assert.equal(failedReportPosts,1,"Failed generation retried automatically");
  await Promise.all([
    mockPage.waitForResponse(response=>response.url().includes("/failed-report-fixture/report")&&response.request().method()==="POST"),
    mockPage.getByRole("button",{name:"다시 확인",exact:true}).click(),
  ]);
  await mockPage.getByRole("dialog").getByRole("alert").waitFor();
  assert.equal(failedReportPosts,2,"Manual retry did not issue a fresh generation request");
  await mockPage.keyboard.press("Escape");
  state.players[0].records[0].fixtureId="history-report-fixture";
  state.players[0].records[0].reportAvailable=false;
  let historyReportPosts=0;
  await mock.route("**/api/kickx/players/test-player/matches/history-report-fixture/report",route=>{
    if(route.request().method()==="POST")historyReportPosts++;
    return route.fulfill({json:{status:"unavailable",unavailableReason:"baseline-history",facts:null,text:null,generatedAt:null,canGenerate:true}});
  });
  await visit(mockPage,base+"/players/test-player",{});
  assert.equal(await mockPage.getByRole("button",{name:"리포트 상대 경기 리포트",exact:true}).count(),0);
  await mockPage.getByRole('button',{name:'가치 분석',exact:true}).click();
  assert.equal(await mockPage.locator('.analysis button').count(),0);
  assert.equal(historyReportPosts,0,"Historical initial-price input requested a report");
  // Even an eligible match must not expose report actions or requests to guests.
  const memberSession=state.session;
  state.session=null;
  state.players[0].records[0].fixtureId='guest-report-fixture';
  state.players[0].records[0].reportAvailable=true;
  let guestReportRequests=0;
  await mock.route('**/api/kickx/players/test-player/matches/guest-report-fixture/report',route=>{guestReportRequests++;return route.fulfill({status:401,json:{error:'로그인이 필요합니다.'}});});
  await visit(mockPage,base+'/players/test-player',{});
  assert.equal(await mockPage.getByRole('button',{name:'리포트 상대 경기 리포트',exact:true}).count(),0);
  await mockPage.getByRole('button',{name:'가치 분석',exact:true}).click();
  assert.equal(await mockPage.locator('.analysis button').count(),0);
  assert.equal(guestReportRequests,0,'Guest view fetched a report');
  state.session=memberSession;
  report.checks.push("Failed generation preserves figures; baseline and guest report buttons are hidden without requests");
  await visit(mockPage,base+"/transactions",{});
  const totals=await mockPage.locator(".tx-summary strong").allTextContents();
  assert.ok(totals.length===3&&totals.every(text=>text.includes("—")));
  assert.ok(await mockPage.getByRole("heading",{name:"거래 내역 정보를 준비하고 있습니다",exact:true}).isVisible());
  report.checks.push("Unconnected finance remains unknown after login");
  let profileCalls=0;
  await mock.route("**/api/kickx/profile",async route=>{
    profileCalls++;
    const input=route.request().postDataJSON();
    assert.equal(input.id,undefined);
    if(profileCalls===1) return route.fulfill({status:409,json:{error:"이미 사용 중인 닉네임입니다."}});
    state.session.profile=input;
    return route.fulfill({json:{profile:input}});
  });
  await visit(mockPage,base+"/mypage",{});
  await mockPage.getByLabel("닉네임",{exact:true}).fill("새 닉네임");
  await mockPage.getByRole("button",{name:"변경사항 저장"}).click();
  await mockPage.getByRole("alert").filter({hasText:"이미 사용 중인 닉네임입니다."}).waitFor();
  assert.equal(await mockPage.getByLabel("닉네임",{exact:true}).inputValue(),"새 닉네임");
  await mockPage.getByRole("button",{name:"변경사항 저장"}).click();
  await mockPage.getByText("프로필을 저장했습니다.",{exact:true}).waitFor();
  assert.ok(await mockPage.getByRole("heading",{name:"새 닉네임",exact:true}).isVisible());
  report.checks.push("Profile errors preserve input; confirmed saves update the account");

  // Admin visits never invoke collection/calculation; verified member controls persist.
  state.session.role="admin";
  const admin=loadTs("../lib/kickx/data.ts").emptyAdminData();
  await mock.route(/\/api\/kickx\/admin$/,route=>route.fulfill({json:{status:"ready",data:admin}}));
  const actions=[];
  await mock.route("**/api/kickx/admin/ingestion",route=>{actions.push("ingestion");return route.fulfill({status:410,json:{error:"automatic"}});});
  const managed={id:"00000000-0000-0000-0000-000000000003",nickname:"운영 테스트 회원",team_id:null,created_at:"2026-10-09T01:00:00Z",user_roles:null,member_restrictions:null};
  await mock.route("**/api/kickx/admin/users**",route=>{
    if(route.request().method()==="POST") {
      const input=route.request().postDataJSON();actions.push(input.days);
      assert.equal(input.userId,managed.id);
      managed.member_restrictions={suspended_until:input.days?new Date(Date.now()+input.days*86400000).toISOString():null,reason:input.reason};
      return route.fulfill({json:{saved:true}});
    }
    return route.fulfill({json:{items:[managed],total:1,page:1,size:30}});
  });
  await visit(mockPage,base+"/admin/data",{waitUntil:"domcontentloaded"});
  await mockPage.waitForURL(url=>url.pathname==='/admin',{waitUntil:'domcontentloaded'});
  await mockPage.getByRole('heading',{name:'운영 개요',exact:true}).waitFor();
  assert.equal(new URL(mockPage.url()).pathname,"/admin");assert.deepEqual(actions,[]);
  assert.equal(await mockPage.getByRole("button",{name:"5대 리그 데이터 갱신",exact:true}).count(),0);
  await visit(mockPage,base+"/admin/users",{});
  await mockPage.getByText(managed.nickname,{exact:true}).waitFor();assert.deepEqual(actions,[]);
  await mockPage.getByRole("button",{name:"회원 관리",exact:true}).click();
  await mockPage.getByLabel("회원 처리 사유").fill("반복적인 운영 규칙 위반");
  await mockPage.getByRole("button",{name:"이용 제한 적용",exact:true}).click();
  await mockPage.getByText("이용 제한",{exact:true}).waitFor();assert.deepEqual(actions,[7]);
  await revisit(mockPage,{});await mockPage.getByText("이용 제한",{exact:true}).waitFor();
  await mockPage.getByRole("button",{name:"회원 관리",exact:true}).click();
  await mockPage.getByLabel("회원 처리 사유").fill("운영 검토 후 제한 해제");
  await mockPage.getByRole("button",{name:"제한 해제",exact:true}).click();
  await mockPage.getByText("정상",{exact:true}).waitFor();assert.deepEqual(actions,[7,0]);
  for(const width of [1440,390]) {
    await mockPage.setViewportSize({width,height:900});
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await mockPage.screenshot({path:`test-artifacts/admin-users-${width}.png`,fullPage:true});
  }
  report.checks.push("Admin visits have no collection mutation; member restriction and restore survive reload");
  // Browser contract doubles only. SQL integration above independently tests actual persistence.
  state.players[0].price=100000;state.players[0].position='FW';
  state.teams=[{id:'test-team',name:'테스트 구단',english:'Test Club',code:'TST',color:null,leagueId:null}];
  state.players[0].team='test-team';state.categories=['자유'];
  state.formations=[{id:'4-3-3',name:'4-3-3',positions:['GK','DF','DF','DF','DF','MF','MF','MF','FW','FW','FW']}];
  Object.assign(state.member,{financialReady:true,points:1300000,totalAssets:1300000,playerAssets:0,profit:0,returnRate:0,ownedPlayers:[]});
  let tradeCalls=0,quoteCalls=0;
  await mock.route(/\/api\/kickx\/trades\?/,route=>{const id=new URL(route.request().url()).searchParams.get('playerId');const items=(state.member.transactions??[]).filter(t=>!id||t.playerId===id);return route.fulfill({json:{status:'ready',data:{items,total:items.length,page:1,size:50}}});});
  await mock.route('**/api/kickx/trades/quote',async route=>{
    quoteCalls++;const body=route.request().postDataJSON();assert.equal(body.playerId,'test-player');assert.equal(body.price,undefined);
    await route.fulfill({json:{id:'11111111-1111-1111-1111-111111111111',playerId:'test-player',side:body.side,quantity:1,price:100000,fee:0,settlement:100000,balance:1300000,balanceAfter:1200000,quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}});
  });
  await mock.route('**/api/kickx/trades',async route=>{
    tradeCalls++;const body=route.request().postDataJSON();assert.deepEqual(Object.keys(body).sort(),['quoteId','requestId']);assert.match(body.requestId,/^[a-f0-9-]{36}$/);
    Object.assign(state.member,{points:1200000,playerAssets:100000,ownedPlayers:[state.players[0]],holdings:[{id:'test-player',playerId:'test-player',playerName:'CI-only player',quantity:1,cost:100000,value:100000,profit:0,returnRate:0}]});
    await new Promise(r=>setTimeout(r,150));await route.fulfill({json:{accepted:true}});
  });
  await visit(mockPage,base+'/players/test-player',{});
  await mockPage.getByRole('button',{name:'매입하기',exact:true}).click();
  const confirm=mockPage.getByRole('button',{name:'매입 확정',exact:true});await confirm.waitFor();await confirm.click();
  await mockPage.getByRole('heading',{name:'매입이 완료되었습니다',exact:true}).waitFor();
  assert.equal(quoteCalls,1);assert.equal(tradeCalls,1);
  await mockPage.getByRole('button',{name:'확인',exact:true}).click();
  assert.equal(await mockPage.getByRole('button',{name:'보유 중',exact:true}).isDisabled(),true);
  report.checks.push('Trade UI uses server quote; receipt reloads holdings; duplicate holding blocks buy');
  const originalHoldings=state.member.holdings,originalOwned=state.member.ownedPlayers;
  state.member.ownedPlayers=Array.from({length:3},(_,i)=>({...state.players[0],id:`held-forward-${i}`}));
  state.member.holdings=state.member.ownedPlayers.map(p=>({playerId:p.id,quantity:1,cost:100000}));
  await revisit(mockPage,{});
  assert.equal(await mockPage.getByRole('button',{name:'매입하기',exact:true}).isEnabled(),true);
  assert.equal(quoteCalls,1,'Opening a detail must not request a quote');
  await mockPage.getByRole('button',{name:'매입하기',exact:true}).click();
  await mockPage.getByRole('dialog').getByText(/FW 보유 정원 3명이 찼습니다/).waitFor();
  assert.equal(await mockPage.getByRole('button',{name:'매입 확정',exact:true}).isDisabled(),true);assert.equal(quoteCalls,1);
  await mockPage.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
  state.players[0].position='MF';
  await revisit(mockPage,{});
  assert.equal(await mockPage.getByRole('button',{name:'매입하기',exact:true}).isEnabled(),true);
  state.players[0].position='FW';state.member.holdings.pop();state.member.ownedPlayers.pop();
  await revisit(mockPage,{});
  assert.equal(await mockPage.getByRole('button',{name:'매입하기',exact:true}).isEnabled(),true);
  state.member.holdings=originalHoldings;state.member.ownedPlayers=originalOwned;
  report.checks.push('Purchase modal enforces positional holding quotas while other positions remain available');
  await visit(mockPage,base+'/squad',{});
  assert.equal(await mockPage.getByRole('button',{name:'스쿼드 저장',exact:true}).count(),0);
  assert.equal(await mockPage.getByRole('button',{name:'배치',exact:true}).count(),0);
  assert.equal(await mockPage.getByRole('button',{name:/자리 빈 자리/}).count(),10);
  assert.ok(await mockPage.getByRole('button',{name:'9번 FW 자리 CI-only player',exact:true}).isVisible());
  await mockPage.getByRole('button',{name:'2번 DF 자리 빈 자리',exact:true}).click();
  await mockPage.getByRole('textbox',{name:'스쿼드 선수 검색',exact:true}).waitFor();
  assert.ok((await mockPage.locator('.slot-note').innerText()).includes('DF'));
  report.checks.push('Bought holdings automatically occupy the pitch; vacancies open the position market without placement/save controls');
  let savedPost=null;const savedPosts=[];const savedComments=[];const communityActions=[];let quickAttempts=0,quickRequest=null;
  await mock.route(/\/api\/kickx\/community(?:\?|$)/,async route=>{
    const req=route.request();
    if(req.method()==='GET'){
      const params=new URL(req.url()).searchParams;
      const posts=savedPosts.filter(p=>p.scope===params.get('scope')&&(!params.get('target')||p.target===params.get('target'))).slice().reverse();
      return route.fulfill({json:{status:'ready',data:params.has('postId')?{post:savedPosts.find(p=>p.id===params.get('postId'))??null,comments:savedComments.filter(c=>c.postId===params.get('postId'))}:{items:posts,total:posts.length,page:1,size:20}}});
    }
    const body=req.postDataJSON();communityActions.push(body.action);
    if(body.action==='createPost'){
      assert.match(body.requestId,/^[a-f0-9-]{36}$/);
      if(body.body==='실패해도 유지되는 선수 이야기입니다.'){
        quickAttempts++;
        if(quickAttempts===1){quickRequest=body.requestId;return route.fulfill({status:500,json:{error:'글 저장 테스트 오류'}});}
        assert.equal(body.requestId,quickRequest);
      }
      savedPost={...body,title:body.title||body.body.trim().replace(/\s+/g,' ').slice(0,80),id:`22222222-2222-2222-2222-${String(savedPosts.length+1).padStart(12,'0')}`,author:'새 닉네임',authorId:'test-account',targetName:body.scope==='club'?'테스트 구단':'CI-only player',date:new Date().toISOString(),revision:1,likes:0,liked:false,views:0,commentCount:0,transaction:null};savedPosts.push(savedPost);
    }
    const selectedPost=savedPosts.find(p=>p.id===body.postId);
    if(body.action==='comment'){assert.match(body.requestId,/^[a-f0-9-]{36}$/);savedComments.push({id:'33333333-3333-3333-3333-333333333333',postId:body.postId,author:'새 닉네임',authorId:'test-account',body:body.body,date:new Date().toISOString(),revision:1});selectedPost.commentCount++;}
    if(body.action==='like'){selectedPost.liked=body.liked;selectedPost.likes=body.liked?1:0;}
    await route.fulfill({json:{id:savedPost?.id}});
  });
  await visit(mockPage,base+'/community/write?scope=player&target=test-player',{});
  assert.equal(await mockPage.getByRole('combobox',{name:'주제',exact:false}).count(),0);
  await mockPage.getByLabel('제목',{exact:false}).fill('테스트 경기 후기');await mockPage.locator('#post-body').fill('저장 흐름을 점검하는 테스트 게시글 내용입니다.');
  await mockPage.getByRole('button',{name:'게시글 등록',exact:true}).click();await mockPage.getByRole('link',{name:'저장한 게시글 보기',exact:true}).click();
  await mockPage.getByRole('heading',{name:'테스트 경기 후기',exact:true}).waitFor();
  await mockPage.getByLabel('댓글 내용',{exact:true}).fill('저장하는 댓글');await mockPage.getByRole('button',{name:'댓글 등록',exact:true}).click();await mockPage.getByText('저장하는 댓글',{exact:true}).waitFor();
  await mockPage.getByRole('button',{name:'공감 0',exact:true,pressed:false}).click();await mockPage.getByRole('button',{name:'공감 1',exact:true,pressed:true}).waitFor();
  await mockPage.getByRole('button',{name:'게시글 신고',exact:true}).click();await mockPage.getByLabel('신고 사유',{exact:true}).fill('신고 등록 테스트입니다');await mockPage.getByRole('button',{name:'신고 제출',exact:true}).click();
  assert.ok(['createPost','comment','like','report'].every(action=>communityActions.includes(action)));
  report.checks.push('Post creation, direct detail, comment, desired-state like and report use real endpoint contracts');
  // Separate feeds require a title and retain the fixed player target.
  state.session.profile.team='test-team';state.session.profile.teams=['test-team'];
  savedPosts.push({...savedPost,id:'44444444-4444-4444-4444-444444444444',scope:'club',target:'test-team',targetName:'테스트 구단',title:'구단 전용 제목',body:'구단에서만 보여야 하는 이야기입니다.',likes:0,liked:false,commentCount:0});
  await visit(mockPage,base+'/community',{});
  assert.equal(await mockPage.locator('.community-switch').count(),0);assert.equal(await mockPage.locator('.popular-list').count(),0);assert.equal(await mockPage.locator('.explorer').count(),0);assert.equal(await mockPage.locator('.feed-composer').count(),0);
  await mockPage.getByRole('link',{name:'구단 전용 제목',exact:true}).waitFor();
  await visit(mockPage,base+'/community/players',{waitUntil:'domcontentloaded'});
  await mockPage.waitForURL(url=>url.pathname==='/market',{waitUntil:'domcontentloaded'});assert.equal(new URL(mockPage.url()).pathname,'/market');
  await visit(mockPage,base+'/players/test-player',{});await mockPage.getByRole('button',{name:'커뮤니티',exact:true}).click();
  await mockPage.getByRole('link',{name:/^테스트 경기 후기/}).first().waitFor();
  assert.equal(await mockPage.locator('.community-board-table tr[data-scope=club]').count(),0);
  await mockPage.locator('.feed-composer-open').click();
  assert.equal(await mockPage.getByRole('combobox',{name:'이야기할 선수'}).count(),0);
  await mockPage.getByLabel('빠른 글 제목',{exact:true}).fill('실패해도 유지되는 선수 이야기입니다.');
  await mockPage.getByLabel('빠른 글 내용',{exact:true}).fill('실패해도 유지되는 선수 이야기입니다.');
  await mockPage.getByRole('button',{name:'게시하기',exact:true}).click();await mockPage.getByRole('alert').filter({hasText:'글 저장 테스트 오류'}).waitFor();
  assert.equal(await mockPage.getByLabel('빠른 글 내용',{exact:true}).inputValue(),'실패해도 유지되는 선수 이야기입니다.');
  await mockPage.getByRole('button',{name:'게시하기',exact:true}).click();await mockPage.getByRole('link',{name:'실패해도 유지되는 선수 이야기입니다.',exact:true}).waitFor();
  assert.equal(quickAttempts,2);assert.equal(savedPost.scope,'player');assert.equal(savedPost.target,'test-player');assert.equal(await mockPage.getByLabel('빠른 글 내용',{exact:true}).count(),0);
  await visit(mockPage,base+'/community/clubs',{});assert.equal(await mockPage.locator('.community-board-table tr[data-scope=player]').count(),0);await mockPage.getByRole('link',{name:'구단 전용 제목',exact:true}).waitFor();
  state.session.profile.team=null;state.session.profile.teams=[];
  await visit(mockPage,base+'/community/clubs/test-team',{});assert.equal(await mockPage.locator('.feed-composer').count(),0);
  state.session.profile.team='test-team';state.session.profile.teams=['test-team'];
  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    for(const path of ['/community','/community/players','/community/clubs','/community/players/test-player','/community/clubs/test-team']){
      await visit(mockPage,base+path,{waitUntil:'domcontentloaded'});await mockPage.locator('#main-content h1').first().waitFor();assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${path} community overflows at ${width}`);
      await mockPage.screenshot({path:`test-artifacts/community-${path.split('/').slice(2).join('-')||'entry'}-${width}.png`,fullPage:true});
    }
    await visit(mockPage,base+'/players/test-player',{});await mockPage.getByRole('button',{name:'커뮤니티',exact:true}).click();assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mockPage.screenshot({path:`test-artifacts/community-player-tab-${width}.png`,fullPage:true});
  }
  report.checks.push('Compact club board removes switches, popular posts, lounge explorer and quick composer; player discussion is entered from player detail; scoped writes retain retry UUID');

  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    for(const path of ['/teams/test-team','/squad',`/community/posts/${savedPost.id}`,'/rules']){
      await visit(mockPage,base+path,{});assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${path} prototype overflows at ${width}`);
      await mockPage.screenshot({path:`test-artifacts/prototype-${path.startsWith('/community')?'post':path.startsWith('/teams')?'team':path.slice(1)}-${width}.png`,fullPage:true});
    }
  }
  report.checks.push('Prototype team, squad, article and score rules fit desktop and mobile');

  // New rules render only for an active v2 DB policy; display persisted pricing evidence.
  state.policy={version:'form-v2',initialPoints:1300000,initialPrice:100000,sellFeeBps:200,quoteSeconds:60};
  state.players[0].pricing={baseline:{source:'previous-season',season:2025,gameCount:10,meanScore:80,seedScore:70,price:140000,warnings:[]},recent:[{fixture_id:'bsd-9301',played_at:'2026-08-02T12:00:00Z',price_before:140000,price_after:151200,target_price:173333,form_score:86.666667,change_percent:8,window_fixture_ids:['bsd-9301','bsd-9209','bsd-9208','bsd-9207','bsd-9206']}]};
  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    await visit(mockPage,base+'/rules',{});
    await mockPage.getByText('FORM V2',{exact:true}).waitFor();
    assert.match(await mockPage.locator('.rules-equation').innerText(),/65.5/);
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`v2 rules overflow at ${width}`);
    await mockPage.screenshot({path:`test-artifacts/market-v2-rules-${width}.png`,fullPage:true});
    await visit(mockPage,base+'/players/test-player',{});
    await mockPage.getByRole('heading',{name:'변동 기록',exact:false}).waitFor();
    assert.equal(await mockPage.locator('.detail-stats,.value-legend,.order-panel').count(),0);
    assert.equal(await mockPage.getByRole('heading',{name:'선수 가치 산정 근거',exact:true}).count(),0);
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`v2 evidence overflow at ${width}`);
    await mockPage.screenshot({path:`test-artifacts/market-v2-detail-${width}.png`,fullPage:true});
  }
  report.checks.push('Active v2 rules and simplified player detail fit desktop and mobile');
  state.policy.clubCompetitionsEnabled=true;
  const leagueIds=['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'];
  state.leagues=leagueIds.map((id,i)=>({id,name:`선택 리그 ${i+1}`}));state.leagues.push({id:'bsd-7',name:'챔피언스리그'});
  state.teams.push(...leagueIds.map((leagueId,i)=>({id:`selected-club-${i}`,name:`선택 구단 ${i+1}`,english:`Club ${i+1}`,leagueId})),{id:'bsd-4401',name:'테스트 홈 구단',english:'Home',leagueId:'bsd-1'},{id:'bsd-4402',name:'테스트 원정 구단',english:'Away',leagueId:null});
  state.session.profile.team=null;state.session.profile.teams=[];
  await visit(mockPage,base+'/mypage',{});
  for(let i=0;i<5;i++){await mockPage.getByRole('combobox',{name:`선택 리그 ${i+1} 응원 구단`,exact:true}).click();await mockPage.getByRole('option',{name:`선택 구단 ${i+1}`,exact:true}).click();}
  await mockPage.getByRole('button',{name:'변경사항 저장',exact:true}).click();await mockPage.getByText('프로필을 저장했습니다.',{exact:true}).waitFor();
  assert.equal(state.session.profile.teams.length,5);assert.equal(new Set(state.session.profile.teams).size,5);
  await visit(mockPage,base+'/community/clubs',{});assert.equal(await mockPage.locator('.supported-board-clubs nav button').count(),6);
  const today=loadTs('../lib/kickx/fixtures.ts').koreanDay(new Date().toISOString());
  const year=today.slice(0,4),month=Number(today.slice(5,7));
  state.fixtures=[{id:'regular-test',leagueId:'bsd-1',home:'bsd-4401',away:'bsd-4402',startsAt:`${today}T01:00:00+09:00`,status:'FT',homeScore:2,awayScore:1,reflectionStatus:'partial'},
    {id:'cup-test',leagueId:'bsd-7',home:'bsd-4401',away:'bsd-4402',startsAt:`${today}T02:00:00+09:00`,status:'PEN',homeScore:1,awayScore:1,penaltiesHome:5,penaltiesAway:4,roundLabel:'League phase · Matchday 5'}];
  const dayOffset=days=>new Date(Date.parse(today+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  for(const offset of [-7,-6,1])state.fixtures.push({...state.fixtures[0],id:`fold-test-${offset}`,startsAt:`${dayOffset(offset)}T03:00:00+09:00`});
  for(const width of [1440,800,390]){
    await mockPage.setViewportSize({width,height:900});
    await visit(mockPage,base+'/fixtures',{});
    await mockPage.locator('.match-day.today .match-row').waitFor();
    await mockPage.waitForFunction(()=>window.scrollY>0);
    const todayTop=await mockPage.locator('.match-day.today').evaluate(el=>el.getBoundingClientRect().top);assert.ok(todayTop>=0&&todayTop<750,`Today anchor hidden: ${todayTop}`);
    const calendar=mockPage.locator('.schedule-calendar');
    const defaultDays=await calendar.locator('.match-day').evaluateAll(days=>days.map(day=>({date:day.dataset.date,expanded:day.querySelector('.match-day-toggle').getAttribute('aria-expanded')})));
    for(const day of defaultDays)assert.equal(day.expanded,String(day.date>=dayOffset(-6)&&day.date<=today));
    const defaultMatches=state.fixtures.filter(f=>f.leagueId==='bsd-1'&&f.startsAt.slice(0,10)>=dayOffset(-6)&&f.startsAt.slice(0,10)<=today&&f.startsAt.slice(0,7)===today.slice(0,7)).length;
    assert.equal(await calendar.locator('.match-row:visible').count(),defaultMatches);assert.equal(await mockPage.getByText('승부차기 5 : 4',{exact:true}).count(),0);
    await mockPage.getByRole('button',{name:'모두 접기',exact:true}).click();
    assert.equal(await calendar.locator('.match-row:visible').count(),0);
    assert.equal(await calendar.locator('.match-day-toggle[aria-expanded=true]').count(),0);
    await mockPage.getByRole('button',{name:'모두 펼치기',exact:true}).click();
    assert.equal(await calendar.locator('.match-day-toggle[aria-expanded=false]').count(),0);
    const todayToggle=calendar.locator('.match-day.today .match-day-toggle');
    await todayToggle.focus();await mockPage.keyboard.press('Enter');
    assert.equal(await todayToggle.getAttribute('aria-expanded'),'false');
    assert.equal(await calendar.locator('.match-day.today .match-row:visible').count(),0);
    await mockPage.keyboard.press('Space');
    assert.equal(await todayToggle.getAttribute('aria-expanded'),'true');
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`monthly fixtures overflow at ${width}`);
    await mockPage.getByRole('button',{name:'1월',exact:true}).click();
    await mockPage.getByRole('heading',{name:new RegExp(`${year}년 1월`)}).waitFor();
    await mockPage.getByRole('button',{name:'최신',exact:true}).click();
    await mockPage.getByRole('heading',{name:new RegExp(`${year}년 ${month}월`)}).waitFor();
    await mockPage.locator('.match-day.today .match-row').waitFor();
    await mockPage.screenshot({path:`test-artifacts/monthly-fixtures-${width}.png`,fullPage:true});
    await visit(mockPage,base+'/teams/bsd-4401',{});await mockPage.getByText('승부차기 5 : 4',{exact:true}).waitFor();assert.equal(await mockPage.locator('.match-row').count(),state.fixtures.length);
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`club all-competition schedule overflow at ${width}`);
    await mockPage.screenshot({path:`test-artifacts/club-all-fixtures-${width}.png`,fullPage:true});
  }
  assert.ok(fixtureRequests.some(q=>q.includes(`month=${year}-${String(month).padStart(2,'0')}`)));assert.ok(fixtureRequests.some(q=>q.includes('team=bsd-4401')));
  report.checks.push('Five support selectors save independently by league; monthly schedule defaults to the last seven KST days with accessible day/all toggles; today/latest navigation and all-competition club schedules remain intact');
  state.policy={...state.policy,version:'report-v3',clubCompetitionsEnabled:false};
  await visit(mockPage,base+'/rules',{});
  assert.equal(await mockPage.getByRole('heading',{name:'시즌 누적 가격',exact:true}).isVisible(),true);
  assert.equal(await mockPage.getByRole('heading',{name:'초기 가격',exact:true}).isVisible(),true);
  assert.ok((await mockPage.locator('body').innerText()).includes('최대 11명까지 보유하며'));
  report.checks.push('Report rules explain cumulative seasons, positional baselines and 11-player holding quotas');
  await mock.close();
  const marketContext=await browser.newContext();
  await marketContext.route(/^https:\/\//,route=>route.abort());
  await marketContext.route(/\/api\/kickx\/notifications(?:\?.*)?$/,route=>route.fulfill({json:{status:'ready',data:{hasUnread:false,matchNotifications:true,commentNotifications:true,replyNotifications:true,items:[],hasMore:false}}}));
  const marketPage=await marketContext.newPage();marketPage.on('pageerror',error=>errors.push(error.message));
  const marketPlayer={...state.players[0],team:'market-scope-team'};
  const marketData={...state,players:[marketPlayer],playerTotal:319,market:{totalPlayers:319,readyPlayers:1,pricedPlayers:1,volume:0,rising:1,falling:0,calculatedAt:null},
    leagues:[...['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'].map((id,i)=>({id,name:`정규 리그 ${i}`})),{id:'bsd-7',name:'범위 밖 컵대회'}],
    teams:[{id:'market-scope-team',name:'범위 안 구단',leagueId:'bsd-1'},{id:'market-scope-team2',name:'두 번째 구단',leagueId:'bsd-3'},{id:'market-foreign-team',name:'범위 밖 구단',leagueId:'bsd-7'}]};
  await marketContext.route(/\/api\/kickx$/,route=>route.fulfill({json:{status:'ready',data:marketData}}));
  const marketRows=Array.from({length:319},(_,i)=>({...marketPlayer,id:`market-page-${i}`,name:`페이지 선수 ${i}`,team:i%2?'market-scope-team2':'market-scope-team'}));
  const marketQueries=[];
  await marketContext.route(/\/api\/kickx\/players\?/,route=>{
    const params=new URL(route.request().url()).searchParams;marketQueries.push(params.toString());
    const page=Number(params.get('page')||1),size=Number(params.get('size')||12);
    const rows=marketRows.filter(p=>(!params.get('team')||p.team===params.get('team'))&&(!params.get('league')||marketData.teams.find(t=>t.id===p.team)?.leagueId===params.get('league')));
    return route.fulfill({json:{status:'ready',data:{items:rows.slice((page-1)*size,page*size),total:rows.length,page,size}}});
  });
  for(const width of [1440,390]){
    await marketPage.setViewportSize({width,height:900});await visit(marketPage,base+'/market',{});
    await marketPage.locator('.market-hero-stats').waitFor();
    for(const [label,value]of [['등록 선수','319'],['구단','2'],['리그','5']])assert.equal(await marketPage.locator('.market-hero-stats>div').filter({has:marketPage.locator('dt',{hasText:label})}).locator('dd').innerText(),value);
    assert.equal(await marketPage.locator('.league-tiles button').count(),6);
    assert.equal(await marketPage.getByText('범위 밖 컵대회',{exact:true}).count(),0);
    assert.equal(await marketPage.getByText('실제 경기 기록으로 움직이는 선수 가치. 관심 선수를 모아두고 가치가 열리는 순간을 기다리세요.',{exact:true}).count(),0);
    assert.equal(await marketPage.getByRole('link',{name:'선수 탐색',exact:true}).count(),0);
    assert.equal(await marketPage.locator('.market-stats,.market-pending').count(),0);
    assert.equal(await marketPage.locator('.market-heading .page-heading p').count(),0);
    assert.equal(await marketPage.locator('.market-browser .league-tiles').count(),1);
    const columns=await marketPage.locator('.player-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(await marketPage.locator('.player-grid .pcard').count(),columns*2);
    assert.equal(await marketPage.locator('.player-grid .pcard').evaluateAll(cards=>new Set(cards.map(card=>card.offsetTop)).size),2);
    assert.equal(await marketPage.getByRole('heading',{name:'선수 시장',exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),width===1440?40:30);
    assert.ok(await marketPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await marketPage.screenshot({path:`test-artifacts/market-scope-${width}.png`,fullPage:true});
    await marketPage.getByRole('button',{name:'목록 보기',exact:true}).click();
    await marketPage.waitForFunction(()=>document.querySelectorAll('.market-table tbody tr').length===12);
    assert.equal(await marketPage.locator('.market-table tbody tr').count(),12);
  }
  await marketPage.setViewportSize({width:1440,height:900});
  const marketPages=marketPage.getByRole('navigation',{name:'선수 시장 페이지 선택',exact:true});
  await marketPages.getByRole('button',{name:'선수 시장 5페이지',exact:true}).click();
  await marketPage.locator('.market-table').getByText('페이지 선수 48',{exact:true}).waitFor();
  await marketPage.getByRole('button',{name:'카드 보기',exact:true}).click();
  await marketPage.locator('.player-grid').getByRole('heading',{name:'페이지 선수 48',exact:true}).waitFor();
  const marketCardColumns=await marketPage.locator('.player-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const marketCardSize=marketCardColumns*2;
  assert.equal(await marketPage.locator('.player-grid .pcard').count(),marketCardSize);
  assert.equal(await marketPage.locator('.player-grid .pcard').evaluateAll(cards=>new Set(cards.map(card=>card.offsetTop)).size),2);
  assert.equal(await marketPages.getByRole('button',{name:`선수 시장 ${Math.floor(48/marketCardSize)+1}페이지`,exact:true}).getAttribute('aria-current'),'page');
  const lastMarketPage=Math.ceil(marketRows.length/marketCardSize),lastMarketStart=(lastMarketPage-1)*marketCardSize;
  const lastListPage=Math.floor(lastMarketStart/12)+1,lastListStart=(lastListPage-1)*12;
  await marketPages.getByRole('button',{name:'선수 시장 다음 구간 페이지 직접 입력',exact:true}).click();
  const marketInput=marketPages.getByRole('textbox',{name:'선수 시장 이동할 페이지',exact:true});
  const beforeInvalidMarket=marketQueries.length;
  await marketInput.fill(String(lastMarketPage+1));await marketInput.press('Enter');await marketPages.getByRole('alert').waitFor();
  assert.equal(marketQueries.length,beforeInvalidMarket);
  await marketInput.fill(String(lastMarketPage));await marketInput.press('Enter');
  await marketPage.locator('.player-grid').getByRole('heading',{name:`페이지 선수 ${lastMarketStart}`,exact:true}).waitFor();
  assert.equal(await marketPage.locator('.player-grid .pcard').count(),marketRows.length-lastMarketStart);
  assert.equal(await marketPages.getByRole('button',{name:'다음 선수 시장 페이지',exact:true}).isDisabled(),true);
  await marketPage.getByRole('button',{name:'목록 보기',exact:true}).click();
  await marketPage.locator('.market-table').getByText(`페이지 선수 ${lastListStart}`,{exact:true}).waitFor();
  assert.equal(await marketPage.locator('.market-table tbody tr').count(),12);
  assert.equal(await marketPages.getByRole('button',{name:`선수 시장 ${lastListPage}페이지`,exact:true}).getAttribute('aria-current'),'page');
  await marketPage.getByRole('button',{name:'카드 보기',exact:true}).click();
  await marketPage.locator('.player-grid').getByRole('heading',{name:`페이지 선수 ${lastListStart}`,exact:true}).waitFor();
  await marketPage.locator('.league-tiles button').filter({hasText:'정규 리그 1'}).click();
  await marketPage.locator('.player-grid').getByRole('heading',{name:'페이지 선수 1',exact:true}).waitFor();
  assert.equal(await marketPages.getByRole('button',{name:'선수 시장 1페이지',exact:true}).getAttribute('aria-current'),'page');
  await marketPage.locator('.league-tiles button.all').click();
  await marketPage.locator('.player-grid').getByRole('heading',{name:'페이지 선수 0',exact:true}).waitFor();
  await marketPage.getByRole('combobox',{name:'구단 필터',exact:true}).click();
  await marketPage.getByRole('option',{name:'두 번째 구단',exact:true}).click();
  await marketPage.locator('.player-grid').getByRole('heading',{name:'페이지 선수 1',exact:true}).waitFor();
  assert.ok(marketQueries.some(q=>q.includes('team=market-scope-team2')&&q.includes('page=1')&&q.includes(`size=${marketCardSize}`)));
  await marketPage.getByRole('button',{name:'필터 초기화',exact:true}).click();
  await marketPage.locator('.player-grid').getByRole('heading',{name:'페이지 선수 0',exact:true}).waitFor();
  assert.equal(await marketPage.locator('.player-grid .pcard').count(),marketCardSize);
  await marketPage.screenshot({path:'test-artifacts/market-cards-1440.png',fullPage:true});
  await marketPage.setViewportSize({width:390,height:900});
  await marketPage.waitForFunction(()=>document.querySelectorAll('.player-grid .pcard').length===4);
  assert.equal(await marketPage.locator('.player-grid .pcard').evaluateAll(cards=>new Set(cards.map(card=>card.offsetTop)).size),2);
  assert.ok(await marketPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await marketPages.getByRole('button',{name:'선수 시장 다음 구간 페이지 직접 입력',exact:true}).click();
  assert.ok(await marketInput.isVisible());
  await marketPage.screenshot({path:'test-artifacts/market-cards-390.png',fullPage:true});
  await marketInput.press('Escape');
  report.checks.push('Market selectors stay with the results; two-row card pages resize from desktop to mobile while preserving list/grid position, filter resets and direct page entry');
  await visit(marketPage,base+'/players?q=CI&watchlist=1&team=market-scope-team',{});
  assert.equal(new URL(marketPage.url()).pathname,'/market');
  for(const [key,value]of [['q','CI'],['watchlist','1'],['team','market-scope-team']])assert.equal(new URL(marketPage.url()).searchParams.get(key),value);
  assert.equal(await marketPage.getByLabel('선수 검색',{exact:true}).inputValue(),'CI');
  await marketContext.close();
  report.checks.push('Market shows only five regular leagues and their clubs; explorer redirects preserve search, watched scope and team');
  assert.deepEqual(errors,[],"Browser JavaScript errors");
  report.checks.push("No browser JavaScript errors");
  await writeFile("test-artifacts/report.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch(error) {
  if(browser){try{const p=browser.contexts().at(-1)?.pages().at(-1);if(p){await p.screenshot({path:'test-artifacts/failure.png',fullPage:true});console.error('Failed page: '+p.url());}}catch{}}
  console.error(output.slice(-8000));
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
