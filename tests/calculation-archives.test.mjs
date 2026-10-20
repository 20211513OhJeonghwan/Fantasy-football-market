import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { archiveCalculationRevisions, ARCHIVE_BUCKET } from '../scripts/lib/calculation-archives.mjs';
function setup({ uploadError, downloadError, corrupt = false, publicBucket = false, acknowledgeError } = {}) {
 const rows=[{id:'revision',archive_hash:'source-hash',results:[{score:50}],pricing:{price:100000}}];
 let stored, uploadedPath;const calls=[];
 const db={storage:{getBucket:async id=>{assert.equal(id,ARCHIVE_BUCKET);return {data:{public:publicBucket}};},from:()=>({
  upload:async(path,bytes)=>{calls.push('upload');uploadedPath=path;stored=bytes;return {error:uploadError};},
  download:async path=>{calls.push('verify');assert.equal(path,uploadedPath);return {error:downloadError,data:new Blob([corrupt?'corrupt':stored])};},
 })},rpc:async(name,args)=>{calls.push(name);if(name==='kickx_revision_archive_batch')return {data:rows};
  assert.equal(name,'kickx_finish_revision_archive');assert.deepEqual(args.p_rows,[{id:'revision',archive_hash:'source-hash'}]);
  return {data:1,error:acknowledgeError};}};
 return {db,rows,calls,restored:()=>JSON.parse(gunzipSync(stored))};
}
test('compaction follows upload and byte verification, and the gzip contains the complete revision',async()=>{
 const h=setup();const result=await archiveCalculationRevisions(h.db,{initialBatch:h.rows,maxBatches:1});
 assert.equal(result.archived,1);assert.ok(result.bytes>0);
 assert.deepEqual(h.calls,['upload','verify','kickx_finish_revision_archive']);
 assert.deepEqual(h.restored().rows,h.rows);
});
for(const options of [{uploadError:{statusCode:'500'}},{downloadError:{statusCode:'500'}},{corrupt:true},{publicBucket:true}]){
 test('a failed or unsafe archive never acknowledges rows: '+JSON.stringify(options),async()=>{
  const h=setup(options);await assert.rejects(archiveCalculationRevisions(h.db,{initialBatch:h.rows,maxBatches:1}));
  assert.ok(!h.calls.includes('kickx_finish_revision_archive'));
 });
}
test('an already uploaded content-addressed object is verified before retrying a lost acknowledgment',async()=>{
 const h=setup({uploadError:{statusCode:'409'}});
 assert.equal((await archiveCalculationRevisions(h.db,{initialBatch:h.rows,maxBatches:1})).archived,1);
 assert.deepEqual(h.calls,['upload','verify','kickx_finish_revision_archive']);
});
test('no work causes no Storage requests and no database writes',async()=>{
 const h=setup();assert.equal((await archiveCalculationRevisions(h.db,{initialBatch:[]})).done,true);
 assert.deepEqual(h.calls,[]);
});

test('checkpoint archives preserve full payloads and acknowledge only their original keys and hashes',async()=>{
 const rows=[{_source:'daily',day:'2026-10-20',key:'match:1',archive_hash:'original',payload:{phase:'legacy',stats:{goals:1}}}];
 let compressed;const order=[];
 const db={storage:{getBucket:async()=>({data:{public:false}}),from:()=>({upload:async(path,bytes)=>{assert.match(path,/^checkpoint-payloads\//);compressed=bytes;order.push('upload');return {};},download:async()=>{order.push('verify');return {data:new Blob([compressed])};}})},
  rpc:async(name,args)=>{order.push(name);if(name==='kickx_checkpoint_archive_batch')return {data:rows};assert.equal(name,'kickx_finish_checkpoint_archive');assert.deepEqual(args.p_rows,[{_source:'daily',day:'2026-10-20',key:'match:1',archive_hash:'original'}]);return {data:1};}};
 const {archiveCheckpointPayloads}=await import('../scripts/lib/calculation-archives.mjs');
 assert.equal((await archiveCheckpointPayloads(db,{maxBatches:1})).archived,1);
 assert.deepEqual(JSON.parse(gunzipSync(compressed)).rows,rows);
 assert.deepEqual(order,['kickx_checkpoint_archive_batch','upload','verify','kickx_finish_checkpoint_archive']);
});
