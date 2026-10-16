import type { AdminData, PlatformData, PublicData, SeriesPoint } from "./types";
export type * from "./types";
export const emptyPublicData = (): PublicData => ({
  players: [],
  teams: [],
  leagues: [],
  fixtures: [],
  formations: [],
  posts: [],
  comments: [],
  rankings: [],
  market: null,
  updatedAt: null,
});
export const emptyPlatformData = (): PlatformData => ({
  ...emptyPublicData(),
  session: null,
  member: null,
});
export const emptyAdminData = (): AdminData => ({
  summary: null,
  jobs: [],
  trades: [],
  reports: [],
  audit: [],
});
export const money = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(
        value,
      );
/** Display raw performance points without rounding fractional scoring away. */
export const score = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("ko-KR", {maximumFractionDigits:2}).format(value);
export const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
export function dateText(value: string | null | undefined, time = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(time
      ? ({ hour: "2-digit", minute: "2-digit", hour12: false } as const)
      : {}),
  }).format(new Date(value));
}
export function seriesForDays(
  points: SeriesPoint[],
  days: number,
  now = Date.now(),
) {
  return points
    .filter(
      (p) =>
        Number.isFinite(p.value) &&
        Date.parse(p.at) >= now - days * 86400000 &&
        Date.parse(p.at) <= now,
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
export const unavailableAction =
  "서비스 준비 중입니다. 현재는 조회 화면만 사용할 수 있습니다.";
/** "3시간 전" style label for recent timestamps; falls back to the date. */
export function relativeTime(value: string | null | undefined, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const diff = Math.max(0, now - Date.parse(value));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return dateText(value, false);
}
