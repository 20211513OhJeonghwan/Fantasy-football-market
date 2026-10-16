/** BSD transport and provider-neutral contract. Server/CLI only. */
import { parseList } from "structured-headers";
export class SyncError extends Error {
  constructor(code, details={}) { super(code); this.code=code; Object.assign(this,details); }
}
const HOST="https://sports.bzzoiro.com";
export const externalId=value=>{
  if(!Number.isSafeInteger(value) || value<1) throw new SyncError("INVALID_EXTERNAL_ID");
  return `bsd-${value}`;
};
const name=value=>{if(typeof value!=="string" || !value.trim()) throw new SyncError("INVALID_NAME");return value.trim();};
const number=value=>{if(value==null) return null;if(!Number.isSafeInteger(value) || value<0) throw new SyncError("INVALID_NUMBER");return value;};
const date=value=>{if(typeof value!=="string" || !Number.isFinite(Date.parse(value))) throw new SyncError("INVALID_DATE");return new Date(value).toISOString();};
const position=value=>({G:"GK",D:"DF",M:"MF",F:"FW"})[value] ?? null;
export const emptyBatch=()=>({provider:"bsd",leagues:[],coverage:[],teams:[],players:[],fixtures:[],matches:[],sources:[]});
export const imageUrl=id=>`${HOST}/img/player/${externalId(id).slice(4)}/?sor=true&bg=transparent`;
const team=(raw,leagueId)=>({id:externalId(raw.id),external_id:raw.id,name:name(raw.name),code:raw.short_name || null,league_id:leagueId ?? null});
export function normalizePlayer(raw,teamId) {
  const p={id:externalId(raw.id),external_id:raw.id,name:name(raw.name),short_name:raw.short_name || null,
    position:position(raw.position),country:raw.nationality || null,
    birth_date:raw.date_of_birth || null,photo:imageUrl(raw.id)};
  // Only current squad changes membership; historical lineups never do.
  if(teamId!=null) p.team_id=externalId(teamId);
  return p;
}
export function normalizeStatus(raw) {
  if(raw && typeof raw==='object'){
    const status=normalizeStatus(raw.status);
    if(['FT','AET','PEN'].includes(status)){
      if(raw.penalty_shootout!=null)return 'PEN';
      if(raw.extra_time_score!=null)return 'AET';
    }
    return status;
  }
  const status=String(raw).toLowerCase();
  if(["finished","ft"].includes(status)) return "FT";
  if(["aet","after_extra_time"].includes(status)) return "AET";
  if(["penalties","after_penalties","pen"].includes(status)) return "PEN";
  if(["upcoming","notstarted","ns"].includes(status)) return "NS";
  if(["live","inprogress","1st_half","halftime","2nd_half","extra_time","penalty_shootout"].includes(status)) return "LIVE";
  return ({postponed:"PST",cancelled:"CANC",unresolved:"UNRESOLVED"})[status] ?? "UNKNOWN";
}
export function normalizeBatch(task,response,context={}) {
  const batch=emptyBatch(),leagueId=externalId(context.league);
  if(task==="leagues") {
    if(response.id!==context.league || response.season.league_id!==context.league) throw new SyncError("UNEXPECTED_LEAGUE");
    const selected=response.season.seasons.find(s=>s.id===context.seasonId);
    if(!selected || !Number.isInteger(selected.year)) throw new SyncError("SEASON_NOT_AVAILABLE");
    batch.leagues.push({id:leagueId,external_id:context.league,name:name(response.name)});
    batch.coverage.push({league_id:leagueId,season:selected.year,provider_season_id:selected.id,coverage:{source:"bsd",season:selected}});
  } else if(task==="teams") {
    for(const raw of response) batch.teams.push(team(raw,leagueId));
  } else if(task==="squads") {
    if(response.team_id!==context.teamId || !Array.isArray(response.players) || response.count!==response.players.length) throw new SyncError("UNEXPECTED_TEAM");
    batch.players=response.players.map(p=>normalizePlayer(p,context.teamId));
  } else if(task==="players") {
    for(const raw of response) {
      if(raw.current_team_id!==context.teamId) throw new SyncError("UNEXPECTED_TEAM");
      batch.players.push(normalizePlayer(raw,context.teamId));
    }
  } else if(task==="fixtures") {
    for(const raw of response) {
      if(raw.league_id!==context.league || raw.season_id!==context.seasonId) throw new SyncError("UNEXPECTED_FIXTURE_CONTEXT");
      const home=team({id:raw.home_team_id,name:raw.home_team},null),away=team({id:raw.away_team_id,name:raw.away_team},null);
      batch.teams.push(home,away);
      const homeScore=number(raw.home_score),awayScore=number(raw.away_score);
      batch.fixtures.push({id:externalId(raw.id),external_id:raw.id,league_id:leagueId,home_team_id:home.id,away_team_id:away.id,
        starts_at:date(raw.event_date),status:normalizeStatus(raw),season:context.seasonYear,provider_season_id:context.seasonId,
        stage:typeof raw.stage==='string'?raw.stage:null,round_label:typeof raw.round_label==='string'?raw.round_label:null,
        penalties_home:number(raw.penalty_shootout?.home),penalties_away:number(raw.penalty_shootout?.away),
        home_score:homeScore==null ? null : homeScore+(number(raw.extra_time_score?.home) ?? 0),
        away_score:awayScore==null ? null : awayScore+(number(raw.extra_time_score?.away) ?? 0)});
      batch.sources.push({fixture_id:externalId(raw.id),detail:raw});
    }
  } else throw new SyncError("UNKNOWN_TASK");
  batch.teams=[...new Map(batch.teams.map(row=>[row.id,row])).values()];
  return batch;
}
const statFields={minutes:"minutes_played",goals:"goals",assists:"goal_assist",shots_on_target:"shots_on_target",key_passes:"key_pass",
  passes_attempted:"total_pass",passes_completed:"accurate_pass",crosses_completed:"accurate_cross",tackles_won:"won_tackle",
  interceptions:"interception",saves:"saves",yellow_cards:"yellow_card",red_cards:"red_card",provider_goals_conceded:"goals_conceded"};
export function normalizeStats(raw,legacy) {
  const values={},quality={};
  for(const [internal,field] of Object.entries(statFields)) {
    const value=number(raw[field]);
    // BSD documents default zero for unreported counters. Keep the exact zero in raw_stats.
    values[internal]=value===0 ? null : value;
    quality[internal]=value==null ? "missing" : value===0 ? "unverified_zero" : "reported";
  }
  const penalty=number(legacy?.penalty_save);
  values.penalty_saves=penalty===0 ? null : penalty;
  quality.penalty_saves=penalty==null ? "missing" : penalty===0 ? "unverified_zero" : "legacy_v1";
  values.pass_accuracy=values.passes_attempted && values.passes_completed!=null ? 100*values.passes_completed/values.passes_attempted : null;
  if(values.passes_completed!=null && values.passes_attempted!=null && values.passes_completed>values.passes_attempted) throw new SyncError("INVALID_PASS_TOTALS");
  // Participation intervals, own goals and card reconciliation are deferred, never guessed.
  values.own_goals=null; values.goals_conceded_on_pitch=null; values.clean_sheet=null;
  return {version:"bsd-v1",values,quality,calculation_ready:false};
}
export function normalizeMatchBundle({detail,stats,lineups,incidents,legacy=[],profiles=[]},context) {
  const event=detail.id;
  for(const resource of [stats,lineups,incidents]) if(resource.event_id!==event) throw new SyncError("UNEXPECTED_EVENT");
  if(!Array.isArray(stats.player_stats) || stats.count!==stats.player_stats.length || !Array.isArray(incidents.incidents)) throw new SyncError("INVALID_MATCH_STATISTICS");
  if(!["FT","AET","PEN"].includes(normalizeStatus(detail.status))) throw new SyncError("MATCH_NOT_FINISHED");
  const batch=normalizeBatch("fixtures",[detail],context),players=new Map(profiles.map(p=>[p.id,p]));
  if(lineups.lineup_status==="confirmed") for(const side of Object.values(lineups.lineups ?? {})) {
    if(![detail.home_team_id,detail.away_team_id].includes(side.team_id)) throw new SyncError("UNEXPECTED_FIXTURE_TEAM");
    for(const p of [...side.players,...side.substitutes]) if(p.id!=null) players.set(p.id,p);
  }
  const supplemental=new Map();
  for(const row of legacy) {
    if(row.event?.id!==event || !row.player?.id || supplemental.has(row.player.id)) throw new SyncError("INVALID_LEGACY_STATISTICS");
    supplemental.set(row.player.id,row);
  }
  const seen=new Set();
  for(const raw of stats.player_stats) {
    if(raw.event_id!==event || seen.has(raw.player_id)) throw new SyncError("INVALID_MATCH_STATISTICS");
    seen.add(raw.player_id);
    if(![detail.home_team_id,detail.away_team_id].includes(raw.team_id)) throw new SyncError("UNEXPECTED_FIXTURE_TEAM");
    const profile=players.get(raw.player_id);
    if(!profile) throw new SyncError("MISSING_PLAYER_PROFILE");
    batch.players.push(normalizePlayer(profile));
    const old=supplemental.get(raw.player_id),normalized=normalizeStats(raw,old);
    batch.matches.push({player_id:externalId(raw.player_id),fixture_id:externalId(event),team_id:externalId(raw.team_id),stats:raw,legacy_stats:old ?? null,normalized});
  }
  batch.sources=[{fixture_id:externalId(event),detail,player_stats:stats,lineups,incidents,legacy_stats:legacy}];
  return batch;
}
export function createFootballClient({key,budget=10,delay=1100,timeoutMs=20000,fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
  let requests=0,remaining=null;
  const checkedUrl=endpoint=>{
    const url=new URL(endpoint,HOST);
    if(url.origin!==HOST || url.username || url.password || !/^\/api\/(v2\/|player-stats\/)/.test(url.pathname)) throw new SyncError("INVALID_API_HOST");
    return url;
  };
  const client={
    get requests(){return requests;},get remaining(){return remaining;},
    async get(endpoint,params={}) {
      const url=checkedUrl(endpoint);
      if(!key) throw new SyncError("MISSING_API_KEY");
      for(const [k,v] of Object.entries(params)) if(v!=null) url.searchParams.set(k,String(v));
      for(let attempt=0;attempt<3;attempt++) {
        if(requests>=budget) throw new SyncError("RUN_BUDGET_REACHED");
        if(remaining!=null && remaining<=0) throw new SyncError("DAILY_QUOTA_REACHED");
        if(requests) await wait(delay*(attempt+1));
        requests++;
        let response;
        try { response=await fetchImpl(url,{headers:{Authorization:`Token ${key}`},signal:AbortSignal.timeout(timeoutMs),redirect:"error"}); }
        catch(error) {if(error instanceof SyncError) throw error;if(attempt<2) continue;throw new SyncError("PROVIDER_NETWORK_ERROR");}
        const quota=response.headers.get("ratelimit");
        if(quota!=null) {
          try {
            const entry=parseList(quota).find(([scope])=>scope==="football");
            const value=entry?.[1].get("r");
            if(Number.isSafeInteger(value) && value>=0) remaining=value;
          } catch {throw new SyncError("INVALID_QUOTA_HEADER");}
        }
        if(response.status===429) {
          const retry=response.headers.get("retry-after");
          const seconds=retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000)) : null;
          let exhausted=remaining===0;
          try {const body=await response.json();exhausted ||= body.code==="taster_exhausted";} catch { /* Only known quota codes are read; body never logged. */ }
          throw new SyncError(exhausted ? "DAILY_QUOTA_REACHED" : "PROVIDER_RATE_LIMIT",{retryAfterSeconds:Number.isFinite(seconds) ? seconds : null});
        }
        if(response.status>=500 && attempt<2) continue;
        if(!response.ok) throw new SyncError(`PROVIDER_HTTP_${response.status}`);
        let body;
        try {body=await response.json();} catch {throw new SyncError("INVALID_PROVIDER_JSON");}
        if(!body || typeof body!=="object" || body.detail || body.error) throw new SyncError("PROVIDER_REJECTED_REQUEST");
        return body;
      }
    },
    async page(endpoint,params={},version="v2") {
      const body=await client.get(endpoint,params);
      if(!Array.isArray(body.results) || !Number.isSafeInteger(body.count) || body.count<0) throw new SyncError("INVALID_PROVIDER_ENVELOPE");
      let next=null;
      if(body.next!=null) {
        const url=checkedUrl(body.next),origin=checkedUrl(endpoint);
        if(url.pathname!==origin.pathname) throw new SyncError("INVALID_PROVIDER_NEXT");
        for(const [k,v] of Object.entries(params)) if(!["page","offset","limit"].includes(k) && url.searchParams.get(k)!==String(v)) throw new SyncError("INVALID_PROVIDER_NEXT");
        const field=version==="v1" ? "page" : "offset",value=url.searchParams.get(field);
        if(!/^\d+$/.test(value ?? "") || Number(value)<=Number(params[field] ?? (version==="v1" ? 1 : 0))) throw new SyncError("INVALID_PROVIDER_NEXT");
        next=Number(value);
      }
      return {results:body.results,count:body.count,next};
    }
  };
  return client;
}
export function parseSyncArgs(args) {
  const [task,...rest]=args;
  if(!["discover","seasons","leagues","teams","players","squads","fixtures","matches"].includes(task)) throw new SyncError("USAGE_TASK");
  const opts={};
  for(const arg of rest) {
    const m=/^--([a-z-]+)=(.+)$/.exec(arg);
    if(arg==="--dry-run" && !opts.dryRun) opts.dryRun=true;
    else if(m && ["league","season-id","team","fixture","offset","pages","limit","budget","from","to"].includes(m[1]) && !(m[1] in opts)) opts[m[1]]=m[2];
    else throw new SyncError("USAGE_OPTION");
  }
  const integer=(key,fallback,max,min=1)=>{
    const raw=opts[key] ?? fallback;
    if(!/^\d+$/.test(String(raw)) || Number(raw)<min || Number(raw)>max) throw new SyncError(`USAGE_${key.toUpperCase().replaceAll("-","_")}`);
    return Number(raw);
  };
  const result={task,offset:integer("offset",0,10000000,0),pages:integer("pages",1,100),limit:integer("limit",50,200),budget:integer("budget",10,500),dryRun:["discover","seasons"].includes(task) || !!opts.dryRun};
  if(task!=="discover") result.league=integer("league",null,100000000);
  if(!["discover","seasons"].includes(task)) result.seasonId=integer("season-id",null,100000000);
  if(["squads","players"].includes(task)) result.teamId=integer("team",null,100000000);
  if(task==="matches") result.fixtureId=integer("fixture",null,100000000);
  if(task==="fixtures") {
    for(const key of ["from","to"]) {
      const v=opts[key];
      if(!/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10)!==v) throw new SyncError("USAGE_DATE_WINDOW");
      result[key]=v;
    }
    if(Date.parse(result.to)<Date.parse(result.from) || Date.parse(result.to)-Date.parse(result.from)>31*86400000) throw new SyncError("USAGE_DATE_WINDOW");
  }
  if(["seasons","leagues","squads","matches"].includes(task) && (result.offset || result.pages!==1)) throw new SyncError("TASK_NOT_PAGINATED");
  return result;
}
