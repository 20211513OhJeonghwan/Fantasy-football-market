import { PRICING, RULE_VERSION } from "./policy";

export type PricingMatch = {
  fixtureId: string; score: number | null; status: string; minutes: number | null;
  startedAt: string; season: number | null;
};
export type PricingStep = {
  fixtureId: string; playedAt: string; priceBefore: number; priceAfter: number;
  targetPrice: number; formScore: number; changePercent: number; window: string[];
};
export type PricingPlan = {
  version: string;
  baseline: { referenceAt: string; anchorAt: string; season: number | null;
    source: string; gameCount: number; meanScore: number | null; seedScore: number;
    price: number; fixtures: string[]; warnings: string[] };
  price: number; steps: PricingStep[];
};
const bound = (n: number) => Math.max(PRICING.minPrice, Math.min(PRICING.maxPrice, n));
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const eligible = (r: PricingMatch) => ["ready", "provisional"].includes(r.status) &&
  r.score != null && Number.isFinite(r.score) && r.minutes != null && r.minutes > 0 && r.minutes <= 90;

/** Price is replayed from a fixed policy reference, never compounded again on scheduler retries.
 * Previous-season history seeds the market. If unavailable, the latest available historical
 * season before referenceAt is used, clearly labelled. Future matches cannot enter the seed. */
export function calculatePricing(matches: PricingMatch[], referenceAt: string, referenceSeason: number | null = null): PricingPlan {
  const cutoff = Date.parse(referenceAt);
  if (!Number.isFinite(cutoff)) throw new Error("INVALID_PRICING_REFERENCE");
  const ids = new Set<string>();
  for (const r of matches) {
    if (!r.fixtureId || ids.has(r.fixtureId) || !Number.isFinite(Date.parse(r.startedAt))) throw new Error("INVALID_PRICING_MATCH");
    ids.add(r.fixtureId);
  }
  const played = matches.filter(eligible).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.fixtureId.localeCompare(b.fixtureId));
  const historical = played.filter(r => Date.parse(r.startedAt) <= cutoff);
  const seasons = historical.flatMap(r => r.season == null ? [] : [r.season]);
  const currentSeason = referenceSeason ?? (seasons.length ? Math.max(...seasons) : null);
  const previousSeasons = seasons.filter(s => currentSeason != null && s < currentSeason);
  const previousSeason = previousSeasons.length ? Math.max(...previousSeasons) : null;
  const season = previousSeason ?? (seasons.length ? Math.max(...seasons) : null);
  const pool = historical.filter(r => season == null || r.season === season);
  const n = pool.length;
  const meanScore = n ? pool.reduce((sum, r) => sum + r.score!, 0) / n : null;
  // Five neutral prior games temper tiny samples; missing data is not treated as zero.
  const seedScore = ((meanScore ?? 0) * n + PRICING.neutralScore * PRICING.priorGames) / (n + PRICING.priorGames);
  const initialPrice = Math.round(bound(seedScore * PRICING.pointsUnit));
  const anchorAt = previousSeason != null && n ? pool.at(-1)!.startedAt : referenceAt;
  const baseline = { referenceAt, anchorAt, season,
    source: previousSeason != null ? "previous-season" : n ? "available-history" : "neutral",
    gameCount: n, meanScore, seedScore, price: initialPrice, fixtures: pool.map(r => r.fixtureId),
    warnings: [ ...(previousSeason == null ? [n ? "PREVIOUS_SEASON_UNAVAILABLE" : "NO_USABLE_HISTORY"] : []),
      ...(n < 10 ? ["SMALL_SAMPLE_PRIOR"] : []),
      ...(pool.some(r => r.status === "provisional") ? ["PROVISIONAL_HISTORY"] : []) ],
  };
  let price = initialPrice;
  const window: PricingMatch[] = [], steps: PricingStep[] = [];
  for (const r of played) {
    window.push(r);
    if (window.length > PRICING.windowWeights.length) window.shift();
    if (Date.parse(r.startedAt) <= Date.parse(anchorAt)) continue;
    const latest = [...window].reverse();
    const formScore = PRICING.windowWeights.reduce((sum, weight, i) => sum + weight * (latest[i]?.score ?? seedScore), 0) / 15;
    const targetPrice = Math.round(bound(formScore * PRICING.pointsUnit));
    const maxChange = PRICING.maxChange * Math.min(1, r.minutes! / PRICING.fullExposureMinutes);
    const priceBefore = price;
    price = Math.round(bound(Math.max(priceBefore * (1 - maxChange), Math.min(priceBefore * (1 + maxChange), priceBefore + PRICING.adjustment * (targetPrice - priceBefore)))));
    steps.push({fixtureId:r.fixtureId,playedAt:r.startedAt,priceBefore,priceAfter:price,targetPrice,
      formScore:round(formScore,6),changePercent:round((price - priceBefore) * 100 / priceBefore,4),window:latest.map(m => m.fixtureId)});
  }
  return {version:RULE_VERSION,baseline,price,steps};
}
