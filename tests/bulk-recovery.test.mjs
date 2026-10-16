import test from "node:test";
import assert from "node:assert/strict";
import { parseBulkArgs, runBulkCli } from "../scripts/lib/bulk-cli.mjs";
import { bulkErrorDetails, readBulkState, stepBulkRun } from "../scripts/lib/bulk-sync.mjs";

const run = "00000000-0000-0000-0000-000000000001";
function database(status = "paused", resume = "running") {
  const calls = [];
  const db = {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "start_football_bulk") return { data: run };
      if (name === "control_football_bulk") { if (resume === "running") status = "running"; return { data: resume }; }
      assert.fail(`Unexpected RPC: ${name}`);
    },
    from: table => {
      const query = { select: () => query, order: () => query, eq: () => query, not: () => query,
        limit: async () => ({ data: table === "football_bulk_runs" ? [{ id: run, status }] : [] }) };
      return query;
    },
  };
  return db;
}
test("CLI resume is applied before a single diagnostic step, which retains the same run", async () => {
  const db = database(), output = []; let steps = 0, waits = 0;
  const args = parseBulkArgs(["--resume", "--once"]);
  const exit = await runBulkCli(db, "private-key", args, { emit: v => output.push(v), wait: async () => { waits++; }, step: async (_, id) => {
    assert.equal(id, run); assert.equal(db.calls.at(-1).name, "control_football_bulk");
    assert.equal(db.calls.at(-1).args.action, "resume");
    steps++; return { state: steps === 1 ? "wait" : "progress", phase: "legacy" };
  } });
  assert.equal(exit, 0); assert.equal(steps, 2); assert.equal(waits, 1);
  assert.equal(output[1].state, "running"); assert.equal(output.at(-1).latest.id, run);
  assert.equal(JSON.stringify(output).includes("private-key"), false);
});
test("CLI refuses to claim work when resume returns busy or cooldown; status performs no mutation", async () => {
  for (const state of ["busy", "cooldown"]) {
    const db = database("paused", state), output = [];
    assert.equal(await runBulkCli(db, "key", parseBulkArgs(["--resume"]), { emit: v => output.push(v), step: () => assert.fail("unexpected claim") }), 2);
    assert.equal(output[1].state, state);
  }
  const db = database();
  assert.equal(await runBulkCli(db, null, parseBulkArgs(["--status"]), { emit: () => {}, step: () => assert.fail("unexpected claim") }), 0);
  assert.equal(db.calls.length, 0);
  for (const args of [["--status", "--once"], ["--resume", "--resume"], ["--unknown"]]) assert.throws(() => parseBulkArgs(args), /USAGE_ALL_STATUS_OR_RESUME/);
});
test("failed finish keeps the first DB operation/code and never fails a possibly committed lease", async () => {
  for (const committed of [false, true]) {
    const calls = [], db = { rpc: async (name) => {
      calls.push(name);
      if (name === "claim_football_bulk") return { data: { state: "claimed", token: "lease", task: { kind: "match", payload: { phase: "incidents", eventId: 100, context: {} } } } };
      if (name === "finish_football_bulk") {
        if (committed) throw new Error("Lost response: private-key https://private-project.invalid");
        return { error: { code: "57014", message: "private SQL", details: "private-key", hint: "secret" } };
      }
      assert.fail("A failed finish must not issue another mutation");
    } };
    await assert.rejects(stepBulkRun(db, "run", "private-key", { fetchImpl: async () => Response.json({ event_id: 100, incidents: [] }) }), error => {
      const details = bulkErrorDetails(error);
      assert.equal(details.error, "BULK_DATABASE_ERROR"); assert.equal(details.operation, "finish_football_bulk");
      assert.equal(details.databaseCode, committed ? undefined : "57014");
      assert.equal(details.phase, "incidents"); assert.equal(details.eventId, 100);
      assert.equal(details.recovery, "wait_for_lease");
      for (const secret of ["private-key", "private SQL", "private-project", "secret"]) assert.equal(JSON.stringify(details).includes(secret), false);
      return true;
    });
    assert.deepEqual(calls, ["claim_football_bulk", "finish_football_bulk"]);
  }
});
test("read-only DB diagnostics identify failed queries without exposing untrusted error codes or text", async () => {
  for (const code of ["PGRST000", "private-key https://private-project.invalid"]) {
    const db = { from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ error: { code, message: "secret" } }) }) }) }) };
    await assert.rejects(readBulkState(db), error => {
      assert.deepEqual(bulkErrorDetails(error), { error: "BULK_DATABASE_ERROR", operation: "read_bulk_runs", ...(code === "PGRST000" ? { databaseCode: code } : {}) });
      return true;
    });
  }
});
test("known database rejections are named, while arbitrary server messages stay private", async () => {
  for (const message of ["STALE_BULK_LEASE", "Incomplete match snapshot", "secret SQL and private-key"]) {
    await assert.rejects(stepBulkRun({ rpc: async () => ({ error: { code: "P0001", message } }) }, run, "key"), error => {
      const details = bulkErrorDetails(error);
      assert.equal(details.operation, "claim_football_bulk");
      assert.equal(details.databaseReason, message.startsWith("secret") ? undefined : message.toUpperCase().replaceAll(" ", "_"));
      assert.equal(JSON.stringify(details).includes("private-key"), false);
      return true;
    });
  }
});
