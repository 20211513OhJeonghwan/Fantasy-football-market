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
  const page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  const routes=["/","/login","/onboarding","/players","/players/missing","/market","/portfolio","/transactions","/squad","/ranking","/community","/community/clubs","/community/players","/community/clubs/missing","/community/players/missing","/community/posts/missing","/community/write","/mypage","/admin","/admin/data","/admin/users","/admin/trades","/admin/community","/fixtures","/teams/missing","/rules"];
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    for(const path of routes) {
      const response=await page.goto(base+path,{waitUntil:"networkidle"});
      assert.ok(response?.ok(),path+" did not load");
      const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
      assert.ok(size.scroll<=size.width+1,path+" overflows at "+viewport.width+": "+size.scroll);
      report.routes.push({path,width:viewport.width});
      if(["/","/fixtures","/players","/squad","/login"].includes(path)) await page.screenshot({path:"test-artifacts/"+(path==="/"?"home":path.slice(1))+"-"+viewport.width+".png",fullPage:true});
    }
  }
  await page.goto(base,{waitUntil:"networkidle"});
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
  await page.goto(base+"/login",{waitUntil:"networkidle"});
  assert.equal(await page.getByRole("button",{name:"Google로 계속하기"}).isDisabled(),true);
  const status=await context.request.get(base+"/api/auth/status");
  assert.equal((await status.json()).enabled,false);
  const denied=await context.request.put(base+"/api/kickx/watchlist",{data:{playerId:"test-player",watched:true}});
  assert.equal(denied.status(),403);
  const disconnected=await context.request.put(base+"/api/kickx/watchlist",{headers:{origin:base},data:{playerId:"test-player",watched:true}});
  assert.equal(disconnected.status(),503);
  report.checks.push("Disconnected services and cross-origin writes stay blocked");
  for (const path of ["/community/players", "/community/clubs"]) {
    await page.goto(base + path, {waitUntil:"networkidle"});
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
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    let released=false;
    await concurrent.route(/\/api\/kickx$/,async route=>{await gate;await route.fulfill({json:{status:'ready',data:state}});});
    const endpoint=detail?/\/api\/kickx\/players\/test-player$/:/\/api\/kickx\/players\?/;
    await concurrent.route(endpoint,route=>route.fulfill({json:{status:'ready',data:detail?{player:state.players[0]}:{items:state.players,total:1,page:1,size:12}}}));
    const concurrentPage=await concurrent.newPage();
    try {
      const requested=concurrentPage.waitForRequest(request=>endpoint.test(request.url()),{timeout:10000});
      await concurrentPage.goto(base+(detail?'/players/test-player':'/players'),{waitUntil:'domcontentloaded'});
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
  const extra=Array.from({length:24},(_,i)=>({...state.players[0],id:"catalog-"+i,name:"목록 선수 "+i}));
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
  await mock.route(/\/api\/kickx\/fixtures\?/,route=>{
    const params=new URL(route.request().url()).searchParams;
    return route.fulfill({json:{status:"ready",data:{items:state.fixtures,total:state.fixtures.length,page:Number(params.get("page")||1),size:20}}});
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
  await mockPage.goto(base,{waitUntil:"networkidle"});
  assert.match(await mockPage.locator(".yb-price").innerText(),/^0/);
  const watch=mockPage.getByRole("button",{name:"관심 선수 추가",exact:true});
  await watch.click();
  await mockPage.getByText("테스트 저장 오류",{exact:true}).waitFor();
  assert.equal(await watch.getAttribute("aria-pressed"),"false");
  await watch.click();
  await mockPage.getByRole("button",{name:"관심 선수 해제",exact:true}).first().waitFor();
  assert.deepEqual(state.member.watchlist,["test-player"]);
  report.checks.push("Zero price renders; failed watchlist writes do not pretend to succeed");
  await mockPage.goto(base+"/players?watchlist=1",{waitUntil:"networkidle"});
  assert.ok(await mockPage.getByRole("heading",{name:"CI-only player",exact:true}).isVisible());
  report.checks.push("Saved watchlist feeds the filtered player list");
  await mockPage.getByRole("button",{name:"전체 선수",exact:true}).click();
  await mockPage.getByLabel("선수 검색",{exact:true}).fill("서버에서만 조회");
  await mockPage.getByRole("heading",{name:"목록 선수 0",exact:true}).waitFor();
  await mockPage.getByRole("button",{name:"다음 페이지",exact:true}).click();
  await mockPage.getByRole("heading",{name:"목록 선수 12",exact:true}).waitFor();
  assert.ok(catalogRequests.some(url=>url.includes("page=2")));
  await mockPage.getByLabel("선수 검색",{exact:true}).fill("");
  await mockPage.getByRole("heading",{name:"CI-only player",exact:true}).waitFor();
  failSearch=true;
  await mockPage.getByLabel("선수 검색",{exact:true}).fill("서버에서만 조회");
  await mockPage.getByRole("heading",{name:"데이터를 불러오지 못했습니다",exact:true}).waitFor();
  await mockPage.getByRole("button",{name:"다시 시도",exact:true}).click();
  await mockPage.getByRole("heading",{name:"목록 선수 0",exact:true}).waitFor();
  await mockPage.goto(base+"/players/catalog-23",{waitUntil:"networkidle"});
  await mockPage.getByRole("heading",{name:"목록 선수 23",exact:true}).waitFor();
  report.checks.push("Server search, second page, retry and direct detail outside bootstrap");
  state.players[0].photo="https://sports.bzzoiro.com/img/player/9/";
  state.players[0].statsScope="imported_matches";
  state.players[0].importedMatches=2;
  await mock.route("https://sports.bzzoiro.com/img/player/9/",route=>route.fulfill({status:204}));
  await mockPage.goto(base+"/players/test-player",{waitUntil:"networkidle"});
  await mockPage.getByText("수집된 2경기 득점 · 도움",{exact:true}).waitFor();
  await mockPage.locator(".detail-photo .portrait svg").waitFor();
  assert.equal(await mockPage.locator(".detail-photo .portrait img").count(),0);
  report.checks.push("BSD missing photo falls back; imported-match totals are labeled explicitly");
  // Opening a match report is the only trigger; reopening shares the cached result.
  const reportFacts={playerName:"CI-only player",opponent:"리포트 상대",playedAt:"2026-10-18T12:00:00Z",minutes:90,score:57,scoreStatus:"provisional",ruleVersion:"form-v2",contributions:[{metric:"minutes",value:90,points:30},{metric:"goals",value:1,points:30},{metric:"yellow_cards",value:1,points:-3}],warningCount:1,priceBefore:100000,priceAfter:92000,targetPrice:80000,formScore:40,changePercent:-8,windowSize:5};
  state.players[0].records=[{id:"report-record",fixtureId:"test-fixture",playedAt:reportFacts.playedAt,opponent:reportFacts.opponent,result:"승",minutes:90,goals:1,assists:0,performance:57}];
  let reportGets=0,reportPosts=0;
  await mock.route("**/api/kickx/players/test-player/matches/test-fixture/report",route=>{
    const creating=route.request().method()==="POST";
    if(creating)reportPosts++;else reportGets++;
    return route.fulfill({json:{status:creating||reportPosts?"ready":"missing",facts:reportFacts,text:creating||reportPosts?{performance:"득점과 출전이 가점에 반영되었습니다.",value:"목표 가격이 낮아 하락 방향으로 반영됐습니다."}:null,generatedAt:"2026-10-20T00:00:00Z",canGenerate:true}});
  });
  await mockPage.goto(base+"/players/test-player",{waitUntil:"networkidle"});
  assert.equal(reportGets+reportPosts,0,"Player detail fetched a report eagerly");
  await mockPage.getByRole("button",{name:"리포트 상대 경기 리포트",exact:true}).click();
  await mockPage.getByRole("heading",{name:"AI 경기력 설명",exact:true}).waitFor();
  assert.equal(reportGets,1);assert.equal(reportPosts,1);
  assert.ok((await mockPage.getByRole("dialog").innerText()).includes("92,000"));
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
  await mockPage.goto(base+"/players/test-player",{waitUntil:"networkidle"});
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
  let historyReportPosts=0;
  await mock.route("**/api/kickx/players/test-player/matches/history-report-fixture/report",route=>{
    if(route.request().method()==="POST")historyReportPosts++;
    return route.fulfill({json:{status:"unavailable",unavailableReason:"baseline-history",facts:null,text:null,generatedAt:null,canGenerate:true}});
  });
  await mockPage.goto(base+"/players/test-player",{waitUntil:"networkidle"});
  await mockPage.getByRole("button",{name:"리포트 상대 경기 리포트",exact:true}).click();
  await mockPage.getByText("이 경기는 초기 가격을 산정할 때 반영된 과거 경기입니다.",{exact:false}).waitFor();
  assert.equal(historyReportPosts,0,"Historical initial-price input generated a report");
  assert.ok((await mockPage.getByRole("dialog").innerText()).includes("57"));
  await mockPage.keyboard.press("Escape");
  report.checks.push("Failed report generation preserves figures with manual retry; initial-price history has a distinct explanation");
  await mockPage.goto(base+"/transactions",{waitUntil:"networkidle"});
  const totals=await mockPage.locator(".transaction-stats strong").allTextContents();
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
  await mockPage.goto(base+"/mypage",{waitUntil:"networkidle"});
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
  await mockPage.goto(base+"/admin/data",{waitUntil:"networkidle"});
  assert.equal(new URL(mockPage.url()).pathname,"/admin");assert.deepEqual(actions,[]);
  assert.equal(await mockPage.getByRole("button",{name:"5대 리그 데이터 갱신",exact:true}).count(),0);
  await mockPage.goto(base+"/admin/users",{waitUntil:"networkidle"});
  await mockPage.getByText(managed.nickname,{exact:true}).waitFor();assert.deepEqual(actions,[]);
  await mockPage.getByRole("button",{name:"회원 관리",exact:true}).click();
  await mockPage.getByLabel("회원 처리 사유").fill("반복적인 운영 규칙 위반");
  await mockPage.getByRole("button",{name:"이용 제한 적용",exact:true}).click();
  await mockPage.getByText("이용 제한",{exact:true}).waitFor();assert.deepEqual(actions,[7]);
  await mockPage.reload({waitUntil:"networkidle"});await mockPage.getByText("이용 제한",{exact:true}).waitFor();
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
  await mock.route('**/api/kickx/trades/quote',async route=>{
    quoteCalls++;const body=route.request().postDataJSON();assert.equal(body.playerId,'test-player');assert.equal(body.price,undefined);
    await route.fulfill({json:{id:'11111111-1111-1111-1111-111111111111',playerId:'test-player',side:body.side,quantity:1,price:100000,fee:0,settlement:100000,balance:1300000,balanceAfter:1200000,quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}});
  });
  await mock.route('**/api/kickx/trades',async route=>{
    tradeCalls++;const body=route.request().postDataJSON();assert.deepEqual(Object.keys(body).sort(),['quoteId','requestId']);assert.match(body.requestId,/^[a-f0-9-]{36}$/);
    Object.assign(state.member,{points:1200000,playerAssets:100000,ownedPlayers:[state.players[0]],holdings:[{id:'test-player',playerId:'test-player',playerName:'CI-only player',quantity:1,cost:100000,value:100000,profit:0,returnRate:0}]});
    await new Promise(r=>setTimeout(r,150));await route.fulfill({json:{accepted:true}});
  });
  await mockPage.goto(base+'/players/test-player',{waitUntil:'networkidle'});
  await mockPage.getByRole('button',{name:'매입하기',exact:true}).click();
  const confirm=mockPage.getByRole('button',{name:'매입 확정',exact:true});await confirm.waitFor();await confirm.click();
  await mockPage.getByRole('heading',{name:'매입이 완료되었습니다',exact:true}).waitFor();
  assert.equal(quoteCalls,1);assert.equal(tradeCalls,1);
  await mockPage.getByRole('button',{name:'확인',exact:true}).click();
  assert.equal(await mockPage.getByRole('button',{name:'보유 중',exact:true}).isDisabled(),true);
  report.checks.push('Trade UI uses server quote; receipt reloads holdings; duplicate holding blocks buy');
  let squadCalls=0;
  await mock.route('**/api/kickx/squad',async route=>{
    squadCalls++;const body=route.request().postDataJSON();assert.equal(body.revision,0);assert.equal(body.slots.length,11);assert.equal(body.slots[8],'test-player');
    state.member.squad={...body,revision:1,value:100000,performance:null};await route.fulfill({json:{revision:1}});
  });
  await mockPage.goto(base+'/squad',{waitUntil:'networkidle'});
  await mockPage.getByRole('combobox',{name:'포메이션',exact:true}).click();await mockPage.getByRole('option').filter({hasText:'4-3-3'}).click();
  await mockPage.getByRole('button',{name:'9번 FW 자리 빈 자리',exact:true}).click();await mockPage.getByRole('button',{name:'배치',exact:true}).click();
  await mockPage.getByRole('button',{name:'스쿼드 저장',exact:true}).click();await mockPage.getByText('스쿼드를 저장했습니다.',{exact:true}).waitFor();assert.equal(squadCalls,1);
  await mockPage.reload({waitUntil:'networkidle'});assert.ok(await mockPage.getByRole('button',{name:'9번 FW 자리 CI-only player',exact:true}).isVisible());
  report.checks.push('Squad saves 11 slots and revision; saved owned lineup survives reload');
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
  await mockPage.goto(base+'/community/write?scope=player&target=test-player',{waitUntil:'networkidle'});
  assert.equal(await mockPage.getByRole('combobox',{name:'주제',exact:false}).count(),0);
  await mockPage.getByLabel('제목',{exact:false}).fill('테스트 경기 후기');await mockPage.locator('#post-body').fill('저장 흐름을 점검하는 테스트 게시글 내용입니다.');
  await mockPage.getByRole('button',{name:'게시글 등록',exact:true}).click();await mockPage.getByRole('link',{name:'저장한 게시글 보기',exact:true}).click();
  await mockPage.getByRole('heading',{name:'테스트 경기 후기',exact:true}).waitFor();
  await mockPage.getByLabel('댓글 내용',{exact:true}).fill('저장하는 댓글');await mockPage.getByRole('button',{name:'댓글 등록',exact:true}).click();await mockPage.getByText('저장하는 댓글',{exact:true}).waitFor();
  await mockPage.getByRole('button',{name:'공감 0',exact:true,pressed:false}).click();await mockPage.getByRole('button',{name:'공감 1',exact:true,pressed:true}).waitFor();
  await mockPage.getByRole('button',{name:'게시글 신고',exact:true}).click();await mockPage.getByLabel('신고 사유',{exact:true}).fill('신고 등록 테스트입니다');await mockPage.getByRole('button',{name:'신고 제출',exact:true}).click();
  assert.ok(['createPost','comment','like','report'].every(action=>communityActions.includes(action)));
  report.checks.push('Post creation, direct detail, comment, desired-state like and report use real endpoint contracts');
  // Separate, body-first feeds and titleless composer use the existing write contract.
  state.session.profile.team='test-team';
  savedPosts.push({...savedPost,id:'44444444-4444-4444-4444-444444444444',scope:'club',target:'test-team',targetName:'테스트 구단',title:'구단 전용 제목',body:'구단에서만 보여야 하는 이야기입니다.',likes:0,liked:false,commentCount:0});
  await mockPage.goto(base+'/community',{waitUntil:'networkidle'});
  assert.equal(new URL(mockPage.url()).pathname,'/community');assert.equal(await mockPage.locator('.community-entry-card').count(),2);
  await mockPage.goto(base+'/community/players',{waitUntil:'networkidle'});
  assert.ok(await mockPage.locator('.feed-card-body').filter({hasText:'저장 흐름을 점검하는 테스트 게시글 내용입니다.'}).isVisible());
  assert.equal(await mockPage.locator('.community-feed-card[data-scope=club]').count(),0);
  await mockPage.locator('.feed-composer-open').click();
  await mockPage.getByRole('combobox',{name:'이야기할 선수'}).click();await mockPage.getByRole('option',{name:/CI-only player/}).click();
  await mockPage.getByLabel('빠른 글 내용',{exact:true}).fill('실패해도 유지되는 선수 이야기입니다.');
  await mockPage.getByRole('button',{name:'게시하기',exact:true}).click();await mockPage.getByRole('alert').filter({hasText:'글 저장 테스트 오류'}).waitFor();
  assert.equal(await mockPage.getByLabel('빠른 글 내용',{exact:true}).inputValue(),'실패해도 유지되는 선수 이야기입니다.');
  await mockPage.getByRole('button',{name:'게시하기',exact:true}).click();await mockPage.locator('.feed-card-body').filter({hasText:'실패해도 유지되는 선수 이야기입니다.'}).waitFor();
  assert.equal(quickAttempts,2);assert.equal(savedPost.scope,'player');assert.equal(savedPost.target,'test-player');assert.equal(await mockPage.getByLabel('빠른 글 내용',{exact:true}).count(),0);
  const card=mockPage.locator('.community-feed-card').filter({hasText:'실패해도 유지되는 선수 이야기입니다.'});
  await card.getByRole('button',{name:'피드 공감 0',exact:true}).click();await card.getByRole('button',{name:'피드 공감 1',exact:true,pressed:true}).waitFor();
  await card.getByRole('button',{name:'댓글 0',exact:true}).click();await card.getByLabel('피드 댓글 내용').fill('피드에서 작성하는 댓글입니다.');await card.getByRole('button',{name:'댓글 등록',exact:true}).click();await card.getByText('피드에서 작성하는 댓글입니다.',{exact:true}).waitFor();
  await mockPage.goto(base+'/community/clubs',{waitUntil:'networkidle'});assert.equal(await mockPage.locator('.community-feed-card[data-scope=player]').count(),0);assert.ok(await mockPage.locator('.feed-card-body').filter({hasText:'구단에서만 보여야 하는 이야기입니다.'}).isVisible());
  await mockPage.goto(base+'/players/test-player',{waitUntil:'networkidle'});await mockPage.getByRole('button',{name:'커뮤니티',exact:true}).click();await mockPage.locator('.feed-card-body').filter({hasText:'실패해도 유지되는 선수 이야기입니다.'}).waitFor();assert.equal(await mockPage.locator('.community-feed-card[data-scope=club]').count(),0);
  state.session.profile.team=null;
  await mockPage.goto(base+'/community/clubs/test-team',{waitUntil:'networkidle'});assert.equal(await mockPage.locator('.feed-composer-open').count(),0);assert.ok(await mockPage.locator('.feed-composer-locked').isVisible());
  state.session.profile.team='test-team';
  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    for(const path of ['/community','/community/players','/community/clubs','/community/players/test-player','/community/clubs/test-team']){
      await mockPage.goto(base+path,{waitUntil:'networkidle'});assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${path} community overflows at ${width}`);
      await mockPage.screenshot({path:`test-artifacts/community-${path.split('/').slice(2).join('-')||'entry'}-${width}.png`,fullPage:true});
    }
    await mockPage.goto(base+'/players/test-player',{waitUntil:'networkidle'});await mockPage.getByRole('button',{name:'커뮤니티',exact:true}).click();assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mockPage.screenshot({path:`test-artifacts/community-player-tab-${width}.png`,fullPage:true});
  }
  report.checks.push('Separate community entry and scoped feeds, body preview, titleless quick post retry UUID, inline like/comments, fan gate and player detail community tab');

  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    for(const path of ['/teams/test-team','/squad',`/community/posts/${savedPost.id}`,'/rules']){
      await mockPage.goto(base+path,{waitUntil:'networkidle'});assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${path} prototype overflows at ${width}`);
      await mockPage.screenshot({path:`test-artifacts/prototype-${path.startsWith('/community')?'post':path.startsWith('/teams')?'team':path.slice(1)}-${width}.png`,fullPage:true});
    }
  }
  report.checks.push('Prototype team, squad, article and score rules fit desktop and mobile');

  // New rules render only for an active v2 DB policy; display persisted pricing evidence.
  state.policy={version:'form-v2',initialPoints:1300000,initialPrice:100000,sellFeeBps:200,quoteSeconds:60};
  state.players[0].pricing={baseline:{source:'previous-season',season:2025,gameCount:10,meanScore:80,seedScore:70,price:140000,warnings:[]},recent:[{fixture_id:'bsd-9301',played_at:'2026-08-02T12:00:00Z',price_before:140000,price_after:151200,target_price:173333,form_score:86.666667,change_percent:8,window_fixture_ids:['bsd-9301','bsd-9209','bsd-9208','bsd-9207','bsd-9206']}]};
  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    await mockPage.goto(base+'/rules',{waitUntil:'networkidle'});
    await mockPage.getByText('FORM V2',{exact:true}).waitFor();
    assert.match(await mockPage.locator('.rules-equation').innerText(),/65.5/);
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`v2 rules overflow at ${width}`);
    await mockPage.screenshot({path:`test-artifacts/market-v2-rules-${width}.png`,fullPage:true});
    await mockPage.goto(base+'/players/test-player',{waitUntil:'networkidle'});
    await mockPage.getByRole('heading',{name:'선수 가치 산정 근거',exact:true}).waitFor();
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`v2 evidence overflow at ${width}`);
    await mockPage.screenshot({path:`test-artifacts/market-v2-detail-${width}.png`,fullPage:true});
  }
  report.checks.push('Active v2 rules and persisted initial/last-five pricing evidence fit desktop and mobile');
  state.policy.clubCompetitionsEnabled=true;
  state.leagues.push({id:'bsd-7',name:'챔피언스리그'});
  state.teams.push({id:'bsd-4401',name:'테스트 홈 구단',english:'Home',leagueId:'bsd-1'},{id:'bsd-4402',name:'테스트 원정 구단',english:'Away',leagueId:null});
  state.fixtures=[{id:'cup-test',leagueId:'bsd-7',home:'bsd-4401',away:'bsd-4402',startsAt:'2026-10-13T12:00:00Z',status:'PEN',homeScore:1,awayScore:1,penaltiesHome:5,penaltiesAway:4,roundLabel:'League phase · Matchday 5',reflectionStatus:'partial'}];
  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    await mockPage.goto(base+'/fixtures',{waitUntil:'networkidle'});
    await mockPage.getByText('승부차기 5 : 4',{exact:true}).waitFor();
    const badge=mockPage.locator('.reflect-badge').filter({hasText:'일부 반영'});await badge.waitFor();
    await badge.hover();await mockPage.getByRole('tooltip').filter({hasText:'일부 선수만 점수가 계산되었습니다.'}).waitFor();
    assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`cup fixtures overflow at ${width}`);
    await mockPage.screenshot({path:`test-artifacts/club-fixtures-${width}.png`,fullPage:true});
    await mockPage.goto(base+'/rules',{waitUntil:'networkidle'});
    await mockPage.getByText(/연장전은 최대 120분/).waitFor();
  }
  report.checks.push('Cup stages, separate shootout score, partial reflection and 120-minute rules render on desktop and mobile');
  await mock.close();
  assert.deepEqual(errors,[],"Browser JavaScript errors");
  report.checks.push("No browser JavaScript errors");
  await writeFile("test-artifacts/report.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch(error) {
  console.error(output.slice(-8000));
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
