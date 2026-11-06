/** Small public DTO. Source statistics and provider responses are never stored here. */
export type ReportText = { performance: string };
/** Presentation only: cached reports never need regeneration for line breaks. */
export function reportSentences(text: string): string[] {
  const segmenter = new Intl.Segmenter('ko', {granularity:'sentence'});
  return text.split(/\r?\n+/u).flatMap(line=>[...segmenter.segment(line)].map(part=>part.segment.trim())).filter(Boolean);
}
export type ReportFacts = {
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
 const exposure=Math.min(facts.minutes/60,1),score=facts.score;
 const raw=(score-6)*2.5*exposure,rate=Math.max(-10,Math.min(10,raw));
 const direction=facts.priceAfter>facts.priceBefore?'상승':facts.priceAfter<facts.priceBefore?'하락':'유지';
 const basis=score===6?'기준 6점과 같아 가격 유지 대상입니다.':`기준 6점보다 ${Math.abs(score-6).toFixed(2).replace(/\.?0+$/,'')}점 ${score>6?'높아 상승':'낮아 하락'} 대상입니다.`;
 const time=facts.minutes<60?` ${facts.minutes}분 출전으로 ${Math.round(exposure*100)}%만 반영합니다.`:'';
 const limit=Math.abs(raw)>10?' 경기당 최대 변동률 10%를 적용합니다.':'';
 const bound=direction==='유지'&&rate!==0?' 가격 상하한 또는 포인트 반올림으로 실제 가격은 유지됐습니다.':'';
 return `${basis}${time}${limit}${bound}`;
}
