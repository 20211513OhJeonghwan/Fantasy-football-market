import { startBulkRun, controlBulkRun, stepBulkRun, readBulkState } from "./bulk-sync.mjs";
import { SyncError } from "./football.mjs";

export function parseBulkArgs(args) {
  if (args.some(arg => !["--status", "--resume", "--once"].includes(arg)) || new Set(args).size !== args.length || (args.includes("--status") && args.length !== 1)) throw new SyncError("USAGE_ALL_STATUS_OR_RESUME");
  return { status: args.includes("--status"), resume: args.includes("--resume"), once: args.includes("--once") };
}

export async function runBulkCli(db, key, args, { emit, stopped = () => false, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), step = stepBulkRun } = {}) {
  if (args.status) { emit(await readBulkState(db)); return 0; }
  const run = await startBulkRun(db);
  emit({ run, scope: "big-five-current-season", manual: true, once: args.once });
  if (args.resume) {
    const state = await controlBulkRun(db, run, "resume");
    emit({ run, action: "resume", state });
    if (state !== "running") { emit(await readBulkState(db)); return state === "completed" ? 0 : 2; }
  }
  while (!stopped()) {
    const result = await step(db, run, key);
    if (result.state !== "wait") emit({ run, ...result });
    if (["completed", "paused", "cancelled", "busy"].includes(result.state) || (args.once && result.state !== "wait")) break;
    await wait(1200);
  }
  if (stopped()) await controlBulkRun(db, run, "pause");
  const state = await readBulkState(db);
  emit(state);
  return state.latest?.status === "completed" || (args.once && state.latest?.status === "running") ? 0 : 2;
}
