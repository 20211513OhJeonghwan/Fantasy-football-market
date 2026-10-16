import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseConfig } from "@/server/kickx/config";
import { createRequestClient } from "@/server/kickx/supabase";
import { privateHeaders } from "@/server/kickx/http";
import { safeReturnPath } from "@/lib/kickx/validation";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const next = safeReturnPath(jar.get("kickx-auth-next")?.value);
  jar.set("kickx-auth-next", "", { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/auth", maxAge: 0 });
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url.origin), 303);
    for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  };
  const failed = "/login?error=oauth&next=" + encodeURIComponent(next);
  if (!getSupabaseConfig()) return redirect("/login?error=not-configured");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error")) return redirect(failed);
  try {
    const client = await createRequestClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) return redirect(failed);
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user) return redirect(failed);
    const profile = await client.from("profiles").select("id").eq("id", verified.data.user.id).maybeSingle();
    if (profile.error) return redirect("/login?error=profile");
    return redirect(profile.data ? next : "/onboarding?next=" + encodeURIComponent(next));
  } catch { return redirect(failed); }
}
