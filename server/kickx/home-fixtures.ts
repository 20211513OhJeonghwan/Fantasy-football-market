import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOMESTIC_LEAGUES } from "@/lib/kickx/support";
import { selectSupportedFixtures } from "@/lib/kickx/fixtures";
import { FIXTURE_COLUMNS, mapFixture } from "./catalog";

/** A small per-club preview, independent of the global dashboard's first 20 matches. */
export async function readHomeClubFixture(client: SupabaseClient, team: string, now = Date.now()) {
  const { data, error } = await client.from("fixture_catalog").select(FIXTURE_COLUMNS)
    .in("league_id", [...DOMESTIC_LEAGUES])
    .or(`home_team_id.eq.${team},away_team_id.eq.${team}`)
    .gte("starts_at", new Date(now - 7 * 86400000).toISOString())
    .order("starts_at").order("id").limit(12);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Missing club fixture preview");
  return selectSupportedFixtures((data as unknown as Record<string, unknown>[]).map(mapFixture), [team], now)[0] ?? null;
}
