/** Direct API-SPORTS v3 contract. Used by the CLI and fixture-driven tests. */
export class SyncError extends Error {
  constructor(code) { super(code); this.code=code; }
}
export const externalId=(value)=>{
  if(!Number.isSafeInteger(value) || value < 1) throw new SyncError("INVALID_EXTERNAL_ID");
  return `af-${value}`;
};
const name=value=>{if(typeof value !== "string" || !value.trim()) throw new SyncError("INVALID_NAME");return value;};
const position=value=>({Goalkeeper:"GK",Defender:"DF",Midfielder:"MF",Attacker:"FW",G:"GK",D:"DF",M:"MF",F:"FW"})[value] ?? null;
const numeric=value=>value == null ? null : typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : (()=>{throw new SyncError("INVALID_NUMBER");})();
const date=value=>{if(typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new SyncError("INVALID_DATE");return new Date(value).toISOString();};
const team=(value,league)=>({id:externalId(value.id),external_id:value.id,name:name(value.name),code:value.code ?? null,league_id:league});
const player=(value)=>({id:externalId(value.id),external_id:value.id,name:name(value.name)});
export function normalizeBatch(task,response,{league,season,teamId,fixtureId}={}) {
  const leagueId=externalId(league);
  const batch={leagues:[],coverage:[],teams:[],players:[],seasons:[],fixtures:[],matches:[]};
  if(task === "leagues") {
    for(const item of response) {
      if(item.league?.id !== league) throw new SyncError("UNEXPECTED_LEAGUE");
      const selected=item.seasons?.find(s=>s.year === season);
      if(!selected) throw new SyncError("SEASON_NOT_AVAILABLE");
      batch.leagues.push({id:leagueId,external_id:league,name:name(item.league.name)});
      batch.coverage.push({league_id:leagueId,season,coverage:selected.coverage ?? {}});
    }
    if(!batch.leagues.length) throw new SyncError("SEASON_NOT_AVAILABLE");
  } else if(task === "teams") {
    for(const item of response) batch.teams.push(team(item.team,leagueId));
  } else if(task === "players") {
    for(const item of response) {
      const p=player(item.player);
      p.country=item.player.nationality ?? null;
      p.birth_date=item.player.birth?.date ?? null;
      const stats=item.statistics?.filter(s=>s.league?.id === league && s.league?.season === season);
      if(!Array.isArray(stats) || !stats.length) throw new SyncError("MISSING_SEASON_STATISTICS");
      // Historical season records never replace the current squad membership.
      p.position=position(stats[0].games?.position);
      batch.players.push(p);
      for(const stat of stats) {
        batch.teams.push(team(stat.team,leagueId));
        batch.seasons.push({player_id:p.id,league_id:leagueId,team_id:externalId(stat.team.id),season,stats:stat});
      }
    }
  } else if(task === "squads") {
    for(const item of response) {
      if(item.team?.id !== teamId) throw new SyncError("UNEXPECTED_TEAM");
      batch.teams.push(team(item.team,leagueId));
      for(const raw of item.players ?? []) batch.players.push({...player(raw),team_id:externalId(teamId),position:position(raw.position)});
    }
    if(!response.length) throw new SyncError("MISSING_SQUAD");
  } else if(task === "fixtures") {
    for(const item of response) {
      if(item.league?.id !== league || item.league?.season !== season) throw new SyncError("UNEXPECTED_FIXTURE_CONTEXT");
      const home=team(item.teams.home,leagueId),away=team(item.teams.away,leagueId);
      batch.teams.push(home,away);
      batch.fixtures.push({id:externalId(item.fixture.id),external_id:item.fixture.id,league_id:leagueId,home_team_id:home.id,away_team_id:away.id,
        starts_at:date(item.fixture.date),status:name(item.fixture.status?.short),home_score:numeric(item.goals?.home),away_score:numeric(item.goals?.away),season});
    }
  } else if(task === "matches") {
    for(const item of response) {
      // Fixture ownership and season must be verified from the stored fixture by the runner.
      for(const value of item.players ?? []) {
        const p=player(value.player),stats=value.statistics;
        if(!Array.isArray(stats) || stats.length !== 1) throw new SyncError("INVALID_MATCH_STATISTICS");
        batch.players.push(p);
        batch.matches.push({player_id:p.id,fixture_id:externalId(fixtureId),team_id:externalId(item.team.id),stats:stats[0]});
      }
    }
  } else throw new SyncError("UNKNOWN_TASK");
  for(const key of ["leagues","teams","players"]) batch[key]=[...new Map(batch[key].map(row=>[row.id,row])).values()];
  return batch;
}
export function createFootballClient({key,budget=10,delay=6500,fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
  let requests=0,remaining=null;
  return {
    get requests(){return requests;},get remaining(){return remaining;},
    async get(endpoint,params={}) {
      if(!key) throw new SyncError("MISSING_API_KEY");
      if(requests >= budget) throw new SyncError("RUN_BUDGET_REACHED");
      if(remaining != null && remaining <= 0) throw new SyncError("DAILY_QUOTA_REACHED");
      if(requests) await wait(delay);
      const url=new URL(endpoint,"https://v3.football.api-sports.io");
      if(url.origin !== "https://v3.football.api-sports.io") throw new SyncError("INVALID_API_HOST");
      for(const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
      requests++;
      let response;
      try {response=await fetchImpl(url,{headers:{"x-apisports-key":key},signal:AbortSignal.timeout(20000),redirect:"error"});}
      catch {throw new SyncError("PROVIDER_NETWORK_ERROR");}
      const quota=response.headers.get("x-ratelimit-requests-remaining");
      if(quota != null && /^\d+$/.test(quota)) remaining=Number(quota);
      if(!response.ok) throw new SyncError(response.status === 429 ? "PROVIDER_RATE_LIMIT" : `PROVIDER_HTTP_${response.status}`);
      let body;
      try {body=await response.json();} catch {throw new SyncError("INVALID_PROVIDER_JSON");}
      if(!body || !body.errors || Object.keys(body.errors).length) throw new SyncError("PROVIDER_REJECTED_REQUEST");
      if(!Array.isArray(body.response) || !Number.isInteger(body.paging?.current) || !Number.isInteger(body.paging?.total) || body.paging.current < 1 || body.paging.total < 1 || body.paging.current > body.paging.total) throw new SyncError("INVALID_PROVIDER_ENVELOPE");
      return body;
    }
  };
}
export function parseSyncArgs(args) {
  const task=args.shift();
  if(!["leagues","teams","players","squads","fixtures","matches"].includes(task)) throw new SyncError("USAGE_TASK");
  const opts={};
  for(const arg of args) {
    const match=/^--([a-z-]+)=(.+)$/.exec(arg);
    if(arg === "--dry-run") opts.dryRun=true;
    else if(match && ["league","season","team","fixture","page","pages","budget","from","to"].includes(match[1]) && !(match[1] in opts)) opts[match[1]]=match[2];
    else throw new SyncError("USAGE_OPTION");
  }
  const integer=(key,fallback,max)=>{
    const raw=opts[key] ?? fallback;
    if(!/^\d+$/.test(String(raw)) || Number(raw)<1 || Number(raw)>max) throw new SyncError(`USAGE_${key.toUpperCase()}`);
    return Number(raw);
  };
  const result={task,league:integer("league",null,100000),season:integer("season",null,2100),page:integer("page",1,10000),pages:integer("pages",1,100),budget:integer("budget",10,100),dryRun:!!opts.dryRun};
  if(result.season<2000) throw new SyncError("USAGE_SEASON");
  if(task === "squads") result.teamId=integer("team",null,100000000);
  if(task === "matches") result.fixtureId=integer("fixture",null,100000000);
  if(task === "fixtures") {
    for(const key of ["from","to"]) {
      const value=opts[key];
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) throw new SyncError("USAGE_DATE_WINDOW");
      result[key]=value;
    }
    if(Date.parse(result.to)<Date.parse(result.from) || Date.parse(result.to)-Date.parse(result.from)>31*86400000) throw new SyncError("USAGE_DATE_WINDOW");
  }
  if(task !== "players" && (result.page!==1 || result.pages!==1)) throw new SyncError("PAGING_ONLY_PLAYERS");
  return result;
}
