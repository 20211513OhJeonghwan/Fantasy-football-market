import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/server/kickx/config";
import { createRequestClient } from "@/server/kickx/supabase";
import { failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
import { safeReturnPath } from "@/lib/kickx/validation";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    if (!getSupabaseConfig()) throw new HttpError(503, "로그인 서비스 연결을 준비하고 있습니다.");
    const input = await readJson(request) as { next?: unknown } | null;
    const callback = new URL("/auth/callback", request.url);
    const jar = await cookies();
    jar.set("kickx-auth-next", safeReturnPath(input?.next), { httpOnly: true, sameSite: "lax", secure: callback.protocol === "https:", path: "/auth", maxAge: 600 });
    const client = await createRequestClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google", options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new HttpError(502, "Google 로그인을 시작하지 못했습니다. 다시 시도해 주세요.");
    return json({ url: data.url });
  } catch (error) { return failure(error); }
}
