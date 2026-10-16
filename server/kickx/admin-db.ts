import "server-only";
import { createClient } from "@supabase/supabase-js";
import { authenticatedClient, HttpError } from "./http";

export async function requireAdmin() {
  const { client, user } = await authenticatedClient();
  const role = await client.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  if (role.error) throw new HttpError(503, "관리자 권한을 확인하지 못했습니다.");
  if (role.data?.role !== "admin") throw new HttpError(403, "관리자 권한이 필요합니다.");
  return user;
}
export function createAdminDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new HttpError(503, "서버의 수집용 Supabase 키를 설정해 주세요.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
