import test from "node:test";
import assert from "node:assert/strict";
import { createFootballClient, normalizeBatch, parseSyncArgs } from "../scripts/lib/api-football-legacy.mjs";
const envelope=(response=[],paging={current:1,total:1},errors=[])=>new Response(JSON.stringify({errors,response,paging}),{headers:{"x-ratelimit-requests-remaining":"99"}});
const context={league:39,season:2025};
test("provider HTTP 200 errors are failures, not successful empty imports",async()=>{
  const api=createFootballClient({key:"test-only",fetchImpl:async()=>envelope([],undefined,{season:"unavailable"})});
  await assert.rejects(api.get("/players",context),/PROVIDER_REJECTED_REQUEST/);
  assert.equal(api.requests,1);
});
test("run budget stops before another quota-consuming request",async()=>{
  let called=0;
  const api=createFootballClient({key:"test-only",budget:1,fetchImpl:async()=>{called++;return envelope();},wait:async()=>{}});
  await api.get("/teams",context);
  await assert.rejects(api.get("/teams",context),/RUN_BUDGET_REACHED/);
  assert.equal(called,1);
});
test("remaining daily quota stops calls and pagination metadata survives",async()=>{
  const api=createFootballClient({key:"test-only",fetchImpl:async()=>{const r=envelope([],{current:2,total:7});r.headers.set("x-ratelimit-requests-remaining","0");return r;}});
  assert.equal((await api.get("/players",{page:2})).paging.total,7);
  await assert.rejects(api.get("/players",{page:3}),/DAILY_QUOTA_REACHED/);
});
test("secrets cannot be sent to a substituted host; malformed envelopes fail",async()=>{
  const api=createFootballClient({key:"test-only",fetchImpl:async()=>new Response("{}")});
  await assert.rejects(api.get("https://other.example.test/"),/INVALID_API_HOST/);
  assert.equal(api.requests,0);
  await assert.rejects(api.get("/teams"),/PROVIDER_REJECTED_REQUEST/);
});
test("fixture zero score and unknown score stay different; no price or performance is invented",()=>{
  const batch=normalizeBatch("fixtures",[{league:{id:39,season:2025},fixture:{id:10,date:"2025-08-01T12:00:00+00:00",status:{short:"NS"}},teams:{home:{id:1,name:"Home"},away:{id:2,name:"Away"}},goals:{home:0,away:null}}],context);
  assert.equal(batch.fixtures[0].home_score,0);assert.equal(batch.fixtures[0].away_score,null);
  assert.equal(batch.fixtures[0].season,2025);assert.equal("price" in batch.fixtures[0],false);
});
test("season transfer statistics remain separate and never overwrite current squad membership",()=>{
  const stat=id=>({league:{id:39,season:2025},team:{id,name:"Test team"},games:{position:"Attacker",minutes:0},goals:{total:0,assists:null}});
  const batch=normalizeBatch("players",[{player:{id:9,name:"Test-only player",birth:{date:null}},statistics:[stat(1),stat(2)]}],context);
  assert.equal(batch.seasons.length,2);assert.equal("team_id" in batch.players[0],false);
  assert.equal(batch.seasons[0].stats.goals.total,0);assert.equal(batch.seasons[0].stats.goals.assists,null);
});
test("current squad sets membership without clearing richer profile fields",()=>{
  const batch=normalizeBatch("squads",[{team:{id:1,name:"Team"},players:[{id:9,name:"Player",position:"Goalkeeper",number:1}]}],{...context,teamId:1});
  assert.equal(batch.players[0].team_id,"af-1");assert.equal(batch.players[0].position,"GK");
  assert.equal("country" in batch.players[0],false);
});
test("provider rating remains raw and never masquerades as KICK-X Performance",()=>{
  const batch=normalizeBatch("matches",[{team:{id:1},players:[{player:{id:9,name:"Player"},statistics:[{games:{rating:"8.5",minutes:0},goals:{total:0,assists:null}}]}]}],{...context,fixtureId:10});
  assert.equal(batch.matches[0].stats.games.rating,"8.5");assert.equal("performance" in batch.matches[0],false);
});
test("sync requires explicit season and bounded dates, allowing an explicit resume page",()=>{
  assert.throws(()=>parseSyncArgs(["players","--league=39"]),/USAGE_SEASON/);
  assert.throws(()=>parseSyncArgs(["fixtures","--league=39","--season=2025","--from=2025-01-01","--to=2025-12-31"]),/USAGE_DATE_WINDOW/);
  assert.throws(()=>parseSyncArgs(["players","--league=39","--season=2025","--budget=101"]),/USAGE_BUDGET/);
  assert.equal(parseSyncArgs(["players","--league=39","--season=2025","--page=4","--pages=2"]).page,4);
});
