/** Pure, versioned prototype. Raw BSD JSON and its unverified zeros are never rewritten. */
export const RULE_VERSION = "prototype-v1";
type Json = Record<string, unknown>;
export type ScoreInput = { fixtureId: string; playerId: string; teamId: string; status: string; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; stats: Json; legacy: Json | null; source: { lineups?: Json | null; incidents?: Json | null } };
export type ScoreResult = { fixtureId: string; position: string | null; score: number | null; status: "ready" | "provisional" | "blocked" | "not-played"; breakdown: { metric: string; value: number; points: number; evidence: string }[]; warnings: string[] };
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const list = (v: unknown): Json[] => Array.isArray(v) ? v.map(object) : [];
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? `bsd-${v}` : "";
const code = (v: unknown) => String(v ?? "").replace(/[^a-z]/gi, "").toLowerCase();
const ownGoal = (e: Json) => e.own_goal === true || e.is_own_goal === true || ["owngoal", "own"].includes(code(e.goal_type ?? e.incident_class ?? e.incidentClass));
const cardKind = (e: Json) => code(e.card_type ?? e.card ?? e.incident_class ?? e.incidentClass ?? e.detail);
export function calculatePerformance(input: ScoreInput): ScoreResult {
 const result: ScoreResult = { fixtureId: input.fixtureId, position: null, score: null, status: "blocked", breakdown: [], warnings: [] };
 const stop = (why: string) => { result.warnings.push(why); return result; };
 if (!["FT", "AET", "PEN"].includes(input.status)) return stop("MATCH_NOT_FINISHED");
 if (input.status !== "FT") return stop("EXTRA_TIME_REQUIRES_REVIEW");
 if (![input.homeTeam, input.awayTeam].includes(input.teamId)) return stop("INVALID_TEAM");
 const minutes = count(input.stats.minutes_played);
 if (minutes == null || minutes > 90) return stop("INVALID_MINUTES");
 const lineups = input.source.lineups;
 if (lineups?.lineup_status !== "confirmed") return stop("CONFIRMED_LINEUP_REQUIRED");
 const sides = Object.values(object(lineups.lineups)).map(object);
 const side = sides.find(s => id(s.team_id) === input.teamId);
 const starters = list(side?.players), bench = list(side?.substitutes);
 if (sides.length !== 2 || sides.some(s => list(s.players).length !== 11)) return stop("INCOMPLETE_STARTERS");
 const player = [...starters, ...bench].find(p => id(p.id) === input.playerId);
 result.position = ({ G: "GK", D: "DF", M: "MF", F: "FW", GK: "GK", DF: "DF", MF: "MF", FW: "FW" } as Record<string, string>)[String(player?.position)] ?? null;
 if (!player || !result.position) return stop("MATCH_POSITION_REQUIRED");
 if (!Array.isArray(input.source.incidents?.incidents)) return stop("INCIDENTS_REQUIRED");
 const events = list(input.source.incidents?.incidents).filter(e => e.rescinded !== true && e.cancelled !== true && e.disallowed !== true);
 // Duplicate provider incident IDs are counted once. Distinct same-minute events stay distinct.
 const seen = new Set<unknown>();
 const ordered: Json[] = events.filter(e => e.id == null || (!seen.has(e.id) && !!seen.add(e.id))).map((e, index) => ({ ...e, order: index }));
 const goals = ordered.filter(e => e.type === "goal");
 if (input.homeScore == null || input.awayScore == null || goals.some(e => typeof e.is_home !== "boolean" || count(e.minute) == null || !id(e.player_id))) return stop("GOAL_TIMELINE_INCOMPLETE");
 if (goals.filter(e => e.is_home === true).length !== input.homeScore || goals.filter(e => e.is_home === false).length !== input.awayScore) return stop("GOAL_SCORE_MISMATCH");
 if (ordered.some(e => e.type === "varDecision" && ["review","mistakenIdentity","cardUpgrade","redCardGiven"].includes(String(e.decision)))) return stop("VAR_REVIEW_REQUIRED");
 const my = ordered.filter(e => id(e.player_id) === input.playerId);
 const cards = my.filter(e => e.type === "card");
 if (cards.some(e => !["yellow", "yellowcard", "red", "redcard", "yellowred", "secondyellow", "secondyellowcard"].includes(cardKind(e)))) return stop("UNKNOWN_CARD_KIND");
 const red = cards.filter(e => ["red", "redcard", "yellowred", "secondyellow", "secondyellowcard"].includes(cardKind(e)));
 if (red.length > 1) return stop("DUPLICATE_RED_REVIEW");
 const yellow = cards.filter(e => ["yellow", "yellowcard"].includes(cardKind(e))).length;
 const statRed = count(input.stats.red_card), statYellow = count(input.stats.yellow_card);
 // Red replaces the triggering second yellow; an earlier yellow is still -1.
 const secondYellow = red.some(e => ["yellowred", "secondyellow", "secondyellowcard"].includes(cardKind(e)));
 if ((statRed != null && statRed > red.length) || (statYellow != null && statYellow > yellow + (secondYellow ? 1 : 0))) return stop("CARD_TIMELINE_MISMATCH");
 const enters = ordered.filter(e => e.type === "substitution" && id(e.player_in_id) === input.playerId);
 const exits = ordered.filter(e => e.type === "substitution" && id(e.player_out_id) === input.playerId);
 const starter = starters.some(p => id(p.id) === input.playerId);
 if (enters.length > 1 || exits.length > 1 || (starter && enters.length)) return stop("INVALID_PARTICIPATION");
 if (minutes === 0) {
  if (starter || enters.length || my.some(e => e.type === "goal")) return stop("ZERO_MINUTES_CONFLICT");
  result.status = "not-played"; result.warnings.push("NO_PRICE_CHANGE_FOR_NON_PARTICIPATION"); return result;
 }
 if (!starter && enters.length !== 1) return stop("ENTRY_TIME_REQUIRED");
 const entry = starter ? null : enters[0];
 const exit = exits[0] ?? red[0];
 const start = entry ? count(entry.minute) : 0, end = exit ? count(exit.minute) : 90;
 if (start == null || end == null || start > end || Math.abs(Math.min(90,end)-Math.min(90,start)-minutes) > 2) return stop("MINUTES_INTERVAL_MISMATCH");
 // Provider arrays may be newest-first. Equal-minute boundaries need explicit timing.
 const compareTime=(a:Json,b:Json)=>{
  if(Number(a.minute)!==Number(b.minute))return Number(a.minute)-Number(b.minute);
  if(count(a.added_time)!=null&&count(b.added_time)!=null&&a.added_time!==b.added_time)return Number(a.added_time)-Number(b.added_time);
  if(count(a.period_second)!=null&&count(b.period_second)!=null&&a.period_second!==b.period_second)return Number(a.period_second)-Number(b.period_second);
  return null;
 };
 if(goals.some(e=>(entry&&compareTime(e,entry)==null)||(!red.length&&exit&&compareTime(e,exit)==null)))return stop("GOAL_BOUNDARY_TIME_AMBIGUOUS");
 const afterEntry = (e: Json) => !entry || (compareTime(e,entry)??0)>0;
 const beforeExit = (e: Json) => !exit || (compareTime(e,exit)??0)<0;
 // Red-card players retain responsibility for later concessions, consistent with FPL.
 const conceded = goals.filter(e => e.is_home !== (input.teamId === input.homeTeam) && afterEntry(e) && (red.length ? true : beforeExit(e))).length;
 const own = my.filter(e => e.type === "goal" && ownGoal(e)).length;
 const scored = my.filter(e => e.type === "goal" && !ownGoal(e)).length;
 const rawGoals = count(input.stats.goals);
 if (rawGoals != null && rawGoals !== scored) return stop("PLAYER_GOALS_MISMATCH");
 const add = (metric: string, value: number, points: number, evidence = "incident") => result.breakdown.push({ metric, value, points:points===0?0:points, evidence });
 add("minutes",minutes,minutes>=60 ? 2 : 1,"minutes_played + lineup/substitution");
 add("goals",scored,scored*({GK:10,DF:6,MF:5,FW:4}[result.position as "GK"|"DF"|"MF"|"FW"]));
 add("yellow_cards",yellow,-yellow);add("red_cards",red.length,-3*red.length);add("own_goals",own,-2*own);
 // BSD's zero defaults remain unknown. Optional metrics contribute only when positively
 // reported (or explicitly verified in a later provider adapter), and are disclosed.
 const positive = (key: string, label: string, weight: number, group=1, raw: Json=input.stats) => {
  const n = count(raw[key]);
  if (n == null || n===0) {result.warnings.push(`${label}:UNVERIFIED_OR_MISSING_EXCLUDED`);return;}
  add(label,n,(group===1 ? n : Math.floor(n/group))*weight,key);
 };
 positive("goal_assist","assists",({GK:5,DF:4,MF:3,FW:3}[result.position as "GK"|"DF"|"MF"|"FW"]));
 if (result.position === "MF" || result.position === "FW") positive("shots_on_target","shots_on_target",result.position === "MF" ? .5 : 1);
 if (result.position !== "GK") {positive("key_pass","key_passes",result.position === "MF" ? 1 : .5);positive("accurate_cross","crosses_completed",.5);}
 if (result.position === "MF" || result.position === "DF") {
  const attempts=count(input.stats.total_pass),completed=count(input.stats.accurate_pass);
  if (attempts != null && completed != null && completed>attempts) return stop("INVALID_PASS_TOTALS");
  if(attempts!=null && attempts>=30 && completed!=null && completed>0) add("pass_accuracy",completed/attempts*100,completed/attempts>=.85 ? 1 : 0,"accurate_pass / total_pass; attempts >= 30");
  else result.warnings.push("pass_accuracy:UNVERIFIED_OR_THRESHOLD_NOT_MET");
  const tackles=count(input.stats.won_tackle),interceptions=count(input.stats.interception);
  if(tackles && interceptions) add("defensive_actions",tackles+interceptions,Math.floor((tackles+interceptions)/3)*(result.position==='DF'?1:.5),"won_tackle + interception, per 3");
  else if(tackles || interceptions) {add("defensive_actions",(tackles ?? 0)+(interceptions ?? 0),Math.floor(((tackles ?? 0)+(interceptions ?? 0))/3)*(result.position==='DF'?1:.5),"positive reported counters only");result.warnings.push("defensive_actions:PARTIAL_COUNTERS");}
  else result.warnings.push("defensive_actions:UNVERIFIED_OR_MISSING_EXCLUDED");
 }
 if (result.position !== "FW") add("clean_sheet",conceded===0 && minutes>=60 && !red.length ? 1 : 0,conceded===0 && minutes>=60 && !red.length ? result.position==='MF'?1:4 : 0,"lineup + goal timeline; 60 minutes; no dismissal");
 if(result.position==='GK' || result.position==='DF') add("conceded",conceded,-Math.floor(conceded/2),"goals during participation (after dismissal included)");
 if(result.position==='GK'){positive("saves","saves",1,3);positive("penalty_save","penalty_saves",5,1,input.legacy ?? {});}
 result.score=result.breakdown.reduce((sum,x)=>sum+x.points,0);
 result.status="provisional";
 result.warnings.push("PROTOTYPE_INCIDENT_COMPLETENESS_ASSUMPTION");
 return result;
}
export function priceFromScores(scores: ScoreResult[], initial=100000) {
 return scores.reduce((price,r) => r.score == null || !["ready","provisional"].includes(r.status) ? price : Math.max(10000,Math.min(1000000,Math.round(price*(1+Math.max(-5,Math.min(5,r.score-4))/100)))),initial);
}
