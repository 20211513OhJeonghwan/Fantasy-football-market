"use client";
export async function apiRequest<T>(url: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "요청을 처리하지 못했습니다.");
    return result as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("응답이 늦어지고 있습니다. 상태를 확인한 뒤 다시 시도해 주세요.");
    throw error;
  } finally { clearTimeout(timer); }
}
