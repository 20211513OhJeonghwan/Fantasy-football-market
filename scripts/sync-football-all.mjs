import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { bulkErrorDetails } from "./lib/bulk-sync.mjs";
import { parseBulkArgs, runBulkCli } from "./lib/bulk-cli.mjs";
import { SyncError } from "./lib/football.mjs";

nextEnv.loadEnvConfig(process.cwd());
try {
  const args = parseBulkArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const key = process.env.BSD_API_KEY?.trim();
  if (!url || !secret || new URL(url).protocol !== "https:") throw new SyncError("MISSING_INGESTION_DATABASE_CONFIG");
  if (!key && !args.status) throw new SyncError("MISSING_API_KEY");
  const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  let stopped = false;
  process.once("SIGINT", () => { stopped = true; });
  process.exitCode = await runBulkCli(db, key, args, { emit: value => console.log(JSON.stringify(value)), stopped: () => stopped });
} catch (error) {
  console.error(JSON.stringify(bulkErrorDetails(error)));
  process.exitCode = 1;
}
