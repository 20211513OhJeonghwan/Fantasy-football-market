/** Report sections 6 and 7. Explicit defaults; references are frozen before activation. */
export const RULE_VERSION = "report-v3";
export const SCORING = {
 goals:{GK:10,DF:6,MF:5,FW:4}, assist:{GK:5,DF:4,MF:3,FW:3},
 shotOnTarget:{MF:.5,FW:1}, keyPass:{DF:.5,MF:1,FW:.5}, cross:.5,
 passThreshold:1,passAccuracy:.85,passBonus:1,
 cleanSheet:{GK:4,DF:4,MF:1,FW:0},save:1,penaltySave:5,
 yellow:-1,red:-3,ownGoal:-2,
} as const;
export const REPORT_PARAMETERS = {
 lambda:5,kappa:4,beta:.3,s:1,deviationLimit:1,
 initialMin:10000,initialMax:1000000,minPrice:10000,maxPrice:1000000,
 maxUp:.02,maxDown:.02,lowerQuantile:.05,upperQuantile:.95,
} as const;
