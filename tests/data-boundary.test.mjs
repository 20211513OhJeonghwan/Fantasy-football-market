import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const loaded = { exports: {} };
  runInThisContext(`(function(require,module,exports){${outputText}\n})`)(
    (id) => {
      if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
      return dependencies[id];
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
const data = load("../lib/kickx/data.ts");
const { readPlatform, readAdmin } = load("../server/kickx/service.ts", {
  "@/lib/kickx/data": data,
});
function repository(session = null) {
  const calls = [];
  return {
    calls,
    configured: true,
    async getSession() {
      calls.push("session");
      return session;
    },
    async getPublicData() {
      calls.push("public");
      return data.emptyPublicData();
    },
    async getMemberData(userId) {
      calls.push(["member", userId]);
      return { privateRecord: true };
    },
    async getAdminData() {
      calls.push("admin");
      return { restrictedRecord: true };
    },
  };
}
test("disconnected reads return empty data and never access any account or privileged source", async () => {
  const repo = repository({ userId: "stale-user", role: "admin" });
  repo.configured = false;
  assert.deepEqual(await readPlatform(repo), {
    status: "not-configured",
    data: data.emptyPlatformData(),
  });
  assert.deepEqual(await readAdmin(repo), {
    status: "not-configured",
    data: data.emptyAdminData(),
  });
  assert.deepEqual(repo.calls, []);
});
test("no sample records, balances or profile appear in the initial response", () => {
  const state = data.emptyPlatformData();
  for (const value of Object.values(state))
    assert.ok(value === null || (Array.isArray(value) && value.length === 0));
  const next = data.emptyPlatformData();
  state.players.push({ id: "test-only" });
  assert.equal(next.players.length, 0);
});
test("unknown numeric values remain unknown; real zero is preserved", () => {
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.equal(data.money(value), "—");
    assert.equal(data.percent(value), "—");
  }
  assert.equal(data.money(0), "0");
  assert.equal(data.percent(0), "0.0%");
  assert.equal(data.dateText("invalid"), "—");
});
test("guest catalog requests never query member or administrator records", async () => {
  const repo = repository();
  const result = await readPlatform(repo);
  assert.equal(result.status, "ready");
  assert.equal(result.data.session, null);
  assert.equal(result.data.member, null);
  assert.deepEqual(repo.calls, ["session", "public"]);
});
test("private read uses only the verified session identity and omits administrator records", async () => {
  const session = { userId: "verified-user", role: "member", profile: null };
  const repo = repository(session);
  const result = await readPlatform(repo);
  assert.deepEqual(result.data.session, session);
  assert.deepEqual(repo.calls, [
    "session",
    "public",
    ["member", "verified-user"],
  ]);
  assert.equal(result.data.restrictedRecord, undefined);
});
test("admin reads reject guests and non-admin accounts before fetching restricted data", async () => {
  for (const [session, status] of [
    [null, 401],
    [{ userId: "member", role: "member" }, 403],
  ]) {
    const repo = repository(session);
    await assert.rejects(readAdmin(repo), (error) => error.status === status);
    assert.deepEqual(repo.calls, ["session"]);
  }
  const repo = repository({ userId: "operator", role: "admin" });
  assert.deepEqual(await readAdmin(repo), {
    status: "ready",
    data: { restrictedRecord: true },
  });
  assert.deepEqual(repo.calls, ["session", "admin"]);
});
test("upstream failures propagate instead of returning a successful zero balance or empty dataset", async () => {
  const repo = repository();
  repo.getPublicData = async () => {
    throw new Error("offline");
  };
  await assert.rejects(readPlatform(repo), /offline/);
});
test("charts use stored dates, exclude invalid/future records and do not generate replacement samples", () => {
  const now = Date.parse("2026-01-10T00:00:00Z");
  const points = [
    { at: "2026-01-09T00:00:00Z", value: 0 },
    { at: "2026-01-04T00:00:00Z", value: 20 },
    { at: "2026-01-01T00:00:00Z", value: 40 },
    { at: "2026-02-01T00:00:00Z", value: 60 },
    { at: "invalid", value: 10 },
  ];
  assert.deepEqual(
    data.seriesForDays(points, 7, now).map((p) => p.value),
    [20, 0],
  );
  assert.deepEqual(data.seriesForDays([], 7, now), []);
});

test("administrator readiness never bypasses authentication or claims a disconnected service is ready", async () => {
  const repo = repository({userId:"operator",role:"admin"});
  repo.adminConfigured = false;
  const result = await readAdmin(repo);
  assert.equal(result.status,"not-configured");
  assert.deepEqual(repo.calls,["session"]);
});

test("development sample data is always labeled with its source", async () => {
  const repo = repository();
  repo.source = "mock";
  const result = await readPlatform(repo);
  assert.equal(result.status, "ready");
  assert.equal(result.source, "mock");
  const real = await readPlatform(repository());
  assert.equal(real.source, undefined);
});
