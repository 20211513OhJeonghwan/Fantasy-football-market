import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFootballClient, externalId, normalizeStatus } from './football.mjs';
import { calculatePerformance } from '../../server/kickx/engine/report-performance';
import { validateReportParameters, type ReportParameters } from '../../server/kickx/engine/report-pricing';

type PlayerHistory = {n:number;sum:number;fixtures:string[]};
type Reference = {
 revision:number;status:string;season:number|null;leagueIndex:number;fixtureIndex:number;fixtureCount:number;completed:number;
 leagues:{id:number;seasonId:number;year:number;fixtures:number[]}[];
 players:Record<string,Record<string,PlayerHistory>>;scores:Record<string,number[]>;
 archives:{path:string;hash:string;fixtureId:string;league:number}[];
 groups?:Record<string,{mean:number;lower:number;upper:number;baselines:number[]}>;hash?:string;
};
const leagueIds=[1,3,4,5,6],positions=['GK','DF','MF','FW'];
const checked=<T>(r:{data:T;error:unknown})=>{if(r.error)throw new Error('REFERENCE_DATABASE_RETRY');return r.data;};
const digest=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const quantile=(a:number[],q:number)=>{const sorted=[...a].sort((x,y)=>x-y),at=(sorted.length-1)*q,lo=Math.floor(at);return sorted[lo]+(sorted[Math.ceil(at)]-sorted[lo])*(at-lo);};
export function observedMatchDuration(values:number[]) {
 const plausible=values.filter(v=>Number.isSafeInteger(v)&&v>=90&&v<=180).sort((a,b)=>b-a);
 // Require corroboration: one corrupt 180-minute counter must not define a match's duration.
 return plausible.find(v=>plausible.filter(x=>x>=v-2&&x<=v).length>=2)??90;
}
export function finalizeReference(ref:Reference,p:ReportParameters) {
 validateReportParameters(p);
 if(ref.leagues.length!==5 || ref.completed!==ref.fixtureCount || ref.fixtureCount===0)throw new Error('REFERENCE_INCOMPLETE');
 ref.groups={};
 for(const position of positions){
  const scores=ref.scores[position];
  if(!scores?.length)throw new Error('REFERENCE_POSITION_UNAVAILABLE');
  const mean=Math.round(scores.reduce((s,n)=>s+n,0)/scores.length*1e10)/1e10;
  const baselines=Object.values(ref.players).flatMap(player=>player[position] ? [Math.round((player[position].sum+p.lambda*mean)/(player[position].n+p.lambda)*1e10)/1e10] : []).sort((a,b)=>a-b);
  ref.groups[position]={mean,lower:quantile(scores,p.lowerQuantile),upper:quantile(scores,p.upperQuantile),baselines};
 }
 ref.status='ready';ref.scores={};
 ref.hash=digest(JSON.stringify({season:ref.season,groups:ref.groups,players:ref.players,archives:ref.archives,parameters:p}));
 return ref;
}

/** Full previous season, four resources per fixture; no player-profile calls or raw DB copies.
 * Uses the existing private archive bucket and shared provider budget; resumes between runs.
 */
export async function prepareReportReference(db:SupabaseClient,key:string,{budget=600,deadline=Date.now()+240000,emit=(v:unknown)=>{void v;},runtimeReady=async()=>{const r=await fetch('https://kick-x-test.vercel.app/api/kickx',{method:'HEAD',signal:AbortSignal.timeout(5000),cache:'no-store'});return r.ok && r.headers.get('x-kickx-policy-support')==='report-v3';}}={}) {
 const policyReply=await db.from('kickx_policy').select('version,report_parameters').single();
 if(policyReply.error && ['42703','PGRST204'].includes(policyReply.error.code))return {pending:'MIGRATION_REQUIRED'};
 const policy=checked(policyReply);
 if(!policy)throw new Error("REFERENCE_POLICY_UNAVAILABLE");
 if(policy.version==='report-v3')return {active:true};
 const parameters=policy.report_parameters as ReportParameters;validateReportParameters(parameters);
 const referenceRow=checked(await db.from('kickx_policy').select('report_reference').single());
 if(!referenceRow)throw new Error('REFERENCE_POLICY_UNAVAILABLE');
 const descriptor=referenceRow.report_reference;
 let bucket:ReturnType<typeof db.storage.from>|undefined;
 const archiveBucket=async()=>{
  if(bucket)return bucket;
  let metadata=await db.storage.getBucket('kickx-calculation-archives');
  if(metadata.error && ['400','404'].includes(String(metadata.error.statusCode))){
   await db.storage.createBucket('kickx-calculation-archives',{public:false,fileSizeLimit:20*1024*1024});
   metadata=await db.storage.getBucket('kickx-calculation-archives');
  }
  const meta=checked(metadata);if(!meta || meta.public!==false)throw new Error('REFERENCE_ARCHIVE_MUST_BE_PRIVATE');
  return bucket=db.storage.from('kickx-calculation-archives');
 };
 const uploadVerified=async(path:string,bytes:Uint8Array,hash:string)=>{
  const store=await archiveBucket();const uploaded=await store.upload(path,bytes,{contentType:'application/gzip',upsert:false});
  if(uploaded.error&&!['400','409'].includes(String(uploaded.error.statusCode)))throw new Error('REFERENCE_ARCHIVE_RETRY');
  const restored=checked(await store.download(path));if(!restored || digest(Buffer.from(await restored.arrayBuffer()))!==hash)throw new Error('REFERENCE_ARCHIVE_MISMATCH');
 };
 let checkpointPath:string|null=descriptor?.checkpoint?.path??null;
 let loaded:Reference|undefined;
 if(checkpointPath){
  if(!/^report-reference\/checkpoints\/[a-f0-9]{64}\.json\.gz$/.test(checkpointPath))throw new Error('REFERENCE_CHECKPOINT_INVALID');
  const blob=checked(await (await archiveBucket()).download(checkpointPath));if(!blob)throw new Error('REFERENCE_CHECKPOINT_INVALID');
  const bytes=Buffer.from(await blob.arrayBuffer());if(digest(bytes)!==descriptor.checkpoint.hash)throw new Error('REFERENCE_CHECKPOINT_INVALID');
  loaded=JSON.parse(gunzipSync(bytes,{maxOutputLength:15*1024*1024}).toString());
 }
 const ref:Reference=loaded??descriptor??{revision:0,status:'collecting',season:null,leagueIndex:0,fixtureIndex:0,fixtureCount:0,completed:0,leagues:[],players:{},scores:{},archives:[]};
 let revision=descriptor?.revision??0,dirty=false;
 const save=async()=>{
  if(!dirty)return;
  let value:unknown=ref,newPath:string|null=null;
  if(ref.status!=='ready'){
   const bytes=gzipSync(Buffer.from(JSON.stringify(ref)),{level:9}),hash=digest(bytes);newPath=`report-reference/checkpoints/${hash}.json.gz`;
   await uploadVerified(newPath,bytes,hash);
   value={status:'collecting',season:ref.season,completed:ref.completed,fixtureCount:ref.fixtureCount,checkpoint:{path:newPath,hash}};
  }
  revision=checked(await db.rpc('kickx_save_report_reference',{p_revision:revision,p_reference:value}));ref.revision=revision;dirty=false;
  const previous=checkpointPath;checkpointPath=newPath;
  // Only replaceable progress checkpoints are removed, after a verified upload and successful DB CAS.
  if(previous && previous!==newPath)await (await archiveBucket()).remove([previous]);
 };
 const api=createFootballClient({key,budget,timeoutMs:10000,delay:60,fetchImpl:async(...args:Parameters<typeof fetch>)=>{
  if(Date.now()>deadline-15000)throw new Error('REFERENCE_TIME_SLICE');
  checked(await db.rpc('kickx_reserve_provider_request'));return fetch(...args);
 }});
 const activate=async()=>{
  if(!await runtimeReady())return {pending:'WAITING_FOR_DEPLOYMENT',completed:ref.completed,total:ref.fixtureCount};
  const queued=checked(await db.rpc('kickx_activate_report_policy'));return {active:true,queued,completed:ref.completed};
 };
 try {
  if(ref.status==='ready')return await activate();
  while(ref.leagues.length<5){
   const id=leagueIds[ref.leagues.length];
   const current=await api.get(`/api/v2/leagues/${id}/season/`);
   const archive=await api.get(`/api/v2/leagues/${id}/seasons/`);
   const seasons=Array.isArray(archive)?archive:archive.seasons??archive.results;
   if(!Array.isArray(seasons)||!current.season)throw new Error('REFERENCE_SEASONS_UNAVAILABLE');
   const season=seasons.filter((s:{year:number})=>s.year<current.season.year).sort((a:{year:number},b:{year:number})=>b.year-a.year)[0];
   if(!season || ref.season!=null && ref.season!==season.year)throw new Error('REFERENCE_SEASON_UNAVAILABLE');
   const fixtures:number[]=[];let offset:number|null=0;
   do {
    const page=await api.page('/api/v2/events/',{league_id:id,season_id:season.id,status:'finished',limit:200,offset});
    fixtures.push(...page.results.map((f:{id:number})=>f.id));offset=page.next;
   }while(offset!=null);
   if(!fixtures.length)throw new Error('REFERENCE_SEASON_EMPTY');
   ref.season=season.year;ref.leagues.push({id,seasonId:season.id,year:season.year,fixtures:[...new Set(fixtures)].sort((a,b)=>a-b)});
   ref.fixtureCount+=new Set(fixtures).size;dirty=true;await save();
  }
  await archiveBucket();
  while(ref.leagueIndex<5 && Date.now()<deadline-20000 && api.requests<budget-12){
   if(api.remaining!=null && api.remaining<1500)break;
   if(api.requests%40<4){
    const day=new Date().toISOString().slice(0,10);
    const used=checked(await db.from('football_bulk_daily_budget').select('requests').eq('day',day).maybeSingle());
    if((used?.requests??0)>=5500)break;
   }
   const league=ref.leagues[ref.leagueIndex];
   if(ref.fixtureIndex>=league.fixtures.length){ref.leagueIndex++;ref.fixtureIndex=0;dirty=true;await save();continue;}
   const id=league.fixtures[ref.fixtureIndex],base=`/api/v2/events/${id}/`;
   const detail=await api.get(base),stats=await api.get(base+'player-stats/'),lineups=await api.get(base+'lineups/'),incidents=await api.get(base+'incidents/');
   if(detail.id!==id||detail.league_id!==league.id||detail.season_id!==league.seasonId||!Array.isArray(stats.player_stats)||stats.event_id!==id||lineups.event_id!==id||incidents.event_id!==id)throw new Error('REFERENCE_FIXTURE_MISMATCH');
   const duration=observedMatchDuration(stats.player_stats.map((s:{minutes_played:number})=>s.minutes_played));
   const results=stats.player_stats.map((s:{player_id:number;team_id:number;minutes_played:number})=>{
    const result=calculatePerformance({fixtureId:externalId(id),playerId:externalId(s.player_id),teamId:externalId(s.team_id),status:normalizeStatus(detail),
     homeTeam:externalId(detail.home_team_id),awayTeam:externalId(detail.away_team_id),homeScore:detail.home_score,awayScore:detail.away_score,
     stats:s,legacy:null,source:{detail,lineups,incidents},durationMinutes:duration});
    return {playerId:externalId(s.player_id),...result};
   });
   const bytes=gzipSync(Buffer.from(JSON.stringify({format:'kickx-report-reference-v1',season:ref.season,fixtureId:externalId(id),detail,stats,lineups,incidents,results})),{level:9});
   const hash=digest(bytes),path=`report-reference/${ref.season}/${league.id}/${id}-${hash}.json.gz`;
   await uploadVerified(path,bytes,hash);
   for(const r of results){
    if(r.score==null||!r.position||!['ready','provisional'].includes(r.status))continue;
    const player=ref.players[r.playerId]??={};const own=player[r.position]??={n:0,sum:0,fixtures:[]};
    own.n++;own.sum+=r.score;own.fixtures.push(externalId(id));(ref.scores[r.position]??=[]).push(r.score);
   }
   ref.archives.push({path,hash,fixtureId:externalId(id),league:league.id});ref.completed++;ref.fixtureIndex++;dirty=true;
   if(ref.completed%5===0){await save();emit({stage:'report-reference',completed:ref.completed,total:ref.fixtureCount,requests:api.requests});}
  }
  if(ref.leagueIndex===5){finalizeReference(ref,parameters);dirty=true;}
  await save();
  if(ref.status==='ready')return await activate();
  return {pending:'PREVIOUS_SEASON_COLLECTION',completed:ref.completed,total:ref.fixtureCount,requests:api.requests};
 }catch(error){await save();emit({stage:'report-reference',completed:ref.completed,total:ref.fixtureCount,pending:'REFERENCE_RETRY'});
  // No raw responses, URLs, credentials or network errors enter logs.
  if(error instanceof Error && ['REFERENCE_SEASON_UNAVAILABLE','REFERENCE_SEASONS_UNAVAILABLE','REFERENCE_SEASON_EMPTY'].includes(error.message))return {pending:error.message,completed:ref.completed};
  return {pending:'REFERENCE_RETRY',completed:ref.completed,total:ref.fixtureCount,requests:api.requests};
 }
}
