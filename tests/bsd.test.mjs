import test from "node:test";
import assert from "node:assert/strict";
import { createFootballClient, externalId, normalizeBatch, normalizeMatchBundle, normalizeStats, parseSyncArgs } from "../scripts/lib/football.mjs";
import { runFootballSync } from "../scripts/lib/sync-runner.mjs";
const context={league:85,seasonId:12345,seasonYear:2026};
const event={id:100,league_id:85,season_id:12345,home_team_id:1,home_team:"Home",away_team_id:2,away_team:"Away",event_date:"2026-09-20T12:00:00Z",status:"finished",home_score:1,away_score:0};
const profile={id:9,name:"Fixture player",position:"G",jersey_number:1};
const stats={event_id:100,count:1,player_stats:[{event_id:100,player_id:9,team_id:1,minutes_played:90,goals:0,goal_assist:0,saves:4,accurate_cross:2,won_tackle:3,total_tackle:9,total_pass:35,accurate_pass:30,rating:8.5}]};
const lineups={event_id:100,lineup_status:"confirmed",lineups:{home:{team_id:1,players:[profile],substitutes:[]},away:{team_id:2,players:[],substitutes:[]}}};
const incidents={event_id:100,incidents:[{type:"goal",player_id:10,minute:45,is_home:true},{type:"substitution",player_out_id:9,player_in_id:8,minute:75,is_home:true}]};
const legacy=[{event:{id:100},player:{id:9},penalty_save:1}];
const response=body=>new Response(JSON.stringify(body));
const client=fetchImpl=>createFootballClient({key:"test-secret",fetchImpl,wait:async()=>{}});
test("BSD token stays on the allowed host, redirects are rejected and errors redact bodies",async()=>{
 let seen;
 const api=client(async(url,init)=>{seen={url,init};return response({id:85});});
 await assert.rejects(api.get("https://evil.test/api/v2/leagues/"),/INVALID_API_HOST/);
 assert.equal(api.requests,0);
 await api.get("/api/v2/leagues/85/");
 assert.equal(seen.init.headers.Authorization,"Token test-secret");assert.equal(seen.init.redirect,"error");
 await assert.rejects(client(async()=>new Response('private body',{status:401})).get('/api/v2/leagues/'),/PROVIDER_HTTP_401/);
});
test("v2 offsets and v1 pages remain separate, filtered next links cannot escape or loop",async()=>{
 const api=client(async()=>response({count:300,results:[],next:"https://sports.bzzoiro.com/api/v2/events/?league_id=85&offset=200&limit=200"}));
 assert.equal((await api.page('/api/v2/events/',{league_id:85,offset:0,limit:200})).next,200);
 const old=client(async()=>response({count:70,results:[],next:"https://sports.bzzoiro.com/api/player-stats/?event=100&page=2"}));
 assert.equal((await old.page('/api/player-stats/',{event:100,page:1},'v1')).next,2);
 for(const next of ['https://evil.test/api/v2/events/?offset=1','/api/v2/players/?offset=1','/api/v2/events/?league_id=86&offset=1','/api/v2/events/?league_id=85&offset=0']) {
  await assert.rejects(client(async()=>response({count:1,results:[],next})).page('/api/v2/events/',{league_id:85,offset:0}),/INVALID_API_HOST|INVALID_PROVIDER_NEXT/);
 }
});
test("request budget includes bounded network and 5xx retries; 429 exposes only Retry-After",async()=>{
 let calls=0;
 const api=createFootballClient({key:'test',budget:2,wait:async()=>{},fetchImpl:async()=>{calls++;return new Response('',{status:503});}});
 await assert.rejects(api.get('/api/v2/leagues/'),/RUN_BUDGET_REACHED/);assert.equal(calls,2);
 const limited=client(async()=>new Response('secret',{status:429,headers:{'Retry-After':'60'}}));
 await assert.rejects(limited.get('/api/v2/leagues/'),e=>e.code==='PROVIDER_RATE_LIMIT' && e.retryAfterSeconds===60);
});
test("season ID is independent of year; API-FOOTBALL keys and pagination options are not reused",()=>{
 const batch=normalizeBatch('leagues',{id:85,name:'Premier League',season:{league_id:85,seasons:[{id:12345,year:2026,name:'2026/27'}]}},context);
 assert.equal(batch.coverage[0].season,2026);assert.equal(batch.coverage[0].provider_season_id,12345);
 assert.equal(externalId(39),'bsd-39');
 assert.throws(()=>parseSyncArgs(['teams','--league=85','--season=2026']),/USAGE_OPTION/);
 assert.equal(parseSyncArgs(['teams','--league=85','--season-id=12345','--offset=200']).offset,200);
 assert.throws(()=>parseSyncArgs(['fixtures','--league=85','--season-id=12345','--from=2026-02-30','--to=2026-03-01']),/USAGE_DATE_WINDOW/);
});
test("zero scores are known, unknown scores stay null, extra time excludes shootout",()=>{
 const batch=normalizeBatch('fixtures',[{...event,home_score:0,away_score:null,extra_time_score:{home:1,away:0},penalty_shootout:{home:5,away:4}}],context);
 assert.equal(batch.fixtures[0].home_score,1);assert.equal(batch.fixtures[0].away_score,null);
 assert.equal(batch.fixtures[0].provider_season_id,12345);assert.equal(batch.sources[0].detail.penalty_shootout.home,5);
  assert.throws(()=>normalizeBatch('fixtures',[{...event,season_id:2026}],context),/UNEXPECTED_FIXTURE_CONTEXT/);
  assert.equal(normalizeBatch('fixtures',[{...event,status:'unresolved',home_score:null,away_score:null}],context).fixtures[0].status,'UNRESOLVED');
});
test("raw default zeros are flagged unknown and successful crosses/tackles are mapped exactly",()=>{
 const batch=normalizeMatchBundle({detail:event,stats,lineups,incidents,legacy},context),m=batch.matches[0];
 assert.equal(m.normalized.values.crosses_completed,2);assert.equal(m.normalized.values.tackles_won,3);
 assert.equal(m.normalized.values.penalty_saves,1);assert.equal(m.normalized.values.goals,null);
 assert.equal(m.normalized.quality.goals,'unverified_zero');assert.equal(m.stats.goals,0);
 assert.equal(m.stats.rating,8.5);assert.equal('performance' in m,false);assert.equal('team_id' in batch.players[0],false);
 assert.equal(m.normalized.calculation_ready,false);assert.equal(m.normalized.values.goals_conceded_on_pitch,null);
 assert.equal(batch.sources[0].incidents,incidents);assert.match(batch.players[0].photo,/img\/player\/9\//);
 assert.throws(()=>normalizeStats({total_pass:5,accurate_pass:6}),/INVALID_PASS_TOTALS/);
});
test("foreign event/team, duplicate stats and mismatched legacy IDs fail before writes",()=>{
 const bundle={detail:event,stats,lineups,incidents,legacy};
 assert.throws(()=>normalizeMatchBundle({...bundle,incidents:{...incidents,event_id:999}},context),/UNEXPECTED_EVENT/);
 assert.throws(()=>normalizeMatchBundle({...bundle,stats:{...stats,player_stats:[{...stats.player_stats[0],team_id:5}]}},context),/UNEXPECTED_FIXTURE_TEAM/);
 assert.throws(()=>normalizeMatchBundle({...bundle,legacy:[{event:{id:999},player:{id:9}}]},context),/INVALID_LEGACY_STATISTICS/);
 assert.throws(()=>normalizeMatchBundle({...bundle,stats:{...stats,count:2,player_stats:[...stats.player_stats,...stats.player_stats]}},context),/INVALID_MATCH_STATISTICS/);
});
const makeApi=(overrides={})=>({get:async path=>{
 const data={'/api/v2/leagues/85/':{id:85,name:'Premier League'},'/api/v2/leagues/85/seasons/':{league_id:85,seasons:[{id:12345,year:2026,name:'2026/27'}]},'/api/v2/events/100/':event,'/api/v2/events/100/player-stats/':stats,'/api/v2/events/100/lineups/':lineups,'/api/v2/events/100/incidents/':incidents};
 if(overrides[path] instanceof Error) throw overrides[path];
 return overrides[path] ?? data[path];
},page:async()=>({results:legacy,next:null})});
test("a finished-match bundle saves atomically once; partial fetch failures save nothing",async()=>{
 const options={...context,task:'matches',fixtureId:100,offset:0},saved=[];
 await runFootballSync(makeApi(),options,{save:async b=>saved.push(b)});
 assert.equal(saved.length,1);assert.equal(saved[0].leagues.length,1);assert.equal(saved[0].matches.length,1);
 await assert.rejects(runFootballSync(makeApi({'/api/v2/events/100/incidents/':new Error('quota')}),options,{save:async b=>saved.push(b)}),/quota/);
 assert.equal(saved.length,1);
});
test("empty lineups fetch player profile without treating historical membership as current",async()=>{
 const api=makeApi({'/api/v2/events/100/lineups/':{event_id:100,lineup_status:'unavailable',lineups:null},'/api/v2/players/9/':{...profile,current_team_id:999}});
 let batch;
 await runFootballSync(api,{...context,task:'matches',fixtureId:100,offset:0},{save:async b=>{batch=b;}});
 assert.equal('team_id' in batch.players[0],false);
});
test("offset cursor advances only after a saved page; second-page failure retains resume point",async()=>{
 const cursors=[],saved=[];let calls=0;
 const api=makeApi();api.page=async()=>{if(calls++===1) throw new Error('budget');return {results:[{id:1,name:'Home'}],count:4,next:200};};
 await assert.rejects(runFootballSync(api,{...context,task:'teams',offset:0,pages:2,limit:200},{save:async b=>saved.push(b),progress:async p=>cursors.push(p.nextOffset)}),/budget/);
 assert.equal(saved.length,2);assert.equal(cursors.at(-1),200);
});
test("BSD structured RateLimit header tracks daily quota; missing headers remain unknown",async()=>{
 const api=client(async()=>new Response('{}',{headers:{RateLimit:'"football";r=0;t=52800'}}));
 await api.get('/api/v2/leagues/');assert.equal(api.remaining,0);
 await assert.rejects(api.get('/api/v2/leagues/'),/DAILY_QUOTA_REACHED/);assert.equal(api.requests,1);
 const paid=client(async()=>response({id:85}));await paid.get('/api/v2/leagues/');assert.equal(paid.remaining,null);
 const exhausted=client(async()=>new Response('{"code":"taster_exhausted"}',{status:429,headers:{'Retry-After':'52800'}}));
 await assert.rejects(exhausted.get('/api/v2/leagues/'),e=>e.code==='DAILY_QUOTA_REACHED' && e.retryAfterSeconds===52800);
});
