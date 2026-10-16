import { createClient } from '@supabase/supabase-js';
import { configureMinuteWorker } from './lib/minute-worker-configuration.mjs';
async function main() {
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,bsdKey=process.env.BSD_API_KEY;
  if(!url || !key || !bsdKey)throw new Error('AUTOMATION_CONFIG_REQUIRED');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try {console.log(JSON.stringify(await configureMinuteWorker(db,bsdKey,key)));}
  catch {console.error('MINUTE_WORKER_CONFIGURATION_FAILED');process.exitCode=1;}
}

if(import.meta.url===`file://${process.argv[1]}`)void main();
