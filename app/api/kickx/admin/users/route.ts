import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
import { requireAdmin, createAdminDatabase } from "@/server/kickx/admin-db";
import { asObject, checkDatabase, identity } from "@/server/kickx/prototype";
import { literalLike } from "@/lib/kickx/catalog-query";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") || 1), q = (params.get("q") || "").trim();
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || q.length > 100 || /[\x00-\x1f]/.test(q)) throw new HttpError(400, "회원 검색 범위를 확인해 주세요.");
    const db = createAdminDatabase();
    let query = db.from("profiles").select("id,nickname,team_id,created_at,member_restrictions(suspended_until,reason)", { count: "exact" });
    if (q) query = /^[a-f0-9-]{36}$/i.test(q) ? query.eq("id", identity(q, true)) : query.ilike("nickname", `%${literalLike(q)}%`);
    const result = await query.order("created_at", { ascending: false }).order("id").range((page - 1) * 30, page * 30 - 1);
    checkDatabase(result.error);
    const rows = result.data || [];
    const roles = rows.length ? await db.from("user_roles").select("user_id,role").in("user_id", rows.map(row => row.id)) : { data: [], error: null };
    checkDatabase(roles.error);
    return json({ items: rows.map(row => ({ ...row, user_roles: roles.data?.find(role => role.user_id === row.id) || null })), total: result.count, page, size: 30 });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request); await requireAdmin();
    const input = asObject(await readJson(request));
    if (![0, 1, 7, 30].includes(input.days as number) || typeof input.reason !== "string" || input.reason.trim().length < 5 || input.reason.length > 500) throw new HttpError(400, "제한 기간과 처리 사유(5~500자)를 확인해 주세요.");
    const { client } = await authenticatedClient();
    const result = await client.rpc("kickx_restrict_member", { p_user: identity(input.userId, true), p_days: input.days, p_reason: input.reason.trim() });
    checkDatabase(result.error); return json({ saved: true });
  } catch (error) { return failure(error); }
}
