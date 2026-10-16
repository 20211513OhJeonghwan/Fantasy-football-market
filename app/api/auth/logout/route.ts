import { createRequestClient } from "@/server/kickx/supabase";
import { failure, HttpError, json, requireOrigin } from "@/server/kickx/http";
import { getSupabaseConfig } from "@/server/kickx/config";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    if (!getSupabaseConfig()) throw new HttpError(503, "로그인 서비스 연결을 준비하고 있습니다.");
    const client = await createRequestClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
