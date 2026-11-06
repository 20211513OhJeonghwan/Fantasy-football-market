import type { Fixture } from "./types";
const live = new Set(["1H","HT","2H","ET","BT","P","LIVE"]);
const finished = new Set(["FT","AET","PEN"]);
const scheduled = new Set(["NS","TBD"]);
export type FixtureGroup = "scheduled" | "live" | "finished" | "other";
export function fixtureGroup(status: string): FixtureGroup {
  const code = status.trim().toUpperCase();
  return live.has(code) ? "live" : finished.has(code) ? "finished" : scheduled.has(code) ? "scheduled" : "other";
}
export function fixtureStatus(status: string) {
  const labels: Record<string, string> = { NS:"경기 예정", TBD:"시간 미정", "1H":"전반", HT:"하프타임", "2H":"후반", ET:"연장", BT:"연장 휴식", P:"승부차기", LIVE:"진행 중", FT:"경기 종료", AET:"연장 종료", PEN:"승부차기 종료", PST:"연기", CANC:"취소", SUSP:"중단", INT:"일시 중단", ABD:"중단", AWD:"결과 확정", WO:"몰수" };
  return labels[status.trim().toUpperCase()] || status;
}
export function koreanDay(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(value));
}
export function selectFeaturedFixtures(fixtures: Fixture[], limit = 3) {
  const rank = (f: Fixture) => ({ live:0, scheduled:1, finished:2, other:3 })[fixtureGroup(f.status)];
  return [...fixtures].filter(f => Number.isFinite(Date.parse(f.startsAt))).sort((a,b) => {
    const diff = rank(a) - rank(b);
    if (diff) return diff;
    return fixtureGroup(a.status) === "finished" ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt);
  }).slice(0, limit);
}

/** Within each date, leagues stay together and each league is chronological. */
export function fixturesByLeague(fixtures:Fixture[]):{leagueId:string|null;fixtures:Fixture[]}[]{
 const order=['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'];
 const groups=new Map<string|null,Fixture[]>();
 for(const f of fixtures)groups.set(f.leagueId,[...(groups.get(f.leagueId)??[]),f]);
 const rank=(id:string|null)=>order.includes(id??'')?order.indexOf(id!):99;
 return [...groups].sort(([a],[b])=>rank(a)-rank(b)||(a??'').localeCompare(b??'')).map(([leagueId,rows])=>({leagueId,fixtures:[...rows].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id))}));
}
