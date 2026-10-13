// Read-only provider audit. Never prints credentials or writes production data.
import { mkdir,writeFile } from 'node:fs/promises';
import { createFootballClient } from './lib/football.mjs';
import { discoverClubCompetitions,DOMESTIC_LEAGUE_IDS } from './lib/competitions.mjs';
import { processBulkTask } from './lib/bulk-plan.mjs';
import { calculatePerformance } from '../server/kickx/engine/performance.ts';
const api=createFootballClient({key:process.env.BSD_API_KEY,budget:150});
const response=await fetch('https://kick-x-test.vercel.app/api/kickx',{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error('PUBLIC_SCOPE_UNAVAILABLE');
const platform=await response.json();
const scopeTeamIds=platform.data.teams.filter(t=>DOMESTIC_LEAGUE_IDS.includes(Number(t.leagueId?.slice(4)))).map(t=>Number(t.id.slice(4)));
if(!scopeTeamIds.length)throw new Error('PUBLIC_SCOPE_UNAVAILABLE');
const discovery=await discoverClubCompetitions(api);
const audit={at:new Date().toISOString(),readOnly:true,scopeTeams:scopeTeamIds.length,discovery,competitions:[]};
for(const l of discovery.found){
 const row={id:l.id,name:l.name};audit.competitions.push(row);
 try{
  const selected=(await api.get(`/api/v2/leagues/${l.id}/season/`)).season;
  row.season=selected;
  if(!selected || selected.end_date<new Date().toISOString().slice(0,10)){row.state='out-of-season';continue;}
  const p=await api.page('/api/v2/events/',{league_id:l.id,season_id:selected.id,status:'finished',limit:200,offset:0});
  row.finished=p.count;
  const selectedFixture=p.results.find(f=>scopeTeamIds.includes(f.home_team_id)||scopeTeamIds.includes(f.away_team_id));
  if(!selectedFixture){row.state='no-tracked-finished-fixture-in-sample';continue;}
  row.fixtureId=selectedFixture.id;
  row.availability=await api.get(`/api/v2/events/${selectedFixture.id}/availability/`);
  let task={kind:'match',payload:{context:{league:l.id,seasonId:selected.id,seasonYear:selected.year,supplemental:true,scopeTeamIds},eventId:selectedFixture.id,phase:'detail'}},result;
  do{result=await processBulkTask(api,task,new Date().toISOString().slice(0,10));if(!result.done)task={...task,payload:result.payload};}while(!result.done);
  if(result.warning){row.state=result.warning;continue;}
  const batch=result.batch,fixture=batch.fixtures[0],source=batch.sources[0];
  const trackedStats=batch.matches.filter(m=>scopeTeamIds.includes(Number(m.team_id.slice(4))));
  const scores=trackedStats.map(m=>calculatePerformance({fixtureId:m.fixture_id,playerId:m.player_id,teamId:m.team_id,status:fixture.status,homeTeam:fixture.home_team_id,awayTeam:fixture.away_team_id,homeScore:fixture.home_score,awayScore:fixture.away_score,stats:m.stats,legacy:m.legacy_stats,source,clubCompetitions:true}));
  row.state='sample-calculated';row.matchStatus=fixture.status;row.players=scores.length;
  row.statuses=Object.fromEntries(['provisional','blocked','not-played','ready'].map(s=>[s,scores.filter(r=>r.status===s).length]));
  row.validScores=scores.filter(s=>s.score!=null).map(s=>s.score);
  row.blockedReasons=[...new Set(scores.filter(s=>s.status==='blocked').flatMap(s=>s.warnings))];
 }catch(e){row.state='sample-error';row.code=typeof e.code==='string'?e.code:'PROVIDER_AUDIT_FAILED';}
 console.log(JSON.stringify(row));
}
audit.requests=api.requests;
await mkdir('test-artifacts',{recursive:true});await writeFile('test-artifacts/competition-audit.json',JSON.stringify(audit,null,2));
console.log(JSON.stringify({readOnly:true,competitions:audit.competitions.length,requests:api.requests,unavailable:discovery.missing}));
