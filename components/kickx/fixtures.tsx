"use client";
import { Select } from "./select";
import { Pagination } from "./pagination";
import { DOMESTIC_LEAGUES } from "@/lib/kickx/support";
import { useLeagueOptions } from "./options";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Search } from "lucide-react";
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
const REFLECTION: Record<string, { label: string; tone: string; detail: string }> = {
  pending: { label: "계산 대기", tone: "wait", detail: "경기 기록을 수집하는 중입니다. 수집이 끝나면 선수 점수와 가치가 계산됩니다." },
  withheld: { label: "계산 보류", tone: "hold", detail: "기록 확인이 필요해 점수 계산을 보류했습니다. 확인 전까지 선수 가치에 반영되지 않습니다." },
  partial: { label: "일부 반영", tone: "part", detail: "일부 선수만 점수가 계산되었습니다. 나머지 선수는 기록을 확인하고 있습니다." },
  reflected: { label: "반영 완료", tone: "done", detail: "이 경기의 선수 점수 계산이 완료되었습니다." },
};
/** Corner badge for the match's scoring state; the full explanation shows on hover or keyboard focus. */
function ReflectionBadge({ status }: { status?: string | null }) {
  const id = useId();
  const state = status ? REFLECTION[status] : undefined;
  if (!state) return null;
  return (
    <span className={`reflect-badge ${state.tone}`} tabIndex={0} aria-describedby={id}>
      <i aria-hidden="true" />{state.label}
      <span role="tooltip" id={id} className="reflect-tip">{state.detail}</span>
    </span>
  );
}
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
      </div>
      <ReflectionBadge status={fixture.reflectionStatus} />
      <Link href={"/teams/" + fixture.away} className={`match-team ${homeWin ? "lost" : ""}`}>
        <TeamBadge id={fixture.away} />
        <span>{getTeam(fixture.away)?.name || "구단 정보 없음"}</span>
      </Link>
    </li>
  );
}
export function FixturesScreen() {
  const {data,status:platformStatus}=usePlatform();
  const today=koreanDay(new Date().toISOString()),todayMonth=today.slice(0,7);
  const [month,setMonth]=useState(todayMonth),[league,setLeague]=useState('all'),[state,setState]=useState('all'),[query,setQuery]=useState(''),[page,setPage]=useState(1),[jump,setJump]=useState(0);
  const [year,monthNumber]=month.split('-').map(Number);
  const todayRef=useRef<HTMLElement>(null),scrolled=useRef('');
  const leagueOptions=useLeagueOptions('5대 리그 전체');
  const results=useMemo(()=>data.fixtures.filter(f=>{
    const home=data.teams.find(t=>t.id===f.home),away=data.teams.find(t=>t.id===f.away);
    return !!f.leagueId && (DOMESTIC_LEAGUES.includes(f.leagueId as typeof DOMESTIC_LEAGUES[number]) || !f.leagueId.startsWith('bsd-'))
      && koreanDay(f.startsAt).startsWith(month) && (league==='all'||f.leagueId===league) && (state==='all'||fixtureGroup(f.status)===state)
      && (!query.trim()||[home?.name,home?.english,away?.name,away?.english].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)),[data.fixtures,data.teams,month,league,state,query]);
  const remote=useCatalogPage<Fixture>('fixtures',{month,league,state,q:query,page,size:500});
  const status=remote.enabled?remote.status:platformStatus,total=remote.enabled?remote.data.total:results.length;
  const visible=remote.enabled?(status==='ready'?remote.data.items:[]):results.slice((page-1)*500,page*500);
  const groups=new Map<string,Fixture[]>();
  for(const f of visible){const day=koreanDay(f.startsAt);groups.set(day,[...(groups.get(day)??[]),f]);}
  if(month===todayMonth&&!groups.has(today))groups.set(today,[]);
  const days=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b));
  useEffect(()=>{
    const key=`${month}:${jump}`;
    if(status!=='ready'||month!==todayMonth||scrolled.current===key)return;
    const frame=requestAnimationFrame(()=>{if(todayRef.current){todayRef.current.scrollIntoView({block:'start',behavior:'instant'});scrolled.current=key;}});
    return()=>cancelAnimationFrame(frame);
  },[status,month,todayMonth,jump]);
  const changeMonth=(value:string)=>{setMonth(value);setPage(1);};
  const shift=(delta:number)=>{const d=new Date(Date.UTC(year,monthNumber-1+delta,1));changeMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`);};
  const latest=()=>{setMonth(todayMonth);setPage(1);setJump(n=>n+1);};
  const stateLabel=STATES.find(([v])=>v===state)?.[1]??'전체';
  return <>
    <PageHeading eyebrow="MATCH CENTRE" title="경기 일정" description="5대 정규 리그의 월별 일정과 결과를 확인하세요. 구단 상세페이지에서는 모든 대회의 일정을 볼 수 있습니다." action={<span className="tag outline"><CalendarDays size={14}/>대한민국 시간 · KST</span>}/>
    <section className="panel flush schedule-calendar">
      <div className="schedule-controls">
        <div className="schedule-year"><button aria-label="이전 연도" onClick={()=>changeMonth(`${year-1}-${String(monthNumber).padStart(2,'0')}`)} disabled={year<=2000}><ChevronLeft size={20}/></button>
          <Select label="일정 연도" value={String(year)} onChange={y=>changeMonth(`${y}-${String(monthNumber).padStart(2,'0')}`)} options={Array.from({length:Number(today.slice(0,4))-2000+6},(_,i)=>({value:String(2000+i),label:`${2000+i}년`}))}/>
          <button aria-label="다음 연도" onClick={()=>changeMonth(`${year+1}-${String(monthNumber).padStart(2,'0')}`)} disabled={year>=Number(today.slice(0,4))+5}><ChevronRight size={20}/></button>
        </div><button className="button secondary small" onClick={latest}>최신</button>
      </div>
      <nav className="schedule-months" aria-label="일정 월 선택">{Array.from({length:12},(_,i)=>i+1).map(m=><button key={m} aria-current={m===monthNumber?'date':undefined} className={m===monthNumber?'active':''} onClick={()=>changeMonth(`${year}-${String(m).padStart(2,'0')}`)}>{m}월</button>)}</nav>
      <div className="schedule-filter-bar"><Select label="경기 대회" value={league} onChange={v=>{setLeague(v);setPage(1);}} options={leagueOptions}/>
        <label className="input-search"><Search size={16}/><input aria-label="경기 구단 검색" placeholder="구단 이름 검색" maxLength={100} value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label>
      </div>
      <div className="panel-head"><Tabs items={STATES.map(([,label])=>label)} value={stateLabel} onChange={label=>{setState(STATES.find(([,l])=>l===label)?.[0]??'all');setPage(1);}} label="경기 상태"/></div>
      <div className="schedule-month-heading"><button aria-label="이전 월" onClick={()=>shift(-1)} disabled={year<=2000&&monthNumber===1}><ChevronLeft size={18}/></button><h2>{year}년 {monthNumber}월 <span className="muted num">{status==='ready'?`${total}경기`:'불러오는 중'}</span></h2><button aria-label="다음 월" onClick={()=>shift(1)} disabled={year>=Number(today.slice(0,4))+5&&monthNumber===12}><ChevronRight size={18}/></button></div>
      {status==='ready'?days.map(([day,fixtures])=><section className={`match-day${day===today?' today':''}`} key={day} ref={day===today?todayRef:undefined} data-date={day}>
        <h2><span className="match-day-date num">{Number(day.slice(5,7))}월 {Number(day.slice(8))}일</span><span className={`match-day-week ${['토','일'].includes(weekday(day))?'weekend':''}`}>({weekday(day)})</span>{day===today&&<span className="tag yellow">오늘</span>}<small className="num">{fixtures.length}경기</small></h2>
        {fixtures.length?<ul>{fixtures.map(f=><MatchRow key={f.id} fixture={f}/>)}</ul>:<p className="schedule-no-match">오늘은 선택한 조건에 맞는 경기가 없습니다.</p>}
      </section>):<DataEmpty entity="경기 일정" status={status} retry={remote.enabled?remote.reload:undefined}/>}
      {status==='ready'&&!total&&<p className="schedule-no-match">{year}년 {monthNumber}월에 수집된 경기가 없습니다.</p>}
      {total>500&&<Pagination page={page} total={total} size={500} onPage={setPage} label="경기"/>}
    </section>
  </>;
}
