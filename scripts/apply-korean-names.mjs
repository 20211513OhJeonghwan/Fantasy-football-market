import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { validateKoreanCatalog, planKoreanPlayers, readAllNames, insertMissingPlayerNames, nameImportFetch } from "./lib/korean-catalog.mjs";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
try {
  const players = validateKoreanCatalog(JSON.parse(await readFile(new URL("../data/localization/players.ko.json", import.meta.url), "utf8")));
  const teams = validateKoreanCatalog(JSON.parse(await readFile(new URL("../data/localization/teams.ko.json", import.meta.url), "utf8")));
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SERVER_CONFIGURATION_MISSING");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: nameImportFetch(key) } });
  const [current, names] = await Promise.all([
    readAllNames(client, "players", "id,name,birth_date,provider"),
    readAllNames(client, "player_names", "player_id,display_name,source"),
  ]);
  const plan = planKoreanPlayers(players, current, names);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", candidates: players.length, existing: plan.preserved,
    newPlayers: plan.rows.length, identityRejected: plan.rejected }));
  if (apply) {
    const result = await client.rpc("kickx_apply_korean_catalog", { p_players: players, p_teams: teams });
    if (!result.error) console.log(JSON.stringify({ mode: "atomic-rpc", ...result.data }));
    else if (result.error.code === "PGRST202") {
      const inserted = await insertMissingPlayerNames(client, plan.rows);
      console.log(JSON.stringify({ mode: "legacy-schema", inserted,
        migrationRequired: "202610110001_korean_catalog.sql", teamColumnsApplied: false }));
    } else throw result.error;
    const after = await readAllNames(client, "player_names", "player_id,display_name,source");
    const currentIds = new Set(current.filter(row => row.provider === "bsd").map(row => row.id));
    console.log(JSON.stringify({ bsdPlayers: currentIds.size,
      koreanPlayerNames: after.filter(row => currentIds.has(row.player_id) && /[가-힣]/u.test(row.display_name)).length }));
  }
} catch (error) {
  // Do not print client configuration, service credentials or provider payloads.
  const kind = /expir/i.test(error.message ?? "") ? "expired" : /signature/i.test(error.message ?? "") ? "signature" : /claim|pars|JWT/i.test(error.message ?? "") ? "jwt_validation" : "unknown";
  console.error(JSON.stringify({ error: error.code || "KOREAN_CATALOG_FAILED", authFailure: error.code === "PGRST303" ? kind : undefined, message:
    error.message === "SERVER_CONFIGURATION_MISSING" ? "Missing server Supabase configuration" : "Korean catalog operation failed; completed batches are safe to rerun" }));
  process.exitCode = 1;
}
