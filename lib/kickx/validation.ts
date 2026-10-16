/** Technical input limits; product policy can be tightened before launch. */
export const PROFILE_LIMITS = { min: 2, max: 20 } as const;
export class InputError extends Error {}
export function safeReturnPath(value: unknown, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://kickx.invalid");
    if (url.origin !== "https://kickx.invalid" || /^\/(?:api|auth|login|onboarding)(?:\/|$)/.test(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}
export function parseProfile(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("입력 내용을 확인해 주세요.");
  const input = value as Record<string, unknown>;
  const nickname = typeof input.nickname === "string" ? input.nickname.normalize("NFC").trim() : "";
  if ([...nickname].length < PROFILE_LIMITS.min || [...nickname].length > PROFILE_LIMITS.max || !/^[\p{L}\p{N}_ -]+$/u.test(nickname))
    throw new InputError("닉네임은 2–20자의 문자, 숫자, 공백, 밑줄, 하이픈을 사용할 수 있습니다.");
  const team = input.team == null || input.team === "" ? null : input.team;
  if (team !== null && (typeof team !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(team)))
    throw new InputError("응원 구단을 다시 선택해 주세요.");
  return { nickname, team: team as string | null };
}
export function parseWatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("요청을 확인해 주세요.");
  const input = value as Record<string, unknown>;
  if (typeof input.playerId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.playerId) || typeof input.watched !== "boolean")
    throw new InputError("선수와 관심 상태를 확인해 주세요.");
  return { playerId: input.playerId, watched: input.watched };
}
export function isSameOrigin(origin: string | null, requestUrl: string) {
  try { return !!origin && new URL(origin).origin === new URL(requestUrl).origin; }
  catch { return false; }
}
/** Community post limits. Shared by the editor UI and (later) the post API. Policy may tighten before launch. */
export const POST_LIMITS = { titleMin: 2, titleMax: 80, bodyMin: 10, bodyMax: 3000 } as const;
export type PostDraft = { scope: string; target: string; title: string; body: string; transaction: string };
export type PostField = keyof PostDraft;
export type PostRules = {
  /** Club lounges accept posts only from fans of that club (null = no club set). */
  myTeam: string | null;
  targets: string[];
  /** IDs of the author's own transactions; anything else may not be attached. */
  transactions: string[];
};
const length = (value: string) => [...value.normalize("NFC").trim()].length;
/** Returns one message per invalid field. Empty object means the draft is valid. */
export function validatePost(draft: PostDraft, rules: PostRules): Partial<Record<PostField, string>> {
  const errors: Partial<Record<PostField, string>> = {};
  if (draft.scope !== "club" && draft.scope !== "player") errors.scope = "게시판 종류를 선택해 주세요.";
  if (draft.scope === "club" && !rules.myTeam) errors.target = "응원 구단을 설정해야 구단 커뮤니티에 글을 쓸 수 있습니다.";
  else if (!draft.target) errors.target = draft.scope === "club" ? "구단을 선택해 주세요." : "선수를 선택해 주세요.";
  else if (!rules.targets.includes(draft.target)) errors.target = "선택할 수 없는 대상입니다. 다시 선택해 주세요.";
  else if (draft.scope === "club" && draft.target !== rules.myTeam) errors.target = "응원 구단 라운지에만 글을 쓸 수 있습니다.";
  const title = length(draft.title);
  if (!title) errors.title = "제목을 입력해 주세요.";
  else if (title < POST_LIMITS.titleMin) errors.title = `제목은 ${POST_LIMITS.titleMin}자 이상 입력해 주세요.`;
  else if (title > POST_LIMITS.titleMax) errors.title = `제목은 ${POST_LIMITS.titleMax}자까지 입력할 수 있습니다.`;
  const body = length(draft.body);
  if (!body) errors.body = "내용을 입력해 주세요.";
  else if (body < POST_LIMITS.bodyMin) errors.body = `내용은 ${POST_LIMITS.bodyMin}자 이상 입력해 주세요. (현재 ${body}자)`;
  else if (body > POST_LIMITS.bodyMax) errors.body = `내용은 ${POST_LIMITS.bodyMax.toLocaleString("ko-KR")}자까지 입력할 수 있습니다.`;
  if (draft.transaction && !rules.transactions.includes(draft.transaction)) errors.transaction = "본인의 거래 내역만 첨부할 수 있습니다.";
  return errors;
}
