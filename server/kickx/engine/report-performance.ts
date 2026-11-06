/** Pure match scoring. Raw BSD JSON and unverified zeros are never rewritten. */
import { SCORING } from "./report-policy";
export { RULE_VERSION } from "./report-policy";
type Json = Record<string, unknown>;
export type ScoreInput = { fixtureId: string; playerId: string; teamId: string; status: string; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; stats: Json; legacy: Json | null; source: { detail?: Json | null; lineups?: Json | null; incidents?: Json | null }; clubCompetitions?: boolean; durationMinutes?: number; regularSeasonOnly?:boolean };
export type ScoreResult = { fixtureId: string; position: string | null; minutes: number | null; score: number | null; status: "ready" | "provisional" | "blocked" | "not-played"; breakdown: { metric: string; value: number; points: number; evidence: string }[]; warnings: string[] };
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const list = (v: unknown): Json[] => Array.isArray(v) ? v.map(object) : [];
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? `bsd-${v}` : "";
const code = (v: unknown) => String(v ?? "").replace(/[^a-z]/gi, "").toLowerCase();
const ownGoal = (e: Json) => e.own_goal === true || e.is_own_goal === true || ["owngoal", "own"].includes(code(e.goal_type ?? e.incident_class ?? e.incidentClass));
const cardKind = (e: Json) => code(e.card_type ?? e.card ?? e.incident_class ?? e.incidentClass ?? e.detail);
export function regularSeasonScope(detail:Json):boolean|null {
 const stage=code(detail.stage);
 if(['leaguephase','regularseason'].includes(stage))return true;
 if(/qualification|final|playoff|relegation|promotion|knockout|roundof/.test(stage))return false;
 if(!stage&&/^(league phase|regular season)\b/i.test(String(detail.round_label??'')))return true;
 return null;
}
export function calculatePerformance(input: ScoreInput): ScoreResult {
 const result: ScoreResult = { fixtureId: input.fixtureId, position: null, minutes: null, score: null, status: "blocked", breakdown: [], warnings: [] };
 const stop = (why: string) => { result.warnings.push(why); return result; };
 if (!["FT", "AET", "PEN"].includes(input.status)) return stop("MATCH_NOT_FINISHED");
 if (input.status !== "FT" && !input.clubCompetitions) return stop("EXTRA_TIME_REQUIRES_REVIEW");
 const detail=object(input.source.detail),extra=object(detail.extra_time_score),shootout=object(detail.penalty_shootout);
 if(input.regularSeasonOnly){const scope=regularSeasonScope(detail);if(scope!==true)return stop(scope===false?'OUTSIDE_COMPETITION_SCOPE':'REGULAR_SEASON_SCOPE_REQUIRED');}
 const duration=input.clubCompetitions && (input.status==='AET'||detail.extra_time_score!=null)?120:90;
 if(input.status==='AET' && (count(extra.home)==null||count(extra.away)==null))return stop('EXTRA_TIME_SCORE_REQUIRED');
 if(input.status==='PEN' && (count(shootout.home)==null||count(shootout.away)==null||shootout.home===shootout.away))return stop('SHOOTOUT_RESULT_REQUIRED');
 if(input.status==='PEN' && input.homeScore!==input.awayScore)return stop('SHOOTOUT_SCORE_CONFLICT');
 if(duration===120 && (count(extra.home)==null||count(extra.away)==null))return stop('EXTRA_TIME_SCORE_REQUIRED');
 if (![input.homeTeam, input.awayTeam].includes(input.teamId)) return stop("INVALID_TEAM");
 const minutes = count(input.stats.minutes_played);
 const observedDuration = input.durationMinutes ?? duration;
 if (!Number.isSafeInteger(observedDuration) || observedDuration < duration || observedDuration > 180) return stop("INVALID_MATCH_DURATION");
 if (minutes == null || minutes > observedDuration) return stop("INVALID_MINUTES");
 result.minutes = minutes;
 const lineups = input.source.lineups;
 if (lineups?.lineup_status !== "confirmed") return stop("CONFIRMED_LINEUP_REQUIRED");
 const sides = Object.values(object(lineups.lineups)).map(object);
 const side = sides.find(s => id(s.team_id) === input.teamId);
 const starters = list(side?.players), bench = list(side?.substitutes);
 if (sides.length !== 2 || sides.some(s => list(s.players).length !== 11)) return stop("INCOMPLETE_STARTERS");
 const player = [...starters, ...bench].find(p => id(p.id) === input.playerId);
 result.position = ({ G: "GK", D: "DF", M: "MF", F: "FW", GK: "GK", DF: "DF", MF: "MF", FW: "FW" } as Record<string, string>)[String(player?.position)] ?? null;
 const unavailable=list(object(lineups.unavailable_players)[input.teamId===input.homeTeam?'home':'away']).some(p=>id(p.id)===input.playerId);
 const roster=object(input.stats._roster_evidence);
 const rosterVerified=roster.fixtureId===input.fixtureId&&roster.teamId===input.teamId&&roster.playerId===input.playerId&&(roster.kind==='observed-squad'||roster.kind==='confirmed-lineup'&&bench.some(p=>id(p.id)===input.playerId)||roster.kind==='unavailable-list'&&unavailable);
 if ((!player || !result.position) && !(minutes===0&&(player||unavailable||rosterVerified))) return stop("MATCH_POSITION_REQUIRED");
 if (!Array.isArray(input.source.incidents?.incidents)) return stop("INCIDENTS_REQUIRED");
 const isShootout=(e:Json)=>e.is_penalty_shootout===true || e.penalty_shootout===true || ['penalties','penaltyshootout','shootout'].some(v=>[e.period,e.phase,e.incident_class,e.goal_type].some(x=>code(x)===v));
 const events = list(input.source.incidents?.incidents).filter(e => e.rescinded !== true && e.cancelled !== true && e.disallowed !== true && !isShootout(e));
 // Duplicate provider incident IDs are counted once. Distinct same-minute events stay distinct.
 const seen = new Set<unknown>();
 const ordered: Json[] = events.filter(e => e.id == null || (!seen.has(e.id) && !!seen.add(e.id))).map((e, index) => ({ ...e, order: index }));
 const goals = ordered.filter(e => e.type === "goal");
 if (input.homeScore == null || input.awayScore == null || goals.some(e => typeof e.is_home !== "boolean" || count(e.minute) == null || !id(e.player_id))) return stop("GOAL_TIMELINE_INCOMPLETE");
 if (goals.filter(e => e.is_home === true).length !== input.homeScore || goals.filter(e => e.is_home === false).length !== input.awayScore) return stop("GOAL_SCORE_MISMATCH");
 for(const e of ordered.filter(e=>e.type==='varDecision')){
  // A completed match can retain an explicitly rejected VAR check. Only
  // accepted or unresolved reviews need verification; score/card checks remain.
  if(['review','mistakenIdentity'].includes(String(e.decision))&&e.confirmed!==false)return stop('VAR_REVIEW_REQUIRED');
  if(['cardUpgrade','redCardGiven'].includes(String(e.decision))){
   if(typeof e.confirmed!=='boolean')return stop('VAR_REVIEW_REQUIRED');
   if(e.confirmed===true&&!ordered.some(c=>c.type==='card'&&id(c.player_id)===id(e.player_id)&&['red','redcard','yellowred','secondyellow','secondyellowcard'].includes(cardKind(c))))return stop('VAR_CARD_TIMELINE_REQUIRED');
   if(e.confirmed===true&&e.decision==='cardUpgrade'&&ordered.some(c=>c.type==='card'&&id(c.player_id)===id(e.player_id)&&c.minute===e.minute&&['yellow','yellowcard'].includes(cardKind(c))))return stop('VAR_CARD_TIMELINE_REQUIRED');
  }
 }
 const my = ordered.filter(e => id(e.player_id) === input.playerId);
 const cards = my.filter(e => e.type === "card");
 if (cards.some(e => !["yellow", "yellowcard", "red", "redcard", "yellowred", "secondyellow", "secondyellowcard"].includes(cardKind(e)))) return stop("UNKNOWN_CARD_KIND");
 const red = cards.filter(e => ["red", "redcard", "yellowred", "secondyellow", "secondyellowcard"].includes(cardKind(e)));
 if (red.length > 1) return stop("DUPLICATE_RED_REVIEW");
 const yellow = cards.filter(e => ["yellow", "yellowcard"].includes(cardKind(e))).length;
 const statRed = count(input.stats.red_card), statYellow = count(input.stats.yellow_card);
 // Red replaces the triggering second yellow; the earlier warning remains.
 const secondYellow = red.some(e => ["yellowred", "secondyellow", "secondyellowcard"].includes(cardKind(e)));
 if ((statRed != null && statRed > red.length) || (statYellow != null && statYellow > yellow + (secondYellow ? 1 : 0))) return stop("CARD_TIMELINE_MISMATCH");
 const enters = ordered.filter(e => e.type === "substitution" && id(e.player_in_id) === input.playerId);
 const exits = ordered.filter(e => e.type === "substitution" && id(e.player_out_id) === input.playerId);
 const starter = starters.some(p => id(p.id) === input.playerId);
 if (enters.length > 1 || exits.length > 1 || (starter && enters.length)) return stop("INVALID_PARTICIPATION");
 if (minutes === 0) {
  if (starter || enters.length || my.some(e => e.type === "goal")) return stop("ZERO_MINUTES_CONFLICT");
  result.status = "not-played"; result.warnings.push("NON_PARTICIPATION_PRICE_DECAY"); return result;
 }
 if (!starter && enters.length !== 1) return stop("ENTRY_TIME_REQUIRED");
 const entry = starter ? null : enters[0];
 const exit = exits[0] ?? red[0];
 const start = entry ? count(entry.minute) : 0, end = exit ? count(exit.minute) : observedDuration;
 // BSD mixes regulation-clock substitutions with playing minutes including
 // stoppage time. Bound the discrepancy by the actual announced/boundary
 // added time, rather than rejecting valid late substitutes and 45+ dismissals.
 const announced=(at:number)=>Math.max(0,...ordered.filter(e=>e.type==='injuryTime'&&e.minute===at&&count(e.length)!=null&&Number(e.length)<=30).map(e=>Number(e.length)));
 const boundaryAdded=(at:number)=>Math.max(0,...[entry,exit].filter(e=>e?.minute===at&&count(e.added_time)!=null&&Number(e.added_time)<=30).map(e=>Number(e!.added_time)));
 const firstAdded=start!=null&&end!=null&&start<45&&end>=45?Math.max(announced(45),boundaryAdded(45)):0;
 const finalAdded=end!=null&&end>=duration?Math.max(announced(duration),boundaryAdded(duration)):0;
 const allowance=Math.max(observedDuration-duration,firstAdded+finalAdded);
 if (start == null || end == null || start > end || (minutes < Math.min(observedDuration,end)-Math.min(observedDuration,start)-allowance-2 || minutes > Math.min(observedDuration,end)-Math.min(observedDuration,start)+allowance+2)) return stop("MINUTES_INTERVAL_MISMATCH");
 // Provider arrays may be newest-first. Equal-minute boundaries need explicit timing.
 const compareTime=(a:Json,b:Json)=>{
  if(Number(a.minute)!==Number(b.minute))return Number(a.minute)-Number(b.minute);
  if(count(a.added_time)!=null&&count(b.added_time)!=null&&a.added_time!==b.added_time)return Number(a.added_time)-Number(b.added_time);
  if(count(a.period_second)!=null&&count(b.period_second)!=null&&a.period_second!==b.period_second)return Number(a.period_second)-Number(b.period_second);
  return null;
 };
 // Boundary order matters only for opponent goals that affect this position's
 // clean-sheet/conceded points. Own-team goals and FW concessions cannot change P.
 if(result.position!=="FW"&&goals.some(e=>e.is_home!==(input.teamId===input.homeTeam)&&((entry&&compareTime(e,entry)==null)||(exit&&compareTime(e,exit)==null))))return stop("GOAL_BOUNDARY_TIME_AMBIGUOUS");
 const afterEntry = (e: Json) => !entry || (compareTime(e,entry)??0)>0;
 const beforeExit = (e: Json) => !exit || (compareTime(e,exit)??0)<0;
 // Team concessions are charged only during the player's actual participation.
 const conceded = goals.filter(e => e.is_home !== (input.teamId === input.homeTeam) && afterEntry(e) && beforeExit(e)).length;
 const own = my.filter(e => e.type === "goal" && ownGoal(e)).length;
 const scored = my.filter(e => e.type === "goal" && !ownGoal(e)).length;
 const rawGoals = count(input.stats.goals);
 if (rawGoals != null && rawGoals > 0 && rawGoals !== scored) return stop("PLAYER_GOALS_MISMATCH");
 const add = (metric: string, value: number, points: number, evidence = "incident") => result.breakdown.push({ metric, value, points:points===0?0:points, evidence });
 const position = result.position as keyof typeof SCORING.goals;

 add("minutes",minutes,SCORING.base,"verified appearance; neutral starting assessment, not a minutes bonus");
 add("goals",scored,scored * SCORING.goals[position]);
 add("yellow_cards",yellow,SCORING.yellow * yellow);add("red_cards",red.length,SCORING.red * red.length);add("own_goals",own,SCORING.ownGoal * own);
 // BSD's zero defaults remain unknown. Optional metrics contribute only when positively
 // reported (or explicitly verified in a later provider adapter), and are disclosed.
 const positive = (key: string, label: string, weight: number, group=1, raw: Json=input.stats) => {
  const n = count(raw[key]);
  if (n == null || n===0) {result.warnings.push(`${label}:UNVERIFIED_OR_MISSING_EXCLUDED`);return;}
  add(label,n,(group===1 ? n : Math.floor(n/group))*weight,key);
 };
 positive("goal_assist","assists",SCORING.assist[position]);
 if (position !== "GK") {
  if (position === "MF" || position === "FW") positive("shots_on_target","shots_on_target",SCORING.shotOnTarget[position]);
  positive("key_pass","key_passes",SCORING.keyPass[position]);positive("accurate_cross","crosses_completed",SCORING.cross);
  const attempts=count(input.stats.total_pass),completed=count(input.stats.accurate_pass);
  if (attempts != null && completed != null && completed>attempts) return stop("INVALID_PASS_TOTALS");
  if((position === "DF" || position === "MF") && attempts!=null && attempts>=SCORING.passThreshold && completed!=null && completed>0) add("pass_accuracy",completed/attempts*100,completed/attempts>=SCORING.passAccuracy ? SCORING.passBonus : 0,"accurate_pass / total_pass; attempts > 0");
  else result.warnings.push("pass_accuracy:UNVERIFIED_OR_THRESHOLD_NOT_MET");
  if (position === "DF" || position === "MF") {
   const tackles=count(input.stats.won_tackle), interceptions=count(input.stats.interception);
   const actions=(tackles ?? 0)+(interceptions ?? 0);
   if(actions>0)add("defensive_actions",actions,position==="DF" ? Math.floor(actions/3)*.3 : actions*.15,"won_tackle + interception; verified actions only");
   if(!tackles || !interceptions)result.warnings.push("defensive_actions:PARTIAL_OR_UNVERIFIED_COUNTERS");
  }
 }

 if (position !== "FW") add("clean_sheet",conceded===0 && minutes>=60 && !red.length ? 1 : 0,conceded===0 && minutes>=60 && !red.length ? SCORING.cleanSheet[position] : 0,"no concessions during participation; >=60 minutes; no dismissal");
 if(position==='GK' || position==='DF') add("conceded",conceded,-Math.floor(conceded/2)*.5,"goals during participation only");
 if(position==='GK'){positive("saves","saves",SCORING.save,3);if(input.status!=='PEN')positive("penalty_save","penalty_saves",SCORING.penaltySave,1,input.legacy ?? {});else result.warnings.push('SHOOTOUT_PENALTY_SAVE_COUNTER_UNVERIFIED_EXCLUDED');}
 // Round each displayed contribution so its visible sum equals the stored total.
 result.breakdown = result.breakdown.map(b => ({...b,points:Math.round(b.points * 100) / 100}));
 const total=Math.round(result.breakdown.reduce((sum,x)=>sum+x.points,0) * 100) / 100;
 result.score=Math.max(0,Math.min(10,total));
 if(total!==result.score)add('score_range',total,Math.round((result.score-total)*100)/100,'assessment bounded to 0–10');
 result.status="provisional";
 result.warnings.push("BSD_OPTIONAL_METRICS_PROVISIONAL");
 return result;
}
