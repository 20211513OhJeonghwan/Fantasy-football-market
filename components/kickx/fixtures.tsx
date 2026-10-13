"use client";
import { Select } from "./select";
import { useLeagueOptions } from "./options";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import { usePlatform } from "./provider";
import { useCatalogPage } from "./catalog";
import type { Fixture } from "@/lib/kickx/types";
import { DataEmpty, LeagueMark, PageHeading, Tabs, TeamBadge } from "./ui";
import { clubIdentity } from "@/lib/kickx/club-identity";
import { dateText } from "@/lib/kickx/data";
import { fixtureGroup, fixtureStatus, koreanDay } from "@/lib/kickx/fixtures";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** Weekday for a KST calendar day string (YYYY-MM-DD). */
const weekday = (day: string) => { const d = new Date(day + "T00:00:00Z"); return Number.isNaN(d.getTime()) ? "" : WEEKDAYS[d.getUTCDay()]; };
const STATES: [string, string][] = [["all", "전체"], ["live", "진행 중"], ["scheduled", "예정"], ["finished", "종료"], ["other", "연기·기타"]];
/** One match card: club-colour edges, score block and links to each team page. */
export function MatchRow({ fixture, showDate = false }: { fixture: Fixture; showDate?: boolean }) {
  const { getTeam, getLeague } = usePlatform();
  const group = fixtureGroup(fixture.status);
  const scored = fixture.homeScore != null && fixture.awayScore != null;
  const homeWin = scored && (fixture.homeScore! > fixture.awayScore! || fixture.homeScore===fixture.awayScore && fixture.penaltiesHome!=null && fixture.penaltiesAway!=null && fixture.penaltiesHome>fixture.penaltiesAway), awayWin = scored && (fixture.awayScore! > fixture.homeScore! || fixture.homeScore===fixture.awayScore && fixture.penaltiesHome!=null && fixture.penaltiesAway!=null && fixture.penaltiesAway>fixture.penaltiesHome);
  const homeId = clubIdentity(getTeam(fixture.home)), awayId = clubIdentity(getTeam(fixture.away));
  const tint = { "--home": homeId?.primary ?? "var(--line-2)", "--away": awayId?.primary ?? "var(--line-2)" } as CSSProperties;
  const [day, time] = [koreanDay(fixture.startsAt), dateText(fixture.startsAt).split(" ").slice(-1).join(" ")];
  return (
    <li className={`match-row ${group}`} style={tint}>
      <div className="match-meta">
        <time dateTime={fixture.startsAt} className="num">{showDate ? `${day.slice(5).replace("-", ".")} (${weekday(day)}) ${time}` : time}</time>
        <span><LeagueMark league={getLeague(fixture.leagueId)} size="sm" />{getLeague(fixture.leagueId)?.name || "대회 정보 없음"}{fixture.roundLabel && ` · ${fixture.roundLabel}`}</span>
      </div>
      <Link href={"/teams/" + fixture.home} className={`match-team home ${awayWin ? "lost" : ""}`}>
        <span>{getTeam(fixture.home)?.name || "구단 정보 없음"}</span>
        <TeamBadge id={fixture.home} />
      </Link>
      <div className={`match-score ${scored ? "scored" : ""}`}>
        <strong className="num">{scored ? `${fixture.homeScore} : ${fixture.awayScore}` : "VS"}</strong>
        {fixture.penaltiesHome!=null && fixture.penaltiesAway!=null && <small>승부차기 {fixture.penaltiesHome} : {fixture.penaltiesAway}</small>}
        <span className={`match-status ${group}`}>{fixtureStatus(fixture.status)}</span>
        {fixture.reflectionStatus && <small>{({pending:'기록 수집·계산 대기',withheld:'기록 확인 · 계산 보류',partial:'일부 반영 · 기록 확인 중',reflected:'점수 계산 완료'} as Record<string,string>)[fixture.reflectionStatus]}</small>}
      </div>
      <Link href={"/teams/" + fixture.away} className={`match-team ${homeWin ? "lost" : ""}`}>
        <TeamBadge id={fixture.away} />
        <span>{getTeam(fixture.away)?.name || "구단 정보 없음"}</span>
      </Link>
    </li>
  );
}
export function FixturesScreen() {
  const { data, status:platformStatus } = usePlatform();
  const [league, setLeague] = useState("all"), [state, setState] = useState("all");
  const [day, setDay] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const leagueOptions = useLeagueOptions('모든 대회',true);
  const results = useMemo(() => data.fixtures.filter((fixture) => {
    const home = data.teams.find((t) => t.id === fixture.home), away = data.teams.find((t) => t.id === fixture.away);
    return (league === "all" || fixture.leagueId === league) && (state === "all" || fixtureGroup(fixture.status) === state)
      && (!day || koreanDay(fixture.startsAt) === day)
      && (!query.trim() || [home?.name, home?.english, away?.name, away?.english].filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), [data.fixtures, data.teams, league, state, day, query]);
  const remote=useCatalogPage<Fixture>("fixtures",{league,state,day,q:query,page,size:20});
  const status=remote.enabled ? remote.status : platformStatus;
  const total=remote.enabled ? remote.data.total : results.length;
  const count=Math.max(1,Math.ceil(total/20)),current=remote.enabled ? page : Math.min(page,count);
  const visible=remote.enabled ? (status === "ready" ? remote.data.items : []) : results.slice((current-1)*20,current*20);
  const groups = new Map<string, typeof results>();
  for (const fixture of visible) {
    const key = koreanDay(fixture.startsAt);
    groups.set(key, [...(groups.get(key) || []), fixture]);
  }
  const today = koreanDay(new Date().toISOString());
  const filtered = league !== "all" || state !== "all" || !!day || !!query;
  const reset = () => { setLeague("all"); setState("all"); setDay(""); setQuery(""); setPage(1); };
  const stateLabel = STATES.find(([value]) => value === state)?.[1] ?? "전체";
  return (
    <>
      <PageHeading
        eyebrow="MATCH CENTRE"
        title="경기 일정"
        description={data.policy?.clubCompetitionsEnabled ? '5대 리그와 소속 구단의 공식 컵대회·유럽 대항전. 검증된 경기 기록을 점수와 가치에 반영합니다.' : '5대 리그의 경기 일정과 결과. 검증된 경기 기록을 점수와 가치에 반영합니다.'}
        action={<span className="tag outline"><CalendarDays size={14} />대한민국 시간 · KST</span>}
      />
      <section className="panel flush">
        <div className="panel-head">
          <Tabs items={STATES.map(([, label]) => label)} value={stateLabel} onChange={(label) => { setState(STATES.find(([, l]) => l === label)?.[0] ?? "all"); setPage(1); }} label="경기 상태" />
        </div>
        <div className="toolbar fixture-tools">
          <label className="input-search"><Search size={17} /><input aria-label="경기 구단 검색" placeholder="구단 이름 검색" maxLength={100} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
          <Select label="경기 대회" value={league} onChange={(v) => { setLeague(v); setPage(1); }} options={leagueOptions} />
          <input type="date" aria-label="경기 날짜 (대한민국 시간)" value={day} onChange={(e) => { setDay(e.target.value); setPage(1); }} />
          <button className="button secondary" disabled={!filtered} onClick={reset}><RotateCcw size={15} />초기화</button>
        </div>
        <p className="fixture-summary" role="status">
          {status === "ready" ? <><b className="num">{total}</b>경기</> : "경기 정보를 준비하고 있습니다."}
          <span>진행 상태는 마지막 수집 기록을 기준으로 표시합니다.</span>
        </p>
        {[...groups].map(([date, fixtures]) => (
          <section className="match-day" key={date}>
            <h2>
              <span className="match-day-date num">{date.slice(5).replace("-", ".")}</span>
              <span className={`match-day-week ${["토", "일"].includes(weekday(date)) ? "weekend" : ""}`}>{weekday(date)}요일</span>
              <span className="match-day-year num">{date.slice(0, 4)}</span>
              {date === today && <span className="tag yellow">오늘</span>}
              <small className="num">{fixtures.length}경기</small>
            </h2>
            <ul>
              {fixtures.map((fixture) => <MatchRow fixture={fixture} key={fixture.id} />)}
            </ul>
          </section>
        ))}
        {!visible.length && <DataEmpty entity="경기 일정" status={status} retry={remote.enabled ? remote.reload : undefined} filtered={filtered} />}
        {total > 0 && (
          <div className="panel-foot pagination">
            <span>{`${(current - 1) * 20 + 1}–${Math.min(current * 20, total)} / ${total}`}</span>
            <div>
              <button aria-label="이전 경기 페이지" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft size={17} /></button>
              <span className="num">{current} / {count}</span>
              <button aria-label="다음 경기 페이지" disabled={current === count} onClick={() => setPage(current + 1)}><ChevronRight size={17} /></button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
