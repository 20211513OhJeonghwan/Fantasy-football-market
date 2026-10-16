import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
test('minute installer keeps secrets out of cron commands, pins its destination and gates overlapping/unauthenticated work',async()=>{
 const db=new PGlite();
 try {
  // Extension boundaries are replaced by observable local implementations. The
  // production SQL, grants, secret rotation and dispatch logic execute unchanged.
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema vault;create schema net;create schema cron;
   create table vault.decrypted_secrets(id uuid default gen_random_uuid(),name text unique,decrypted_secret text);
   create function vault.create_secret(secret text,label text) returns uuid language sql as 'insert into vault.decrypted_secrets(name,decrypted_secret) values(label,secret) returning id';
   create function vault.update_secret(secret_id uuid,secret text) returns void language sql as 'update vault.decrypted_secrets set decrypted_secret=secret where id=secret_id';
   create table cron.job(jobname text unique,schedule text,command text);
   create function cron.schedule(label text,pattern text,sql text) returns bigint language sql as 'insert into cron.job values(label,pattern,sql) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning 1::bigint';
   create table net.requests(id bigint generated always as identity,url text,headers jsonb,body jsonb,timeout_milliseconds int);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as 'insert into net.requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id';
   create table public.realtime_worker_state(singleton boolean,lease_until timestamptz);
   insert into public.realtime_worker_state values(true,null);
   create function public.kickx_realtime_due_fixtures(p_at timestamptz) returns table(id int) language sql as 'select 1';
   create table public.realtime_fixture_tasks(retry_at timestamptz);
   create table public.calculation_queue(retry_at timestamptz);
   grant usage on schema public to anon,authenticated,service_role;`);
  const installer=(await readFile('supabase/operations/enable-minute-worker.sql','utf8')).replace(/^create extension .*;\n/gm,'');
  await db.exec(installer);await db.exec(installer);
  assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n,1);
  await db.exec('set role authenticated');
  await assert.rejects(db.query("select public.kickx_configure_minute_worker('private-bsd-key','private-service-key-very-long')"),e=>e.code==='42501');
  await assert.rejects(db.query('select public.kickx_dispatch_minute_worker()'),e=>e.code==='42501');
  await db.exec('reset role;set role service_role');
  await db.query("select public.kickx_configure_minute_worker('private-bsd-key','private-service-key-very-long')");
  await db.query("select public.kickx_configure_minute_worker('rotated-bsd-key','private-service-key-very-long')");
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from vault.decrypted_secrets')).rows[0].n,2);
  await db.query('select public.kickx_dispatch_minute_worker()');
  const sent=(await db.query('select * from net.requests')).rows[0];
  assert.equal(sent.url,'https://kick-x-test.vercel.app/api/internal/football');assert.equal(sent.body.bsdKey,'rotated-bsd-key');
  assert.equal(sent.headers.Authorization,'Bearer private-service-key-very-long');
  assert.doesNotMatch((await db.query('select command from cron.job')).rows[0].command,/private|rotated/);
  await db.exec("update public.realtime_worker_state set lease_until=now()+interval '1 minute'");
  await db.query('select public.kickx_dispatch_minute_worker()');
  assert.equal((await db.query('select count(*)::int as n from net.requests')).rows[0].n,1);
 }finally{await db.close();}
});
