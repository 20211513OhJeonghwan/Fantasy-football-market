/** Report sections 6 and 7. Explicit defaults; references are frozen before activation. */
export const RULE_VERSION = "report-v3";
export const SCORING_REVISION = "neutral-six-20261106";
export const SCORING = {
 base:6, goals:{GK:4,DF:3,MF:2.5,FW:2}, assist:{GK:2,DF:1.5,MF:1.5,FW:1.5},
 shotOnTarget:{MF:.2,FW:.25}, keyPass:{DF:.15,MF:.25,FW:.15}, cross:.1,
 passThreshold:1,passAccuracy:.85,passBonus:.3,
 cleanSheet:{GK:1,DF:1,MF:.3,FW:0},save:.5,penaltySave:3,
 yellow:-.7,red:-2.5,ownGoal:-1.5,
} as const;
export const REPORT_PARAMETERS = {
 lambda:5,kappa:4,beta:.3,s:1,deviationLimit:1,
 initialMin:50000,initialMax:150000,minPrice:10000,maxPrice:1000000,
 maxUp:.10,maxDown:.10,nonParticipationRate:.015,lowerQuantile:.05,upperQuantile:.95,
 neutralScore:6,pointRate:.025,
} as const;
