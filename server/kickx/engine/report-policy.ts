/** Report sections 6 and 7. Explicit defaults; references are frozen before activation. */
export const RULE_VERSION = "report-v3";
export const SCORING_REVISION = "report-additive-20261106";
export const SCORING = {
 goals:{GK:10,DF:6,MF:5,FW:4}, assist:{GK:5,DF:4,MF:3,FW:3},
 shotOnTarget:{MF:.5,FW:1}, keyPass:{DF:.5,MF:1,FW:.5}, cross:.5,
 passThreshold:1,passAccuracy:.85,passBonus:1,
 cleanSheet:{GK:4,DF:4,MF:1,FW:0},save:1,penaltySave:5,
 yellow:-1,red:-3,ownGoal:-2,
 completedPasses:.5,ballRecovery:.5,clearance:.25,dribble:.5,shotBlock:.5,foulWon:.25,highClaim:.5,keeperSweeper:.5,
} as const;
export const REPORT_PARAMETERS = {
 lambda:5,kappa:4,beta:.3,s:1,deviationLimit:1,
 initialMin:50000,initialMax:150000,minPrice:10000,maxPrice:1000000,
 maxUp:.10,maxDown:.10,nonParticipationRate:.015,lowerQuantile:.05,upperQuantile:.95,
 priceSensitivity:.10,
} as const;
