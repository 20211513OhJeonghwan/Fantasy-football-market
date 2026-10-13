import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const policy = loadTs('../server/kickx/engine/policy.ts');
const { calculatePerformance: calc } = loadTs('../server/kickx/engine/performance.ts', {'./policy': policy});
function match(position='D') {
 return {fixtureId:'bsd-100',playerId:'bsd-2',teamId:'bsd-1',status:'FT',homeTeam:'bsd-1',awayTeam:'bsd-2',homeScore:0,awayScore:0,stats:{minutes_played:90,goals:0},legacy:null,
  source:{lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players:Array.from({length:11},(_,i)=>({id:i+1,position:i===1?position:'D'})),substitutes:[{id:30,position}]},away:{team_id:2,players:Array.from({length:11},(_,i)=>({id:i+12,position:'D'}))}}},incidents:{incidents:[]}}};
}
const points=(r,key)=>r.breakdown.find(b=>b.metric===key)?.points;
const goal=(id,minute,home=true,player=2)=>({id,type:'goal',minute,is_home:home,player_id:player});
test('all-round defensive contribution yields 65.5 points without a goal, with visible sum exact',()=>{
 const m=match();Object.assign(m.stats,{won_tackle:3,interception:3,total_pass:40,accurate_pass:36});
 const r=calc(m);assert.equal(r.score,65.5);assert.equal(r.status,'provisional');assert.equal(r.breakdown.reduce((s,b)=>s+b.points,0),65.5);
 assert.equal(m.stats.goals,0);assert.ok(r.warnings.includes('assists:UNVERIFIED_OR_MISSING_EXCLUDED'));
});
test('striker contributions reach 48, 78 and 108 without a score ceiling',()=>{
 const m=match('F');m.homeScore=1;m.source.incidents.incidents=[goal(1,40,true,1)];Object.assign(m.stats,{shots_on_target:3,key_pass:2});assert.equal(calc(m).score,48);
 m.stats.goals=1;m.source.incidents.incidents=[goal(1,40)];assert.equal(calc(m).score,78);
 m.homeScore=2;m.stats.goals=2;m.source.incidents.incidents.push(goal(2,80));assert.equal(calc(m).score,108);
});
test('position-specific goals, cards and own goals are reconciled against incidents',()=>{
 for(const [position,weight] of [['G',50],['D',40],['M',35],['F',30]]){const m=match(position);m.homeScore=1;m.stats.goals=1;m.source.incidents.incidents=[goal(1,40)];assert.equal(points(calc(m),'goals'),weight);}
 const m=match();m.awayScore=1;m.source.incidents.incidents=[{...goal(1,20,false),own_goal:true},{type:'card',card_type:'yellow',minute:30,player_id:2}];
 assert.equal(points(calc(m),'own_goals'),-10);assert.equal(points(calc(m),'goals'),0);assert.equal(points(calc(m),'yellow_cards'),-3);
});
test('team clean sheet is proportional and depends on full-time result, not clean substitution interval',()=>{
 const m=match();m.stats.minutes_played=45;m.source.incidents.incidents=[{type:'substitution',minute:45,player_out_id:2,player_in_id:30}];assert.equal(points(calc(m),'clean_sheet'),10);
 m.awayScore=1;m.source.incidents.incidents.push(goal(2,80,false,12));assert.equal(points(calc(m),'clean_sheet'),0);assert.equal(points(calc(m),'conceded'),0);
});
test('dismissal removes clean-sheet bonus and post-dismissal concessions are not charged',()=>{
 const m=match();m.stats.minutes_played=60;m.stats.red_card=1;m.awayScore=1;m.source.incidents.incidents=[{type:'card',card_type:'red',minute:60,player_id:2},goal(1,70,false,12)];
 const r=calc(m);assert.equal(points(r,'red_cards'),-12);assert.equal(points(r,'conceded'),0);assert.equal(points(r,'clean_sheet'),0);
});
test('each goalkeeper save counts and missed optional fields are not treated as verified zero',()=>{
 const m=match('G');m.stats.saves=7;m.legacy={penalty_save:1};const r=calc(m);
 assert.equal(points(r,'saves'),21);assert.equal(points(r,'penalty_saves'),20);assert.equal(r.score,91);
});
test('DNP, incomplete score timeline and invalid passing keep null instead of inventing a score',()=>{
 const m=match();m.playerId='bsd-30';m.stats.minutes_played=0;assert.equal(calc(m).status,'not-played');
 m.playerId='bsd-2';assert.equal(calc(m).score,null);
 const bad=match();bad.homeScore=1;assert.equal(calc(bad).status,'blocked');
 const pass=match('F');Object.assign(pass.stats,{total_pass:10,accurate_pass:11});assert.equal(calc(pass).status,'blocked');
});

test('same-minute goal and dismissal needs explicit timing before charging participation',()=>{
 const m=match();m.stats.minutes_played=60;m.awayScore=1;m.source.incidents.incidents=[{type:'card',card_type:'red',minute:60,player_id:2},goal(1,60,false,12)];
 assert.equal(calc(m).status,'blocked');assert.ok(calc(m).warnings.includes('GOAL_BOUNDARY_TIME_AMBIGUOUS'));
 m.source.incidents.incidents[0].period_second=3610;m.source.incidents.incidents[1].period_second=3620;
 assert.equal(points(calc(m),'conceded'),0);
});
