// Offline only: calculate exported evidence without spending provider requests.
// Every publication checks that exported source fingerprints still match.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import * as scoringModule from '../server/kickx/engine/report-performance.ts';
import * as policyModule from '../server/kickx/engine/report-policy.ts';
const {calculatePerformance}=scoringModule.default??scoringModule;
const {RULE_VERSION,SCORING_REVISION}=policyModule.default??policyModule;
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node --import tsx scripts/prepare-pending-price-repairs.mjs evidence.json output-directory');
const jobs=new Map(),statuses={};
for(const fixture of JSON.parse(await readFile(input,'utf8')))for(const player of fixture.players){
 const result=['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'].includes(fixture.leagueId)?calculatePerformance({...fixture,...player,regularSeasonOnly:true}):{fixtureId:fixture.fixtureId,position:null,minutes:null,score:null,status:'blocked',breakdown:[],warnings:['OUTSIDE_COMPETITION_SCOPE']};
 const job=jobs.get(player.playerId)??{playerId:player.playerId,results:[],proofs:[]};
 job.results.push({...result,ruleVersion:RULE_VERSION,scoringRevision:SCORING_REVISION});
 job.proofs.push({fixtureId:fixture.fixtureId,sourceHash:player.sourceHash});jobs.set(player.playerId,job);
 statuses[result.status]=(statuses[result.status]??0)+1;
}
await mkdir(output,{recursive:true});const rows=[...jobs.values()];
for(let at=0;at<rows.length;at+=20){
 const payload=JSON.stringify(rows.slice(at,at+20));if(payload.includes('$pending_jobs$'))throw Error('Invalid SQL delimiter');
 await writeFile(`${output}/batch-${String(at/20+1).padStart(3,'0')}.sql`,
`do $repair$ declare job jsonb;answer jsonb;rev uuid;integrity jsonb;results jsonb:='[]';begin
 perform pg_advisory_xact_lock(hashtextextended('kickx:bsd-import',0));perform public.kickx_economy_lock();
 integrity:=public.kickx_valuation_integrity();
 for job in select value from jsonb_array_elements($pending_jobs$${payload}$pending_jobs$::jsonb)loop
  if not public.kickx_market_eligible(job->>'playerId')or exists(select 1 from jsonb_array_elements(job->'proofs')p
   left join public.kickx_calculation_sources(job->>'playerId')c on c.fixture_id=p->>'fixtureId'where c.source_hash is distinct from p->>'sourceHash')
   or exists(select 1 from public.kickx_calculation_sources(job->>'playerId')c where not c.cached and not exists(select 1 from jsonb_array_elements(job->'results')r where r->>'fixtureId'=c.fixture_id))then
   results:=results||jsonb_build_array(jsonb_build_object('player',job->>'playerId','skipped',true));continue;end if;
  select revision into rev from public.calculation_queue where player_id=job->>'playerId';
  answer:=public.kickx_publish_calculation_delta(null,job->>'playerId',public.kickx_calculation_token(job->>'playerId'),job->'results');
  if rev is not null then perform public.kickx_ack_calculation(job->>'playerId',rev,case when answer->>'withheld'='true'then 'CALCULATION_WITHHELD'end);end if;
  results:=results||jsonb_build_array(jsonb_build_object('player',job->>'playerId','result',answer));
 end loop;
 if integrity is distinct from public.kickx_valuation_integrity()then raise exception 'REPAIR_FINANCIAL_INTEGRITY';end if;
 insert into public.operation_audit(action,target,detail)values('calculation.pending-repair','20261109-batch-${at/20+1}',jsonb_build_object('results',results,'financialIntegrityUnchanged',true,'providerRequests',0));
end $repair$;
select detail from public.operation_audit where action='calculation.pending-repair'and target='20261109-batch-${at/20+1}'order by created_at desc limit 1;`);
}
console.log(JSON.stringify({players:rows.length,records:rows.reduce((n,r)=>n+r.results.length,0),statuses,batches:Math.ceil(rows.length/20)}));
