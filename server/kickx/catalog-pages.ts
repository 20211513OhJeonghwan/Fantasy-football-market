import "server-only";
import { attachTradeWindows } from "./trading";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fixture, Player } from "@/lib/kickx/types";
import { literalLike, type CatalogQuery } from "@/lib/kickx/catalog-query";
import { mapPlayer, mapFixture, PLAYER_COLUMNS, FIXTURE_COLUMNS } from "./catalog";
import { checkDatabase, migrationMissing } from "./prototype";
export type CatalogPage<T> = { items: T[]; total: number; page: number; size: number };
export async function readPlayerPage(client: SupabaseClient, input: CatalogQuery): Promise<CatalogPage<Player>> {
  let query = input.scope === "watch"
    ? client.rpc("watched_player_catalog", {}, { count: "exact" }).select(PLAYER_COLUMNS)
    : input.scope === "owned" ? client.rpc("owned_player_catalog", {}, {count:"exact"}).select(PLAYER_COLUMNS) : client.from("player_catalog").select(PLAYER_COLUMNS, { count: "exact" });
  if(!['owned','watch'].includes(input.scope))query=query.in('league_id',['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6']);
  if (input.q) query = query.ilike("search_text", `%${literalLike(input.q)}%`);
  if (input.league) query = query.contains("league_ids", [input.league]);
  if (input.team) query = query.eq("team_id", input.team);
  if (input.position) query = query.eq("position", input.position);
  if (input.scope === "rising") query = query.gt("change_percent", 0);
  if (input.scope === "falling") query = query.lt("change_percent", 0);
  const column = { price:"price", "price-asc":"price", change:"change_percent", performance:"performance", volume:"volume", name:"name" }[input.sort]!;
  const { data, error, count } = await query.order(column, { ascending: ["price-asc","name"].includes(input.sort), nullsFirst:false }).order("name").order("id")
    .range((input.page-1)*input.size, input.page*input.size-1);
  if (error) throw error;
  if (!Array.isArray(data) || count == null) throw new Error("Missing paginated catalog result");
  const rows=data as unknown as Record<string,unknown>[];
  return {items:await attachTradeWindows(client,rows.map(row=>mapPlayer(row, row))),total:count,page:input.page,size:input.size};
}
export async function readFixturePage(client: SupabaseClient, input: CatalogQuery): Promise<CatalogPage<Fixture>> {
  let query = client.from("fixture_catalog").select(FIXTURE_COLUMNS, {count:"exact"});
  if (input.q) query = query.ilike("search_text", `%${literalLike(input.q)}%`);
  if (input.league) query = query.eq("league_id", input.league);
  if (input.team) query = query.or(`home_team_id.eq.${input.team},away_team_id.eq.${input.team}`);
  if (input.state !== "all") query = query.eq("state", input.state);
  if (input.day) {
    const start = new Date(input.day+"T00:00:00+09:00");
    query = query.gte("starts_at",start.toISOString()).lt("starts_at",new Date(start.getTime()+86400000).toISOString());
  }
  const {data,error,count} = await query.order("starts_at").order("id").range((input.page-1)*input.size,input.page*input.size-1);
  if (error) throw error;
  if (!Array.isArray(data) || count == null) throw new Error("Missing paginated fixture result");
  return {items:(data as unknown as Record<string,unknown>[]).map(mapFixture),total:count,page:input.page,size:input.size};
}
export async function readPlayerDetail(client: SupabaseClient, id: string): Promise<Player | null> {
  const {data,error} = await client.from("player_catalog").select(PLAYER_COLUMNS).eq("id",id).maybeSingle();
  if(error) throw error;
  if(!data) return null;
  const since=new Date(Date.now()-31*86400000).toISOString();
  const snapshot=data as unknown as Record<string,unknown>;
  const player=mapPlayer(snapshot,snapshot);
  const [history,records,scores,baseline,priceSteps]=await Promise.all([
    client.from("price_history").select("recorded_at,value").eq("player_id",id).gte("recorded_at",since).order("recorded_at",{ascending:false}).limit(1000),
    client.from("player_match_records").select("id,fixture_id,played_at,opponent,result,minutes,goals,assists,performance").eq("player_id",id).order("played_at",{ascending:false}).limit(20),
    client.from("performance_results").select("fixture_id,score,status,rule_version,breakdown,warnings").eq("player_id",id).order("calculated_at",{ascending:false}).limit(20),
    client.from("player_initial_values").select("detail").eq("player_id",id).maybeSingle(),
    client.from("player_price_results").select("fixture_id,played_at,price_before,price_after,target_price,form_score,change_percent,window_fixture_ids").eq("player_id",id).order("played_at",{ascending:false}).order("fixture_id").limit(20),
    attachTradeWindows(client,[player]),
  ]);
  for(const result of [history,records]) if(result.error) throw result.error;
  const opponents = [...new Set((records.data ?? []).map(row => row.opponent))];
  const fixtureIds = [...new Set((records.data ?? []).map(row => row.fixture_id).filter(Boolean))];
  const [teamNames,competitions]=await Promise.all([
    opponents.length ? client.from("teams").select("name,name_ko").in("name",opponents) : {data:[],error:null},
    fixtureIds.length ? client.from("fixtures").select("id,league_id").in("id",fixtureIds) : {data:[],error:null},
  ]);
  if (teamNames.error) throw teamNames.error;
  if (competitions.error) throw competitions.error;
  const localized = new Map((teamNames.data ?? []).map(row => [row.name,row.name_ko || row.name]));
  const leagueOf = new Map((competitions.data ?? []).map(row => [row.id,row.league_id]));
  player.history=(history.data||[]).reverse().map(row=>({at:row.recorded_at,value:Number(row.value)}));
  player.records=(records.data||[]).map(row=>({id:row.id,fixtureId:row.fixture_id ?? null,leagueId:leagueOf.get(row.fixture_id) ?? null,playedAt:row.played_at,opponent:localized.get(row.opponent) || row.opponent,result:row.result,minutes:row.minutes,goals:row.goals,assists:row.assists,performance:row.performance == null ? null : Number(row.performance)}));
  if(!migrationMissing(scores.error)){checkDatabase(scores.error);player.scoreDetails=scores.data??[];}
  for(const result of [baseline,priceSteps])if(!migrationMissing(result.error))checkDatabase(result.error);
  if (!migrationMissing(baseline.error) && !migrationMissing(priceSteps.error)) {
    player.pricing={baseline:baseline.data?.detail ?? null,recent:priceSteps.data ?? []};
  }
  return player;
}
