import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorkbookNames, matchWorkbookPlayer, planWorkbookNames, writeWorkbookName } from '../scripts/lib/workbook-player-names.mjs';

const player={id:'bsd-100',name:'João Silva',english:'Joao Silva',birth_date:'2000-01-02',team_id:'bsd-1',provider:'bsd',name_ko:'기존 실바'};
const team={id:'bsd-1',name:'Liverpool FC',english:'Liverpool'};
const row={key:'epl:2',name:'João Silva',name_ko:'주앙 실바',birth_date:'2000-01-02',team:'Liverpool',aliases:['조앙 실바'],source_player_id:'FPL:999'};
const name={player_id:player.id,display_name:player.name_ko,source:'transliteration',source_id:null,updated_at:'2026-10-01T00:00:00Z',aliases:['Joao Silva','이전 별칭']};
const data=players=>({version:'2026-10-18',players,identity_overrides:[]});

test('all five supplied source lists reconcile; league IDs and jersey numbers are never provider fields',()=>{
  const actual=validateWorkbookNames(JSON.parse(readFileSync(new URL('../data/localization/players.workbook.ko.json',import.meta.url))));
  assert.equal(actual.players.length,2827);
  assert.equal(actual.players.filter(row=>row.name_ko).length,2611);
  assert.equal(actual.players.filter(row=>!row.name_ko).length,216);
  assert.equal(actual.sources.reduce((sum,source)=>sum+source.rows,0),2827);
  assert.ok(actual.players.every(row=>!('id' in row)&&!('number' in row)&&!('shirt_number' in row)));
  assert.equal(actual.sources.length,5);
});

test('name and birthday find a transferred player without using FPL IDs',()=>{
  const match=matchWorkbookPlayer({...row,team:'Different Club'},[player,{...player,id:'bsd-999',name:'Someone Else',english:null,birth_date:'1999-01-01'}],[team]);
  assert.equal(match.player.id,'bsd-100');
  assert.equal(match.method,'exact_name_and_birth_date');
  assert.equal(matchWorkbookPlayer({...row,birth_date:'2001-01-01'},[player],[team]).reason,'birth_date_conflict');
});

test('matching rejects ambiguous twins, missing identity evidence and surnames alone',()=>{
  assert.equal(matchWorkbookPlayer(row,[player,{...player,id:'bsd-101'}],[team]).reason,'ambiguous_identity');
  assert.ok(!matchWorkbookPlayer({...row,name:'Silva'},[player],[team]).player);
  assert.ok(!matchWorkbookPlayer({...row,birth_date:null,team:'Other Club'},[player],[team]).player);
  assert.equal(matchWorkbookPlayer({...row,birth_date:null},[player],[team]).player.id,player.id);
  assert.equal(matchWorkbookPlayer({...row,name:'J. Silva'},[player],[team]).player.id,player.id);
});

test('blanks, absent players and human overrides keep existing names and aliases',()=>{
  const plan=planWorkbookNames(data([row,{...row,key:'epl:3',name_ko:null}]),[player],[team],[name]);
  assert.equal(plan.rows.length,1);
  assert.equal(plan.skipped[0].reason,'blank_keeps_existing');
  assert.ok(plan.rows[0].value.aliases.includes('이전 별칭'));
  assert.ok(plan.rows[0].value.aliases.includes('기존 실바'));
  assert.ok(plan.rows[0].value.aliases.includes('조앙 실바'));
  assert.equal(plan.rows[0].value.source,'manual');
  assert.equal(planWorkbookNames(data([row]),[player],[team],[{...name,source:'manual'}]).rows.length,0);
  const rerun=planWorkbookNames(data([row]),[player],[team],[{...name,...plan.rows[0].value}]);
  assert.equal(rerun.rows.length,0);
  assert.equal(rerun.skipped[0].reason,'already_confirmed');
  assert.equal(planWorkbookNames(data([row]),[],[team],[]).rows.length,0);
});

test('conflicting workbook records cannot select a label by input order',()=>{
  const plan=planWorkbookNames(data([row,{...row,key:'seriea:2',name_ko:'다른 실바'}]),[player],[team],[name]);
  assert.equal(plan.rows.length,0);
  assert.ok(plan.skipped.every(row=>row.reason==='conflicting_workbook_labels'));
});

test('reviewed date conflicts bind both source and DB identities and can never repair DOB or a different player',()=>{
  const source={...row,birth_date:'2000-01-03'};
  const override={key:row.key,id:player.id,expected_name:player.name,birth_date:player.birth_date,expected_team_id:player.team_id,
    source_name:source.name,source_birth_date:source.birth_date,source_team:source.team,allow_birth_date_conflict:true};
  const actual={...data([source]),identity_overrides:[override]};
  assert.equal(planWorkbookNames(actual,[player],[team],[name]).rows[0].id,player.id);
  assert.ok(!('birth_date' in planWorkbookNames(actual,[player],[team],[name]).rows[0].value));
  assert.ok(!matchWorkbookPlayer({...source,name:'Other Name'},[player],[team],[name],override).player);
  assert.ok(!matchWorkbookPlayer(source,[{...player,team_id:'bsd-2'}],[team],[name],override).player);
  assert.ok(!matchWorkbookPlayer(source,[{...player,birth_date:'1999-01-01'}],[team],[name],override).player);
  assert.ok(!matchWorkbookPlayer({...source,birth_date:'2000-01-04'},[player],[team],[name],override).player);
  assert.throws(()=>validateWorkbookNames({...actual,identity_overrides:[{...override,expected_name:'Someone else'}]}));
});

function fakeDb({current=player,concurrent=false}={}) {
  const operations=[];
  return {operations,from(table){
    const op={table,filters:[]};operations.push(op);
    const query={select(){return query;},eq(key,value){op.filters.push([key,value]);return query;},is(key,value){op.filters.push([key,value]);return query;},
      update(value){op.value=value;return query;},upsert(value,options){op.value=value;op.options=options;return query;},
      then(resolve,reject){return Promise.resolve({data:table==='players'?[current]:concurrent?[]:[{player_id:player.id}],error:null}).then(resolve,reject);}};
    return query;
  }};
}

test('writes recheck identity and compare existing label/source/version to preserve concurrent edits',async()=>{
  const planned=planWorkbookNames(data([row]),[player],[team],[name]).rows[0];
  const db=fakeDb({concurrent:true});
  assert.equal((await writeWorkbookName(db,planned)).status,'concurrent_name_preserved');
  const update=db.operations.find(op=>op.table==='player_names');
  for(const key of ['display_name','source','source_id','updated_at'])assert.ok(update.filters.some(([field])=>field===key));
  assert.equal(update.value.source,'manual');
  const changed=fakeDb({current:{...player,birth_date:'2001-01-01'}});
  assert.equal((await writeWorkbookName(changed,planned)).status,'identity_changed');
  assert.ok(changed.operations.every(op=>op.table==='players'));
  const absent=planWorkbookNames(data([row]),[player],[team],[]).rows[0],insert=fakeDb();
  assert.equal((await writeWorkbookName(insert,absent)).status,'applied');
  assert.equal(insert.operations[1].options.ignoreDuplicates,true);
});
