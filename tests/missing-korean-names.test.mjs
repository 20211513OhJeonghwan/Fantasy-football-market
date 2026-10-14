import test from 'node:test';
import assert from 'node:assert/strict';
import { transliteratePlayerName } from '../scripts/lib/player-transliteration.mjs';
import { fillMissingKoreanNames, planMissingKoreanNames, readNameCoverage } from '../scripts/lib/missing-korean-names.mjs';

test('pronunciation drafts work without DOB, support accents/initials and reject unsupported spelling',()=>{
  assert.equal(transliteratePlayerName({name:'Son Heung-min'}),'손흥민');
  assert.equal(transliteratePlayerName({name:'Lucas Hernández'}),'루카스 에르난데스');
  assert.equal(transliteratePlayerName({name:'J. Zevan'}).startsWith('제이 '),true);
  assert.match(transliteratePlayerName({name:'Zevan Molvex'}),/^[가-힣]+ [가-힣]+$/u);
  for (const name of ['Osman Atılgan','Vukašin Đurđević','Jarosław Kubicki','Semih Kılıçsoy','Mateusz Pruchniewski','Isak Dahlqvist','Tyreeq Bakinson','Shawn Blum','Matthew Crowther']) {
    assert.match(transliteratePlayerName({name}),/^[가-힣 ]+$/u,name);
  }
  assert.equal(transliteratePlayerName({name:'이강인'}),'이강인');
  assert.equal(transliteratePlayerName({name:'李某某'}),null);
  assert.equal(transliteratePlayerName({name:'<unknown>'}),null);
  assert.equal(transliteratePlayerName({name:'Z'.repeat(200)}),null);
});

const player=(id,name='Son Heung-min')=>({id,name,english:null,provider:'bsd',birth_date:null,team_id:null,name_ko:null});
function database(players,names,{race=false}={}) {
  const calls=[];
  const db={calls,from(table){return {
    select(){return this;},order(){return this;},
    async range(start,end){return {data:(table==='players'?players:names).slice(start,end+1)};},
    update(value){this.value=value;this.filters={};return this;},
    eq(key,value){this.filters[key]=value;return this;},
    then(resolve){const matches=names.filter(n=>Object.entries(this.filters).every(([k,v])=>n[k]===v));for(const n of matches){const p=players.find(p=>p.id===n.player_id);if(p)p.name_ko=this.value.display_name;}resolve({data:matches});},
  };},async rpc(fn,input){calls.push({fn,input});let inserted=0;
    for(const r of input.p_players){const p=players.find(p=>p.id===r.id);
      if(race&&!names.some(n=>n.player_id===r.id)){names.push({player_id:r.id,display_name:'수동 수정',source:'manual'});p.name_ko='수동 수정';}
      if(p.name!==r.name||names.some(n=>n.player_id===r.id))continue;
      names.push({player_id:r.id,display_name:r.name_ko,source:'transliteration'});p.name_ko=r.name_ko;inserted++;
    }return {data:{players:inserted}};
  }};return db;
}

test('coverage counts teamless/DOB-less rows; plans only blank BSD labels and preserves explicit overrides',async()=>{
 const players=[player('bsd-1'),{...player('bsd-2'),name_ko:'직접 입력'},player('bsd-3'),{...player('af-4'),provider:'api-football'},player('bsd-5')];
 const names=[{player_id:'bsd-2',display_name:'직접 입력',source:'manual'},{player_id:'bsd-3',display_name:'손흥민',source:'wikidata'},{player_id:'bsd-5',display_name:'Explicit override',source:'manual'}];
 const db=database(players,names),coverage=await readNameCoverage(db),plan=planMissingKoreanNames(coverage);
 assert.equal(coverage.summary.bsdPlayers,4);assert.equal(coverage.summary.missing,2);assert.equal(coverage.summary.columnSyncPending,1);
 assert.deepEqual(plan.rows.map(p=>p.id),['bsd-1']);assert.equal(plan.rows[0].source,'transliteration');assert.equal(plan.rows[0].review,'provisional');assert.equal(plan.rows[0].birth_date,undefined);
 assert.deepEqual(plan.unresolved,[{id:'bsd-5',reason:'existing_label_preserved'}]);
 const dry=await fillMissingKoreanNames(db);assert.equal(db.calls.length,0);assert.equal(dry.inserted,0);
});

test('apply is idempotent, keeps raw identity, repairs alias/column synchronization and protects raced manual edits',async()=>{
 const players=[player('bsd-1'),player('bsd-2')],names=[{player_id:'bsd-2',display_name:'검수 이름',source:'wikidata'}];
 const db=database(players,names);let result=await fillMissingKoreanNames(db,{apply:true});
 assert.equal(result.inserted,1);assert.equal(result.repaired,1);assert.equal(result.after.missing,0);assert.equal(result.after.columnSyncPending,0);
 assert.equal(players[0].name,'Son Heung-min');assert.equal(names[1].source,'transliteration');assert.equal(names[0].source,'wikidata');
 result=await fillMissingKoreanNames(db,{apply:true});assert.equal(result.inserted,0);assert.equal(result.repaired,0);
 const racedPlayers=[player('bsd-3')],racedNames=[];const race=database(racedPlayers,racedNames,{race:true});
 result=await fillMissingKoreanNames(race,{apply:true});assert.equal(result.inserted,0);assert.equal(racedPlayers[0].name_ko,'수동 수정');
});

test('work batches honor limits and preserve unsupported originals as explicit misses',async()=>{
 const db=database([player('bsd-1'),player('bsd-2'),player('bsd-3','李某某')],[]);
 let result=await fillMissingKoreanNames(db,{apply:true,limit:1});assert.equal(result.inserted,1);assert.equal(result.after.missing,2);
 result=await fillMissingKoreanNames(db,{apply:true});assert.equal(result.inserted,1);assert.equal(result.after.missing,1);assert.equal(result.unresolved[0].reason,'unsupported_spelling');
});
