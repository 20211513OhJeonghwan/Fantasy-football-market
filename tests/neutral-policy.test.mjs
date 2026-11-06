import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {supportWindow,canChangeSubteam,canPostToClub}=loadTs('../lib/kickx/support.ts');
const {fixturesByLeague}=loadTs('../lib/kickx/fixtures.ts');
const {matchPriceExplanation}=loadTs('../lib/kickx/match-report.ts');
test('KST support windows include exactly February and September days 1–7',()=>{
 for(const month of ['02','09']){
  assert.equal(supportWindow(Date.parse(`2026-${month}-01T00:00:00+09:00`)),`2026-${month}`);
  assert.equal(supportWindow(Date.parse(`2026-${month}-07T23:59:59.999+09:00`)),`2026-${month}`);
  assert.equal(supportWindow(Date.parse(`2026-${month}-08T00:00:00+09:00`)),null);
 }
 assert.equal(supportWindow(Date.parse('2026-01-31T23:59:59+09:00')),null);
});
test('subteam allowance expires after an hour and later belongs to each league in each window',()=>{
 const joined=Date.parse('2026-11-06T00:00:00Z'),profile={team:'main',primaryTeam:'main',createdAt:new Date(joined).toISOString()};
 assert.equal(canChangeSubteam(profile,'bsd-1',joined+3599999),true);
 assert.equal(canChangeSubteam(profile,'bsd-1',joined+3600000),false);
 const old={...profile,createdAt:'2025-01-01',supportChangeWindow:'2026-02',supportChangedLeagues:['bsd-1']};
 assert.equal(canChangeSubteam(old,'bsd-1',Date.parse('2026-02-02')),false);
 assert.equal(canChangeSubteam(old,'bsd-3',Date.parse('2026-02-02')),true);
 assert.equal(canChangeSubteam(old,'bsd-1',Date.parse('2026-09-02')),true);
 assert.equal(canPostToClub({team:'legacy',teams:['legacy']}),false);
 assert.equal(canPostToClub(profile,'main'),true);assert.equal(canPostToClub(profile,'other'),false);
});
test('a date groups leagues before kickoff time without losing matches',()=>{
 const f=(id,leagueId,startsAt)=>({id,leagueId,startsAt});
 const groups=fixturesByLeague([f('c','bsd-3','2026-11-07T02:00Z'),f('b','bsd-1','2026-11-07T04:00Z'),f('a','bsd-1','2026-11-07T01:00Z')]);
 assert.deepEqual(groups.map(g=>[g.leagueId,g.fixtures.map(f=>f.id)]),[['bsd-1',['a','b']],['bsd-3',['c']]]);
});
test('report always states neutral, positive, negative, short appearance and price-bound outcomes',()=>{
 const facts={score:4,referenceScore:8,minutes:90,priceBefore:100000,priceAfter:95000};
 assert.match(matchPriceExplanation(facts),/낮아 하락/);
 assert.match(matchPriceExplanation({...facts,score:12,priceAfter:105000}),/높아 상승/);
 assert.match(matchPriceExplanation({...facts,score:8,priceAfter:100000}),/가격 유지/);
 assert.match(matchPriceExplanation({...facts,minutes:30}),/50%를 반영/);
 assert.match(matchPriceExplanation({...facts,priceBefore:10000,priceAfter:10000}),/최소 가격/);
});
