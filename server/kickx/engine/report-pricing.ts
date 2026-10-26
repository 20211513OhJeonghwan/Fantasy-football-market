import { REPORT_PARAMETERS, RULE_VERSION } from './report-policy';
import type { PricingMatch } from './pricing';

export type ReportParameters = { [K in keyof typeof REPORT_PARAMETERS]: number };
export type ReportBaseline = {
 source:string;season:number;gameCount:number;meanScore:number|null;seedScore:number;
 percentile:number;price:number;lower:number;upper:number;referenceHash:string;
 fixtures:string[];warnings:string[];
};
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const rounded=(n:number,p=6)=>Math.round(n*10**p)/10**p;
export function validateReportParameters(p:ReportParameters) {
 if(Object.values(p).some(x=>!Number.isFinite(x)) || p.lambda<=0 || p.kappa<=0 || p.beta<=0 || p.s<=0 || p.deviationLimit<=0 ||
  !Number.isSafeInteger(p.minPrice)||!Number.isSafeInteger(p.maxPrice)||!Number.isSafeInteger(p.initialMin)||!Number.isSafeInteger(p.initialMax)||
  p.minPrice<=0 || p.minPrice>p.initialMin || p.initialMin>p.initialMax || p.initialMax>p.maxPrice || p.maxPrice>1_000_000_000 ||
  p.maxUp<0 || p.maxUp>=1 || p.maxDown<0 || p.maxDown>=1 || p.lowerQuantile<0 || p.upperQuantile>1 || p.lowerQuantile>=p.upperQuantile)
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
/** Replay every scored appearance of each season; DNPs never enter its numerator or denominator. */
export function calculateReportPricing(matches:PricingMatch[],baseline:ReportBaseline,p:ReportParameters={...REPORT_PARAMETERS}) {
 validateReportParameters(p);
 if(!baseline || !Number.isFinite(baseline.seedScore) || !Number.isFinite(baseline.lower) || !Number.isFinite(baseline.upper) ||
  baseline.lower>baseline.upper || !Number.isSafeInteger(baseline.price) || baseline.price<p.minPrice || baseline.price>p.maxPrice)
  throw new Error('INVALID_REPORT_BASELINE');
 const ids=new Set<string>();
 for(const m of matches){if(!m.fixtureId||ids.has(m.fixtureId)||!Number.isFinite(Date.parse(m.startedAt)))throw new Error('INVALID_PRICING_MATCH');ids.add(m.fixtureId);}
 const played=matches.filter(m=>['ready','provisional'].includes(m.status)&&m.score!=null&&Number.isFinite(m.score)&&m.minutes!=null&&m.minutes>0&&m.minutes<=180&&m.season!=null&&m.season>baseline.season)
  .sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.fixtureId.localeCompare(b.fixtureId));
 let price=baseline.price,season:number|null=null,sum=0,n=0;
 let window:string[]=[];
 const steps=[];
 for(const m of played){
  if(m.season!==season){season=m.season;sum=0;n=0;window=[];}
  const bounded=clamp(m.score!,baseline.lower,baseline.upper);sum+=bounded;n++;window.push(m.fixtureId);
  const cumulative=(p.kappa*baseline.seedScore+sum)/(p.kappa+n);
  const deviation=(cumulative-baseline.seedScore)/Math.max(Math.abs(baseline.seedScore),p.s);
  const target=clamp(baseline.price*Math.exp(p.beta*clamp(deviation,-p.deviationLimit,p.deviationLimit)),p.minPrice,p.maxPrice);
  const before=price;
  // Ceil/floor after rounding: even a 1-P price may not cross the percentage cap.
  price=clamp(Math.round(target),Math.max(p.minPrice,Math.ceil(before*(1-p.maxDown))),Math.min(p.maxPrice,Math.floor(before*(1+p.maxUp))));
  steps.push({fixtureId:m.fixtureId,playedAt:m.startedAt,priceBefore:before,priceAfter:price,targetPrice:Math.round(target),
   formScore:rounded(cumulative),changePercent:rounded((price-before)*100/before,4),window:[...window],
   evidence:{season,n,rawScore:m.score,boundedScore:bounded,cumulativeSum:sum,cumulativeScore:cumulative,deviation,target,referenceHash:baseline.referenceHash}});
 }
 return {version:RULE_VERSION,baseline,price,steps};
}
