import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
/** Used only by Route Handlers: refreshed cookies are written to their response. */
export async function createRequestClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("KICK-X database is not configured");
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (entries) => { entries.forEach(({ name, value, options }) => jar.set(name, value, options)); },
    },
  });
}
