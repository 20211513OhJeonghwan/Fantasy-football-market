import { normalizeBatch, normalizeMatchBundle, SyncError } from "./football.mjs";
/** Dependency-injected runner: a match bundle is saved only after all resources are fetched. */
export async function runFootballSync(api,options,{save=async()=>{},progress=async()=>{}}={}) {
  let nextOffset=options.offset;
  const persist=async batch=>{await save(batch);};
  if(options.task==="seasons") {
    const result=await api.get(`/api/v2/leagues/${options.league}/seasons/`);
    if(result.league_id!==options.league || !Array.isArray(result.seasons)) throw new SyncError("UNEXPECTED_LEAGUE");
    await progress({nextOffset:null,seasons:result.seasons});
    return {nextOffset:null};
  }
  if(options.task==="discover") {
    for(let page=0;page<options.pages;page++) {
      const result=await api.page("/api/v2/leagues/",{limit:options.limit,offset:nextOffset,is_women:false});
      nextOffset=result.next;
      await progress({nextOffset,leagues:result.results.map(l=>({id:l.id,name:l.name,country:l.country,currentSeason:l.current_season}))});
      if(nextOffset==null) break;
    }
    return {nextOffset};
  }
  const detail=await api.get(`/api/v2/leagues/${options.league}/`);
  const season=await api.get(`/api/v2/leagues/${options.league}/seasons/`);
  const initial=normalizeBatch("leagues",{...detail,season},options);
  const context={...options,seasonYear:initial.coverage[0].season};
  if(options.task==="leagues") {await persist(initial);return {nextOffset:null};}
  if(["players","squads"].includes(options.task)) {
    // Confirm club membership against this league/season; never trust an arbitrary team id.
    let offset=0,found=false;
    do {
      const teams=await api.page("/api/v2/teams/",{league_id:options.league,season_id:options.seasonId,limit:200,offset});
      const raw=teams.results.find(t=>t.id===options.teamId);
      if(raw) { initial.teams.push(...normalizeBatch("teams",[raw],context).teams);found=true;break; }
      offset=teams.next;
    } while(offset!=null);
    if(!found) throw new SyncError("TEAM_NOT_IN_LEAGUE_SEASON");
  }
  if(options.task==="matches") {
    const fixture=await api.get(`/api/v2/events/${options.fixtureId}/`);
    if(fixture.id!==options.fixtureId) throw new SyncError("UNEXPECTED_EVENT");
    // Check context and lifecycle before spending the sub-resource calls.
    normalizeBatch("fixtures",[fixture],context);
    if(!["finished","aet","after_extra_time","penalties","after_penalties","ft","pen"].includes(String(fixture.status).toLowerCase())) throw new SyncError("MATCH_NOT_FINISHED");
    const stats=await api.get(`/api/v2/events/${options.fixtureId}/player-stats/`);
    const lineups=await api.get(`/api/v2/events/${options.fixtureId}/lineups/`);
    const incidents=await api.get(`/api/v2/events/${options.fixtureId}/incidents/`);
    const legacy=[];
    let page=1;
    do {
      const result=await api.page("/api/player-stats/",{event:options.fixtureId,page},"v1");
      legacy.push(...result.results);page=result.next;
    } while(page!=null);
    const known=new Set();
    if(lineups.lineup_status==="confirmed") for(const side of Object.values(lineups.lineups ?? {})) {
      for(const p of [...side.players,...side.substitutes]) known.add(p.id);
    }
    const profiles=[];
    if(!Array.isArray(stats.player_stats)) throw new SyncError("INVALID_MATCH_STATISTICS");
    for(const id of new Set(stats.player_stats.map(p=>p.player_id))) if(!known.has(id)) {
      const p=await api.get(`/api/v2/players/${id}/`);
      if(p.id!==id) throw new SyncError("UNEXPECTED_PLAYER");
      profiles.push(p);
    }
    const batch=normalizeMatchBundle({detail:fixture,stats,lineups,incidents,legacy,profiles},context);
    batch.leagues=initial.leagues;batch.coverage=initial.coverage;
    await persist(batch);await progress({nextOffset:null});
    return {nextOffset:null};
  }
  if(options.task==="squads") {
    const raw=await api.get(`/api/v2/teams/${options.teamId}/squad/`);
    const batch=normalizeBatch("squads",raw,context);
    batch.leagues=initial.leagues;batch.coverage=initial.coverage;batch.teams=initial.teams;
    await persist(batch);return {nextOffset:null};
  }
  await persist(initial);
  const endpoints={teams:"/api/v2/teams/",players:"/api/v2/players/",fixtures:"/api/v2/events/"};
  for(let page=0;page<options.pages;page++) {
    await progress({nextOffset});
    const params={limit:options.limit,offset:nextOffset};
    if(options.task==="players") params.team_id=options.teamId;
    else Object.assign(params,{league_id:options.league,season_id:options.seasonId});
    if(options.task==="fixtures") Object.assign(params,{date_from:options.from,date_to:options.to});
    const response=await api.page(endpoints[options.task],params);
    await persist(normalizeBatch(options.task,response.results,context));
    nextOffset=response.next;
    await progress({nextOffset,count:response.count});
    if(nextOffset==null) break;
  }
  return {nextOffset};
}
export const batchRowCount=batch=>Object.entries(batch).reduce((n,[,v])=>n+(Array.isArray(v) ? v.length : 0),0);
export const pausedError=code=>["RUN_BUDGET_REACHED","DAILY_QUOTA_REACHED","PROVIDER_RATE_LIMIT"].includes(code);
