import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculatePerformance, RULE_VERSION } from "./performance";
import { calculatePerformance as calculateLegacy } from "./legacy-performance";
import { calculatePricing } from "./pricing";
import { HttpError } from "../http";
import { checkDatabase } from "../prototype";
export async function calculatePlayer(db: SupabaseClient, playerId: string, actor: string | null, preview=false,
 previewPolicy?: {referenceAt:string;referenceSeason:number|null}) {
 if (previewPolicy && !preview) throw new HttpError(400,"시험 정책은 읽기 전용으로만 사용할 수 있습니다.");
 const policy = await db.from("kickx_policy").select("*").single();checkDatabase(policy.error);
 const version = previewPolicy ? RULE_VERSION : policy.data.version;
 if (![RULE_VERSION,"prototype-v1"].includes(version)) throw new HttpError(409,"지원하지 않는 산정 정책입니다.");
 const calculator = version === RULE_VERSION ? calculatePerformance : calculateLegacy;
 const stats=[];
 for(let offset=0;;offset+=500){
  const r=await db.from("football_match_stats").select("*,fixtures!inner(*,football_event_sources(*))").eq("player_id",playerId).order("fixture_id").range(offset,offset+499);
  checkDatabase(r.error);stats.push(...(r.data??[]));if((r.data?.length??0)<500)break;if(offset>=9500)throw new HttpError(422,"선수 기록 범위가 너무 큽니다.");
 }
 const expected=stats.map(m=>({fixture:m.fixture_id,statsAt:m.updated_at,sourceAt:m.fixtures.football_event_sources?.updated_at??null,fixtureAt:m.fixtures.updated_at}));
 const ordered=stats.sort((a,b)=>a.fixtures.starts_at.localeCompare(b.fixtures.starts_at)||a.fixture_id.localeCompare(b.fixture_id));
 const results=ordered.map(m=>({...calculator({fixtureId:m.fixture_id,playerId,teamId:m.team_id,status:m.fixtures.status,homeTeam:m.fixtures.home_team_id,awayTeam:m.fixtures.away_team_id,homeScore:m.fixtures.home_score,awayScore:m.fixtures.away_score,stats:m.stats,legacy:m.legacy_stats,source:m.fixtures.football_event_sources??{}}),ruleVersion:version}));
 const referenceAt = previewPolicy?.referenceAt ?? policy.data.pricing_reference_at;
 const referenceSeason = previewPolicy?.referenceSeason ?? policy.data.pricing_reference_season;
 const pricing = version === RULE_VERSION ? calculatePricing(results.map((r,i)=>({...r,minutes:ordered[i].stats?.minutes_played ?? null,startedAt:ordered[i].fixtures.starts_at,season:ordered[i].fixtures.season})),referenceAt,referenceSeason) : null;
 const hash=createHash("sha256").update(JSON.stringify({version,reference:referenceAt ?? null,referenceSeason:referenceSeason ?? null,results,pricing})).digest("hex");
 if(preview)return {playerId,version,results,pricing,hash};
 // The DB independently computes prices from these scores and its own fixture dates.
 // An old DB keeps using v1 until the additive v2 migration is applied.
 const saved=await db.rpc("kickx_publish_calculation",{p_actor:actor,p_player:playerId,p_hash:hash,p_expected:expected,p_results:results});checkDatabase(saved.error);
 return {playerId,results:results.map(r=>({fixtureId:r.fixtureId,status:r.status,warnings:r.warnings})),...saved.data};
}
