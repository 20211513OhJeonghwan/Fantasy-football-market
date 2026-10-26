import { discoverClubCompetitions, DOMESTIC_LEAGUE_IDS } from './competitions.mjs';
import { processBulkTask } from './bulk-plan.mjs';
import { checked, errorCode } from './automatic-football.mjs';
/** Separate persistent queue: a cup backfill resumes across midnight and runner restarts.
 * Current domestic rosters remain the only authority for market membership. */
export async function runClubCollection(db,api,claim,deadline,emit=()=>{}) {
  const policy=checked(await db.from('kickx_policy').select('club_competitions_enabled').single());
  if(!policy.club_competitions_enabled)return {enabled:false};
  if(api.remaining!=null && api.remaining<1500)return {enabled:true,deferred:'PROVIDER_BUDGET_RESERVED_FOR_NEW_MATCHES'};
  const scope=checked(await db.from('teams').select('external_id').eq('provider','bsd').in('league_id',DOMESTIC_LEAGUE_IDS.map(id=>`bsd-${id}`))).map(t=>Number(t.external_id));
  if(!scope.length)throw new Error('DOMESTIC_SCOPE_UNAVAILABLE');
  const cached=checked(await db.from('club_competition_discovery').select('*').maybeSingle());
  const discovery=cached?.day===claim.day?cached.payload:await discoverClubCompetitions(api);
  if(cached?.day!==claim.day)checked(await db.from('club_competition_discovery').upsert({singleton:true,day:claim.day,payload:discovery}));
  const {found,missing}=discovery;
  const backfills=checked(await db.from('club_competition_backfills').select('league_id,season_id'));
  const tasks=found.map(l=>({key:`club:league:${l.id}`,kind:'league',priority:0,label:l.name,payload:{league:l.id,displayName:l.name,phase:'detail',automatic:true,supplemental:true,scopeTeamIds:scope,backfilledSeasonIds:backfills.filter(b=>b.league_id===`bsd-${l.id}`).map(b=>Number(b.season_id))}}));
  // Revisit old missing/corrected matches too; the calendar's seven-day window is not a cutoff.
  if(found.length){
    const retries=checked(await db.from('automatic_fixture_checks').select('fixture_id,fixtures!inner(external_id,league_id,provider_season_id,season,starts_at,status)').in('fixtures.league_id',found.map(l=>`bsd-${l.id}`)).in('fixtures.status',['FT','AET','PEN']).lte('retry_at',new Date().toISOString()).order('checked_at').limit(3));
    for(const row of retries){const f=row.fixtures;tasks.push({key:`club:retry:${f.external_id}`,kind:'match',priority:39,label:'컵대회 기록 재확인',payload:{context:{league:Number(f.league_id.slice(4)),seasonId:Number(f.provider_season_id),seasonYear:f.season,supplemental:true,scopeTeamIds:scope},eventId:Number(f.external_id),phase:'detail',refresh:true}});}
  }
  checked(await db.rpc('kickx_club_seed',{p_token:claim.token,p_tasks:tasks}));
  let completed=0,rows=0,failed=0;
  while(Date.now()<deadline){
    if(api.remaining!=null && api.remaining<1500)break;
    const jobs=checked(await db.from('club_collection_tasks').select('key,kind,priority,payload,label').eq('completed',false).lte('retry_at',new Date().toISOString()).order('priority').order('key').limit(1));
    if(!jobs.length)break;
    const job=jobs[0];
    try {
      const outcome=await processBulkTask(api,job,new Date().toISOString().slice(0,10));
      rows+=checked(await db.rpc('kickx_club_finish',{p_token:claim.token,p_key:job.key,p_outcome:outcome}));
      if(outcome.done)completed++;
    } catch(e){
      const code=errorCode(e);failed++;
      checked(await db.rpc('kickx_club_fail',{p_token:claim.token,p_key:job.key,p_error:code}));
      emit({stage:'club-task',competition:job.payload.league??job.payload.context?.league,error:code});
      if(/BUDGET|QUOTA|RATE_LIMIT/.test(code))break;
    }
    if(completed && completed%10===0)emit({stage:'clubs',completed,requests:api.requests});
  }
  return {enabled:true,competitions:found.map(l=>({id:l.id,name:l.name})),unavailable:missing,completed,rows,failed};
}
