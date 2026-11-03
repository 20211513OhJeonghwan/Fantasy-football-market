// Offline preparation only. Source evidence is exported once per fixture.
// Generated SQL publishes only previously blocked records with unchanged sources.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import * as performanceModule from '../server/kickx/engine/report-performance.ts';
const {calculatePerformance}=performanceModule.default??performanceModule;
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node --import tsx scripts/prepare-score-repairs.mjs evidence.json output-directory');
const cases=JSON.parse(await readFile(input,'utf8')),jobs=new Map(),remaining={};
for(const fixture of cases)for(const player of fixture.players){
 const result=calculatePerformance({...fixture,...player,regularSeasonOnly:true});
 if(result.status==='blocked'){const reason=result.warnings.at(-1);remaining[reason]=(remaining[reason]??0)+1;continue;}
 const job=jobs.get(player.playerId)??{playerId:player.playerId,results:[],proofs:[]};
 job.results.push({...result,ruleVersion:'report-v3',scoringRevision:'regular-season-20261030'});
 job.proofs.push({fixtureId:fixture.fixtureId,statsAt:player.statsAt,fixtureAt:fixture.fixtureAt,eventsAt:fixture.eventsAt,inputHash:player.inputHash});
 jobs.set(player.playerId,job);
}
await mkdir(output,{recursive:true});
const rows=[...jobs.values()];
for(let at=0;at<rows.length;at+=20){
 const payload=JSON.stringify(rows.slice(at,at+20));
 if(payload.includes('$repair_jobs$'))throw Error('Invalid SQL delimiter');
 const sql=`with locked as materialized(select pg_advisory_xact_lock(hashtextextended('kickx:bsd-import',0))),
 jobs as materialized(select x.value as job from locked,jsonb_array_elements($repair_jobs$${payload}$repair_jobs$::jsonb)x),
 valid as materialized(select job,c.revision from jobs left join public.calculation_queue c on c.player_id=job->>'playerId'
 where public.kickx_market_eligible(job->>'playerId') and not exists(
 select 1 from public.kickx_calculation_sources(job->>'playerId')c where not c.cached
 and not exists(select 1 from jsonb_array_elements(job->'results')x where x->>'fixtureId'=c.fixture_id)) and not exists(
 select 1 from jsonb_array_elements(job->'proofs')p
 left join public.football_match_stats m on m.player_id=job->>'playerId'and m.fixture_id=p->>'fixtureId'
 left join public.fixtures f on f.id=m.fixture_id left join public.football_event_sources s on s.fixture_id=f.id
 left join public.performance_results r on r.player_id=m.player_id and r.fixture_id=m.fixture_id
 where m.player_id is null or r.status is distinct from 'blocked'
 or (m.updated_at,f.updated_at,s.updated_at,r.input_hash)is distinct from((p->>'statsAt')::timestamptz,(p->>'fixtureAt')::timestamptz,(p->>'eventsAt')::timestamptz,p->>'inputHash'))),
 published as materialized(select job->>'playerId' as player,revision,public.kickx_publish_calculation_delta(null,job->>'playerId',public.kickx_calculation_token(job->>'playerId'),job->'results') as result from valid)
 select jsonb_build_object('results',(select jsonb_agg(jsonb_build_object('player',player,'result',result,'ack',case when revision is not null then public.kickx_ack_calculation(player,revision,case when result->>'withheld'='true'then 'CALCULATION_WITHHELD'end)end))from published),
 'skipped',(select jsonb_agg(job->>'playerId')from jobs where job->>'playerId'not in(select player from published)));`;
 await writeFile(`${output}/batch-${String(at/20+1).padStart(3,'0')}.sql`,sql);
}
await writeFile(`${output}/summary.json`,JSON.stringify({players:rows.length,recoveredRecords:rows.reduce((n,j)=>n+j.results.length,0),remaining},null,2));
console.log(JSON.stringify({players:rows.length,recoveredRecords:rows.reduce((n,j)=>n+j.results.length,0),batches:Math.ceil(rows.length/20),remaining}));
