"use client";
import { Select } from "./select";
import { POSITION_OPTIONS, useTeamOptions } from "./options";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, BookOpen, Search, Shield, TrendingUp, X } from "lucide-react";
import { Pagination } from './pagination';
import { dateText, money, score } from "@/lib/kickx/data";
import { fixedSquadSlots, SQUAD_FORMATION } from "@/lib/kickx/squad";
import { fixtureGroup, fixtureStatus, selectFeaturedFixtures } from "@/lib/kickx/fixtures";
import type { Player } from "@/lib/kickx/types";
import { clubIdentity } from "@/lib/kickx/club-identity";
import { usePlatform } from "./provider";
import { useCatalogPage } from "./catalog";
import { Change, DataEmpty, Modal, PlayerIdentity, PlayerPortrait, PositionBadge, Sparkline, TeamBadge, WatchButton } from "./ui";
import { Pitch } from "./squad";
import { PlaybookArt } from "./playbook-art";

function PanelHead({ title, href, label }: { title: string; href: string; label?: string }) {
  return (
    <div className="dash-head">
      <h2>{title}</h2>
      <Link href={href} aria-label={`${title} ${label || "보기"}`}>
        {label && <span>{label}</span>}
        <ArrowRight size={22} />
      </Link>
    </div>
  );
}
function AssetsPanel() {
  const { data, status } = usePlatform();
  const member = data.member?.financialReady === false ? null : data.member;
  const name = data.session?.profile?.nickname;
  return (
    <section className="dash-panel dash-assets" aria-labelledby="dash-assets">
      <div className="dash-head">
        <h2 id="dash-assets">내 자산</h2>
        <Link href="/portfolio" aria-label="내 자산 보기"><ArrowRight size={22} /></Link>
      </div>
      {member ? (
        <>
          <p className="dash-assets-owner">{name ? `${name} 님의 총자산` : "총자산"}</p>
          <div className="dash-assets-total">
            <strong className="num">{money(member.totalAssets)}<span className="unit">P</span></strong>
            <Change value={member.returnRate} size="lg" />
          </div>
          <dl className="dash-assets-stats">
            <div><dt>보유 포인트</dt><dd className="num">{money(member.points)}</dd></div>
            <div><dt>보유 선수</dt><dd className="num">{member.holdings.length}<span className="unit">명</span></dd></div>
            <div><dt>평가 손익</dt><dd className={`num ${(member.profit ?? 0) > 0 ? "up" : (member.profit ?? 0) < 0 ? "down" : ""}`}>{member.profit != null && member.profit > 0 ? "+" : ""}{money(member.profit)}</dd></div>
          </dl>
        </>
      ) : (
        <>
          <dl className="dash-assets-stats empty-values">
            <div><dt>현재 가치</dt><dd>—</dd></div>
            <div><dt>보유 선수</dt><dd>—</dd></div>
            <div><dt>평가 손익</dt><dd>—</dd></div>
          </dl>
          {status === "ready" && !data.session && <Link className="button primary full" href="/login">로그인하고 자산 확인하기</Link>}
        </>
      )}
    </section>
  );
}
function SquadPanel() {
  const { data, getPlayer } = usePlatform();
  const squad = data.member?.squad;
  const formation = SQUAD_FORMATION;
  const slots = squad ? fixedSquadSlots(squad.slots, squad.formationId, getPlayer) : [];
  const filled = slots.filter(Boolean).length;
  return (
    <section className="dash-panel dash-squad" aria-labelledby="dash-squad">
      <PanelHead title="내 스쿼드" href="/squad" label="스쿼드 관리" />
      <div className="dash-squad-body">
        {formation && squad ? <Pitch slots={slots} formation={formation.id} compact /> : <Pitch slots={[]} formation={null} compact />}
        <div className="dash-squad-side">
          <div className="dash-field"><span>포메이션</span><strong>{formation.name}</strong></div>
          <div className="dash-field"><span>등록 선수</span><strong className="num">{`${filled} / 11`}</strong></div>
          <div className="dash-field"><span>평균 Performance</span><strong className="num">{score(squad?.performance)}</strong></div>
          <Link href="/squad" className="button primary full">스쿼드 편집</Link>
        </div>
      </div>
    </section>
  );
}
function FixturesPanel() {
  const { data, getTeam } = usePlatform();
  const featured = selectFeaturedFixtures(data.fixtures);
  return (
    <section className="dash-panel dash-fixtures" aria-labelledby="dash-fixtures">
      <PanelHead title="주요 경기" href="/fixtures" label="전체 일정" />
      {featured.length ? (
        <ul className="dash-fixture-list">
          {featured.map(fixture => {
            const group = fixtureGroup(fixture.status);
            const scored = fixture.homeScore != null && fixture.awayScore != null;
            return (
              <li key={fixture.id} className={group}>
                <span className="dash-fx-team home"><span>{getTeam(fixture.home)?.name || "—"}</span><TeamBadge id={fixture.home} size="small" /></span>
                <span className="dash-fx-score num">{scored ? `${fixture.homeScore} : ${fixture.awayScore}` : "VS"}</span>
                <span className="dash-fx-team"><TeamBadge id={fixture.away} size="small" /><span>{getTeam(fixture.away)?.name || "—"}</span></span>
                <span className={`dash-fx-state ${group}`}>{group === "scheduled" ? dateText(fixture.startsAt).slice(6) : fixtureStatus(fixture.status)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="dash-placeholder"><Shield size={22} /><span>경기 일정이 준비되면 표시됩니다.</span></div>
      )}
    </section>
  );
}
function WatchPanel() {
  const { data, getTeam } = usePlatform();
  const remote=useCatalogPage<Player>("players",{scope:data.session ? "watch" : "all",size:4});
  const watched=remote.enabled ? (data.session && remote.status === "ready" ? remote.data.items : []) : data.players.filter(player=>data.member?.watchlist.includes(player.id));
  return (
    <section className="dash-panel dash-watch" aria-labelledby="dash-watch">
      <PanelHead title="관심 선수" href="/players?watchlist=1" />
      {watched.length ? (
        <div className="dash-watch-grid">
          {watched.slice(0, 4).map(player => (
            <Link key={player.id} href={`/players/${player.id}`} className="dash-watch-card">
              <PlayerPortrait player={player} size="xl" />
              <span className="dash-watch-text">
                <strong>{player.short || player.name}</strong>
                <span>{clubIdentity(getTeam(player.team))?.code || "—"}{player.price != null ? <> · <b className="num">{money(player.price)}</b></> : player.position ? ` · ${player.position}` : ""}</span>
                {player.price != null ? <Change value={player.change} /> : <small className="value-pending">가치 산정 전</small>}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="dash-placeholder"><span>{data.session ? "선수 목록의 ☆ 버튼으로 관심 선수를 추가하세요." : "로그인 후 관심 선수를 모아볼 수 있습니다."}</span></div>
      )}
    </section>
  );
}
function MoverList({ title, players, tone }: { title: string; players: Player[]; tone: "up" | "down" }) {
  const { getTeam } = usePlatform();
  return (
    <section className="movers-col">
      <h3 className={tone}>{title}</h3>
      {players.length ? (
        <ol>
          {players.map((player, index) => (
            <li key={player.id}>
              <span className="movers-rank num">{index + 1}</span>
              <Link href={`/players/${player.id}`} className="movers-player">
                <PlayerPortrait player={player} size="sm" />
                <span><strong>{player.name}</strong><small>{getTeam(player.team)?.name || "—"}</small></span>
              </Link>
              <span className="movers-price num">{money(player.price)}<span className="unit">P</span></span>
              <Change value={player.change} />
            </li>
          ))}
        </ol>
      ) : <p className="movers-empty">집계된 변동이 없습니다.</p>}
    </section>
  );
}
export function HomeScreen() {
  const { data, status:platformStatus } = usePlatform();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("all");
  const [team, setTeam] = useState("all");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [guideOpen, setGuideOpen] = useState(false);
  const teamOptions = useTeamOptions("소속 구단 전체");
  const member = data.member?.financialReady === false ? null : data.member;
  const filtered = !!search || position !== "all" || team !== "all";
  const results = useMemo(() => data.players.filter(player => {
    const club = data.teams.find(item => item.id === player.team);
    return `${player.name} ${player.english || ""} ${club?.name || ""}`.toLowerCase().includes(search.trim().toLowerCase()) && (position === "all" || player.position === position) && (team === "all" || player.team === team);
  }).sort((a, b) => {
    if (sort === "default") return 0;
    const pick = (p: Player) => sort === "performance" ? p.performance : sort === "change" ? p.change : p.price;
    const left = pick(a), right = pick(b);
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return sort === "low" ? left - right : right - left;
  }), [data.players, data.teams, search, position, team, sort]);
  const remote=useCatalogPage<Player>("players",{q:search,position:position === "all" ? undefined : position,team,sort:sort === "low" ? "price-asc" : sort === "change" || sort === "performance" ? sort : "price",size:pageSize,page});
  const status=remote.enabled ? remote.status : platformStatus;
  const total=remote.enabled ? remote.data.total : results.length;
  const current=remote.enabled ? page : Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  const visible=remote.enabled ? (remote.status === "ready" ? remote.data.items : []) : results.slice((current-1)*pageSize,current*pageSize);
  // Value columns only when any visible player has a computed value; otherwise show real imported stats.
  const valued = !visible.length || visible.some(p => p.price != null);
  const known = data.players.filter(p => p.change != null);
  const rising = [...known].filter(p => (p.change ?? 0) > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 5);
  const falling = [...known].filter(p => (p.change ?? 0) < 0).sort((a, b) => (a.change ?? 0) - (b.change ?? 0)).slice(0, 5);
  const trades = member?.transactions.slice(0, 5) ?? [];
  const reset = () => { setQuery(""); setSearch(""); setPosition("all"); setTeam("all"); setSort("default"); setPage(1); };
  const update = (fn: () => void) => { fn(); setPage(1); };
  return (
    <>
      <div className="home-grid">
        <section className="home-market" aria-labelledby="home-title">
          <div className="home-hero">
            <div className="home-hero-copy">
              <span className="eyebrow">PLAYER MARKET</span>
              <h1 id="home-title">다음 선수를 찾아라.</h1>
              <p>발견하고, 분석하고, 당신의 스쿼드를 완성하세요.</p>
            </div>
            <PlaybookArt variant="hero" className="home-hero-art" />
          </div>
          <form className="home-search yb-search" onSubmit={event => { event.preventDefault(); update(() => setSearch(query)); }}>
            <label className="home-search-field">
              <Search size={22} />
              <input aria-label="선수 이름 검색" placeholder="선수 이름을 검색하세요." maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />
              {query && <button aria-label="검색어 지우기" type="button" onClick={() => { setQuery(""); update(() => setSearch("")); }}><X size={16} /></button>}
            </label>
            <Select label="포지션" variant="bare" value={position} onChange={v => update(() => setPosition(v))} options={POSITION_OPTIONS} />
            <Select label="소속 구단" variant="bare" value={team} onChange={v => update(() => setTeam(v))} options={teamOptions} />
            <Select label="정렬 기준" variant="bare" value={sort} onChange={v => update(() => setSort(v))} options={[{ value: "default", label: "정렬 기준" }, { value: "high", label: "가치 높은 순" }, { value: "low", label: "가치 낮은 순" }, { value: "change", label: "상승률 순" }, { value: "performance", label: "Performance 순" }]} />
            <button type="submit" className="home-search-button yb-search-button">검색</button>
          </form>
          <div className="board-caption">
            <div>
              <h2>선수 마켓 보드</h2>
              <span className="tag outline num">{status === "ready" ? `${total}명` : "—"}</span>
              {filtered && (
                <span className="board-filter" role="status">
                  검색 결과 <strong>{status === "ready" ? `${total}명` : "—"}</strong>
                  <button type="button" onClick={reset}>필터 초기화 <X size={13} /></button>
                </span>
              )}
            </div>
            <button type="button" className="text-link" onClick={() => setGuideOpen(true)}><BookOpen size={15} />지표 읽는 법</button>
          </div>
          <div className="table-scroll">
            <table className="data-table board-table">
              <thead>
                <tr>
                  <th>선수</th>
                  <th className="hide-sm">포지션</th>
                  {valued ? (
                    <>
                      <th className="numeric">현재 가치</th>
                      <th className="numeric hide-sm"><abbr title="직전 발행 가격 대비 변화율">변동</abbr></th>
                      <th className="hide-md">30일 추이</th>
                      <th className="numeric hide-sm"><abbr title="최근 경기 1건의 저장 점수">Performance</abbr></th>
                    </>
                  ) : (
                    <>
                      <th className="hide-md">국적 · 나이</th>
                      <th className="numeric hide-sm" title="수집된 경기 기준">경기</th>
                      <th className="numeric hide-sm">골</th>
                      <th className="numeric hide-sm">도움</th>
                      <th className="numeric">가치</th>
                    </>
                  )}
                  <th className="cell-actions">관심</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(player => (
                  <tr key={player.id}>
                    <td><PlayerIdentity player={player} size="wide" /></td>
                    <td className="hide-sm"><PositionBadge position={player.position} /></td>
                    {valued ? (
                      <>
                        <td className="numeric strong yb-price">{money(player.price)}<span className="unit">P</span><span className="only-sm"><Change value={player.change} /></span></td>
                        <td className="numeric hide-sm"><Change value={player.change} /></td>
                        <td className="hide-md"><Sparkline values={player.history.map(point => point.value)} down={(player.change ?? 0) < 0} /></td>
                        <td className="numeric hide-sm">{score(player.performance)}</td>
                      </>
                    ) : (
                      <>
                        <td className="hide-md muted">{[player.country, player.age != null ? `${player.age}세` : null].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="numeric hide-sm">{money(player.statsScope === "imported_matches" ? player.importedMatches : null)}</td>
                        <td className="numeric hide-sm">{money(player.goals)}</td>
                        <td className="numeric hide-sm">{money(player.assists)}</td>
                        <td className="numeric"><span className="value-pending">산정 전</span></td>
                      </>
                    )}
                    <td className="cell-actions"><WatchButton id={player.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length && <DataEmpty entity="선수" status={status} retry={remote.enabled ? remote.reload : undefined} filtered={filtered} rows={6} />}
          {status==='ready' && <Pagination page={current} total={total} size={pageSize} onPage={setPage} label="홈 선수"/>}
          {total > 0 && <p className="board-foot">가격 적용 {dateText(data.updatedAt)} · 가치와 Performance는 KICK-X 내부 지표입니다.</p>}
        </section>
        <aside className="home-side" aria-label="나의 축구 대시보드">
          <AssetsPanel />
          <SquadPanel />
          <FixturesPanel />
          <WatchPanel />
        </aside>
      </div>

      <section className="home-movers" aria-labelledby="movers-title">
        <div className="home-section-head">
          <div>
            <span className="eyebrow">MARKET MOVERS</span>
            <h2 id="movers-title">오늘 가장 크게 움직인 선수</h2>
          </div>
          <Link className="button secondary small" href="/market">선수 시장 <ArrowRight size={15} /></Link>
        </div>
        <div className="movers-grid">
          {rising.length || falling.length ? (
            <>
              <MoverList title="상승 TOP 5" players={rising} tone="up" />
              <MoverList title="하락 TOP 5" players={falling} tone="down" />
            </>
          ) : (
            <section className="movers-col movers-pending">
              <span className="market-pending-icon" aria-hidden="true"><TrendingUp size={18} /></span>
              <h3>가치 변동 집계 준비 중</h3>
              <p>경기 기록으로 Performance가 계산되면 가장 크게 오르고 내린 선수가 여기에 표시됩니다.</p>
              <Link className="button secondary small" href="/market">선수 시장 둘러보기 <ArrowRight size={14} /></Link>
            </section>
          )}
          <section className="movers-col trades-col">
            <h3>최근 내 거래</h3>
            {trades.length ? (
              <ol>
                {trades.map(trade => (
                  <li key={trade.id}>
                    <span className={`trade-type ${trade.type}`}>{trade.type === "buy" ? "매입" : "매각"}</span>
                    <span className="movers-player"><span><strong>{trade.playerName}</strong><small>{dateText(trade.date)}</small></span></span>
                    <span className="movers-price num">{money(trade.net)}<span className="unit">P</span></span>
                  </li>
                ))}
              </ol>
            ) : <p className="movers-empty">{data.session ? "아직 거래 기록이 없습니다." : "로그인 후 최근 거래를 확인할 수 있습니다."}</p>}
            <Link className="text-link" href="/transactions">거래 내역 전체 <ArrowRight size={14} /></Link>
          </section>
        </div>
      </section>


      {guideOpen && (
        <Modal title="지표 읽는 법" eyebrow="METRIC GUIDE" onClose={() => setGuideOpen(false)}>
          <div className="metric-guide">
            <article><span>01 / PERFORMANCE</span><h3>경기에서 얼마나 활약했나요?</h3><p>실제 경기 기록을 포지션별 기준으로 평가한 지표입니다. 거래 가격과는 별개의 값입니다.</p></article>
            <article><span>02 / VALUE</span><h3>지금 선수의 가치는 얼마인가요?</h3><p>Performance와 시장 흐름을 반영한 KICK-X 내부 가치입니다. 실제 이적료와 무관합니다.</p></article>
            <article><span>03 / CHANGE</span><h3>가치가 어떻게 움직였나요?</h3><p>직전 갱신 대비 변동률입니다. ▲ 상승, ▼ 하락 기호를 함께 표시합니다.</p></article>
          </div>
        </Modal>
      )}
    </>
  );
}
