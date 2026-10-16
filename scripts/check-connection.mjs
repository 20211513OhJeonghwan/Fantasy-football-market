import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const result={databaseEnabled:process.env.KICKX_DATABASE_ENABLED === "true",publicConfig:!!url && !!key,ingestionKey:!!process.env.SUPABASE_SERVICE_ROLE_KEY,footballProvider:"bsd",footballKey:!!process.env.BSD_API_KEY,checks:[]};
if(url && key) {
  try {
    const parsed=new URL(url);
    if(parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost","127.0.0.1"].includes(parsed.hostname))) throw new Error("Invalid URL");
    const client=createClient(parsed.origin,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
    for(const table of ["leagues","teams","players","fixtures","player_catalog","fixture_catalog","player_season_summaries"]) {
      const response=await client.from(table).select("id",{head:true,count:"exact"});
      result.checks.push({table,ok:!response.error,rows:response.error ? null : response.count});
    }
    const bsdView=await client.from("player_catalog").select("id,provider,photo,stats_scope,matches_imported",{head:true,count:"exact"}).eq("provider","bsd");
    result.checks.push({bsdMigration:!bsdView.error,ok:!bsdView.error,bsdPlayers:bsdView.error ? null : bsdView.count});
    const response=await fetch(new URL("/auth/v1/settings",parsed.origin),{headers:{apikey:key},signal:AbortSignal.timeout(15000)});
    const settings=response.ok ? await response.json() : null;
    result.checks.push({googleProvider:settings?.external?.google === true});
  } catch {result.checks.push({ok:false,error:"CONNECTION_CHECK_FAILED"});}
}
console.log(JSON.stringify(result,null,2));
if(!result.databaseEnabled || !result.publicConfig || !result.checks.length || result.checks.some(c=>c.ok === false || c.googleProvider === false)) process.exitCode=1;
