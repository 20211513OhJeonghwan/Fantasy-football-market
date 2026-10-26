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
