import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';
const policy=loadTs('../server/kickx/engine/report-policy.ts');
const {calculatePerformance:calc}=loadTs('../server/kickx/engine/report-performance.ts',{'./report-policy':policy});
const {calculateReportPricing:price,reportBaseline}=loadTs('../server/kickx/engine/report-pricing.ts',{'./report-policy':policy});
const p={...policy.REPORT_PARAMETERS};
const baseline={source:'previous-season',season:2025,gameCount:20,meanScore:6,seedScore:6,percentile:.5,price:100000,lower:-20,upper:100,referenceHash:'fixed',fixtures:[],warnings:[]};
const game=(id,score,season=2026)=>({fixtureId:`bsd-${id}`,score,status:'provisional',minutes:90,season,startedAt:`${season}-09-${String(id).padStart(2,'0')}T12:00:00Z`});
function match(position='D') {return {fixtureId:'bsd-100',playerId:'bsd-2',teamId:'bsd-1',status:'FT',homeTeam:'bsd-1',awayTeam:'bsd-2',homeScore:0,awayScore:0,stats:{minutes_played:90,goals:0},legacy:null,source:{lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players:Array.from({length:11},(_,i)=>({id:i+1,position:i===1?position:'D'})),substitutes:[{id:30,position}]},away:{team_id:2,players:Array.from({length:11},(_,i)=>({id:i+12,position:'D'}))}}},incidents:{incidents:[]}}};}
const points=(r,key)=>r.breakdown.find(b=>b.metric===key)?.points;
test('report scoring applies its positional table and no v2 team-win bonus',()=>{
 for(const [pos,goal,assist] of [['G',10,5],['D',6,4],['M',5,3],['F',4,3]]){
  const m=match(pos);m.homeScore=1;m.stats.goals=1;m.stats.goal_assist=1;m.source.incidents.incidents=[{id:1,type:'goal',minute:40,is_home:true,player_id:2}];
  const r=calc(m);assert.equal(points(r,'minutes'),2);assert.equal(points(r,'goals'),goal);assert.equal(points(r,'assists'),assist);assert.equal(points(r,'team_win'),undefined);
 }
});
test('report counts DF defensive groups and MF individual actions, pass success above zero attempts',()=>{
 const m=match();Object.assign(m.stats,{won_tackle:4,interception:3,total_pass:10,accurate_pass:9});
 assert.equal(points(calc(m),'defensive_actions'),2);assert.equal(points(calc(m),'pass_accuracy'),1);
 m.source.lineups.lineups.home.players[1].position='M';assert.equal(points(calc(m),'defensive_actions'),3.5);
});
test('report goalkeeper saves, clean-sheet threshold and actual participation',()=>{
 const m=match('G');m.stats.saves=7;m.legacy={penalty_save:1};assert.equal(points(calc(m),'saves'),2);assert.equal(points(calc(m),'penalty_saves'),5);assert.equal(points(calc(m),'clean_sheet'),4);
 m.stats.minutes_played=45;m.source.incidents.incidents=[{type:'substitution',minute:45,player_out_id:2,player_in_id:30}];assert.equal(points(calc(m),'clean_sheet'),0);
});
test('observed added-time duration rescues real 90+ appearances without permitting corrupt counters',()=>{
 const m=match();m.stats.minutes_played=97;m.durationMinutes=97;assert.equal(calc(m).score,6);assert.equal(calc(m).status,'provisional');
 m.stats.minutes_played=180;assert.ok(calc(m).warnings.includes('INVALID_MINUTES'));
 m.playerId='bsd-30';m.durationMinutes=100;m.stats.minutes_played=35;m.source.incidents.incidents=[{type:'substitution',minute:60,player_out_id:2,player_in_id:30}];assert.equal(calc(m).status,'provisional');
});
test('unknown counters and missing required facts stay distinguishable from DNP',()=>{
 const m=match();assert.ok(calc(m).warnings.some(x=>x.includes('UNVERIFIED')));m.playerId='bsd-30';m.stats.minutes_played=0;assert.equal(calc(m).status,'not-played');
 m.stats.minutes_played=15;m.source.lineups.lineup_status='predicted';assert.equal(calc(m).score,null);
});
test('report pricing reproduces its 104040-P example with every season appearance counted once',()=>{
 const plan=price([game(1,8),game(2,10)],baseline,p);assert.equal(plan.steps[0].priceAfter,102000);assert.equal(plan.price,104040);assert.equal(plan.steps[1].formScore,7);assert.equal(plan.steps[1].targetPrice,105127);
 assert.deepEqual(price([game(2,10),game(1,8)],baseline,p),plan);
 const games=Array.from({length:8},(_,i)=>game(i+1,6));const changed=games.map((g,i)=>i===0?{...g,score:30}:g);
 assert.notEqual(price(games,baseline,p).steps.at(-1).targetPrice,price(changed,baseline,p).steps.at(-1).targetPrice);
});
test('raw score clipping, DNP, negative baselines and seasonal rollover obey report limits',()=>{
 const plan=price([game(1,10000),{...game(2,null),status:'not-played',minutes:0},game(3,-5,2027)],{...baseline,seedScore:0},p);
 assert.equal(plan.steps.length,2);assert.equal(plan.steps[0].evidence.boundedScore,100);assert.equal(plan.steps[1].evidence.n,1);assert.equal(plan.steps[1].priceBefore,plan.steps[0].priceAfter);
 for(const s of plan.steps)assert.ok(s.priceAfter>=Math.ceil(s.priceBefore*.98)&&s.priceAfter<=Math.floor(s.priceBefore*1.02));
 assert.throws(()=>price([],baseline,{...p,kappa:0}),/INVALID_REPORT_PARAMETERS/);
});
test('frozen positional midranks and prior fallback do not ingest current-season games',()=>{
 const reference={status:'ready',season:2025,hash:'frozen',groups:{DF:{mean:6,lower:0,upper:10,baselines:[4,6,6,8]}},players:{a:{DF:{n:2,sum:12,fixtures:['old-1','old-2']}}}};
 const b=reportBaseline(reference,'a','DF',p);assert.equal(b.percentile,.5);assert.equal(b.price,505000);assert.equal(reportBaseline(reference,'new','DF',p).source,'position-prior');assert.equal(reportBaseline(reference,'new','GK',p),null);
 assert.equal(reportBaseline({...reference,status:'collecting'},'a','DF',p),null);
});
test('independent PostgreSQL and TypeScript agree for cumulative seasons and integer percentage caps',async()=>{
 const db=new PGlite();try{
  const sql=readFileSync(new URL('../supabase/migrations/20261026074540_report_season_policy.sql',import.meta.url),'utf8');
  await db.exec(sql.match(/create function public\.kickx_report_plan\([\s\S]*?end \$\$;/)[0]);
  let seed=7654;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let c=0;c<40;c++){
   const rows=Array.from({length:1+Math.floor(rand()*24)},(_,i)=>game(i+1,Math.round((rand()*60-15)*2)/2));
   const b={...baseline,seedScore:Math.round((rand()*15-4)*2)/2,price:10000+Math.floor(rand()*900000)};
   const ts=price(rows,b,p),pg=(await db.query('select public.kickx_report_plan($1,$2,$3) plan',[rows,b,p])).rows[0].plan;
   assert.equal(pg.price,ts.price,`case ${c}`);assert.equal(pg.steps.length,ts.steps.length);
   for(let i=0;i<ts.steps.length;i++)for(const key of ['priceBefore','priceAfter','targetPrice','formScore','changePercent','window'])assert.deepEqual(pg.steps[i][key],ts.steps[i][key],`${c}/${i}/${key}`);
  }
 }finally{await db.close();}
});
