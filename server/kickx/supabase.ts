import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
/** Used only by Route Handlers: refreshed cookies are written to their response. */
export async function createRequestClient({ freshAuth = false } = {}) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("KICK-X database is not configured");
  const jar = await cookies();
  const sessionKey = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  const isSessionCookie = (name: string) => name === sessionKey || name.startsWith(sessionKey + ".");
  let ignoreOldSession = freshAuth;
  return createServerClient(config.url, config.key, {
    cookies: {
      // Starting/exchanging a new OAuth flow must not first renew an old,
      // possibly expired session. Keep the PKCE verifier and all other cookies.
      getAll: () => jar.getAll().filter(({ name }) => !ignoreOldSession || !isSessionCookie(name)),
      setAll: (entries) => {
        entries.forEach(({ name, value, options }) => jar.set(name, value, options));
        // The just-exchanged session must authorize the following profile read.
        if (entries.some(({ name, value }) => isSessionCookie(name) && value)) ignoreOldSession = false;
      },
    },
  });
}

/** Public catalog reads never inspect or refresh a visitor's auth cookies. */
export function createPublicClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("KICK-X database is not configured");
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
