import test from'node:test';import assert from'node:assert/strict';import{loadTs}from'./load-ts.mjs';
const policy=loadTs('../server/kickx/engine/report-policy.ts');const{calculatePerformance:calc}=loadTs('../server/kickx/engine/report-performance.ts',{'./report-policy':policy});
function match(position='M'){return{fixtureId:'bsd-1',playerId:'bsd-2',teamId:'bsd-1',status:'FT',homeTeam:'bsd-1',awayTeam:'bsd-2',homeScore:0,awayScore:0,stats:{minutes_played:90},legacy:null,source:{lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players:Array.from({length:11},(_,i)=>({id:i+1,position:i===1?position:'D'})),substitutes:[]},away:{team_id:2,players:Array.from({length:11},(_,i)=>({id:i+12,position:'D'})),substitutes:[]}}},incidents:{incidents:[]}}};}
test('routine verified actions accumulate on the report scale without fabricated activity or duplicated totals',()=>{
 const m=match();Object.assign(m.stats,{total_pass:50,accurate_pass:40,ball_recovery:4,total_clearance:4,won_contest:2,outfielder_block:1,was_fouled:2,touches:100,total_contest:20,duel_won:15,rating:10});
 const r=calc(m);assert.equal(r.score,10);assert.equal(r.breakdown.reduce((n,b)=>n+b.points,0),10);assert.deepEqual(r.breakdown.filter(b=>['passes_completed','ball_recoveries','clearances','dribbles_completed','shots_blocked','fouls_won'].includes(b.metric)).map(b=>b.points),[2,2,1,1,.5,.5]);
 delete m.stats.duel_won;delete m.stats.rating;delete m.stats.touches;delete m.stats.total_contest;assert.equal(calc(m).score,r.score);
});
test('goalkeeper-specific extra actions do not award an outfield player',()=>{
 const m=match('G');m.stats.good_high_claim=2;m.stats.accurate_keeper_sweeper=3;assert.equal(calc(m).score,8.5);
 m.source.lineups.lineups.home.players[1].position='F';assert.equal(calc(m).score,2);
});
test('unknown, zero and corrupt optional counters do not invent a bonus; more than 30 points remain possible',()=>{
 const m=match('F');Object.assign(m.stats,{accurate_pass:0,ball_recovery:null,total_clearance:-1,won_contest:1.5,outfielder_block:'many',was_fouled:0});assert.equal(calc(m).score,2);
 m.homeScore=8;m.stats.goals=8;m.source.incidents.incidents=Array.from({length:8},(_,i)=>({type:'goal',player_id:2,is_home:true,minute:i+1}));assert.equal(calc(m).score,34);
});
