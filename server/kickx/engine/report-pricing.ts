import { REPORT_PARAMETERS, RULE_VERSION, SCORING_REVISION } from './report-policy';
import type { PricingMatch } from './pricing';

export type ReportParameters = { [K in keyof typeof REPORT_PARAMETERS]: number } & {
 scoringRevision?:string; pricingModel?:string; positionBenchmarks?:Record<string,number>; benchmarkCounts?:Record<string,number>; benchmarkCutoffMs?:number; valuationStartMs?:number; capChangeAtMs?:number; previousMaxUp?:number; previousMaxDown?:number;
};
export type ReportBaseline = {
 source:string;season:number;gameCount:number;meanScore:number|null;seedScore:number;
 percentile:number;price:number;lower:number;upper:number;referenceHash:string;
 fixtures:string[];warnings:string[];
};
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const rounded=(n:number,p=6)=>Math.round(n*10**p)/10**p;
export function validateReportParameters(p:ReportParameters) {
 if(Object.entries(p).some(([key,x])=>!['scoringRevision','pricingModel','positionBenchmarks','benchmarkCounts'].includes(key)&&!Number.isFinite(x)) || (p.scoringRevision!=null&&p.scoringRevision!==SCORING_REVISION) || p.lambda<=0 || p.kappa<=0 || p.beta<=0 || p.s<=0 || p.deviationLimit<=0 ||
  !Number.isSafeInteger(p.minPrice)||!Number.isSafeInteger(p.maxPrice)||!Number.isSafeInteger(p.initialMin)||!Number.isSafeInteger(p.initialMax)||
  p.minPrice<=0 || p.minPrice>p.initialMin || p.initialMin>p.initialMax || p.initialMax>p.maxPrice || p.maxPrice>Number.MAX_SAFE_INTEGER ||
  p.maxUp<0 || p.maxUp>=1 || p.maxDown<0 || p.maxDown>=1 || p.priceSensitivity<=0 || p.priceSensitivity>1 || !Number.isSafeInteger(p.priceUnit) || p.priceUnit<=0 || (p.nonParticipationRate??.015)<0 || (p.nonParticipationRate??.015)>=1 || (p.valuationStartMs!=null&&(!Number.isSafeInteger(p.valuationStartMs)||p.valuationStartMs<0)) || p.lowerQuantile<0 || p.upperQuantile>1 || p.lowerQuantile>=p.upperQuantile)
  throw new Error('INVALID_REPORT_PARAMETERS');
 if(p.positionBenchmarks && (Object.keys(p.positionBenchmarks).length!==4 || ['GK','DF','MF','FW'].some(pos=>!Number.isFinite(p.positionBenchmarks![pos])||p.positionBenchmarks![pos]<=0)))throw new Error('INVALID_POSITION_BENCHMARKS');
 if(p.pricingModel!=null&&p.pricingModel!=='position-points')throw new Error('INVALID_REPORT_PARAMETERS');
 if(p.benchmarkCutoffMs!=null&&p.benchmarkCutoffMs!==p.valuationStartMs)throw new Error('INVALID_BENCHMARK_CUTOFF');
 if (p.capChangeAtMs != null && (!Number.isSafeInteger(p.capChangeAtMs) || p.capChangeAtMs < 0 ||
  p.previousMaxUp == null || p.previousMaxDown == null || p.previousMaxUp < 0 || p.previousMaxUp >= 1 || p.previousMaxDown < 0 || p.previousMaxDown >= 1))
  throw new Error('INVALID_REPORT_PARAMETERS');
}
/** Frozen previous-season population; no current-season result can change this baseline. */
export function reportBaseline(reference:Record<string,unknown>, playerId:string, position:string, p:ReportParameters):ReportBaseline|null {
 validateReportParameters(p);
 const groups=reference.groups as Record<string,{mean:number;lower:number;upper:number;baselines:number[]}>|undefined;
 const group=groups?.[position];
 if(reference.status!=='ready' || !group || !group.baselines.length)return null;
 const players=reference.players as Record<string,Record<string,{n:number;sum:number;fixtures:string[]}>>;
 const own=players[playerId]?.[position];
 const n=own?.n??0, mean=n?own.sum/n:null;
 const score=rounded(((own?.sum??0)+p.lambda*group.mean)/(n+p.lambda),10);
 const percentile=(group.baselines.filter(x=>x<score).length+group.baselines.filter(x=>x===score).length*.5)/group.baselines.length;
 return {source:n?'previous-season':'position-prior',season:Number(reference.season),gameCount:n,meanScore:mean,seedScore:score,
  percentile,price:Math.round(p.initialMin+(p.initialMax-p.initialMin)*percentile),lower:group.lower,upper:group.upper,
  referenceHash:String(reference.hash),fixtures:own?.fixtures??[],warnings:n?[]:['PREVIOUS_SEASON_PLAYER_UNAVAILABLE']};
}
/** Initial prices remain frozen. Only completed post-launch games issue price changes.
 * The position reference is frozen from pre-launch appearances, never future matches. */
export function calculateReportPricing(matches:PricingMatch[],baseline:ReportBaseline,p:ReportParameters={...REPORT_PARAMETERS}) {
 validateReportParameters(p);
 if(!baseline || !Number.isFinite(baseline.seedScore) || !Number.isFinite(baseline.lower) || !Number.isFinite(baseline.upper) ||
  baseline.lower>baseline.upper || !Number.isSafeInteger(baseline.price) || baseline.price<p.minPrice || baseline.price>p.maxPrice)
  throw new Error('INVALID_REPORT_BASELINE');
 const ids=new Set<string>();
 for(const m of matches){if(!m.fixtureId||ids.has(m.fixtureId)||!Number.isFinite(Date.parse(m.startedAt))||(m.endedAt!=null&&!Number.isFinite(Date.parse(m.endedAt))))throw new Error('INVALID_PRICING_MATCH');ids.add(m.fixtureId);}
 const at=(m:PricingMatch)=>m.endedAt??m.startedAt;
 const played=matches.filter(m=>m.season!=null&&m.season>baseline.season&&((['ready','provisional'].includes(m.status)&&m.score!=null&&Number.isFinite(m.score)&&m.minutes!=null&&m.minutes>0&&m.minutes<=180)||(m.status==='not-played'&&m.minutes===0)))
  .sort((a,b)=>Date.parse(at(a))-Date.parse(at(b))||a.fixtureId.localeCompare(b.fixtureId));
 let price=baseline.price;
 const steps=[];
 for(const m of played){
  if(Date.parse(at(m))<(p.valuationStartMs??0))continue;
  const dnp=m.status==='not-played';
  const position=m.position??'';
  const reference=dnp?null:p.positionBenchmarks?.[position];
  if(!dnp&&(!Number.isFinite(reference)||reference!<=0))throw new Error('POSITION_BENCHMARK_REQUIRED');
  const exposure=dnp?0:Math.min(m.minutes!/60,1);
  const deviation=dnp?null:(m.score!-reference!)/Math.max(Math.abs(reference!),p.s);
  const rawDelta=dnp?-price*(p.nonParticipationRate??.015):p.priceUnit*p.priceSensitivity*deviation!*exposure;
  const rawRate=rawDelta/price;
  const rate=clamp(rawRate,-p.maxDown,p.maxUp);
  const before=price;
  const target=clamp(before*(1+rate),p.minPrice,p.maxPrice);
  price=clamp(Math.round(target),Math.max(p.minPrice,Math.ceil(before*(1-p.maxDown))),Math.min(p.maxPrice,Math.floor(before*(1+p.maxUp))));
  steps.push({fixtureId:m.fixtureId,playedAt:at(m),priceBefore:before,priceAfter:price,targetPrice:Math.round(target),
   formScore:dnp?0:(m.score!||0),changePercent:rounded((price-before)*100/before,4),window:[m.fixtureId],
   evidence:{reason:dnp?'NON_PARTICIPATION':'POSITION_MATCH_SCORE',position,referenceScore:reference,exposure,rawDelta,rawRate,rate,priceUnit:p.priceUnit,sensitivity:p.priceSensitivity,
    rawScore:m.score,nonParticipationRate:dnp?(p.nonParticipationRate??.015):null,benchmarkCutoffMs:p.benchmarkCutoffMs??p.valuationStartMs,referenceHash:baseline.referenceHash}});
 }
 return {version:RULE_VERSION,baseline,price,steps};
}
