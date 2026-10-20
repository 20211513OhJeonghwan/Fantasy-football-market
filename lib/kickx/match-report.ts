/** Small public DTO. Source statistics and provider responses are never stored here. */
export type ReportText = { performance: string; value: string };
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
