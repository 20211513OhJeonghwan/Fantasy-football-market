import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";
const validation = loadTs("../lib/kickx/validation.ts");
const http = loadTs("../server/kickx/http.ts", { "server-only": {}, "@/lib/kickx/validation": validation, "./config": {}, "./supabase": {} });
const request = (data, origin = "https://kickx.invalid") => new Request("https://kickx.invalid/api/kickx/admin/ingestion", {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(data),
});
test("admin role is read for the verified user, never accepted from request metadata", async () => {
  let role = "member", error = null;
  const { requireAdmin } = loadTs("../server/kickx/admin-db.ts", {
    "server-only": {}, "@supabase/supabase-js": {}, "./http": { ...http, authenticatedClient: async () => ({
      user: { id: "verified-account" }, client: { from: table => {
        assert.equal(table, "user_roles");
        return { select: () => ({ eq: (field, id) => { assert.equal(field, "user_id"); assert.equal(id, "verified-account"); return { maybeSingle: async () => ({ data: { role }, error }) }; } }) };
      } },
    }) },
  });
  await assert.rejects(requireAdmin(), e => e.status === 403);
  role = "admin"; assert.equal((await requireAdmin()).id, "verified-account");
  error = new Error("private DB details"); await assert.rejects(requireAdmin(), e => e.status === 503 && !e.message.includes("private"));
});
test("retired manual ingestion rejects writes after origin and admin checks", async () => {
  let status=401, calls=0;
  const { POST }=loadTs("../app/api/kickx/admin/ingestion/route.ts",{
    "@/server/kickx/admin-db":{requireAdmin:async()=>{calls++;if(status)throw new http.HttpError(status,"denied");},createAdminDatabase:()=>{throw new Error("must not call service");}},
    "@/server/kickx/http":http,"@/server/kickx/ingestion":{},
  });
  for(status of [401,403])assert.equal((await POST(request({action:"start"}))).status,status);
  status=0;assert.equal((await POST(request({action:"start"}))).status,410);
  const before=calls;assert.equal((await POST(request({action:"start"},"https://foreign.invalid"))).status,403);assert.equal(calls,before);
});
