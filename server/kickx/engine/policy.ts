/** KICK-X rules inspired by Bundesliga scoring and AFL historical pricing.
 * These coefficients are KICK-X's own, not a reproduction of an unpublished formula. */
export const RULE_VERSION = "form-v2";
export const SCORING = {
  appearance: 10, fullMinutes: 20,
  goals: { GK: 50, DF: 40, MF: 35, FW: 30 },
  assist: 20, shotOnTarget: 3, keyPass: 2, cross: 1,
  tackle: 1.5, interception: 2, save: 3, penaltySave: 20,
  passBonus: 5, passThreshold: 30, passAccuracy: .85,
  cleanSheet: { GK: 20, DF: 20, MF: 8, FW: 0 },
  teamWin: 5, yellow: -3, red: -12, ownGoal: -10, conceded: -3,
} as const;
export const PRICING = {
  pointsUnit: 2000, neutralScore: 50, priorGames: 5,
  windowWeights: [5, 4, 3, 2, 1], adjustment: .4,
  maxChange: .08, fullExposureMinutes: 60, minPrice: 10000, maxPrice: 1000000,
} as const;
