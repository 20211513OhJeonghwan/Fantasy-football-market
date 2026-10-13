import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const db=new PGlite();
try {
 await db.exec(await readFile('tests/database-bootstrap.sql','utf8'));
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {await db.exec(await readFile('supabase/migrations/'+f,'utf8'));console.log('migration',f);}
 await db.exec('update public.kickx_policy set club_competitions_enabled=false');
 for(const f of (await readdir('tests')).filter(f=>/^database-(?!bootstrap).*\.sql$/.test(f)).sort()) {await db.exec(await readFile('tests/'+f,'utf8'));console.log('passed',f);}
} catch(error) {console.error(error.message, error.code, error.where ?? "");process.exitCode=1;} finally {await db.close();}
