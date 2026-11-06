import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';
const policy=loadTs('../server/kickx/engine/report-policy.ts');
const {calculatePerformance:calc}=loadTs('../server/kickx/engine/report-performance.ts',{'./report-policy':policy});
const {calculateReportPricing:price,reportBaseline}=loadTs('../server/kickx/engine/report-pricing.ts',{'./report-policy':policy});
// Historical reference examples retain the previous 2% cap. New policy is tested separately.
const current={...policy.REPORT_PARAMETERS,pricingModel:'position-points',positionBenchmarks:{GK:8,DF:8,MF:8,FW:8}};
const p={...current,maxUp:.02,maxDown:.02};
const baseline={source:'previous-season',season:2025,gameCount:20,meanScore:6,seedScore:6,percentile:.5,price:100000,lower:-20,upper:100,referenceHash:'fixed',fixtures:[],warnings:[]};
const game=(id,score,season=2026)=>({fixtureId:`bsd-${id}`,score,position:'DF',status:'provisional',minutes:90,season,startedAt:`${season}-09-${String(id).padStart(2,'0')}T12:00:00Z`});
function match(position='D') {return {fixtureId:'bsd-100',playerId:'bsd-2',teamId:'bsd-1',status:'FT',homeTeam:'bsd-1',awayTeam:'bsd-2',homeScore:0,awayScore:0,stats:{minutes_played:90,goals:0},legacy:null,source:{lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players:Array.from({length:11},(_,i)=>({id:i+1,position:i===1?position:'D'})),substitutes:[{id:30,position}]},away:{team_id:2,players:Array.from({length:11},(_,i)=>({id:i+12,position:'D'}))}}},incidents:{incidents:[]}}};}
const points=(r,key)=>r.breakdown.find(b=>b.metric===key)?.points;
test('report scoring applies its positional table and no v2 team-win bonus',()=>{
 for(const [pos,goal,assist] of [['G',10,5],['D',6,4],['M',5,3],['F',4,3]]){
  const m=match(pos);m.homeScore=1;m.stats.goals=1;m.stats.goal_assist=1;m.source.incidents.incidents=[{id:1,type:'goal',minute:40,is_home:true,player_id:2}];
  const r=calc(m);assert.equal(points(r,'minutes'),2);assert.equal(points(r,'goals'),goal);assert.equal(points(r,'assists'),assist);assert.equal(points(r,'team_win'),undefined);
 }
});
test('regular-season scope rejects league-code playoffs and keeps an unknown stage unverified',()=>{
 const m=match();m.regularSeasonOnly=true;m.source.detail={stage:'league-phase'};assert.equal(calc(m).status,'provisional');
 m.source.detail.stage='final';assert.deepEqual(calc(m).warnings,['OUTSIDE_COMPETITION_SCOPE']);
 m.source.detail={};assert.deepEqual(calc(m).warnings,['REGULAR_SEASON_SCOPE_REQUIRED']);
});
test('settled card checks do not block verified final cards; an accepted upgrade requires a red-card incident',()=>{
 const m=match();const review={type:'varDecision',minute:39,decision:'cardUpgrade',confirmed:false,player_id:2};
 m.source.incidents.incidents=[review];assert.equal(calc(m).status,'provisional');
 review.confirmed=true;assert.deepEqual(calc(m).warnings,['VAR_CARD_TIMELINE_REQUIRED']);
 m.source.incidents.incidents.push({type:'card',minute:39,card_type:'red',player_id:2});m.stats.minutes_played=39;m.stats.red_card=1;
 assert.equal(calc(m).status,'provisional');
 delete review.confirmed;assert.deepEqual(calc(m).warnings,['VAR_REVIEW_REQUIRED']);
});
test('report counts DF defensive groups and MF individual actions, pass success above zero attempts',()=>{
 const m=match();Object.assign(m.stats,{won_tackle:4,interception:3,total_pass:10,accurate_pass:9});
 assert.equal(points(calc(m),'defensive_actions'),2);assert.equal(points(calc(m),'pass_accuracy'),1);
 m.source.lineups.lineups.home.players[1].position='M';assert.equal(points(calc(m),'defensive_actions'),3.5);
});
test('explicitly rejected reviews do not block finished matches but unresolved or accepted reviews still do',()=>{
 const m=match();const review={type:'varDecision',minute:28,decision:'review',confirmed:false,player_id:2};
 m.source.incidents.incidents=[review];assert.equal(calc(m).status,'provisional');
 review.decision='mistakenIdentity';assert.equal(calc(m).status,'provisional');
 review.confirmed=true;assert.ok(calc(m).warnings.includes('VAR_REVIEW_REQUIRED'));
 delete review.confirmed;assert.ok(calc(m).warnings.includes('VAR_REVIEW_REQUIRED'));
});
test('announced added time reconciles late entries and first-half dismissals without accepting unrelated corrupt minutes',()=>{
 const m=match();m.playerId='bsd-30';m.stats.minutes_played=9;
 m.source.incidents.incidents=[{type:'substitution',minute:86,player_out_id:2,player_in_id:30},{type:'injuryTime',minute:90,length:3}];
 assert.equal(calc(m).status,'provisional');
 m.stats.minutes_played=30;assert.ok(calc(m).warnings.includes('MINUTES_INTERVAL_MISMATCH'));
 m.playerId='bsd-2';m.stats.minutes_played=53;m.stats.red_card=1;
 m.source.incidents.incidents=[{type:'card',minute:45,added_time:8,card_type:'red',player_id:2}];
 assert.equal(calc(m).status,'provisional');
 m.stats.minutes_played=70;assert.ok(calc(m).warnings.includes('MINUTES_INTERVAL_MISMATCH'));
});
test('report goalkeeper saves, clean-sheet threshold and actual participation',()=>{
 const m=match('G');m.stats.saves=7;m.legacy={penalty_save:1};assert.equal(points(calc(m),'saves'),2);assert.equal(points(calc(m),'penalty_saves'),5);assert.equal(points(calc(m),'clean_sheet'),4);
 m.stats.minutes_played=45;m.source.incidents.incidents=[{type:'substitution',minute:45,player_out_id:2,player_in_id:30}];assert.equal(points(calc(m),'clean_sheet'),0);
});
test('same-minute goals only block when boundary order can affect positional points',()=>{
 const m=match('D');m.stats.minutes_played=60;m.homeScore=1;
 m.source.incidents.incidents=[{type:'goal',minute:60,is_home:true,player_id:3},{type:'substitution',minute:60,player_out_id:2,player_in_id:30}];
 assert.equal(calc(m).status,'provisional');assert.equal(points(calc(m),'clean_sheet'),4);
 m.homeScore=0;m.awayScore=1;m.source.incidents.incidents[0].is_home=false;m.source.incidents.incidents[0].player_id=12;
 assert.ok(calc(m).warnings.includes('GOAL_BOUNDARY_TIME_AMBIGUOUS'));
 m.source.lineups.lineups.home.players[1].position='F';assert.equal(calc(m).status,'provisional');
 assert.equal(points(calc(m),'clean_sheet'),undefined);assert.equal(points(calc(m),'conceded'),undefined);
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
test('a confirmed unused substitute does not require a match position for fixed DNP decay',()=>{
 const m=match(null);m.playerId='bsd-30';m.stats.minutes_played=0;
 assert.equal(calc(m).status,'not-played');assert.equal(calc(m).score,null);
 m.stats.minutes_played=15;assert.equal(calc(m).status,'blocked');
});
test('report pricing reproduces an explicit two-percent parameter without any cumulative target lag',()=>{
 const plan=price([game(1,10),game(2,12)],baseline,p);assert.equal(plan.steps[0].priceAfter,102000);assert.equal(plan.price,104040);assert.equal(plan.steps[1].formScore,12);assert.equal(plan.steps[1].targetPrice,104040);
 assert.deepEqual(price([game(2,12),game(1,10)],baseline,p),plan);
 const games=Array.from({length:8},(_,i)=>game(i+1,6));const changed=games.map((g,i)=>i===0?{...g,score:30}:g);
 assert.notEqual(price(games,baseline,p).steps.at(-1).targetPrice,price(changed,baseline,p).steps.at(-1).targetPrice);
});
test('October 15 launch includes a game ending at midnight and carries earlier form without earlier prices',()=>{
 const launch=Date.parse('2026-10-14T15:00:00Z');
 const rows=[{...game(1,8),startedAt:'2026-10-14T12:00:00Z',endedAt:'2026-10-14T14:59:59.999Z'},
 {...game(2,12),startedAt:'2026-10-14T14:00:00Z',endedAt:'2026-10-14T15:00:00Z'}];
 const plan=price(rows,baseline,{...p,valuationStartMs:launch});
 assert.equal(plan.steps.length,1);assert.equal(plan.steps[0].fixtureId,'bsd-2');
 assert.equal(plan.steps[0].priceBefore,100000);assert.equal(plan.price,102000);
 assert.equal(plan.steps[0].formScore,12);assert.equal(plan.steps[0].evidence.referenceScore,8);
 assert.equal(price(rows.slice(0,1),baseline,{...p,valuationStartMs:launch}).price,100000);
});
test('raw score clipping, DNP, negative baselines and seasonal rollover obey report limits',()=>{
 const plan=price([game(1,10000),{...game(2,null),status:'not-played',minutes:0},game(3,-5,2027)],{...baseline,seedScore:0},p);
 assert.equal(plan.steps.length,3);assert.equal(plan.steps[0].evidence.rawScore,10000);assert.equal(plan.steps[1].evidence.reason,'NON_PARTICIPATION');assert.equal(plan.steps[2].evidence.reason,'POSITION_MATCH_SCORE');assert.equal(plan.steps[2].priceBefore,plan.steps[1].priceAfter);
 for(const s of plan.steps)assert.ok(s.priceAfter>=Math.ceil(s.priceBefore*.98)&&s.priceAfter<=Math.floor(s.priceBefore*1.02));
 assert.throws(()=>price([],baseline,{...p,kappa:0}),/INVALID_REPORT_PARAMETERS/);
});
test('frozen positional midranks and prior fallback do not ingest current-season games',()=>{
 const reference={status:'ready',season:2025,hash:'frozen',groups:{DF:{mean:6,lower:0,upper:10,baselines:[4,6,6,8]}},players:{a:{DF:{n:2,sum:12,fixtures:['old-1','old-2']}}}};
 const b=reportBaseline(reference,'a','DF',p);assert.equal(b.percentile,.5);assert.equal(b.price,100000);assert.equal(reportBaseline(reference,'new','DF',p).source,'position-prior');assert.equal(reportBaseline(reference,'new','GK',p),null);
 assert.equal(reportBaseline({...reference,status:'collecting'},'a','DF',p),null);
});
test('independent PostgreSQL and TypeScript agree for cumulative seasons and integer percentage caps',async()=>{
 const db=new PGlite();try{
  const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(x=>x.endsWith('_additive_point_pricing_release.sql'));
  const sql=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
  await db.exec([...sql.matchAll(/create or replace function public\.kickx_report_plan\([\s\S]*?end \$\$;/gi)].at(-1)[0]);
  let seed=7654;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let c=0;c<40;c++){
   const rows=Array.from({length:1+Math.floor(rand()*24)},(_,i)=>game(i+1,Math.round((rand()*60-15)*2)/2));
   const b={...baseline,seedScore:Math.round((rand()*15-4)*2)/2,price:10000+Math.floor(rand()*900000)};
   const parameters=c%2?{...p,maxUp:.1,maxDown:.1,capChangeAtMs:Date.parse("2026-09-05T00:00:00Z"),previousMaxUp:.02,previousMaxDown:.02}:current;
   const ts=price(rows,b,parameters),pg=(await db.query('select public.kickx_report_plan($1,$2,$3) plan',[rows,b,parameters])).rows[0].plan;
   assert.equal(pg.price,ts.price,`case ${c}`);assert.equal(pg.steps.length,ts.steps.length);
   for(let i=0;i<ts.steps.length;i++)for(const key of ['priceBefore','priceAfter','targetPrice','formScore','changePercent','window'])assert.deepEqual(pg.steps[i][key],ts.steps[i][key],`${c}/${i}/${key}`);
  }
 }finally{await db.close();}
});
test('verified non-participation compounds 1.5 percent without diluting seasonal performance',async()=>{
 const dnp=id=>({...game(id,null),status:'not-played',minutes:0});
 const rows=[game(1,10),dnp(2),dnp(3),{...game(4,null),status:'blocked',minutes:null}];
 const plan=price(rows,baseline,p);assert.equal(plan.steps.length,3);assert.equal(plan.steps[1].priceAfter,100470);assert.equal(plan.price,98963);
 assert.equal(plan.steps[2].evidence.reason,'NON_PARTICIPATION');assert.equal(plan.steps[2].formScore,0);assert.equal(plan.steps[1].evidence.reason,'NON_PARTICIPATION');
 const db=new PGlite();try{
  const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(x=>x.endsWith('_additive_point_pricing_release.sql'));
  const sql=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
  await db.exec([...sql.matchAll(/create or replace function public\.kickx_report_plan\([\s\S]*?end \$\$;/gi)].at(-1)[0]);
  const pg=(await db.query('select public.kickx_report_plan($1,$2,$3) plan',[rows,baseline,p])).rows[0].plan;
  assert.equal(pg.price,plan.price);assert.deepEqual(pg.steps.map(x=>x.priceAfter),plan.steps.map(x=>x.priceAfter));
 }finally{await db.close();}
});
test('October launch warms seasonal form without publishing earlier prices and orders by completion',()=>{
 const launch=Date.parse('2026-10-01T00:00:00+09:00');
 const rows=[game(1,8),{...game(2,12),endedAt:'2026-10-01T01:00:00Z'},{...game(3,null),status:'not-played',minutes:0,endedAt:'2026-10-01T00:00:00Z'}];
 const plan=price(rows,baseline,{...p,valuationStartMs:launch});assert.equal(plan.steps.length,2);assert.equal(plan.steps[0].fixtureId,'bsd-3');
 assert.equal(plan.steps[0].priceBefore,100000);assert.equal(plan.steps[0].priceAfter,98500);assert.equal(plan.steps[1].evidence.referenceScore,8);
 assert.equal(plan.steps[1].targetPrice,100470);assert.equal(plan.steps[1].priceAfter,100470);
});
test('unavailable club member can be DNP but a missing player without membership evidence is blocked',()=>{
 const m=match();m.playerId='bsd-77';m.stats.minutes_played=0;
 assert.equal(calc(m).status,'blocked');m.source.lineups.unavailable_players={home:[{id:77}],away:[]};
 assert.equal(calc(m).status,'not-played');m.source.incidents.incidents=[{type:'substitution',minute:70,player_in_id:77}];
 assert.equal(calc(m).status,'blocked');
});
test('corrected lineup evidence cannot keep an obsolete DNP eligible for decay',()=>{
 const m=match();m.playerId='bsd-77';m.stats.minutes_played=0;
 m.stats._roster_evidence={fixtureId:m.fixtureId,teamId:m.teamId,playerId:m.playerId,kind:'confirmed-lineup'};
 assert.equal(calc(m).status,'blocked');
 m.source.lineups.lineups.home.substitutes.push({id:77});assert.equal(calc(m).status,'not-played');
 m.source.lineups.lineups.home.substitutes.pop();m.stats._roster_evidence.kind='unavailable-list';assert.equal(calc(m).status,'blocked');
 m.source.lineups.unavailable_players={home:[{id:77}]};assert.equal(calc(m).status,'not-played');
 m.source.lineups.unavailable_players={home:[]};m.stats._roster_evidence.kind='observed-squad';assert.equal(calc(m).status,'not-played');
});

test('approved repricing uses the ten-percent cap for old games too',()=>{
 assert.equal(policy.REPORT_PARAMETERS.maxUp,.1);assert.equal(policy.REPORT_PARAMETERS.maxDown,.1);
 const rows=[game(1,100),game(2,100),game(3,-100)];
 const old=price(rows.slice(0,1),baseline,p);
 const currentPlan=price(rows.slice(0,1),baseline,current);
 assert.equal(old.price,102000);assert.equal(currentPlan.price,110000);
 const params={...current,capChangeAtMs:Date.parse('2026-09-02T12:00:00Z'),previousMaxUp:.02,previousMaxDown:.02};
 const plan=price(rows,baseline,params);
 assert.equal(plan.steps[0].priceAfter,110000);
 assert.equal(plan.steps[1].priceAfter,121000);
 for(const step of plan.steps.slice(1))assert.ok(step.priceAfter>=Math.ceil(step.priceBefore*.9)&&step.priceAfter<=Math.floor(step.priceBefore*1.1));
 const downward=price([game(1,-100)],baseline,current);assert.equal(downward.price,90000);
 assert.throws(()=>price(rows,baseline,{...params,previousMaxUp:undefined}),/INVALID_REPORT_PARAMETERS/);
});

test('low assessments cannot rise and high assessments cannot fall, irrespective of baseline or prior form',()=>{
 for(const prior of [0,1,4,6,8,10])for(const score of [0,1,4,7.9,8,8.1,20,30])for(const minutes of [1,15,59,60,90]){
  const rows=[game(1,prior),{...game(2,score),minutes}];
  const step=price(rows,{...baseline,seedScore:prior},current).steps.at(-1);
  if(score<8)assert.ok(step.priceAfter<=step.priceBefore);
  if(score>8)assert.ok(step.priceAfter>=step.priceBefore);
  if(score===8)assert.equal(step.priceAfter,step.priceBefore);
 }
 assert.equal(price([{...game(1,12),minutes:30}],baseline,current).price,102500);
 assert.equal(price([game(1,12)],baseline,current).price,105000);
});
test('report minutes bands stay small; verified actions accumulate without an upper or lower score cap',()=>{
 const m=match('F');assert.equal(calc(m).score,2);
 m.source.incidents.incidents=[{type:'card',minute:20,card_type:'yellow',player_id:2}];m.stats.yellow_card=1;
 assert.equal(calc(m).score,1);
 m.stats.goals=8;m.homeScore=8;m.source.incidents.incidents=Array.from({length:8},(_,i)=>({type:'goal',minute:i+5,is_home:true,player_id:2}));delete m.stats.yellow_card;
 const result=calc(m);assert.equal(result.score,34);assert.equal(result.breakdown.reduce((n,b)=>n+b.points,0),34);
});

test('stored scoring metadata is accepted without treating its revision as a numeric coefficient',()=>{
 const parameters={...current,scoringRevision:policy.SCORING_REVISION};
 assert.equal(price([game(1,12)],baseline,parameters).price,105000);
 assert.throws(()=>price([],baseline,{...parameters,scoringRevision:'unknown'}),/INVALID_REPORT_PARAMETERS/);
});
