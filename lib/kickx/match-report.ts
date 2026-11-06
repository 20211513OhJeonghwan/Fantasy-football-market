/** Small public DTO. Source statistics and provider responses are never stored here. */
export type ReportText = { performance: string };
/** Presentation only: cached reports never need regeneration for line breaks. */
export function reportSentences(text: string): string[] {
  const segmenter = new Intl.Segmenter('ko', {granularity:'sentence'});
  return text.split(/\r?\n+/u).flatMap(line=>[...segmenter.segment(line)].map(part=>part.segment.trim())).filter(Boolean);
}
export type ReportFacts = {
  position?: string | null;
  referenceScore?: number | null;
  priceSensitivity?: number | null;
  priceUnit?: number | null;
  priceExposure?: number | null;
  playerName: string;
  opponent: string;
  playedAt: string;
  minutes: number;
  score: number;
  scoreStatus: "ready" | "provisional";
  ruleVersion: string;
  contributions: { metric: string; value: number; points: number }[];
  warningCount: number;
  priceBefore: number;
  priceAfter: number;
  targetPrice: number;
  formScore: number;
  changePercent: number;
  windowSize: number;
};
export type MatchReport = {
  status: "ready" | "missing" | "pending" | "cooldown" | "limited" | "unavailable";
  facts: ReportFacts | null;
  text: ReportText | null;
  generatedAt: string | null;
  /** Only a completed model response is called AI. The numerical summary always works. */
  canGenerate: boolean;
  retryAt?: string | null;
  unavailableReason?: "baseline-history" | "awaiting-results" | null;
};

/** Exact outcome explanation always renders, including when AI is rate limited. */
export function matchPriceExplanation(facts:ReportFacts):string{
 const reference=facts.referenceScore,score=facts.score;
 const direction=facts.priceAfter>facts.priceBefore?'상승':facts.priceAfter<facts.priceBefore?'하락':'유지';
 if(reference==null||!Number.isFinite(reference)||reference<=0)return `이번 경기의 실제 가격은 ${direction}했습니다. 상세 기준이 없는 과거 결과에는 현재 기준을 소급해 설명하지 않습니다.`;
 const exposure=facts.priceExposure??Math.min(facts.minutes/60,1),sensitivity=facts.priceSensitivity??.1;
 const unit=facts.priceUnit??facts.priceBefore;
 const rawDelta=(score-reference)/Math.max(Math.abs(reference),1)*sensitivity*exposure*unit;
 const raw=rawDelta/facts.priceBefore;
 const basis=score===reference?`포지션 기준 ${reference.toFixed(2)}점과 같아 가격 유지 대상입니다.`:`포지션 기준 ${reference.toFixed(2)}점보다 ${Math.abs(score-reference).toFixed(2)}점 ${score>reference?'높아 상승':'낮아 하락'} 대상입니다.`;
 const time=facts.minutes<60?` ${facts.minutes}분 출전으로 변동폭의 ${Math.round(exposure*100)}%를 반영합니다.`:'';
 const limit=Math.abs(raw)>.1?' 경기당 최대 변동률 10%를 적용합니다.':'';
 const bound=direction==='유지'&&raw!==0?' 최소 가격 또는 포인트 반올림으로 실제 가격은 유지됐습니다.':'';
 const points=facts.priceUnit!=null?` 제한 전 증감은 ${rawDelta>=0?'+':''}${Math.round(rawDelta).toLocaleString('ko-KR')}P이며 현재 가격과 무관한 기준 단위로 계산합니다.`:'';
 return `${basis}${time}${points}${limit}${bound}`;
}
