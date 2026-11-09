import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTs } from './load-ts.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.env.KICKX_BROWSER_MODULE||'/tmp/kickx-browser','node_modules/playwright/index.mjs')).href);
const {emptyPlatformData}=loadTs('../lib/kickx/data.ts');
const base='http://localhost:3114',out='test-artifacts/home-fixtures';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','localhost','-p','3114'],{stdio:['ignore','pipe','pipe']});
const report={widths:[390,1440],checks:[],errors:[]};let browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===59)throw Error('App did not start');await new Promise(r=>setTimeout(r,500));}
 await mkdir(out,{recursive:true});browser=await chromium.launch();
 for(const width of report.widths){
  const c=await browser.newContext({viewport:{width,height:1000}}),p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));
  const make=(id,home,away)=>({id,leagueId:'bsd-1',home,away,status:'NS',startsAt:new Date(Date.now()+86400000).toISOString(),homeScore:null,awayScore:null});
  const global=make('global','other','visitor'),main=make('main-match','main','visitor'),sub=make('sub-match','visitor','sub');
  const state={...emptyPlatformData(),leagues:[{id:'bsd-1',name:'Premier League'}],teams:[{id:'main',name:'본진 구단',leagueId:'bsd-1'},{id:'sub',name:'서브 구단',leagueId:'bsd-1'},{id:'other',name:'무관한 구단',leagueId:'bsd-1'},{id:'visitor',name:'상대 구단',leagueId:'bsd-1'}],fixtures:[global],session:{userId:'current-user',role:'member',profile:{nickname:'경기 테스트',primaryTeam:'main',team:'main',teams:['sub']}},member:null};
  let items=[main,sub],requests=[];
  await c.route('https://**',r=>r.abort());
  await c.route('**/api/**',async r=>{
   const u=new URL(r.request().url()),path=u.pathname;
   const ready=data=>r.fulfill({json:{status:'ready',source:'database',data}});
   if(path==='/api/auth/status')return r.fulfill({json:{enabled:false}});
   if(path==='/api/kickx')return ready(state);
   if(path==='/api/kickx/home-fixtures'){requests.push(u.searchParams.get('teams'));return ready({items});}
   return ready({items:[],total:0,page:1,size:12,preferences:{matchEnabled:true}});
  });
  await p.goto(base,{waitUntil:'domcontentloaded'});
  const panel=p.locator('.dash-fixtures');await panel.getByText('본진 구단',{exact:true}).waitFor();await panel.getByText('서브 구단',{exact:true}).waitFor();
  assert.deepEqual(requests,['main,sub']);assert.equal(await panel.getByText('무관한 구단',{exact:true}).count(),0);assert.equal(await panel.locator('li').count(),2);
  await p.screenshot({path:`${out}/supported-${width}.png`,fullPage:true});
  items=[];await p.reload({waitUntil:'domcontentloaded'});await panel.getByText('메인 응원 구단·서브팀의 경기 일정이 아직 없습니다.',{exact:true}).waitFor();assert.equal(await panel.getByText('무관한 구단',{exact:true}).count(),0);
  state.session.profile={nickname:'경기 테스트',teams:[],primaryTeam:null,team:null};const before=requests.length;await p.reload({waitUntil:'domcontentloaded'});await panel.getByRole('link',{name:'응원 구단 설정',exact:true}).waitFor();assert.equal(requests.length,before);
  state.session=null;await p.reload({waitUntil:'domcontentloaded'});await panel.getByText('무관한 구단',{exact:true}).waitFor();assert.equal(requests.length,before);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  report.checks.push(`${width}px: primary plus subteam outside global preview; no unrelated fallback; setup empty state; guest public fixtures; no guest personalized request`);await c.close();
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();server.kill('SIGTERM');await mkdir(out,{recursive:true});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
