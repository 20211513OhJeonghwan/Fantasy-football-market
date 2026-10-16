import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('scheduled Node runner imports the real server calculator with server-only react-server conditions',()=>{
 const r=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e','await import("./server/kickx/engine/service.ts");'],{cwd:process.cwd(),encoding:'utf8',timeout:15000});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');
});
