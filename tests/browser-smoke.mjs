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
    players:[{id:"test-player",name:"CI-only player",english:null,short:null,team:null,position:"FW",number:null,country:null,age:null,price:0,change:0,performance:0,volume:0,goals:0,assists:0,minutes:0,history:[],records:[],analysis:null,updatedAt:null,status:null}],
    session:{userId:"test-account",role:"member",profile:{nickname:"테스트 사용자",team:null}},
    member:{financialReady:false,points:null,totalAssets:null,playerAssets:null,profit:null,returnRate:null,weeklyRank:null,holdings:[],transactions:[],watchlist:[],assetHistory:[],squad:null},
  };
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
    return route.fulfill({json:{status:"ready",data:{items:[],total:0,page:Number(params.get("page")||1),size:20}}});
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
  state.players[0].price=100000;state.players[0].position='FW';state.players[0].number=9;
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
  let savedPost=null;const savedComments=[];const communityActions=[];
  await mock.route(/\/api\/kickx\/community(?:\?|$)/,async route=>{
    const req=route.request();
    if(req.method()==='GET'){
      const params=new URL(req.url()).searchParams;
      return route.fulfill({json:{status:'ready',data:params.has('postId')?{post:savedPost,comments:savedComments}:{items:savedPost?[savedPost]:[],total:savedPost?1:0,page:1,size:20}}});
    }
    const body=req.postDataJSON();communityActions.push(body.action);
    if(body.action==='createPost')savedPost={...body,id:'22222222-2222-2222-2222-222222222222',author:'새 닉네임',authorId:'test-account',targetName:'CI-only player',date:new Date().toISOString(),revision:1,likes:0,liked:false,views:0,commentCount:0,transaction:null};
    if(body.action==='comment'){assert.match(body.requestId,/^[a-f0-9-]{36}$/);savedComments.push({id:'33333333-3333-3333-3333-333333333333',postId:savedPost.id,author:'새 닉네임',authorId:'test-account',body:body.body,date:new Date().toISOString(),revision:1});savedPost.commentCount++;}
    if(body.action==='like'){savedPost.liked=body.liked;savedPost.likes=body.liked?1:0;}
    await route.fulfill({json:{id:savedPost?.id}});
  });
  await mockPage.goto(base+'/community/write?scope=player&target=test-player',{waitUntil:'networkidle'});
  await mockPage.getByRole('combobox',{name:'주제',exact:false}).click();await mockPage.getByRole('option',{name:'자유',exact:true}).click();
  await mockPage.getByLabel('제목',{exact:false}).fill('테스트 경기 후기');await mockPage.locator('#post-body').fill('저장 흐름을 점검하는 테스트 게시글 내용입니다.');
  await mockPage.getByRole('button',{name:'게시글 등록',exact:true}).click();await mockPage.getByRole('link',{name:'저장한 게시글 보기',exact:true}).click();
  await mockPage.getByRole('heading',{name:'테스트 경기 후기',exact:true}).waitFor();
  await mockPage.getByLabel('댓글 내용',{exact:true}).fill('저장하는 댓글');await mockPage.getByRole('button',{name:'댓글 등록',exact:true}).click();await mockPage.getByText('저장하는 댓글',{exact:true}).waitFor();
  await mockPage.getByRole('button',{name:'공감 0',exact:true,pressed:false}).click();await mockPage.getByRole('button',{name:'공감 1',exact:true,pressed:true}).waitFor();
  await mockPage.getByRole('button',{name:'게시글 신고',exact:true}).click();await mockPage.getByLabel('신고 사유',{exact:true}).fill('신고 등록 테스트입니다');await mockPage.getByRole('button',{name:'신고 제출',exact:true}).click();
  assert.ok(['createPost','comment','like','report'].every(action=>communityActions.includes(action)));
  report.checks.push('Post creation, direct detail, comment, desired-state like and report use real endpoint contracts');
  for(const width of [1440,390]){
    await mockPage.setViewportSize({width,height:900});
    for(const path of ['/teams/test-team','/squad',`/community/posts/${savedPost.id}`,'/rules']){
      await mockPage.goto(base+path,{waitUntil:'networkidle'});assert.ok(await mockPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${path} prototype overflows at ${width}`);
      await mockPage.screenshot({path:`test-artifacts/prototype-${path.startsWith('/community')?'post':path.startsWith('/teams')?'team':path.slice(1)}-${width}.png`,fullPage:true});
    }
  }
  report.checks.push('Prototype team, squad, article and score rules fit desktop and mobile');

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
