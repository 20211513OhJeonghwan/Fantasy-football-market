import { POST_LIMITS } from "./validation";
export type CommunityScope = "club" | "player";
export const COMMUNITY_PATHS = { club: "/community/clubs", player: "/community/players" } as const;

/** Existing DB titles stay compatible; a note's title is derived on the server. */
export function postTitle(title: string, body: string) {
  return title.normalize("NFC").trim() || [...body.normalize("NFC").trim().replace(/\s+/gu, " ")].slice(0, POST_LIMITS.titleMax).join("");
}
export function postHeading(title: string, body: string) {
  return title === postTitle("", body) ? "" : title;
}
export function parseCommunityQuery(params: URLSearchParams) {
  const scope = params.get("scope") ?? "player";
  if (scope !== "club" && scope !== "player") throw new Error("커뮤니티 종류를 확인해 주세요.");
  const sort = params.get("sort") ?? "new";
  if (sort !== "new" && sort !== "popular") throw new Error("게시글 정렬을 확인해 주세요.");
  const rawPage = params.get("page") ?? "1";
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1 || Number(rawPage) > 10000) throw new Error("페이지 범위를 확인해 주세요.");
  const target = params.get("target");
  if (target !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(target)) throw new Error("커뮤니티 대상을 확인해 주세요.");
  const query = (params.get("q") ?? "").normalize("NFC").trim();
  if (query.length > 100 || /[\x00-\x1f]/.test(query)) throw new Error("검색어는 100자 이내로 입력해 주세요.");
  return { scope: scope as CommunityScope, sort, page: Number(rawPage), target, query };
}
