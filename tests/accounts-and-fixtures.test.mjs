import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";
const validation = loadTs("../lib/kickx/validation.ts");
const fixtures = loadTs("../lib/kickx/fixtures.ts");
test("OAuth return paths reject external URLs, protocol-relative redirects and auth loops", () => {
  for (const path of ["https://evil.invalid","//evil.invalid","/\\evil.invalid","/auth/callback","/login?next=/","/api/kickx","/onboarding", "/a/../auth/callback", null, 123])
    assert.equal(validation.safeReturnPath(path), "/");
  assert.equal(validation.safeReturnPath("/players?q=son#stats"), "/players?q=son#stats");
});
test("write requests require the same complete origin including port", () => {
  assert.equal(validation.isSameOrigin("https://kick-x-test.vercel.app","https://kick-x-test.vercel.app/api/kickx/profile"),true);
  for(const origin of [null,"null","https://evil.invalid","http://kick-x-test.vercel.app","https://kick-x-test.vercel.app:444"])
    assert.equal(validation.isSameOrigin(origin,"https://kick-x-test.vercel.app/api/kickx/profile"),false);
});
test("profile input is normalized, constrained and cannot supply a role or identity", () => {
  assert.deepEqual(validation.parseProfile({nickname:"  승현 FC  ",team:"club-1",role:"admin",id:"other"}),{nickname:"승현 FC",team:"club-1"});
  assert.deepEqual(validation.parseProfile({nickname:"승현",team:""}),{nickname:"승현",team:null});
  for (const nickname of ["a","a".repeat(21),"<script>","승현\n관리자","😀😀"]) assert.throws(()=>validation.parseProfile({nickname}), validation.InputError);
  assert.throws(()=>validation.parseProfile({nickname:"승현",team:{id:"other"}}),validation.InputError);
});
test("watchlist mutation is an explicit idempotent desired state, not an ambiguous toggle", () => {
  assert.deepEqual(validation.parseWatch({playerId:"p-1",watched:false,userId:"other"}),{playerId:"p-1",watched:false});
  for(const input of [{playerId:"p-1"},{playerId:"p-1",watched:"true"},{playerId:"../p-1",watched:true},null])
    assert.throws(()=>validation.parseWatch(input),validation.InputError);
});
test("fixture days use Korea's midnight regardless of server timezone", () => {
  assert.equal(fixtures.koreanDay("2026-09-30T15:00:00Z"),"2026-10-01");
  assert.equal(fixtures.koreanDay("2026-09-30T14:59:59Z"),"2026-09-30");
  assert.equal(fixtures.koreanDay("invalid"),"");
});
test("a passed kickoff does not fabricate a live or finished match", () => {
  assert.equal(fixtures.fixtureGroup("NS"),"scheduled");
  assert.equal(fixtures.fixtureGroup("1H"),"live");
  assert.equal(fixtures.fixtureGroup("FT"),"finished");
  assert.equal(fixtures.fixtureGroup("PST"),"other");
  assert.equal(fixtures.fixtureStatus("unrecognized"),"unrecognized");
});
test("featured fixtures prioritize recorded live state, then upcoming, then latest results", () => {
  const rows = [
    {id:"old",startsAt:"2026-01-01T12:00:00Z",status:"FT"},
    {id:"upcoming",startsAt:"2026-01-06T12:00:00Z",status:"NS"},
    {id:"live",startsAt:"2026-01-05T12:00:00Z",status:"1H"},
    {id:"recent",startsAt:"2026-01-04T12:00:00Z",status:"FT"},
  ];
  assert.deepEqual(fixtures.selectFeaturedFixtures(rows).map(f=>f.id),["live","upcoming","recent"]);
  assert.equal(rows[0].id,"old");
});
test("post drafts enforce fan-only club lounges, length limits and own-trade attachments", () => {
  const rules = { myTeam: "ars", targets: ["ars", "liv"], transactions: ["tx-1"] };
  const valid = { scope: "club", target: "ars", title: "아스널 경기 후기", body: "오늘 경기 정말 좋았습니다.", transaction: "" };
  assert.deepEqual(validation.validatePost(valid, rules), {});
  assert.ok(validation.validatePost({ ...valid, target: "liv" }, rules).target);
  assert.ok(validation.validatePost(valid, { ...rules, myTeam: null }).target);
  assert.ok(validation.validatePost({ ...valid, title: " a " }, rules).title);
  assert.ok(validation.validatePost({ ...valid, body: "짧음" }, rules).body);
  assert.ok(validation.validatePost({ ...valid, body: "가".repeat(3001) }, rules).body);
  assert.ok(validation.validatePost({ ...valid, transaction: "someone-else" }, rules).transaction);
  assert.deepEqual(validation.validatePost({ ...valid, scope: "player", target: "liv", transaction: "tx-1" }, rules), {});
});
