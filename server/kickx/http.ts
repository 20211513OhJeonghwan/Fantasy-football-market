import "server-only";
import { InputError, isSameOrigin } from "@/lib/kickx/validation";
import { getSupabaseConfig } from "./config";
import { createRequestClient } from "./supabase";
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
// Fits a 3,000-character post, its title/metadata and JSON escaping overhead.
// This is a byte limit; field-level character limits still apply separately.
export const MAX_JSON_BODY_BYTES = 32 * 1024;
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: privateHeaders });
}
export function requireOrigin(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), request.url)) throw new HttpError(403, "허용되지 않은 요청입니다.");
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "JSON 형식으로 요청해 주세요.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "입력 내용이 없습니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, "입력 내용이 너무 깁니다."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, "입력 형식을 확인해 주세요."); }
}
export async function authenticatedClient() {
  if (!getSupabaseConfig()) throw new HttpError(503, "서비스 연결을 준비하고 있습니다.");
  const client = await createRequestClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    if (error && error.status && error.status >= 500) throw new HttpError(503, "로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.");
    throw new HttpError(401, "로그인 후 다시 시도해 주세요.");
  }
  return { client, user: data.user };
}
export function failure(error: unknown) {
  if (error instanceof InputError) return json({ error: error.message }, 400);
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  // Never expose database details, credentials, or user records in responses.
  return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
}
