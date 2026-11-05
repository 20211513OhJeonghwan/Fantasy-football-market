"use client";
import {CommunityFeed} from "./community-feed";
import {PerformanceDetails} from "./performance";
import { MatchReportDialog } from "./match-report";
import { Select } from "./select";
import { useLeagueOptions, useTeamOptions } from "./options";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, LayoutGrid, List, MessageCircle, RotateCcw, Search, Sparkles } from "lucide-react";
import { dateText, money, seriesForDays, score } from "@/lib/kickx/data";
import { leagueIdentity } from "@/lib/kickx/club-identity";
import { DOMESTIC_LEAGUES } from "@/lib/kickx/support";
import type { Player, PlayerRecord } from "@/lib/kickx/types";
import { usePlatform } from "./provider";
import { useCatalogPage, useCatalogPlayer } from "./catalog";
import { PlayerCard } from "./player-card";
import { Pagination } from "./pagination";
import {
  BackLink,
  Change,
  DataEmpty,
  Empty,
  PageHeading,
  PlayerIdentity,
  PlayerPortrait,
  PositionBadge,
  PriceChart,
  SectionTitle,
  Sparkline,
  Tabs,
  TradeButton,
  TradeNotice,
  WatchButton,
  ClubCrest,
  LeagueMark,
  useClub,
} from "./ui";

const LIST_PAGE_SIZE = 12;
const SORT_OPTIONS = [
  { value: "name", label: "이름순" },
  { value: "price", label: "가치 높은 순" },
  { value: "price-asc", label: "가치 낮은 순" },
  { value: "change", label: "상승률 순" },
  { value: "performance", label: "Performance 순" },
  { value: "volume", label: "거래량 순" },
];
function compareNumber(a: number | null, b: number | null, ascending = false) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return ascending ? a - b : b - a;
}
function useMarketCatalog() {
  const { data } = usePlatform();
  const leagues = data.leagues.filter(l=>DOMESTIC_LEAGUES.includes(l.id as typeof DOMESTIC_LEAGUES[number]));
  const teams = data.teams.filter(t=>leagues.some(l=>l.id===t.leagueId));
  return {data,leagues,teams};
}
function MarketHero() {
  const {data,leagues,teams}=useMarketCatalog();
  const featured = [...data.players].filter(p=>!p.id.startsWith('bsd-')||teams.some(t=>t.id===p.team)).sort((a, b) => Number(!!b.photo) - Number(!!a.photo)).slice(0, 3);
  const total = data.market?.totalPlayers ?? data.playerTotal ?? data.players.length;
  return (
      <section className="market-hero" aria-labelledby="market-hero-title">
        <div className="market-hero-copy">
          <span className="eyebrow plain">PLAYER EXCHANGE · BIG FIVE</span>
          <h2 id="market-hero-title">유럽 5대 리그의 선수를<br /><em>한 곳에서.</em></h2>
          <dl className="market-hero-stats">
            <div><dt>등록 선수</dt><dd className="num">{money(total)}</dd></div>
            <div><dt>구단</dt><dd className="num">{teams.length}</dd></div>
            <div><dt>리그</dt><dd className="num">{leagues.length}</dd></div>
            <div><dt>가격 적용</dt><dd className="num small">{dateText(data.updatedAt)}</dd></div>
          </dl>
        </div>
        <div className="market-hero-stack" aria-hidden="true">
          {featured.map((p, i) => (
            <Link key={p.id} href={`/players/${p.id}`} tabIndex={-1} className={`hero-card hero-card-${i}`}>
              <PlayerPortrait player={p} size="xl" />
              <span className="hero-card-plate"><b>{p.short || p.name}</b><small>{p.position ?? "—"}</small></span>
            </Link>
          ))}
        </div>
      </section>
  );
}
function MarketLeagues({ league, onLeague }: { league: string; onLeague: (id: string) => void }) {
  const {leagues,teams}=useMarketCatalog();
  return (
    <>
      {leagues.length > 0 && (
        <div className="league-tiles" role="group" aria-label="리그로 선수 보기">
          <button type="button" className={`league-tile all ${league === "all" ? "active" : ""}`} aria-pressed={league === "all"} onClick={() => onLeague("all")}>
            <span className="league-tile-mark">ALL</span>
            <strong>전체 리그</strong>
            <small className="num">{teams.length}개 구단</small>
          </button>
          {leagues.map((l) => {
            const mark = leagueIdentity(l);
            return (
              <button key={l.id} type="button" className={`league-tile ${league === l.id ? "active" : ""}`} aria-pressed={league === l.id} onClick={() => onLeague(l.id)}
                style={{ "--league": mark?.color, "--league-ink": mark?.ink } as CSSProperties}>
                <span className="league-tile-mark">{mark?.short}</span>
                <strong>{l.name}</strong>
                <small className="num">{mark?.country ? `${mark.country} · ` : ""}{teams.filter((t) => t.leagueId === l.id).length}개 구단</small>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
export function PlayerList({ market = false }: { market?: boolean }) {
  const sp = useSearchParams();
  const { data, status: platformStatus, getTeam, getLeague } = usePlatform();
  const [q, setQ] = useState(sp.get("q") || ""),
    [league, setLeague] = useState("all"),
    [team, setTeam] = useState(sp.get("team") || "all"),
    [pos, setPos] = useState("전체");
  const [sort, setSort] = useState(market ? "volume" : "name"),
    [view, setView] = useState("grid"),
    [tab, setTab] = useState(sp.get("watchlist") === "1" ? "관심 선수" : "전체 선수"),
    [page, setPage] = useState(1),
    [cardPageSize, setCardPageSize] = useState(4);
  const browserRef=useRef<HTMLElement>(null);
  const pageSize=view === "grid" ? cardPageSize : LIST_PAGE_SIZE;
  useEffect(() => {
    const element=browserRef.current;
    if(!element)return;
    const resize=() => {
      // Share the grid's CSS sizing so each page contains exactly two rows.
      const style=getComputedStyle(element);
      const gap=parseFloat(style.getPropertyValue("--player-grid-gap")) || 0;
      const minimum=parseFloat(style.getPropertyValue("--player-grid-min-width")) || 1;
      const fixedColumns=parseInt(style.getPropertyValue("--player-grid-columns"),10);
      const columns=fixedColumns || Math.max(1,Math.floor((element.clientWidth+gap)/(minimum+gap)));
      const nextSize=Math.min(50,columns*2);
      if(nextSize===cardPageSize)return;
      if(view==="grid")setPage(previous=>Math.floor((previous-1)*cardPageSize/nextSize)+1);
      setCardPageSize(nextSize);
    };
    resize();
    const observer=new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  },[view,cardPageSize]);
  const leagueOptions = useLeagueOptions();
  const teamOptions = useTeamOptions("모든 구단", league);
  useEffect(() => {
    setQ(sp.get("q") || "");
    setTeam(sp.get("team") || "all");
    setTab(sp.get("watchlist") === "1" ? "관심 선수" : "전체 선수");
    setPage(1);
  }, [sp]);
  const results = data.players
    .filter((p) => {
      const t = getTeam(p.team),
        l = getLeague(t?.leagueId);
      return (
        `${p.name} ${p.english || ""} ${t?.name || ""} ${t?.english || ""} ${l?.name || ""}`.toLowerCase().includes(q.trim().toLowerCase()) &&
        (league === "all" || t?.leagueId === league) &&
        (team === "all" || p.team === team) &&
        (pos === "전체" || p.position === pos) &&
        (tab !== "관심 선수" || data.member?.watchlist.includes(p.id)) &&
        (tab !== "상승 선수" || (p.change != null && p.change > 0)) &&
        (tab !== "하락 선수" || (p.change != null && p.change < 0)) &&
        (tab !== "보유 선수" || data.member?.holdings.some((h) => h.playerId === p.id))
      );
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      const key = (sort === "price-asc" ? "price" : sort) as "price" | "change" | "performance" | "volume";
      return compareNumber(a[key], b[key], ["price-asc"].includes(sort)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
  const remote=useCatalogPage<Player>("players",{q,league,team,position:pos === "전체" ? undefined : pos,sort,page,size:pageSize,scope:({"관심 선수":"watch","보유 선수":"owned","상승 선수":"rising","하락 선수":"falling"} as Record<string,string>)[tab] ?? "all"});
  const total=remote.enabled ? remote.data.total : results.length;
  const pageCount=Math.max(1,Math.ceil(total/pageSize)), current=Math.min(page,pageCount);
  const correctingPage=remote.enabled && remote.status === "ready" && page !== current;
  const status=correctingPage ? "loading" : remote.enabled ? remote.status : platformStatus;
  useEffect(() => {
    if (correctingPage) setPage(current);
  }, [correctingPage, current]);
  const visible=remote.enabled ? (status === "ready" ? remote.data.items : []) : results.slice((current-1)*pageSize,current*pageSize);
  const filtered = !!q || league !== "all" || team !== "all" || pos !== "전체" || tab !== "전체 선수";
  const reset = () => {
    setQ("");
    setLeague("all");
    setTeam("all");
    setPos("전체");
    setTab("전체 선수");
    setPage(1);
  };
  function changeView(next:string) {
    if(next===view)return;
    const nextSize=next === "grid" ? cardPageSize : LIST_PAGE_SIZE;
    setPage(Math.floor((current-1)*pageSize/nextSize)+1);
    setView(next);
  }
  function changePage(next:number) {
    setPage(next);
    browserRef.current?.scrollIntoView({block:"start",behavior:"smooth"});
  }
  const movers = [...data.players].filter((p) => p.change != null).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!)).slice(0, 4);
  return (
    <>
      <div className={market ? "market-heading" : undefined}><PageHeading
        eyebrow={market ? "PLAYER EXCHANGE" : "DISCOVER YOUR NEXT PLAYER"}
        title={market ? "선수 시장" : "선수 탐색"}
        description={market ? undefined : "리그·구단·포지션으로 나에게 맞는 선수를 찾아보세요."}
        action={<span className="updated-at">가격 적용 <b>{dateText(data.updatedAt)}</b></span>}
      /></div>
      {market && (
        <>
          <MarketHero />
          {movers.length > 0 && (
            <section className="market-movers" aria-labelledby="market-movers">
              <SectionTitle title="최근 변동" meta="직전 발행 대비 변동폭 상위" />
              <div className="mover-cards">
                {movers.map((p) => (
                  <Link key={p.id} href={`/players/${p.id}`} className="mover-card hover-lift">
                    <PlayerPortrait player={p} size="md" />
                    <span className="mover-card-text">
                      <strong>{p.name}</strong>
                      <span>{getTeam(p.team)?.name}</span>
                    </span>
                    <span className="mover-card-value">
                      <b className="num">{money(p.price)}<span className="unit">P</span></b>
                      <Change value={p.change} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <section className={`browser${market ? " market-browser" : ""}`} ref={browserRef} aria-label="선수 목록" tabIndex={-1} data-pagination-focus-target>
        {market && <MarketLeagues league={league} onLeague={(id) => { setLeague(id); setTeam("all"); setPage(1); }} />}
        <div className="browser-top">
          <Tabs
            items={market ? ["전체 선수", "상승 선수", "하락 선수", "관심 선수", "보유 선수"] : ["전체 선수", "관심 선수", "보유 선수"]}
            value={tab}
            onChange={(v) => { setTab(v); setPage(1); }}
            label="선수 목록 보기"
          />
          <div className="view-switch" role="group" aria-label="보기 방식">
            <button aria-label="카드 보기" aria-pressed={view === "grid"} onClick={() => changeView("grid")} className={view === "grid" ? "active" : ""}><LayoutGrid size={17} /></button>
            <button aria-label="목록 보기" aria-pressed={view === "list"} onClick={() => changeView("list")} className={view === "list" ? "active" : ""}><List size={17} /></button>
          </div>
        </div>
        <div className="toolbar browser-filters">
          <label className="input-search">
            <Search size={17} />
            <input aria-label="선수 검색" placeholder="선수 · 구단 · 리그 검색" maxLength={100} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </label>
          <Select label="리그 필터" value={league} onChange={(v) => { setLeague(v); setTeam("all"); setPage(1); }} options={leagueOptions} />
          <Select label="구단 필터" value={team} onChange={(v) => { setTeam(v); setPage(1); }} options={teamOptions} />
          <Select label="선수 정렬" value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={SORT_OPTIONS} />
        </div>
        <div className="result-line">
          <div className="chips" role="group" aria-label="포지션 필터">
            {["전체", "FW", "MF", "DF", "GK"].map((p) => (
              <button key={p} type="button" aria-pressed={p === pos} onClick={() => { setPos(p); setPage(1); }} className={`chip ${p === pos ? "active" : ""}`}>{p}</button>
            ))}
          </div>
          <span className="result-count">
            {status === "ready" ? <><strong className="num">{total}</strong>명의 선수</> : "—"}
            {filtered && <button type="button" className="text-link" onClick={reset}><RotateCcw size={13} />필터 초기화</button>}
          </span>
        </div>
        {view === "grid" && visible.length > 0 ? (
          <div className="player-grid">{visible.map((p) => <PlayerCard key={p.id} player={p} />)}</div>
        ) : view === "list" && visible.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table market-table">
              <thead>
                <tr>
                  <th>선수</th>
                  <th className="hide-sm">포지션</th>
                  <th className="numeric">현재 가치</th>
                  <th className="numeric hide-sm"><abbr title="직전 발행 가격 대비 변화율">변동</abbr></th>
                  <th className="hide-md">30일 추이</th>
                  <th className="numeric hide-sm"><abbr title="최근 경기 1건의 저장 점수">Performance</abbr></th>
                  <th className="numeric hide-md">거래량</th>
                  <th className="cell-actions hide-sm">거래</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const owned = data.member?.holdings.some((h) => h.playerId === p.id);
                  return (
                    <tr key={p.id}>
                      <td><span className="row-identity"><WatchButton id={p.id} /><PlayerIdentity player={p} /></span></td>
                      <td className="hide-sm"><PositionBadge position={p.position} /></td>
                      <td className="numeric strong">{p.price != null ? <>{money(p.price)}<span className="unit">P</span><span className="only-sm"><Change value={p.change} /></span></> : <span className="value-pending">산정 전</span>}</td>
                      <td className="numeric hide-sm"><Change value={p.change} /></td>
                      <td className="hide-md"><Sparkline values={p.history.map((v) => v.value)} down={(p.change ?? 0) < 0} /></td>
                      <td className="numeric hide-sm">{score(p.performance)}</td>
                      <td className="numeric hide-md">{money(p.volume)}</td>
                      <td className="cell-actions hide-sm"><TradeButton player={p} side={owned ? "sell" : "buy"} className={`button small ${owned ? "secondary" : "primary"}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {remote.inputError ? <Empty title="검색어를 확인해 주세요" description={remote.inputError} /> : !visible.length && <DataEmpty entity="선수" status={status} retry={remote.enabled ? remote.reload : undefined} filtered={filtered} rows={6} />}
        {status === "ready" && <Pagination key={pageSize} page={current} total={total} size={pageSize} onPage={changePage} label="선수 시장" centered allowJump />}
      </section>
    </>
  );
}
function PerformanceBars({ player }: { player: Player }) {
  const records = [...player.records].sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt)).slice(-6);
  if (!records.length) return <p className="muted perf-empty">최근 경기 기록이 없습니다.</p>;
  const scale=Math.max(1,...records.map(r=>Math.abs(r.performance??0)));
  return (
    <div className="perf-bars" role="img" aria-label={`최근 ${records.length}경기 Performance (막대는 점수의 절댓값): ${records.map((r) => score(r.performance)).join(", ")}`}>
      {records.map((r) => (
        <span key={r.id} className={r.performance == null ? "dnp" : r.performance<0 ? "negative" : ""}>
          <i style={{ height: `${r.performance == null ? 6 : Math.max(4, Math.abs(r.performance)/scale*70)}%` }} />
          <b className="num">{r.performance == null ? "—" : r.performance}</b>
          <small>{dateText(r.playedAt, false).slice(6)}</small>
        </span>
      ))}
    </div>
  );
}
export function PlayerDetail() {
  const params = useParams();
  const { data, getTeam, getLeague } = usePlatform();
  const detail = useCatalogPlayer(String(params.id));
  const {player:p,status} = detail;
  const [period, setPeriod] = useState("1개월"),
    [tab, setTab] = useState("최근 경기");
  const [reportRecord, setReportRecord] = useState<PlayerRecord | null>(null);
  const canReadReports = !!data.session?.profile;
  const owned = data.member?.holdings.find((h) => h.playerId === p?.id);
  const team = getTeam(p?.team);
  const detailClub = useClub(p?.team);
  const posts = data.posts.filter((post) => post.scope === "player" && post.target === p?.id).slice(0, 3);
  if (!p)
    return (
      <>
        <BackLink />
        <section className="panel">
          {status === "ready" ? (
            <Empty title="선수를 찾을 수 없습니다" description="주소가 올바른지 확인하거나 선수 목록에서 다시 찾아보세요." action={<Link className="button primary small" href="/market">선수 시장</Link>} />
          ) : <DataEmpty entity="선수" status={status} retry={detail.reload} />}
        </section>
      </>
    );
  const points = seriesForDays(p.history, period === "1주" ? 7 : period === "2주" ? 14 : 30);
  const high = points.length ? Math.max(...points.map((x) => x.value)) : null,
    low = points.length ? Math.min(...points.map((x) => x.value)) : null;
  return (
    <>
      <BackLink />
      <section className="detail-hero" style={{ "--club": detailClub.identity?.primary ?? "#55554f", "--club-2": detailClub.identity?.secondary ?? "#ffffff" } as CSSProperties}>
        <span className="detail-hero-bg" aria-hidden="true" />
        <div className="detail-photo"><PlayerPortrait player={p} size="xl" /></div>
        <div className="detail-identity">
          <div className="detail-badges">
            <ClubCrest id={p.team} size="large" />
            {getLeague(team?.leagueId) && <LeagueMark league={getLeague(team?.leagueId)} size="md" />}
          </div>
          <h1>{p.name}</h1>
          {p.english && p.english !== p.name && <p className="detail-english">{p.english}</p>}
          <div className="detail-meta">
            <span className="detail-club">{team?.name || "소속 정보 없음"}</span>
            <PositionBadge position={p.position} />
            <span>{p.country || "국적 정보 없음"}</span>
            <span>{p.age != null ? `${p.age}세` : "나이 정보 없음"}</span>
          </div>
        </div>
        <div className="detail-price">
          <span className="detail-price-label">현재 가치 <small>마지막 발행 가격</small></span>
          {p.price != null ? (
            <>
              <strong className="num">{money(p.price)}<span className="unit">P</span></strong>
              <span className="detail-change"><Change value={p.change} size="lg" /><small>직전 발행 대비</small></span>
            </>
          ) : (
            <div className="detail-pending">
              <span className="pcard-pending-dot" aria-hidden="true" />
              <div><strong>가치 산정 전</strong><small>Performance 계산이 연결되면 가치와 변동률이 표시됩니다.</small></div>
            </div>
          )}
          <small className="detail-updated">가격 적용 {p.updatedAt ? dateText(p.updatedAt) : "—"}</small>
          <div className="detail-cta">
            <TradeButton player={p} side="buy" className="button primary large" label="매입하기" />
            <TradeButton player={owned ? p : undefined} side="sell" className="button secondary large" label="매각하기" />
            <WatchButton id={p.id} />
          </div>
          <TradeNotice player={p} />
          {p.status && <p className="detail-status">{p.status} · 현재 거래할 수 없습니다.</p>}
        </div>
      </section>
      <div className="detail-layout">
        <div className="detail-main">
          <section className="panel player-value-history">
            <div className="section-title">
              <h2>변동 기록<span>VALUE HISTORY</span></h2>
              <Tabs items={["1주", "2주", "1개월"]} value={period} onChange={setPeriod} variant="segment" label="기간 선택" />
            </div>
            <div className="chart-summary">
              <div><span>기간 최고</span><b className="num">{money(high)} P</b></div>
              <div><span>기간 최저</span><b className="num">{money(low)} P</b></div>
              <div><span>기간 변동</span><b>{points.length > 1 ? <Change value={((points[points.length - 1].value - points[0].value) / points[0].value) * 100} /> : "—"}</b></div>
            </div>
            <PriceChart points={points} />
          </section>
          <section className="panel">
            <Tabs items={["최근 경기", "가치 분석", "커뮤니티"]} value={tab} onChange={setTab} label="상세 정보" />
            {tab === "최근 경기" ? (
              <>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>경기</th>
                        <th>결과</th>
                        <th className="numeric">출전</th>
                        <th className="numeric">골</th>
                        <th className="numeric">도움</th>
                        <th className="numeric">Performance</th>
                        {canReadReports && <th>리포트</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {p.records.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <div className="record-match">
                              {getLeague(r.leagueId) ? <LeagueMark league={getLeague(r.leagueId)} size="sm" /> : <span className="league-mark sm unknown" title="대회 정보 없음">—</span>}
                              <div className="two-line"><strong>vs {r.opponent}</strong><small>{dateText(r.playedAt, false)}</small></div>
                            </div>
                          </td>
                          <td><span className={`result-tag ${r.result?.includes("승") ? "win" : r.result?.includes("패") ? "loss" : ""}`}>{r.result || "—"}</span></td>
                          <td className="numeric">{r.minutes == null ? "—" : r.minutes > 0 ? `${money(r.minutes)}′` : <span className="muted">미출전</span>}</td>
                          <td className="numeric">{money(r.goals)}</td>
                          <td className="numeric">{money(r.assists)}</td>
                          <td className="numeric"><span className={`score-chip ${r.performance == null ? "none" : ""}`}>{score(r.performance)}</span></td>
                          {canReadReports && <td>{r.reportAvailable && <button type="button" className="button secondary small report-button" onClick={() => setReportRecord(r)} aria-label={`${r.opponent} 경기 리포트`}><Sparkles size={14} />리포트</button>}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!p.records.length && <DataEmpty entity="경기 기록" />}
              </>
            ) : tab === "커뮤니티" ? (
              <CommunityFeed key={p.id} scope="player" target={p.id} targetName={p.name} title={`${p.short || p.name} 이야기`} />
            ) : (
              <div className="analysis">
                <span className="tag ink"><Sparkles size={13} />경기별 AI 리포트</span>
                <h3>경기력 점수가 어떻게 나왔는지 확인하세요.</h3>
                <p>출전 시간과 공격·수비 기록이 Performance에 기여한 내용을 설명합니다.</p>
                {canReadReports && p.records.filter(r => r.reportAvailable).slice(0, 3).map(r => <button key={r.id} className="button secondary small" onClick={() => setReportRecord(r)}><Sparkles size={14} />{dateText(r.playedAt, false)} · vs {r.opponent}</button>)}
                {!canReadReports ? <p className="fine-print">로그인 후 경기별 AI 리포트를 볼 수 있습니다.</p> : !p.records.some(r => r.reportAvailable) && <p className="fine-print">리포트를 제공할 수 있는 최근 경기가 없습니다.</p>}
              </div>
            )}
          </section>
        </div>
        <aside className="detail-side">
          <section className="panel lounge-preview player-community-entry">
            <span className="eyebrow">PLAYER COMMUNITY</span>
            <h2><MessageCircle size={23}/>{p.short || p.name} 커뮤니티</h2>
            <p>이 선수의 경기와 시세에 대한 이야기를 나눠보세요.</p>
            <Link className="button primary player-lounge-cta" href={`/community/players/${p.id}`}>선수 커뮤니티 입장 <ArrowRight size={18}/></Link>
            {posts.length ? (
              <ul>
                {posts.map((post) => (
                  <li key={post.id}>
                    <Link href={`/community/posts/${post.id}`}>
                      <strong>{post.title}</strong>
                      <span>{post.author} · 댓글 {post.commentCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Link href={`/community/players/${p.id}`} className="lounge-empty"><MessageCircle size={18} />첫 이야기를 남겨보세요 <ArrowRight size={15} /></Link>
            )}
          </section>
          <section className="panel">
            <SectionTitle title="최근 Performance" meta="최근 6경기" />
            <PerformanceBars player={p} />
          </section>
        </aside>
      </div>
      {canReadReports && reportRecord?.reportAvailable && <MatchReportDialog key={`${p.id}:${reportRecord.fixtureId}`} playerId={p.id} record={reportRecord} onClose={() => setReportRecord(null)} />}
      <PerformanceDetails player={p}/>
    </>
  );
}
