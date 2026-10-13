import test from "node:test";
import assert from "node:assert/strict";
import { initialTasks, processBulkTask, seasonWindows } from "../scripts/lib/bulk-plan.mjs";
import { stepBulkRun } from "../scripts/lib/bulk-sync.mjs";
import { SyncError } from "../scripts/lib/football.mjs";

const context = { league: 1, seasonId: 1058, seasonYear: 2026, leagueName: "Test league" };
const event = { id: 100, league_id: 1, season_id: 1058, home_team_id: 1, home_team: "Home", away_team_id: 2, away_team: "Away", event_date: "2026-09-20T12:00:00Z", status: "finished", home_score: 1, away_score: 0 };
const player = { id: 9, name: "Test player", position: "G" };
const statistics = { event_id: 100, count: 1, player_stats: [{ event_id: 100, player_id: 9, team_id: 1, minutes_played: 90, saves: 3 }] };
const lineup = { event_id: 100, lineup_status: "confirmed", lineups: { home: { team_id: 1, players: [player], substitutes: [] } } };
const incidents = { event_id: 100, incidents: [{ type: "goal", minute: 20, player_id: 8, is_home: true }] };
const legacy = [{ event: { id: 100 }, player: { id: 9 }, penalty_save: 1 }];
// CurrentSeasonV2Schema and _SeasonSchema from BSD's /api/schema/?format=json.
const currentSeason = { league_id: 1, season: { id: 1058, name: "2026/27", year: 2026, start_date: "2026-08-01", end_date: "2027-06-30", is_current: true, stages: [] } };
test("bulk discovers the five current seasons and partitions the complete calendar without gaps", async () => {
  assert.deepEqual(initialTasks().map(t => t.payload.league), [1, 3, 4, 5, 6]);
  const windows = seasonWindows("2026-08-01", "2027-06-30");
  assert.equal(windows[0].from, "2026-08-01"); assert.equal(windows.at(-1).to, "2027-06-30");
  for (let i = 0; i < windows.length; i++) {
    assert.ok(Date.parse(windows[i].to) - Date.parse(windows[i].from) <= 29 * 86400000);
    if (i) assert.equal(Date.parse(windows[i].from) - Date.parse(windows[i - 1].to), 86400000);
  }
  for (const pair of [["2026-02-30", "2026-03-01"], ["2027-06-01", "2026-08-01"], ["2025-01-01", "2027-01-01"]]) assert.throws(() => seasonWindows(...pair), /INVALID_SEASON_DATES/);
  const api = { get: async path => path.endsWith("/season/") ? currentSeason : { id: 1, name: "Test league" } };
  const checkpoint = await processBulkTask(api, initialTasks()[0], "2026-10-02");
  assert.equal(checkpoint.done, false); assert.equal(checkpoint.batch, null);
  const done = await processBulkTask(api, { kind: "league", payload: checkpoint.payload }, "2026-10-02");
  assert.equal(done.batch.coverage[0].provider_season_id, 1058);
  assert.equal(done.children.length, windows.length + 1);
  assert.deepEqual(done.entities[0].raw.currentSeason, currentSeason);
  await assert.rejects(processBulkTask(api, { kind: "league", payload: checkpoint.payload }, "2028-01-01"), /CURRENT_SEASON_UNAVAILABLE/);
});
test("current season response rejects foreign leagues, absent seasons and invalid calendar data before scheduling writes", async () => {
  const job = { kind: "league", payload: { league: 1, phase: "seasons", detail: { id: 1, name: "Test league" } } };
  const cases = [
    [{ ...currentSeason, league_id: 3 }, "UNEXPECTED_LEAGUE"],
    [{ league_id: 1, season: null }, "CURRENT_SEASON_UNAVAILABLE"],
    [{ league_id: 1 }, "INVALID_CURRENT_SEASON_RESPONSE"],
    [{ league_id: 1, season: [] }, "INVALID_CURRENT_SEASON_RESPONSE"],
    [{ ...currentSeason, season: { ...currentSeason.season, id: "1058" } }, "INVALID_EXTERNAL_ID"],
    [{ ...currentSeason, season: { ...currentSeason.season, is_current: false } }, "CURRENT_SEASON_UNAVAILABLE"],
    [{ ...currentSeason, season: { ...currentSeason.season, start_date: null } }, "INVALID_SEASON_DATES"],
    [{ ...currentSeason, season: { ...currentSeason.season, start_date: "2026-02-30" } }, "INVALID_SEASON_DATES"],
  ];
  for (const [response, code] of cases) await assert.rejects(processBulkTask({ get: async () => response }, job, "2026-10-03"), new RegExp(code));
});
test("worker resumes a stored seasons checkpoint and commits the wrapped BSD response", async () => {
  const calls = [];
  const db = { rpc: async (name, data) => {
    calls.push({ name, data });
    return { data: name === "claim_football_bulk" ? { state: "claimed", token: "lease", task: { kind: "league", label: "프리미어리그", payload: { league: 1, phase: "seasons", detail: { id: 1, name: "Test league" } } }, today: "2026-10-03" } : null };
  } };
  const result = await stepBulkRun(db, "run", "secret", { fetchImpl: async url => {
    assert.equal(new URL(url).pathname, "/api/v2/leagues/1/season/");
    return Response.json(currentSeason);
  } });
  assert.equal(result.state, "progress");
  assert.equal(calls.at(-1).name, "finish_football_bulk");
  assert.equal(calls.at(-1).data.outcome.batch.coverage[0].provider_season_id, 1058);
  assert.ok(calls.at(-1).data.outcome.children.some(t => t.kind === "teams"));
  assert.equal(calls.filter(c => c.name === "fail_football_bulk").length, 0);
});
test("roster refresh detaches only after a complete nonempty snapshot; team paging preserves membership", async () => {
  const job = { kind: "teams", label: "teams", payload: { context, offset: 0, seen: [] } };
  const first = await processBulkTask({ page: async () => ({ results: [{ id: 1, name: "Home" }], next: 200 }) }, job);
  assert.equal(first.leagueMembership, null);
  const next = first.children.find(c => c.kind === "teams");
  const last = await processBulkTask({ page: async () => ({ results: [{ id: 2, name: "Away" }], next: null }) }, next);
  assert.deepEqual(last.leagueMembership, { leagueId: "bsd-1", teamIds: ["bsd-1", "bsd-2"] });
  const squad = first.children.find(c => c.kind === "squad");
  await assert.rejects(processBulkTask({ get: async () => ({ team_id: 1, count: 0, players: [] }) }, squad), /EMPTY_SQUAD/);
  const done = await processBulkTask({ get: async () => ({ team_id: 1, count: 1, players: [player] }) }, squad);
  assert.deepEqual(done.squadMembership.playerIds, ["bsd-9"]); assert.equal(done.entities[0].kind, "squad");
});
test("fixture pages schedule only finished games and retain full-season pagination", async () => {
  const job = { kind: "fixtures", payload: { context, from: "2026-09-01", to: "2026-09-30", offset: 0 } };
  const result = await processBulkTask({ page: async (_, p) => {
    assert.equal(p.season_id, 1058); assert.equal(p.date_to, "2026-09-30");
    return { results: [event, { ...event, id: 101, status: "upcoming" }], next: 200 };
  } }, job);
  assert.equal(result.batch.fixtures.length, 2); assert.equal(result.children.filter(t => t.kind === "match").length, 1);
  assert.equal(result.children.at(-1).payload.offset, 200);
  await assert.rejects(processBulkTask({ page: async () => ({ results: [{ ...event, season_id: 999 }], next: null }) }, job), /UNEXPECTED_FIXTURE_CONTEXT/);
});
test("match checkpoints keep partial resources private until the complete v1/v2 bundle can commit", async () => {
  const values = { detail: event, stats: statistics, lineups: lineup, incidents };
  let job = { kind: "match", payload: { context, eventId: 100, phase: "detail" } }, calls = 0;
  for (const phase of ["detail", "stats", "lineups", "incidents", "legacy"]) {
    const result = await processBulkTask({ get: async () => { calls++; return values[phase]; }, page: async () => { calls++; return { results: legacy, next: null }; } }, job);
    if (phase !== "legacy") {
      assert.equal(result.done, false); assert.equal(result.batch, null); job = { ...job, payload: result.payload };
    } else {
      assert.equal(result.done, true); assert.equal(result.batch.matches[0].normalized.values.penalty_saves, 1);
      assert.equal(result.batch.sources[0].incidents, incidents);
      assert.equal("team_id" in result.batch.players[0], false);
    }
  }
  assert.equal(calls, 5);
  const partial = { kind: "match", payload: { context, eventId: 100, phase: "stats", detail: event } };
  const unavailable = await processBulkTask({ get: async () => ({ event_id: 100, count: 0, player_stats: [] }) }, partial);
  assert.equal(unavailable.warning, "MATCH_STATS_UNAVAILABLE"); assert.equal(unavailable.batch.fixtures.length,1);
  await assert.rejects(processBulkTask({ get: async () => ({ ...statistics, event_id: 999 }) }, partial), /UNEXPECTED_EVENT/);
});
test("missing lineup profiles are fetched one per step; legacy pagination does not mix events", async () => {
  const payload = { context, eventId: 100, phase: "legacy", page: 1, detail: event, stats: statistics, lineups: { event_id: 100, lineup_status: "unavailable" }, incidents, legacy: [] };
  const next = await processBulkTask({ page: async () => ({ results: legacy, next: 2 }) }, { kind: "match", payload });
  assert.equal(next.payload.page, 2); assert.equal(next.batch, null);
  const profiles = await processBulkTask({ page: async () => ({ results: [], next: null }) }, { kind: "match", payload: next.payload });
  assert.deepEqual(profiles.payload.missing, [9]);
  const done = await processBulkTask({ get: async path => { assert.equal(path, "/api/v2/players/9/"); return { ...player, current_team_id: 200 }; } }, { kind: "match", payload: profiles.payload });
  assert.equal(done.batch.players[0].id, "bsd-9"); assert.equal("team_id" in done.batch.players[0], false);
  await assert.rejects(processBulkTask({ get: async () => ({ ...player, id: 8 }) }, { kind: "match", payload: profiles.payload }), /UNEXPECTED_PLAYER/);
});
test("worker reserves before network, checkpoints only successful work and pauses with a safe quota reason", async () => {
  for (const status of ["busy", "wait", "paused", "completed"]) {
    const result = await stepBulkRun({ rpc: async () => ({ data: { state: status } }) }, "run", "key", { fetchImpl: () => assert.fail("unexpected network") });
    assert.equal(result.state, status);
  }
  const calls = [];
  const db = { rpc: async (name, data) => { calls.push({ name, data }); return { data: name === "claim_football_bulk" ? { state: "claimed", token: "lease", task: initialTasks()[0], today: "2026-10-02" } : null }; } };
  const failed = await stepBulkRun(db, "run", "secret", { fetchImpl: async () => new Response('{"code":"taster_exhausted"}', { status: 429, headers: { "Retry-After": "60" } }) });
  assert.equal(failed.state, "paused"); assert.equal(calls.at(-1).name, "fail_football_bulk");
  assert.equal(calls.at(-1).data.request_count, 1); assert.equal(calls.at(-1).data.error_code, "DAILY_QUOTA_REACHED");
  assert.equal(JSON.stringify(calls).includes("secret"), false);
  calls.length = 0;
  await stepBulkRun(db, "run", "secret", { fetchImpl: async () => new Response(JSON.stringify({ id: 1, name: "League" })) });
  assert.equal(calls.at(-1).name, "finish_football_bulk"); assert.equal(calls.at(-1).data.outcome.done, false);
  await assert.rejects(stepBulkRun({ rpc: async () => ({ error: { code: "42P01" } }) }, "run", "key"), error => error instanceof SyncError && error.code === "BULK_MIGRATION_REQUIRED");
});
