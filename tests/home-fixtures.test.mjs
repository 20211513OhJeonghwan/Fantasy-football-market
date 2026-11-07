import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const fixtures=loadTs('../lib/kickx/fixtures.ts');
const query=loadTs('../lib/kickx/catalog-query.ts');
const leagues=['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'];
const now=Date.parse('2026-11-07T03:00:00Z');
const match=(id,home,away,status,offset)=>({id,home,away,status,leagueId:'bsd-1',startsAt:new Date(now+offset*3600000).toISOString(),homeScore:null,awayScore:null});

test('home fixtures include the permanent primary club, subteams and legacy single-team profiles',()=>{
 assert.deepEqual(fixtures.featuredTeamIds({primaryTeam:'primary',teams:['sub','primary','sub']}),['primary','sub']);
 assert.deepEqual(fixtures.featuredTeamIds({primaryTeam:'primary',teams:['sub']}),['primary','sub']);
 assert.deepEqual(fixtures.featuredTeamIds({team:'legacy'}),['legacy']);
 assert.deepEqual(fixtures.featuredTeamIds(null),[]);
});
test('each supported club gets one nearest match without borrowing unrelated global previews',()=>{
 const rows=[...Array.from({length:20},(_,i)=>match('unrelated-'+i,'other','else','NS',i+1)),
  match('main-next','main','visitor','NS',12),match('main-later','main','later','NS',24),
  match('sub-live','visitor','sub','1H',-1),match('third-next','third','visitor','NS',18),
  match('fourth-next','fourth','visitor','NS',20),match('fifth-next','fifth','visitor','NS',22)];
 assert.deepEqual(fixtures.selectSupportedFixtures(rows,['main','sub','third','fourth','fifth'],now).map(f=>f.id),['sub-live','main-next','third-next','fourth-next','fifth-next']);
 assert.equal(rows.length,26);
});
test('supported-club meetings appear once; absent clubs do not get another club’s fixture',()=>{
 const shared=match('shared','main','sub','NS',10);
 assert.deepEqual(fixtures.selectSupportedFixtures([shared,match('later','main','other','NS',20)],['main','sub'],now).map(f=>f.id),['shared']);
 assert.deepEqual(fixtures.selectSupportedFixtures([shared],['absent'],now),[]);
 assert.deepEqual(fixtures.selectSupportedFixtures([shared],[],now),[]);
});
test('cancelled and expired scheduled games do not hide the newest finished result',()=>{
 const rows=[match('cancelled','main','visitor','CANC',2),match('expired','main','visitor','NS',-1),match('old','main','visitor','FT',-48),match('recent','main','visitor','FT',-12)];
 assert.deepEqual(fixtures.selectSupportedFixtures(rows,['main'],now).map(f=>f.id),['recent']);
});
test('home fixture query accepts only five safe public team IDs and normalizes cache keys',()=>{
 assert.deepEqual(query.parseFeaturedTeams(new URLSearchParams('teams=sub,main,main')),['main','sub']);
 assert.deepEqual(query.parseFeaturedTeams(new URLSearchParams()),[]);
 for(const value of ['a,b,c,d,e,f','../team','team),status.eq.FT','a,'])assert.throws(()=>query.parseFeaturedTeams(new URLSearchParams({teams:value})),query.CatalogInputError);
});
test('home club reads are bounded and independently query a supported team outside the global preview',async()=>{
 const calls=[],rows=[match('sub-next','sub','other','NS',24)];
 const response={data:rows,error:null};
 const builder=new Proxy({then(resolve,reject){return Promise.resolve(response).then(resolve,reject);}}, {get(target,key){return key in target?target[key]:(...args)=>{calls.push([key,...args]);return builder;};}});
 const {readHomeClubFixture}=loadTs('../server/kickx/home-fixtures.ts',{'server-only':{},'@/lib/kickx/support':{DOMESTIC_LEAGUES:leagues},'@/lib/kickx/fixtures':fixtures,'./catalog':{FIXTURE_COLUMNS:'id,starts_at',mapFixture:row=>row}});
 const db={from:table=>{calls.push(['from',table]);return builder;}};
 assert.equal((await readHomeClubFixture(db,'sub',now)).id,'sub-next');
 assert.deepEqual(calls.find(c=>c[0]==='in'),['in','league_id',leagues]);
 assert.deepEqual(calls.find(c=>c[0]==='or'),['or','home_team_id.eq.sub,away_team_id.eq.sub']);
 assert.deepEqual(calls.find(c=>c[0]==='limit'),['limit',12]);
 assert.deepEqual(calls.find(c=>c[0]==='gte'),['gte','starts_at',new Date(now-7*86400000).toISOString()]);
 response.error=new Error('read failed');await assert.rejects(readHomeClubFixture(db,'sub',now),/read failed/);
});
