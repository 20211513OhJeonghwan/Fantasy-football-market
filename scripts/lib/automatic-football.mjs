import { createFootballClient, externalId, normalizeBatch, normalizeStatus, SyncError } from './football.mjs';
import { BIG_FIVE, initialTasks, processBulkTask } from './bulk-plan.mjs';
import { runClubCollection } from './club-collection.mjs';

export function checked(reply) {
  if (reply.error) {
    if (/^(LOCAL_DAILY_BUDGET|STALE_AUTOMATION_LEASE)$/.test(reply.error.message ?? '')) throw new SyncError(reply.error.message);
    throw new SyncError(['42P01', '42883', 'PGRST202', 'PGRST205'].includes(reply.error.code) ? 'AUTOMATION_MIGRATION_REQUIRED' : 'AUTOMATION_DATABASE_ERROR');
  }
  return reply.data;
}
export const errorCode = e => e instanceof SyncError ? e.code : 'AUTOMATION_PROCESSING_ERROR';
export const dateShift = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
export function needsFixtureCheck(check, now) { return !check || Date.parse(check.retry_at) <= Date.parse(now); }
const ended = status => ['FT', 'AET', 'PEN'].includes(normalizeStatus(status));

async function saveOutcome(db, outcome) {
  if (outcome.batch || outcome.entities?.length || outcome.squadMembership || outcome.leagueMembership)
    return checked(await db.rpc('kickx_apply_automatic_task', { p_outcome: outcome }));
  return 0;
}
async function noteMatch(db, id, starts, now, incomplete = false) {
  const interval = incomplete ? 15 * 60000 : Date.parse(now) - Date.parse(starts) < 6 * 3600000 ? 60 * 60000 : 6 * 3600000;
  checked(await db.from('automatic_fixture_checks').upsert({ fixture_id: externalId(id), checked_at: now, retry_at: new Date(Date.parse(now) + interval).toISOString() }));
}
export async function runDailyCollection(db, api, claim, deadline, emit = value => { void value; }) {
  checked(await db.rpc('kickx_automatic_daily_start', { p_token: claim.token, p_tasks: initialTasks().map(t => ({ ...t, payload: { ...t.payload, automatic: true } })) }));
  let completed = 0, rows = 0;
  while (Date.now() < deadline) {
    const tasks = checked(await db.from('automation_daily_tasks').select('key,kind,priority,payload,label').eq('day', claim.day).eq('completed', false).order('priority').order('key').limit(1));
    if (!tasks.length) return { completed, rows, done: true };
    const task = tasks[0];
    const outcome = await processBulkTask(api, task, claim.day);
    rows += checked(await db.rpc('kickx_automatic_daily_finish_task', { p_token: claim.token, p_key: task.key, p_outcome: outcome }));
    if (outcome.done) {
      completed++;
      if (task.kind === 'match' && task.payload.detail?.event_date) await noteMatch(db, task.payload.eventId, task.payload.detail.event_date, new Date().toISOString(), !!outcome.warning);
    }
    if (completed && completed % 25 === 0) emit({ stage: 'daily', completed, requests: api.requests });
  }
  return { completed, rows, done: false };
}
export async function pollFinishedMatches(db, api, now, deadline = Infinity) {
  const today = now.slice(0, 10), from = dateShift(today, -7);
  const sources = checked(await db.from('football_entity_sources').select('external_id,raw').eq('kind', 'league'));
  let fetched = 0;
  for (const league of BIG_FIVE) {
    const source = sources.find(s => Number(s.external_id) === league.id)?.raw;
    const season = source?.currentSeason?.season;
    if (!season || !season.is_current || season.start_date > today || season.end_date < today) throw new SyncError('CURRENT_SEASON_UNAVAILABLE');
    const context = { league: league.id, seasonId: season.id, seasonYear: season.year, leagueName: source.detail.name };
    let offset = 0;
    do {
      if (Date.now() >= deadline) return fetched;
      const page = await api.page('/api/v2/events/', { league_id: league.id, season_id: season.id, date_from: from, date_to: today, limit: 200, offset });
      await saveOutcome(db, { batch: normalizeBatch('fixtures', page.results, context) });
      const finished = page.results.filter(f => ended(f.status));
      const checks = finished.length ? checked(await db.from('automatic_fixture_checks').select('fixture_id,retry_at').in('fixture_id', finished.map(f => externalId(f.id)))) : [];
      for (const fixture of finished) {
        if (Date.now() >= deadline) return fetched;
        if (!needsFixtureCheck(checks.find(c => c.fixture_id === externalId(fixture.id)), now)) continue;
        let task = { kind: 'match', payload: { context, eventId: fixture.id, phase: 'detail' } }, outcome;
        do {
          outcome = await processBulkTask(api, task, today);
          await saveOutcome(db, outcome);
          if (!outcome.done) task = { ...task, payload: outcome.payload };
        } while (!outcome.done);
        await noteMatch(db, fixture.id, fixture.event_date, now, !!outcome.warning);
        fetched++;
      }
      offset = page.next;
    } while (offset != null);
  }
  return fetched;
}
export async function pollHistoricalCorrections(db,api,now,deadline=Infinity){
  if(api.remaining!=null && api.remaining<1500)return 0;
  const rows=checked(await db.from('automatic_fixture_checks').select('fixture_id,fixtures!inner(external_id,league_id,provider_season_id,season,starts_at,status)').in('fixtures.league_id',BIG_FIVE.map(l=>externalId(l.id))).lt('fixtures.starts_at',new Date(Date.parse(now)-7*86400000).toISOString()).lte('retry_at',now).order('checked_at').limit(4));
  let fetched=0;
  for(const row of rows){
    if(Date.now()>=deadline || api.remaining!=null && api.remaining<1500)break;
    const f=row.fixtures,context={league:Number(f.league_id.slice(4)),seasonId:Number(f.provider_season_id),seasonYear:f.season};
    let job={kind:'match',payload:{context,eventId:Number(f.external_id),phase:'detail'}},outcome;
    do {outcome=await processBulkTask(api,job,now.slice(0,10));await saveOutcome(db,outcome);if(!outcome.done)job={...job,payload:outcome.payload};}while(!outcome.done);
    await noteMatch(db,Number(f.external_id),f.starts_at,now,!!outcome.warning);fetched++;
  }
  return fetched;
}
export async function drainCalculations(db, calculate, deadline, emit = value => { void value; }) {
  let calculated = 0, failed = 0, withheld = 0;
  while (Date.now() < deadline) {
    const rows = checked(await db.from('calculation_queue').select('player_id,revision,players!inner(provider)').eq('players.provider', 'bsd').lte('retry_at', new Date().toISOString()).order('queued_at').order('player_id').limit(45));
    if (!rows.length) break;
    for (let i = 0; i < rows.length && Date.now() < deadline; i += 3) {
      await Promise.all(rows.slice(i, i + 3).map(async row => {
        let error = null;
        try { const result = await calculate(row.player_id); if (result.withheld) { withheld++; error = 'CALCULATION_WITHHELD'; } else calculated++; }
        catch { failed++; error = 'CALCULATION_RETRY'; }
        checked(await db.rpc('kickx_ack_calculation', { p_player: row.player_id, p_revision: row.revision, p_error: error }));
      }));
    }
    emit({ stage: 'calculation', calculated, failed, withheld });
  }
  return { calculated, failed, withheld };
}

/** One runner concurrency group plus a persistent DB lease. Source writes and publication
 * retain the original DB locks/CAS. No browser session or administrator actor is required. */
export async function runAutomaticFootball(db, key, { calculate, mapNames, emit = value => { void value; }, now = new Date().toISOString() }) {
  const claim = checked(await db.rpc('kickx_automation_claim'));
  if (claim.busy) return { busy: true };
  const summary = {}, started = Date.now();
  let daily = false, failure = null;
  const api = createFootballClient({ key, budget: 3000, timeoutMs: 15000, fetchImpl: async (...args) => {
    checked(await db.rpc('kickx_reserve_provider_request'));
    return fetch(...args);
  } });
  try {
    // An unsuccessful daily refresh remains due on the next scheduled run.
    try { if (claim.daily) { summary.daily = await runDailyCollection(db, api, claim, started + 15 * 60000, emit); daily = summary.daily.done; } }
    catch (e) { failure = errorCode(e); emit({ stage: 'daily', error: failure }); }
    try { summary.matches = await pollFinishedMatches(db, api, now, started + 25 * 60000); }
    catch (e) { failure ??= errorCode(e); emit({ stage: 'matches', error: errorCode(e) }); }
    try {summary.historicalCorrections=await pollHistoricalCorrections(db,api,now,started+27*60000);}
    catch(e){failure??=errorCode(e);emit({stage:'historical-corrections',error:errorCode(e)});}
    try { summary.clubs=await runClubCollection(db,api,claim,started+30*60000,emit); }
    catch(e){failure??=errorCode(e);emit({stage:'clubs',error:errorCode(e)});}
    summary.initialized = checked(await db.rpc('kickx_auto_initialize_market'));
    summary.calculation = await drainCalculations(db, calculate, started + 35 * 60000, emit);
    summary.rankings = checked(await db.rpc('kickx_auto_refresh_rankings'));
    // Names cannot block score/price publication. Provider failures are retried later.
    try { if (mapNames && Date.now() - started < 35 * 60000) summary.names = await mapNames(); }
    catch { summary.names = { error: 'NAME_MAPPING_RETRY' }; }
  } catch (e) { failure ??= errorCode(e); }
  summary.requests = api.requests;
  checked(await db.rpc('kickx_automation_finish', { p_token: claim.token, p_daily: daily, p_summary: summary, p_error: failure }));
  emit({ stage: 'completed', ...summary, error: failure });
  if (failure) throw new SyncError(failure);
  return summary;
}
