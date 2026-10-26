import test from 'node:test';
import assert from 'node:assert/strict';
import {processBulkTask} from '../scripts/lib/bulk-plan.mjs';
test('cup schedule collection keeps relevant fixtures without creating scoring or profile work',async()=>{
 const fixture={id:10,league_id:99,season_id:100,status:'finished',home_team_id:1,away_team_id:2,home_team:'Home',away_team:'Away',event_date:'2026-10-01T12:00:00Z',home_score:1,away_score:0};
 const job={kind:'fixtures',payload:{context:{league:99,seasonId:100,seasonYear:2026,supplemental:true,schedulesOnly:true,scopeTeamIds:[1]},from:'2026-10-01',to:'2026-10-30',offset:0}};
 let requests=0;
 const outcome=await processBulkTask({async page(){requests++;return {results:[fixture,{...fixture,id:11,home_team_id:3,away_team_id:4}],next:null};}},job,'2026-10-26');
 assert.equal(requests,1);assert.equal(outcome.batch.fixtures.length,1);assert.equal(outcome.batch.fixtures[0].id,'bsd-10');assert.deepEqual(outcome.children,[]);
});
