import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClubCompetitions } from '../scripts/lib/competitions.mjs';
import { processBulkTask } from '../scripts/lib/bulk-plan.mjs';
import { normalizeBatch,normalizeStatus } from '../scripts/lib/football.mjs';
import { loadTs } from './load-ts.mjs';
const policy=loadTs('../server/kickx/engine/policy.ts');
const {calculatePerformance:calc}=loadTs('../server/kickx/engine/performance.ts',{'./policy':policy});
const frame=()=>({fixtureId:'bsd-100',playerId:'bsd-2',teamId:'bsd-1',status:'AET',homeTeam:'bsd-1',awayTeam:'bsd-2',homeScore:0,awayScore:0,stats:{minutes_played:120,goals:0},legacy:null,clubCompetitions:true,source:{detail:{extra_time_score:{home:0,away:0}},lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players:Array.from({length:11},(_,i)=>({id:i+1,position:i===1?'F':'D'})),substitutes:[{id:30,position:'D'}]},away:{team_id:2,players:Array.from({length:11},(_,i)=>({id:i+12,position:'D'}))}}},incidents:{incidents:[]}}});
const metric=(r,k)=>r.breakdown.find(b=>b.metric===k)?.points;
test('competition discovery uses exact aliases and rejects ambiguous IDs rather than importing unrelated leagues',()=>{
 const r=resolveClubCompetitions([{id:7,name:'Champions League'},{id:29,name:'CAF Champions League'},{id:43,name:'DFB Pokal'},{id:999,name:'FA Cup Women'}]);
 assert.deepEqual(r.found.map(x=>x.id),[7,43]);assert.ok(r.missing.includes('FA컵'));
 assert.throws(()=>resolveClubCompetitions([{id:7,name:'Champions League'},{id:88,name:'UEFA Champions League'}]),/AMBIGUOUS_COMPETITION/);
});
test('additional competition backfill covers its past season and never changes current rosters or domestic league membership',async()=>{
 const job={kind:'league',payload:{league:7,phase:'seasons',supplemental:true,automatic:true,scopeTeamIds:[1],backfilledSeasonIds:[],detail:{id:7,name:'Champions League'}}};
 const season={league_id:7,season:{id:11,year:2026,start_date:'2026-07-01',end_date:'2027-06-30',is_current:true}};
 const r=await processBulkTask({get:async()=>season},job,'2026-10-13');
 assert.equal(r.children.some(t=>t.kind==='teams'||t.kind==='squad'),false);
 assert.equal(r.children[0].payload.from,'2026-07-01');assert.equal(r.children.at(-1).kind,'club-complete');
 const later=await processBulkTask({get:async()=>season},{...job,payload:{...job.payload,backfilledSeasonIds:[11]}},'2026-10-13');
 assert.equal(later.children[0].payload.from,'2026-10-06');assert.equal(later.children.length,1);
 const off=await processBulkTask({get:async()=>({league_id:7,season:null})},job,'2026-10-13');assert.equal(off.warning,'COMPETITION_OUT_OF_SEASON');
});
test('a cup fixture is imported when either side is tracked and the opponent retains no invented domestic league',async()=>{
 const c={league:7,seasonId:11,seasonYear:2026,supplemental:true,scopeTeamIds:[1]};
 const fixture={id:100,league_id:7,season_id:11,event_date:'2026-10-01T12:00:00Z',home_team_id:2,home_team:'Opponent',away_team_id:1,away_team:'Tracked',status:'finished',home_score:0,away_score:1,stage:'round-of-16',round_label:'Round of 16'};
 const r=await processBulkTask({page:async()=>({results:[fixture,{...fixture,id:101,away_team_id:3}],next:null})},{kind:'fixtures',payload:{context:c,from:'2026-10-01',to:'2026-10-02',offset:0}});
 assert.equal(r.batch.fixtures.length,1);assert.equal(r.children.length,1);assert.equal(r.batch.teams[0].league_id,null);
 assert.equal(r.batch.fixtures[0].round_label,'Round of 16');
});
test('a generic finished status is refined from ET and shootout fields; shootout goals never enter the match score',()=>{
 assert.equal(normalizeStatus({status:'finished',extra_time_score:{home:1,away:0}}),'AET');
 assert.equal(normalizeStatus({status:'finished',penalty_shootout:{home:5,away:4}}),'PEN');
 const r=normalizeBatch('fixtures',[{id:1,league_id:7,season_id:11,event_date:'2026-10-01T12:00:00Z',home_team_id:1,home_team:'H',away_team_id:2,away_team:'A',status:'finished',home_score:1,away_score:1,extra_time_score:{home:1,away:1},penalty_shootout:{home:5,away:4}}],{league:7,seasonId:11,seasonYear:2026});
 assert.equal(r.fixtures[0].home_score,2);assert.equal(r.fixtures[0].away_score,2);assert.equal(r.fixtures[0].penalties_home,5);
});
test('120-minute contributions count while appearance remains capped and a 30-minute extra-time substitute is handled',()=>{
 const m=frame();m.homeScore=1;m.stats.goals=1;m.source.detail.extra_time_score.home=1;m.source.incidents.incidents=[{type:'goal',minute:110,is_home:true,player_id:2}];
 const r=calc(m);assert.equal(r.score,65);assert.equal(metric(r,'minutes'),30);assert.equal(metric(r,'goals'),30);
 const sub=frame();sub.playerId='bsd-30';sub.stats.minutes_played=30;sub.source.incidents.incidents=[{type:'substitution',minute:90,player_in_id:30,player_out_id:2}];
 assert.equal(metric(calc(sub),'clean_sheet'),5);assert.equal(calc(sub).score,21.67);
 assert.equal(calc({...m,clubCompetitions:false}).status,'blocked');
});
test('shootout goals are excluded, a normal penalty remains a goal, and only the winner receives the team bonus',()=>{
 const m=frame();m.status='PEN';m.source.detail.penalty_shootout={home:5,away:4};m.source.incidents.incidents=[{type:'goal',minute:121,is_home:true,player_id:2,goal_type:'penaltyShootout'}];
 const r=calc(m);assert.equal(metric(r,'goals'),0);assert.equal(metric(r,'team_win'),5);assert.equal(r.score,35);
 m.source.detail.penalty_shootout={home:4,away:5};assert.equal(metric(calc(m),'team_win'),0);
 m.status='AET';m.homeScore=1;m.stats.goals=1;m.source.incidents.incidents=[{type:'goal',minute:75,is_home:true,player_id:2,goal_type:'penalty'}];assert.equal(metric(calc(m),'goals'),30);
});
test('contradictory shootout results and incomplete ET metadata stay blocked; post-substitution goals do not charge concessions',()=>{
 const m=frame();m.status='PEN';m.source.detail.penalty_shootout={home:5,away:5};assert.equal(calc(m).status,'blocked');
 m.status='AET';delete m.source.detail.extra_time_score;assert.equal(calc(m).status,'blocked');
 const d=frame();d.source.lineups.lineups.home.players[1].position='D';d.stats.minutes_played=100;d.awayScore=1;d.source.detail.extra_time_score.away=1;d.source.incidents.incidents=[{type:'substitution',minute:100,player_in_id:30,player_out_id:2},{type:'goal',minute:115,is_home:false,player_id:12}];assert.equal(metric(calc(d),'conceded'),0);
});
