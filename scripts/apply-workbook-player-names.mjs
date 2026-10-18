import { readFile, writeFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { nameImportFetch } from './lib/korean-catalog.mjs';
import { applyWorkbookNames } from './lib/workbook-player-names.mjs';

nextEnv.loadEnvConfig(process.cwd());
try {
  const data=JSON.parse(await readFile(new URL('../data/localization/players.workbook.ko.json',import.meta.url),'utf8'));
  const url=(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url||!key)throw new Error('SERVER_CONFIGURATION_MISSING');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:nameImportFetch(key)}});
  const report=await applyWorkbookNames(db,data,{apply:process.argv.includes('--apply'),emit:value=>console.log(JSON.stringify(value))});
  const path=process.argv.find(arg=>arg.startsWith('--report='))?.slice('--report='.length);
  if(path)await writeFile(path,JSON.stringify(report,null,2)+'\n');
  if(report.failures.length||report.verificationFailures.length)process.exitCode=1;
} catch(error) {
  console.error(JSON.stringify({error:error.code||'WORKBOOK_NAME_IMPORT_FAILED',message:error.message==='SERVER_CONFIGURATION_MISSING'?'Missing server Supabase configuration':'Name import failed; completed rows are safe to rerun'}));
  process.exitCode=1;
}
