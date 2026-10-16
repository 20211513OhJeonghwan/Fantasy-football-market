import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createFootballClient, parseSyncArgs, SyncError } from "./lib/football.mjs";
import { runFootballSync, batchRowCount, pausedError } from "./lib/sync-runner.mjs";
nextEnv.loadEnvConfig(process.cwd());
let client,jobId,api,nextOffset=null,written=0;
const check=result=>{if(result.error) throw new SyncError("DATABASE_WRITE_FAILED");return result.data;};
try {
  const options=parseSyncArgs(process.argv.slice(2));
  nextOffset=options.offset;
  const key=process.env.BSD_API_KEY?.trim();
  if(!key) throw new SyncError("MISSING_API_KEY");
  if(!options.dryRun) {
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url || !key || new URL(url).protocol!=="https:") throw new SyncError("MISSING_INGESTION_DATABASE_CONFIG");
    client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const job=check(await client.from("football_sync_jobs").insert({provider:"bsd",task:options.task,target:JSON.stringify(options),status:"running",next_offset:options.offset}).select("id").single());
    jobId=job.id;
  }
  api=createFootballClient({key,budget:options.budget});
  const progress=async info=>{
    nextOffset=info.nextOffset;
    if(client) check(await client.from("football_sync_jobs").update({requests:api.requests,rows_written:written,next_offset:nextOffset}).eq("id",jobId));
    console.log(JSON.stringify({provider:"bsd",task:options.task,rows:written,requests:api.requests,remaining:api.remaining,dryRun:options.dryRun,...info}));
  };
  const result=await runFootballSync(api,options,{progress,save:async payload=>{
    written+=client ? check(await client.rpc("apply_bsd_batch",{payload})) : batchRowCount(payload);
  }});
  nextOffset=result.nextOffset;
  const status=nextOffset!=null ? "paused" : "completed";
  if(client) check(await client.from("football_sync_jobs").update({status,finished_at:new Date().toISOString(),requests:api.requests,rows_written:written,next_offset:nextOffset}).eq("id",jobId));
  console.log(JSON.stringify({provider:"bsd",status,jobId,requests:api.requests,rows:written,nextOffset,dryRun:options.dryRun}));
} catch(error) {
  // Never log provider bodies, keys, fetch internals or database errors.
  const code=error instanceof SyncError ? error.code : "SYNC_FAILED";
  const retryAfterSeconds=error instanceof SyncError ? error.retryAfterSeconds ?? null : null;
  if(client && jobId) {
    const result=await client.from("football_sync_jobs").update({status:pausedError(code) ? "paused" : "failed",finished_at:new Date().toISOString(),requests:api?.requests ?? 0,rows_written:written,next_offset:nextOffset,error_code:code,retry_after_seconds:retryAfterSeconds}).eq("id",jobId);
    if(result.error) console.error(JSON.stringify({error:"JOB_STATUS_WRITE_FAILED",jobId}));
  }
  console.error(JSON.stringify({error:code,jobId,requests:api?.requests ?? 0,nextOffset,retryAfterSeconds}));
  process.exitCode=1;
}
