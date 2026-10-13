"use client";
import { useMemo } from "react";
import type { SelectOption } from "./select";
import { usePlatform } from "./provider";
import { ClubCrest, LeagueMark } from "./ui";
import { clubIdentity } from "@/lib/kickx/club-identity";

/** Club options grouped by league, each with its crest. */
export function useTeamOptions(allLabel: string | null, leagueId = "all", allValue = "all"): SelectOption[] {
  const { data } = usePlatform();
  return useMemo(() => {
    const leagueName = new Map(data.leagues.map((l) => [l.id, l.name]));
    const order = new Map(data.leagues.map((l, i) => [l.id, i]));
    const teams = data.teams
      .filter(t=>t.leagueId && ['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'].includes(t.leagueId) || !t.id.startsWith('bsd-'))
      .filter((t) => leagueId === "all" || t.leagueId === leagueId)
      .sort((a, b) => (order.get(a.leagueId ?? "") ?? 99) - (order.get(b.leagueId ?? "") ?? 99) || a.name.localeCompare(b.name));
    const options: SelectOption[] = teams.map((t) => ({ value: t.id, label: t.name, group: leagueId === "all" ? leagueName.get(t.leagueId ?? "") ?? "기타" : undefined, icon: <ClubCrest id={t.id} size="small" />, keywords: [t.english, t.code, clubIdentity(t)?.code].filter(Boolean).join(" ") }));
    return allLabel ? [{ value: allValue, label: allLabel }, ...options] : options;
  }, [data.teams, data.leagues, leagueId, allLabel, allValue]);
}
export function useLeagueOptions(allLabel = "모든 리그", includeClubCompetitions=false): SelectOption[] {
  const { data } = usePlatform();
  return useMemo(() => [
    { value: "all", label: allLabel },
    ...data.leagues.filter(l=>includeClubCompetitions || !l.id.startsWith('bsd-') || ['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6'].includes(l.id)).map((l) => ({ value: l.id, label: l.name, icon: <LeagueMark league={l} size="sm" /> })),
  ], [data.leagues, allLabel,includeClubCompetitions]);
}
export const POSITION_OPTIONS: SelectOption[] = [
  { value: "all", label: "포지션 전체" },
  { value: "FW", label: "FW", hint: "공격수" },
  { value: "MF", label: "MF", hint: "미드필더" },
  { value: "DF", label: "DF", hint: "수비수" },
  { value: "GK", label: "GK", hint: "골키퍼" },
];
export const simple = (values: string[]): SelectOption[] => values.map((v) => ({ value: v, label: v }));
