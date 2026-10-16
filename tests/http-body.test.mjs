import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";
const validation = loadTs("../lib/kickx/validation.ts");
const { readJson, HttpError, MAX_JSON_BODY_BYTES } = loadTs("../server/kickx/http.ts", {
  "server-only": {},
  "@/lib/kickx/validation": validation,
  "./config": {},
  "./supabase": {},
});
const requestFor = (body, contentType = "application/json") => new Request("https://kickx.invalid/api/kickx/posts", {
  method: "POST", headers: { "content-type": contentType }, body,
});
const hasStatus = status => error => error instanceof HttpError && error.status === status;

test("post-sized Korean and JSON-escaped bodies fit without changing character limits", async () => {
  for (const body of ["가".repeat(3000), "\u0000".repeat(3000)]) {
    const post = { scope: "club", target: "club-1", title: "제".repeat(80), body, transactionId: null };
    const encoded = JSON.stringify(post);
    assert.ok(Buffer.byteLength(encoded) > 4096);
    assert.ok(Buffer.byteLength(encoded) <= MAX_JSON_BODY_BYTES);
    assert.deepEqual(await readJson(requestFor(encoded)), post);
  }
});
test("the exact 32 KiB boundary is accepted and one extra byte is rejected", async () => {
  assert.equal(MAX_JSON_BODY_BYTES, 32768);
  const body = "x".repeat(MAX_JSON_BODY_BYTES - JSON.stringify({ body: "" }).length);
  const encoded = JSON.stringify({ body });
  assert.equal(Buffer.byteLength(encoded), MAX_JSON_BODY_BYTES);
  assert.deepEqual(await readJson(requestFor(encoded)), { body });
  await assert.rejects(readJson(requestFor(JSON.stringify({ body: body + "x" }))), hasStatus(413));
});
test("streamed bodies use actual bytes and cancel the reader when over the limit", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_JSON_BODY_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://kickx.invalid/api/kickx/posts", {
    method: "POST", body: stream, duplex: "half",
    headers: { "content-type": "application/json", "content-length": "1" },
  });
  await assert.rejects(readJson(request), hasStatus(413));
  assert.equal(cancelled, true);
});
test("larger capacity preserves invalid JSON and unsupported media errors", async () => {
  await assert.rejects(readJson(requestFor("{")), hasStatus(400));
  await assert.rejects(readJson(requestFor("{}", "text/plain")), hasStatus(415));
});
