import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {calculatePerformance:calc,priceFromScores:price}=loadTs('../server/kickx/engine/legacy-performance.ts');
function match(position='D'){
 return {fixtureId:'bsd-100',playerId:'bsd-2',teamId:'bsd-1',status:'FT',homeTeam:'bsd-1',awayTeam:'bsd-2',homeScore:0,awayScore:0,stats:{minutes_played:90,goals:0},legacy:null,source:{lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players:Array.from({length:11},(_,i)=>({id:i+1,position:i===1?position:'D'})),substitutes:[{id:30,position}]},away:{team_id:2,players:Array.from({length:11},(_,i)=>({id:i+12,position:'D'}))}}},incidents:{incidents:[]}}};
}
const goal=(id,minute,home=true,player=2)=>({id,type:'goal',minute,is_home:home,player_id:player});
const item=(r,k)=>r.breakdown.find(b=>b.metric===k)?.points;
test('specification DF sample is 9 raw points and capped +5% price, never 0..100 rating',()=>{
 const m=match();Object.assign(m.stats,{won_tackle:3,interception:3,total_pass:40,accurate_pass:36});const r=calc(m);
 assert.equal(r.score,9);assert.equal(r.status,'provisional');assert.equal(price([r]),105000);assert.equal(m.stats.goals,0);assert.ok(r.warnings.some(w=>w.startsWith('assists:')));
});
test('positional goals follow specification GK10 DF6 MF5 FW4',()=>{
 for(const [position,points] of [['G',10],['D',6],['M',5],['F',4]]){const m=match(position);m.homeScore=1;m.stats.goals=1;m.source.incidents.incidents=[goal(1,40)];assert.equal(item(calc(m),'goals'),points);}
});
test('MF attacking, passing and per-three defensive counters add fractional points',()=>{
 const m=match('M');Object.assign(m.stats,{shots_on_target:3,key_pass:2,accurate_cross:1,total_pass:40,accurate_pass:34,won_tackle:2,interception:4,goal_assist:1});const r=calc(m);assert.equal(r.score,12);assert.equal(item(r,'defensive_actions'),1);assert.equal(item(r,'shots_on_target'),1.5);
});
test('substitution before later concession preserves earned clean sheet',()=>{
 const m=match();m.stats.minutes_played=60;m.awayScore=1;m.source.incidents.incidents=[goal(2,80,false,12),{type:'substitution',minute:60,player_out_id:2,player_in_id:30}];assert.equal(item(calc(m),'clean_sheet'),4);
});
test('red card retains subsequent concessions and removes clean sheet',()=>{
 const m=match();m.stats.minutes_played=60;m.awayScore=2;m.source.incidents.incidents=[goal(1,70,false,12),goal(2,80,false,12),{type:'card',card_type:'red',minute:60,player_id:2}];const r=calc(m);assert.equal(item(r,'conceded'),-1);assert.equal(item(r,'clean_sheet'),0);assert.equal(r.score,-2);
});
test('second yellow applies prior warning plus dismissal without double red',()=>{
 const m=match();m.stats.minutes_played=60;m.stats.yellow_card=2;m.stats.red_card=1;m.source.incidents.incidents=[{type:'card',card_type:'yellow',minute:40,player_id:2},{type:'card',card_type:'secondYellow',minute:60,player_id:2}];const r=calc(m);assert.equal(item(r,'yellow_cards'),-1);assert.equal(item(r,'red_cards'),-3);
});
test('rescinded cards and repeated incident IDs are ignored without conflating distinct goals',()=>{
 const m=match();m.homeScore=1;m.stats.goals=1;const g=goal(1,30);m.source.incidents.incidents=[g,g,{type:'card',card_type:'red',minute:60,player_id:2,rescinded:true}];assert.equal(item(calc(m),'goals'),6);assert.equal(item(calc(m),'red_cards'),0);
});
test('own goal is negative and not a scored goal for player',()=>{
 const m=match();m.awayScore=1;m.source.incidents.incidents=[{...goal(1,20,false),own_goal:true}];const r=calc(m);assert.equal(item(r,'own_goals'),-2);assert.equal(item(r,'goals'),0);assert.equal(item(r,'clean_sheet'),0);
});
test('goal at substitution minute needs timing, never provider array order',()=>{
 const m=match();m.stats.minutes_played=60;m.awayScore=1;m.source.incidents.incidents=[goal(1,60,false,12),{type:'substitution',minute:60,player_out_id:2,player_in_id:30}];assert.equal(calc(m).score,null);
 m.source.incidents.incidents[0].period_second=3620;m.source.incidents.incidents[1].period_second=3610;assert.equal(item(calc(m),'clean_sheet'),4);
});
test('GK grouped saves and legacy PK saves use distinct specification weights',()=>{
 const m=match('G');m.stats.saves=7;m.legacy={penalty_save:1};const r=calc(m);assert.equal(item(r,'saves'),2);assert.equal(item(r,'penalty_saves'),5);assert.equal(r.score,13);
});
test('zero-minute bench does not lose price; absent starting minutes are a conflict',()=>{
 const m=match();m.playerId='bsd-30';m.stats.minutes_played=0;assert.equal(calc(m).status,'not-played');assert.equal(price([calc(m)]),100000);m.playerId='bsd-2';assert.equal(calc(m).status,'blocked');
});
test('missing sources, invalid statistics, score mismatches, overtime and unfinished matches remain null',()=>{
 const variants=[m=>{m.source.lineups=null;},m=>{m.stats.minutes_played=null;},m=>{m.homeScore=1;},m=>{m.status='AET';},m=>{m.status='LIVE';},m=>{m.stats.red_card=1;},m=>{m.stats.total_pass=40;m.stats.accurate_pass=50;}];
 for(const alter of variants){const m=match();alter(m);const r=calc(m);assert.equal(r.status,'blocked');assert.equal(r.score,null);assert.equal(price([r]),100000);}
});
test('replay, integer rounding, negative scores and price bounds are deterministic',()=>{
 const result=score=>({status:'provisional',score});assert.equal(price([result(9),result(-2)]),99750);assert.equal(price([result(9),result(-2)]),price([result(9),result(-2)]));assert.equal(price(Array(100).fill(result(-100))),10000);assert.equal(price(Array(100).fill(result(100))),1000000);
});
