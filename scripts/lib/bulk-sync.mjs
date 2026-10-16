import { createFootballClient, SyncError } from "./football.mjs";
import { initialTasks, processBulkTask } from "./bulk-plan.mjs";

const databaseCode = value => typeof value === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(value) ? value : undefined;
const knownDatabaseMessages = ["STALE_BULK_LEASE", "Invalid request count", "Invalid outcome", "Invalid failure", "Invalid action", "Five leagues required", "Invalid initial task", "BSD provider required", "Invalid BSD identity", "Invalid BSD league", "Ambiguous season year", "Unknown BSD season", "Invalid BSD fixture", "Invalid source identity", "Incomplete match snapshot", "Invalid BSD match membership"];
const databaseReasons = new Map(knownDatabaseMessages.map(message => [message, message.toUpperCase().replaceAll(" ", "_")]));
const check = (response, operation) => {
  if (response.error) throw new SyncError(response.error.code === "PGRST202" || response.error.code === "42P01" ? "BULK_MIGRATION_REQUIRED" : "BULK_DATABASE_ERROR", { operation, databaseCode: databaseCode(response.error.code), databaseReason: databaseReasons.get(response.error.message) });
  return response.data;
};
async function databaseCall(operation, request) {
  try { return check(await request(), operation); }
  catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("BULK_DATABASE_ERROR", { operation });
  }
}
/** Deliberately excludes database messages/details/hints, URLs, SQL, bodies and credentials. */
export function bulkErrorDetails(error) {
  const details = { error: error instanceof SyncError ? error.code : "BULK_SYNC_FAILED" };
  if (!(error instanceof SyncError)) return details;
  if (["start_football_bulk", "control_football_bulk", "claim_football_bulk", "finish_football_bulk", "fail_football_bulk", "read_bulk_runs", "read_bulk_current", "read_bulk_warnings"].includes(error.operation)) details.operation = error.operation;
  if (databaseCode(error.databaseCode)) details.databaseCode = error.databaseCode;
  if ([...databaseReasons.values()].includes(error.databaseReason)) details.databaseReason = error.databaseReason;
  if (["league", "teams", "squad", "players", "fixtures", "match"].includes(error.task)) details.task = error.task;
  if (["detail", "seasons", "stats", "lineups", "incidents", "legacy", "profiles"].includes(error.phase)) details.phase = error.phase;
  if (Number.isSafeInteger(error.eventId) && error.eventId > 0) details.eventId = error.eventId;
  if (error.recovery === "wait_for_lease") details.recovery = error.recovery;
  return details;
}
/** @param {import("@supabase/supabase-js").SupabaseClient} db @param {string | null} actor */
export async function startBulkRun(db, actor = null) {
  return databaseCall("start_football_bulk", () => db.rpc("start_football_bulk", { actor, tasks: initialTasks() }));
}
export async function controlBulkRun(db, run, action) {
  return databaseCall("control_football_bulk", () => db.rpc("control_football_bulk", { run, action }));
}
export async function stepBulkRun(db, run, key, options = {}) {
  const claim = await databaseCall("claim_football_bulk", () => db.rpc("claim_football_bulk", { run }));
  if (claim.state !== "claimed") return { state: claim.state };
  const api = createFootballClient({ key, budget: 3, timeoutMs: 8000, ...options });
  try {
    const outcome = await processBulkTask(api, claim.task, claim.today);
    await databaseCall("finish_football_bulk", () => db.rpc("finish_football_bulk", { run, token: claim.token, outcome, request_count: api.requests, quota_remaining: api.remaining }));
    return { state: "progress", label: claim.task.label, requests: api.requests, task: claim.task.kind, phase: claim.task.payload.phase ?? null };
  } catch (error) {
    if (error instanceof SyncError) Object.assign(error, { task: claim.task.kind, phase: claim.task.payload.phase, eventId: claim.task.payload.eventId });
    // A lost finish response may follow a committed transaction. Do not mutate its
    // lease again or hide the original error; persisted state recovers after expiry.
    if (error instanceof SyncError && ["BULK_DATABASE_ERROR", "BULK_MIGRATION_REQUIRED"].includes(error.code)) {
      error.recovery = "wait_for_lease";
      throw error;
    }
    const code = error instanceof SyncError ? error.code : "BULK_PROCESSING_ERROR";
    const retry = Number.isSafeInteger(error.retryAfterSeconds) ? Math.min(86400, Math.max(1, error.retryAfterSeconds)) : code === "PROVIDER_RATE_LIMIT" ? 60 : null;
    try {
      await databaseCall("fail_football_bulk", () => db.rpc("fail_football_bulk", { run, token: claim.token, error_code: code, request_count: api.requests, retry_seconds: retry }));
    } catch (pauseError) {
      Object.assign(pauseError, { task: claim.task.kind, phase: claim.task.payload.phase, eventId: claim.task.payload.eventId, recovery: "wait_for_lease" });
      throw pauseError;
    }
    return { state: "paused", error: code };
  }
}

const runColumns = "id,status,started_at,updated_at,finished_at,total_tasks,completed_tasks,warnings,requests,rows_written,error_code,retry_at,remaining,lease_until";
export async function readBulkState(db) {
  const runs = await databaseCall("read_bulk_runs", () => db.from("football_bulk_runs").select(runColumns).order("started_at", { ascending: false }).limit(10));
  const latest = runs[0] ?? null;
  let current = null, warnings = [];
  if (latest) {
    current = (await databaseCall("read_bulk_current", () => db.from("football_bulk_tasks").select("label,kind").eq("run_id", latest.id).eq("completed", false).order("priority").order("id").limit(1)))[0] ?? null;
    warnings = await databaseCall("read_bulk_warnings", () => db.from("football_bulk_tasks").select("label,warning").eq("run_id", latest.id).not("warning", "is", null).order("id").limit(20));
  }
  return { latest, current, warnings, runs };
}
