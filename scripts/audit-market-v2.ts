/** Read-only operational sample. No RPC writes, prices, accounts or secrets are emitted. */
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { calculatePlayer } from '../server/kickx/engine/service';
import { nameImportFetch } from './lib/korean-catalog.mjs';
async function main() {
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
 if(!url||!key)throw new Error('AUDIT_CONFIG_REQUIRED');
 const db=createClient(url,key,{global:{fetch:nameImportFetch(key)},auth:{persistSession:false,autoRefreshToken:false}});
 const rows:Record<string,unknown>[]=[];
 for(let offset=0;;offset+=500){const r=await db.from('player_catalog').select('id,position,team_id,league_ids,matches_imported,performance,season').order('id').range(offset,offset+499);if(r.error)throw new Error('AUDIT_CATALOG_READ_FAILED');rows.push(...r.data);if(r.data.length<500)break;}
 const groups=new Map<string,Record<string,unknown>[]>();
 let seed=20261013;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(const row of rows.filter(r=>Number(r.matches_imported)>0)){const leagues=Array.isArray(row.league_ids)?row.league_ids:[];const group=String(leagues[0]??'unknown')+':'+String(row.position??'unknown');if(!groups.has(group))groups.set(group,[]);groups.get(group)!.push({...row,draw:rand()});}
 const sample=[...groups.values()].flatMap(group=>group.sort((a,b)=>Number(a.draw)-Number(b.draw)).slice(0,10));
 const referenceAt=new Date().toISOString(),referenceSeason=Math.max(...rows.map(r=>Number(r.season)||0))||null;
 const scores:number[]=[],latest:number[]=[],prices:number[]=[],oldLatest:number[]=[];
 const positions:Record<string,{scores:number[];players:number}>= {},statuses:Record<string,number>={},sources:Record<string,number>={};
 let failures=0;
 for(let i=0;i<sample.length;i+=3){await Promise.all(sample.slice(i,i+3).map(async row=>{
  try{
   const r=await calculatePlayer(db,String(row.id),null,true,{referenceAt,referenceSeason});
   const results=r.results as {score:number|null;status:string}[];
   const accepted=results.filter(m=>m.score!=null);scores.push(...accepted.map(m=>m.score!));
   for(const m of results)statuses[m.status]=(statuses[m.status]??0)+1;
   if(accepted.length)latest.push(accepted.at(-1)!.score!);
   if(row.performance!=null)oldLatest.push(Number(row.performance));
   const p=r.pricing!;prices.push(p.price);sources[p.baseline.source]=(sources[p.baseline.source]??0)+1;
   const pos=String(row.position??'unknown');positions[pos]??={scores:[],players:0};positions[pos].scores.push(...accepted.map(m=>m.score!));positions[pos].players++;
  }catch{failures++;}
 }));}
 const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {n:sorted.length,min:sorted[0]??null,p10:sorted[Math.floor(sorted.length*.1)]??null,median:sorted[Math.floor(sorted.length*.5)]??null,p90:sorted[Math.floor(sorted.length*.9)]??null,max:sorted.at(-1)??null,mean:sorted.length?Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length*100)/100:null};};
 const report={at:referenceAt,readOnly:true,sampling:'20261013; up to 10 players per league-position stratum with imported matches',catalogPlayers:rows.length,samplePlayers:sample.length,failures,statuses,baselineSources:sources,scores:summary(scores),latestScores:summary(latest),oldLatestScores:summary(oldLatest),initialOrReplayedPrices:summary(prices),byPosition:Object.fromEntries(Object.entries(positions).map(([p,v])=>[p,{players:v.players,...summary(v.scores)}])),sampleIds:sample.map(r=>r.id)};
 await mkdir('test-artifacts',{recursive:true});await writeFile('test-artifacts/market-v2-audit.json',JSON.stringify(report,null,2)+'\n');
 const {sampleIds,...aggregate}=report;void sampleIds;console.log(JSON.stringify(aggregate));
 if(failures)throw new Error('AUDIT_PARTIAL_FAILURE');
}
main().catch(()=>{console.error('MARKET_AUDIT_FAILED');process.exitCode=1;});
