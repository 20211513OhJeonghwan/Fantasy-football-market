import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTs } from './load-ts.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE || '/tmp/kickx-browser','node_modules/playwright/index.mjs')).href);
const { emptyPlatformData } = loadTs('../lib/kickx/data.ts');
const { FORMATIONS,ownedSquadSlots } = loadTs('../lib/kickx/squad.ts');
const base='http://localhost:3113',out='test-artifacts/formations';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','localhost','-p','3113'],{stdio:'ignore'});
const report={flows:[],layouts:[],errors:[]};let browser;
try {
  for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===39)throw Error('App did not start');await new Promise(r=>setTimeout(r,500));}
  browser=await chromium.launch({ executablePath: process.env.KICKX_BROWSER_EXECUTABLE || undefined });await mkdir(out,{recursive:true});
  for(const width of [320,390,1440]) {
    const players=FORMATIONS[0].positions.map((position,i)=>({id:`p${i}`,name:`주전선수 ${i}`,short:`선수${i}`,position,price:50000+i*1000,team:'club',performance:8,change:1,history:[],records:[],analysis:null}));
    players[0].name='마누엘 노이어';players[0].short='마누엘 노이어';
    players.push({id:'extra-mf',name:'영입대상 미드필더',position:'MF',price:50000,team:'club',history:[],records:[],performance:9});
    players.push({id:'old-bench',name:'기존 벤치 선수',position:'DF',price:120000,team:'club',history:[],records:[],performance:9});
    const state={...emptyPlatformData(),players,formations:FORMATIONS,teams:[{id:'club',name:'테스트 구단',leagueId:'bsd-1'}],leagues:[{id:'bsd-1',name:'Premier League'}],session:{userId:'member',role:'member',profile:{nickname:'포메이션 시험',team:'club',teams:['club'],primaryTeam:'club'}},member:{financialReady:true,points:700000,totalAssets:1300000,playerAssets:600000,holdings:players.slice(0,11).map(p=>({id:p.id,playerId:p.id,playerName:p.name,cost:50000,value:p.price,quantity:1})),ownedPlayers:players,transactions:[],watchlist:[],assetHistory:[],squad:{formationId:'4-3-3',slots:players.slice(0,11).map(p=>p.id),revision:1,value:550000,performance:8}}};
    const oldStart=new Date(Date.now()-86400000).toISOString();
    state.member.holdings.push({id:'old-bench',playerId:'old-bench',playerName:'기존 벤치 선수',cost:50000,value:70000,bench:{price:70000,reason:'transfer',startedAt:oldStart,expiresAt:new Date(Date.now()+6*86400000).toISOString()}});
    let changes=0,moves=0,quotes=0;
    const context=await browser.newContext({viewport:{width,height:960},timezoneId:'Asia/Seoul'});
    await context.route(/^https:\/\//,r=>r.abort());
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname;
      const ready=data=>route.fulfill({json:{status:'ready',source:'database',data}});
      if(path==='/api/kickx')return ready(state);
      if(path==='/api/kickx/notifications')return ready({hasUnread:false,matchNotifications:true});
      if(path==='/api/kickx/players'){
        const pos=url.searchParams.get('position'),q=url.searchParams.get('q')||'',page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('size')||8);
        const items=players.filter(p=>(!pos||p.position===pos)&&p.name.includes(q));return ready({items:items.slice((page-1)*size,page*size),total:items.length,page,size});
      }
      if(path==='/api/kickx/squad/formation'){
        changes++;const body=req.postDataJSON();assert.equal(body.revision,state.member.squad.revision);
        assert.deepEqual(body.benchPlayerIds,['p4','p10']);assert.equal(body.formationId,'3-5-2');
        const startedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+7*86400000).toISOString();
        for(const h of state.member.holdings)if(body.benchPlayerIds.includes(h.playerId))h.bench={price:players.find(p=>p.id===h.playerId).price,reason:'formation',startedAt,expiresAt};
        state.member.squad={...state.member.squad,formationId:body.formationId,revision:2,slots:ownedSquadSlots(state.member.holdings,[],body.formationId,id=>players.find(p=>p.id===id))};
        return route.fulfill({json:{formation_id:body.formationId,revision:2,slots:state.member.squad.slots}});
      }
      if(path==='/api/kickx/squad'&&req.method()==='PUT'){
        moves++;const body=req.postDataJSON();assert.equal(body.formationId,'3-5-2');assert.equal(body.revision,2);
        assert.equal(body.slots[4],'p6');assert.equal(body.slots[5],'p5');
        assert(!body.slots.includes('p4'));assert(!body.slots.includes('p10'));
        state.member.squad={...state.member.squad,slots:body.slots,revision:3};return route.fulfill({json:state.member.squad});
      }
      if(path==='/api/kickx/trades/quote'){
        quotes++;assert.equal(req.postDataJSON().playerId,'extra-mf');return route.fulfill({json:{id:'quote',playerId:'extra-mf',side:'buy',quantity:1,price:50000,fee:0,settlement:50000,balance:700000,balanceAfter:650000,quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}});
      }
      return ready({items:[],total:0,page:1,size:20});
    });
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(base+'/squad',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'포메이션 변경',exact:true}).click();
    let dialog=page.getByRole('dialog');assert.equal(await dialog.locator('select option').count(),19);
    assert.equal(await dialog.locator('option[value="4-6-0"],option[value="3-6-1"],option[value="3-3-3-1"]').count(),0);
    await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.equal(changes,0);
    await page.getByRole('button',{name:'포메이션 변경',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByRole('combobox',{name:'새 포메이션'}).selectOption('3-5-2');
    const confirm=dialog.getByRole('button',{name:'2명 벤치 이동 후 변경'});assert(await confirm.isDisabled());
    await dialog.locator('label').filter({hasText:'주전선수 4'}).getByRole('checkbox').check();assert(await confirm.isDisabled());
    await dialog.locator('label').filter({hasText:'주전선수 10'}).getByRole('checkbox').check();assert(await confirm.isEnabled());
    const checkbox=dialog.locator('input[type="checkbox"]:checked').first();
    await checkbox.focus();
    await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    const box=await checkbox.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,minHeight:getComputedStyle(el).minHeight,padding:getComputedStyle(el).padding,outline:getComputedStyle(el).outlineStyle}));
    assert.equal(box.width,18);assert.equal(box.height,18);assert.equal(box.minHeight,'18px');assert.equal(box.padding,'0px');assert.equal(box.outline,'solid');
    report.layouts.push({width,checkbox:box});
    assert.match(await dialog.innerText(),/재배치할 수 없습니다/);
    assert.match(await dialog.innerText(),/7일 안에 직접 매각/);
    assert.doesNotMatch(await dialog.innerText(),/14일/);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if(width===390)await page.screenshot({path:`${out}/modal-390.png`,fullPage:true});
    await confirm.click();await page.waitForFunction(()=>document.querySelector('.squad-formation > strong')?.textContent==='3-5-2');
    assert.equal(changes,1);assert.equal(state.member.holdings.filter(h=>h.bench).length,3);assert.equal(state.member.holdings.find(h=>h.playerId==='old-bench').bench.startedAt,oldStart);
    assert.equal(await page.locator('.pitch-player.filled').count(),9);assert.match(await page.locator('.squad-bench').innerText(),/자동 매각까지/);
    assert.equal(await page.locator('.squad-bench').getByRole('button',{name:/배치/}).count(),0);
    await page.getByRole('button',{name:'선수 배치',exact:true}).click();
    await page.getByRole('button',{name:/^5번 MF 자리/}).click();await page.getByRole('button',{name:/^6번 MF 자리/}).click();
    await page.waitForFunction(()=>document.querySelector('.pitch-player[aria-label^="6번"]')?.textContent.includes('선수5'));
    assert.equal(moves,1);assert.equal(await page.locator('.pitch-player.filled').count(),9);
    await page.getByRole('button',{name:'배치 완료',exact:true}).click();
    await page.getByRole('textbox',{name:'스쿼드 선수 검색'}).fill('영입대상');
    const row=page.locator('.squad-market-list li').filter({hasText:'영입대상 미드필더'});await row.getByRole('button',{name:'매입',exact:true}).click();
    dialog=page.getByRole('dialog');await dialog.locator('.trade-capacity').waitFor();assert.match(await dialog.locator('.trade-capacity').innerText(),/3\s*\/\s*5/);assert.equal(quotes,1);
    await dialog.getByRole('button',{name:'닫기',exact:true}).click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Squad overflow at ${width}`);
    await page.screenshot({path:`${out}/squad-${width}.png`,fullPage:true});
    await page.goto(base+'/',{waitUntil:'networkidle'});
    await page.locator('.dash-squad .pitch-name[title="마누엘 노이어"]').waitFor();
    assert.equal(await page.locator('.dash-squad .pitch-name[title="마누엘 노이어"]').innerText(),'노이어');
    assert.equal(await page.locator('.dash-squad .pitch-player.filled').count(),9);
    assert.match(await page.locator('.dash-squad').innerText(),/3-5-2/);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`${out}/home-compact-${width}.png`,fullPage:true});
    report.flows.push({width,changes,moves,quotes,bench:3});
    if(width!==390){
      state.member.holdings=[];
      for(const f of FORMATIONS){
        state.member.squad={...state.member.squad,formationId:f.id,slots:Array(11).fill(null)};
        await page.goto(base+'/squad',{waitUntil:'networkidle'});
        assert.equal(await page.locator('.squad-formation > strong').innerText(),f.id);
        assert.equal(await page.locator('.pitch .pitch-row').count(),f.rows.length);
        assert.equal(await page.locator('.pitch .pitch-player').count(),11);
        const clipped=await page.locator('.pitch').evaluate(pitch=>{const p=pitch.getBoundingClientRect();return [...pitch.querySelectorAll('.pitch-player')].filter(e=>{const r=e.getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1||r.top<p.top-1||r.bottom>p.bottom+1;}).map(e=>e.getAttribute('aria-label'));});
        assert.deepEqual(clipped,[],`${f.id} clipped players at ${width}`);
        if(f.id==='4-2-3-1')await page.screenshot({path:`${out}/five-lines-${width}.png`,fullPage:true});
        const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right})).slice(0,8)}));
        assert(overflow.scrollWidth<=overflow.width+1,`${f.id} overflow at ${width}: ${JSON.stringify(overflow)}`);
        report.layouts.push({width,formation:f.id,rows:f.rows.length});
      }
    }
    await context.close();
  }
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report));
} finally {await mkdir(out,{recursive:true});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.kill('SIGTERM');}
