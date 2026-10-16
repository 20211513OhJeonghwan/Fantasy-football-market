import { createFootballClient, externalId, normalizeBatch, normalizeStatus, SyncError } from './football.mjs';
import { processBulkTask } from './bulk-plan.mjs';
import { checked, errorCode } from './automatic-football.mjs';
import { DOMESTIC_LEAGUE_IDS } from './competitions.mjs';

const FINAL = new Set(['FT','AET','PEN','AWD','WO']);
const add = (at, ms) => new Date(Date.parse(at) + ms).toISOString();
/** Fast near kick-off/end; corrections back off instead of rereading the season. */
export function fixturePollDelay(fixture, now) {
  if (['PST','CANC'].includes(fixture.status)) return 6 * 3600000;
  if (FINAL.has(fixture.status)) {
    const age = fixture.finished_observed_at ? Date.parse(now) - Date.parse(fixture.finished_observed_at) : 0;
    return age < 12 * 60000 ? 2 * 60000 : age < 2 * 3600000 ? 15 * 60000 : 24 * 3600000;
  }
  const elapsed = Date.parse(now) - Date.parse(fixture.starts_at);
  return elapsed < 0 ? 5 * 60000 : elapsed < 4 * 3600000 ? 60000 : elapsed < 12 * 3600000 ? 15 * 60000 : 6 * 3600000;
}
export function leagueContexts(rows, now, clubsEnabled) {
  const today = now.slice(0,10);
  return rows.flatMap(row => {
    const season = row.raw?.currentSeason?.season;
    const id = Number(row.external_id);
    if (!season?.is_current || season.start_date > today || season.end_date < today || !clubsEnabled && !DOMESTIC_LEAGUE_IDS.includes(id)) return [];
    return [{ league:id,seasonId:season.id,seasonYear:season.year,supplemental:!DOMESTIC_LEAGUE_IDS.includes(id) }];
  });
}
async function apply(db, outcome) {
  if (outcome.batch || outcome.entities?.length) checked(await db.rpc('kickx_apply_automatic_task',{p_outcome:outcome}));
}
async function refreshCalendar(db,api,contexts,scope,now,deadline,summary) {
  const checks = checked(await db.from('realtime_calendar_checks').select('*'));
  const context = contexts.filter(c => !checks.some(x => x.league_id === externalId(c.league) && x.season_id === c.seasonId && Date.parse(x.retry_at) > Date.parse(now))).sort((a,b) => Date.parse(checks.find(x=>x.league_id===externalId(a.league))?.retry_at??'1970-01-01')-Date.parse(checks.find(x=>x.league_id===externalId(b.league))?.retry_at??'1970-01-01'))[0];
  if (!context || Date.now() >= deadline) return;
  const previous = checks.find(x => x.league_id === externalId(context.league));
  const offset = previous?.season_id === context.seasonId ? previous.offset_value : 0;
  const page = await api.page('/api/v2/events/',{league_id:context.league,season_id:context.seasonId,date_from:add(now,-86400000).slice(0,10),date_to:add(now,2*86400000).slice(0,10),limit:200,offset});
  const rows = page.results.filter(f => !context.supplemental || scope.includes(f.home_team_id) || scope.includes(f.away_team_id));
  await apply(db,{batch:normalizeBatch('fixtures',rows,context)});
  checked(await db.from('realtime_calendar_checks').upsert({league_id:externalId(context.league),season_id:context.seasonId,season_year:context.seasonYear,offset_value:page.next??0,retry_at:page.next==null?add(now,3600000):now}));
  summary.checked++;summary.calendar++;
}
async function checkFixtures(db,api,contexts,scope,now,deadline,summary) {
  const fixtures = checked(await db.rpc('kickx_realtime_due_fixtures',{p_at:now}));
  if (!fixtures.length) return;
  // Live/new finals have priority over historical corrections.
  fixtures.sort((a,b)=>Number(FINAL.has(a.status))-Number(FINAL.has(b.status)) || Date.parse(b.starts_at)-Date.parse(a.starts_at));
  for (const fixture of fixtures) {
    if (Date.now() >= deadline || summary.checked >= 16) break;
    const context=contexts.find(c=>externalId(c.league)===fixture.league_id && c.seasonId===Number(fixture.provider_season_id));
    if (!context) continue;
    try {
      const detail = await api.get(`/api/v2/events/${fixture.external_id}/`);
      if(detail.id!==Number(fixture.external_id))throw new SyncError('UNEXPECTED_EVENT');
      if(context.supplemental && !scope.some(id=>[detail.home_team_id,detail.away_team_id].includes(id)))continue;
      const batch=normalizeBatch('fixtures',[detail],context);
      await apply(db,{batch});summary.checked++;
      const status=normalizeStatus(detail);
      if(FINAL.has(status)) checked(await db.from('realtime_fixture_tasks').upsert({fixture_id:fixture.id,payload:{context:{...context,scopeTeamIds:scope},eventId:detail.id,phase:'stats',detail},priority:Date.parse(now)-Date.parse(fixture.starts_at)<6*3600000?0:10,retry_at:now,error_code:null}));
      const delay=fixturePollDelay({...fixture,starts_at:batch.fixtures[0].starts_at,status},now);
      checked(await db.from('realtime_fixture_checks').upsert({fixture_id:fixture.id,checked_at:now,retry_at:add(now,delay)}));
    } catch(e) {
      if(/BUDGET|QUOTA|RATE_LIMIT/.test(errorCode(e)))throw e;
      summary.failed++;
      checked(await db.from('realtime_fixture_checks').upsert({fixture_id:fixture.id,checked_at:now,retry_at:add(now,2*60000)}));
    }
  }
}
async function drainMatchTasks(db,api,now,deadline,summary) {
  while(Date.now()<deadline) {
    const jobs=checked(await db.from('realtime_fixture_tasks').select('*').lte('retry_at',now).order('priority').order('retry_at').order('fixture_id').limit(1));
    if(!jobs.length)break;
    const job=jobs[0];
    try {
      const outcome=await processBulkTask(api,{kind:'match',payload:job.payload},now.slice(0,10));
      await apply(db,outcome);
      if(outcome.done) {
        checked(await db.from('realtime_fixture_tasks').delete().eq('fixture_id',job.fixture_id));summary.imported++;
        if(outcome.warning)checked(await db.from('realtime_fixture_checks').update({retry_at:add(now,60000)}).eq('fixture_id',job.fixture_id));
      } else checked(await db.from('realtime_fixture_tasks').update({payload:outcome.payload}).eq('fixture_id',job.fixture_id));
    } catch(e) {
      const code=errorCode(e);
      if(['RUN_BUDGET_REACHED','TICK_TIME_BUDGET'].includes(code))throw e;
      checked(await db.from('realtime_fixture_tasks').update({attempts:job.attempts+1,error_code:code,retry_at:add(now,Math.min(15,job.attempts+1)*60000)}).eq('fixture_id',job.fixture_id));
      if(/BUDGET|QUOTA|RATE_LIMIT/.test(code))throw e;
      summary.failed++;
    }
  }
}
async function calculatePending(db,calculate,deadline,summary) {
  while(Date.now()<deadline) {
    const jobs=checked(await db.from('calculation_queue').select('player_id,revision').lte('retry_at',new Date().toISOString()).order('queued_at',{ascending:false}).order('player_id').limit(8));
    if(!jobs.length)break;
    await Promise.all(jobs.map(async job=>{
      let error=null;
      try { const result=await calculate(job.player_id);if(result.withheld){error='CALCULATION_WITHHELD';summary.withheld++;}else summary.calculated++; }
      catch {error='CALCULATION_RETRY';summary.failed++;}
      checked(await db.rpc('kickx_ack_calculation',{p_player:job.player_id,p_revision:job.revision,p_error:error}));
    }));
  }
}
/** Each request is bounded and resumes match phases from DB. Independent of slow catalog imports.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} key
 * @param {{calculate:(id:string)=>Promise<any>,claim?:{token?:string,now?:string,busy?:boolean},emit?:(value:any)=>void,durationMs?:number,now?:string,api?:any}} options
 */
export async function runRealtimeFootball(db,key,{calculate,claim,emit=()=>{},durationMs=43000,now=claim?.now??new Date().toISOString(),api:injectedApi}={}) {
  const lease=claim??checked(await db.rpc('kickx_realtime_claim'));
  if(lease.busy)return {busy:true,error:null};
  const started=Date.now(),deadline=started+durationMs;
  const summary={checked:0,calendar:0,imported:0,calculated:0,withheld:0,failed:0};let failure=null;
  const api=injectedApi??createFootballClient({key,budget:36,timeoutMs:4000,delay:30,fetchImpl:async(...args)=>{
    if(Date.now()>deadline-10000)throw new SyncError('TICK_TIME_BUDGET');
    checked(await db.rpc('kickx_reserve_provider_request'));return fetch(...args);
  }});
  try {
    const policy=checked(await db.from('kickx_policy').select('club_competitions_enabled').single());
    const rows=checked(await db.from('football_entity_sources').select('external_id,raw').eq('kind','league'));
    const contexts=leagueContexts(rows,now,policy.club_competitions_enabled);
    const scope=checked(await db.from('teams').select('external_id').eq('provider','bsd').in('league_id',DOMESTIC_LEAGUE_IDS.map(externalId))).map(t=>Number(t.external_id));
    // Finish already-started record bundles before discovering more work.
    await drainMatchTasks(db,api,now,Math.min(started+14000,deadline-12000),summary);
    await checkFixtures(db,api,contexts,scope,now,Math.min(started+22000,deadline-10000),summary);
    await drainMatchTasks(db,api,now,Math.min(started+29000,deadline-8000),summary);
    if(summary.checked===0)for(let i=0;i<5 && Date.now()<started+29000;i++)await refreshCalendar(db,api,contexts,scope,now,deadline-10000,summary);
  } catch(e) {
    const code=errorCode(e);
    // A per-tick cap is a normal checkpoint, never a lost task.
    if(!['RUN_BUDGET_REACHED','TICK_TIME_BUDGET'].includes(code))failure=code;
  }
  try {
    await calculatePending(db,calculate,deadline-2000,summary);
    if(summary.calculated && Date.now()<deadline-1000)checked(await db.rpc('kickx_auto_refresh_rankings'));
  } catch(e){failure??=errorCode(e);}
  if(summary.failed>0)failure??='MATCH_RETRY';
  summary.requests=api.requests;
  checked(await db.rpc('kickx_realtime_finish',{p_token:lease.token,p_summary:summary,p_error:failure}));
  emit({stage:'realtime',...summary,error:failure});
  return {...summary,error:failure};
}
