import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateKoreanCatalog, planKoreanPlayers, insertMissingPlayerNames, nameImportFetch } from "../scripts/lib/korean-catalog.mjs";
import { createClient } from "@supabase/supabase-js";
const players = JSON.parse(readFileSync(new URL("../data/localization/players.ko.json", import.meta.url)));
const teams = JSON.parse(readFileSync(new URL("../data/localization/teams.ko.json", import.meta.url)));

test("Supabase transport sends opaque server keys only as apikey and retains JWT authentication", async () => {
  for (const key of ["sb_secret_test_only", "test.legacy.jwt"]) {
    let sent;
    const db = createClient("https://test-only.supabase.co", key, { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: nameImportFetch(key, async (_url, init) => { sent = init.headers; return new Response("[]", { headers: { "content-type": "application/json" } }); }) } });
    await db.from("players").select("id");
    assert.equal(sent.get("apikey"), key);
    assert.equal(sent.get("authorization"), key.startsWith("sb_secret_") ? null : `Bearer ${key}`);
  }
  let sent;
  await nameImportFetch("sb_secret_test_only", async (_url, init) => { sent = init.headers; })("https://test-only.supabase.co", { headers: { authorization: "Bearer independent.user.jwt" } });
  assert.equal(sent.get("authorization"), "Bearer independent.user.jwt");
});

test("Korean catalog has unique provider identities and explicitly marked provisional names", () => {
  assert.equal(validateKoreanCatalog(players).length, 3122);
  assert.equal(validateKoreanCatalog(teams).length, 96);
  assert.equal(players.filter(row => row.source === "wikidata").length, 1182);
  assert.ok(players.filter(row => row.source === "transliteration").every(row => row.review === "provisional"));
  assert.throws(() => validateKoreanCatalog([players[0], players[0]]));
  assert.throws(() => validateKoreanCatalog([{ ...players[0], name_ko: "English" }]));
  const sql = readFileSync(new URL("../supabase/migrations/202610110001_korean_catalog.sql", import.meta.url), "utf8");
  assert.deepEqual(JSON.parse(sql.split("$players$")[1]), players);
  assert.deepEqual(JSON.parse(sql.split("$teams$")[1]), teams);
});

test("same-name or birthday mismatches cannot receive a published label; all existing labels survive", () => {
  const base = { name: "Test", name_ko: "테스트", source: "wikidata", source_id: "Q123", birth_date: "2000-01-01" };
  const candidates = Array.from({ length: 6 }, (_, i) => ({ ...base, id: "bsd-" + i }));
  const current = candidates.slice(0, 5).map(row => ({ ...row, provider: "bsd" }));
  current[1].birth_date = "2000-02-02";
  current[2].name = "Someone else";
  current[3].provider = "api-football";
  const result = planKoreanPlayers(candidates, current, [{ player_id: "bsd-4", source: "manual" }]);
  assert.deepEqual(result.rows.map(row => row.player_id), ["bsd-0"]);
  assert.equal(result.preserved, 1);
  assert.equal(result.rejected.length, 4);
});

test("legacy import uses insert-only conflict handling, bounded batches and an audit of written IDs", async () => {
  const calls = [];
  const client = { from(table) {
    return {
      upsert(rows, options) { calls.push({ table, rows, options }); return { select: async () => ({ data: rows.slice(1), error: null }) }; },
      insert(audit) { calls.push({ table, audit }); return Promise.resolve({ error: null }); },
    };
  } };
  const rows = Array.from({ length: 201 }, (_, i) => ({ player_id: "bsd-" + i, display_name: "테스트", source: "transliteration" }));
  assert.equal(await insertMissingPlayerNames(client, rows), 199);
  assert.deepEqual(calls.filter(row => row.options).map(row => row.rows.length), [200, 1]);
  assert.ok(calls.filter(row => row.options).every(row => row.options.ignoreDuplicates && row.options.onConflict === "player_id"));
  assert.equal(calls.find(row => row.audit).audit.detail.changes.length, 199);
});
