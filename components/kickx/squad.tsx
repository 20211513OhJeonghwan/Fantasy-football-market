"use client";
import {MatchNotificationToggle} from "./notifications";
import { useId, useState, type CSSProperties } from "react";
import { clubIdentity, luminance } from "@/lib/kickx/club-identity";
import { Plus, Search, X } from "lucide-react";
import { money, score } from "@/lib/kickx/data";
import { ownedSquadSlots, squadCapacity, POSITION_LIMITS, SQUAD_FORMATION } from "@/lib/kickx/squad";
import type { Player, Position } from "@/lib/kickx/types";
import { usePlatform } from "./provider";
import { useCatalogPage } from "./catalog";
import { Pagination } from "./pagination";
import Link from "next/link";
import { Change, DataEmpty, MemberNotice, PageHeading, PlayerPortrait, PositionBadge, TradeButton } from "./ui";

const ROWS: Position[] = ["FW", "MF", "DF", "GK"];
/**
 * Kit colours from the presentation-only club identity (the football API has no kit images).
 * The trim keeps readable contrast; stripes appear only for clubs registered with striped colours.
 */
function kit(team: Parameters<typeof clubIdentity>[0]) {
  const id = clubIdentity(team);
  if (!id) return undefined;
  const ink = Math.abs(luminance(id.primary) - luminance(id.secondary)) > 0.25 ? id.secondary : luminance(id.primary) > 0.4 ? "#111110" : "#FFFFFF";
  return { style: { "--kit": id.primary, "--kit-2": ink } as CSSProperties, stripes: !!id.stripes };
}
const SHIRT = "M21 3 9 7.5 1.5 19 10 25.5 15 21.5V56q0 2 2 2h30q2 0 2-2V21.5l5 4 8.5-6.5L55 7.5 43 3q-3.5 6.5-11 6.5T21 3Z";
function Jersey({ empty = false, kit: k }: { empty?: boolean; kit?: ReturnType<typeof kit> }) {
  const uid = useId().replace(/:/g, "");
  if (empty) return <svg className="jersey jersey-empty" viewBox="0 0 64 60" aria-hidden="true"><path d={SHIRT} /></svg>;
  return (
    <svg className="jersey" viewBox="0 0 64 60" aria-hidden="true" style={k?.style}>
      <defs>
        <clipPath id={`${uid}c`}><path d={SHIRT} /></clipPath>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".22" />
        </linearGradient>
      </defs>
      <path className="jersey-body" d={SHIRT} />
      <g clipPath={`url(#${uid}c)`}>
        {k?.stripes && <path className="jersey-stripes" d="M19.5 0h5v60h-5ZM29.5 0h5v60h-5ZM39.5 0h5v60h-5Z" />}
        <path className="jersey-cuff" d="M1.5 19 10 25.5l2.2-2.9-8.6-6.4ZM62.5 19 54 25.5l-2.2-2.9 8.6-6.4Z" />
        <path className="jersey-collar" d="M21 3q3.5 6.5 11 6.5T43 3l-3.4-.9Q37.6 6.6 32 6.6t-7.6-4.5Z" />
        <rect width="64" height="60" fill={`url(#${uid}g)`} />
      </g>
      <path className="jersey-edge" d={SHIRT} />
    </svg>
  );
}
function PitchMarkings() {
  return (
    <svg className="pitch-lines" viewBox="0 0 680 440" preserveAspectRatio="none" aria-hidden="true">
      <rect x="10" y="10" width="660" height="420" />
      <line x1="10" y1="220" x2="670" y2="220" />
      <circle cx="340" cy="220" r="52" />
      <circle cx="340" cy="220" r="3" className="fill" />
      <rect x="200" y="10" width="280" height="78" />
      <rect x="270" y="10" width="140" height="30" />
      <rect x="200" y="352" width="280" height="78" />
      <rect x="270" y="400" width="140" height="30" />
      <path d="M290 88 A52 52 0 0 0 390 88" />
      <path d="M290 352 A52 52 0 0 1 390 352" />
    </svg>
  );
}
export function Pitch({
  slots,
  formation,
  compact = false,
  selected,
  onSelect,
}: {
  slots: (string | null)[];
  formation: string | null;
  compact?: boolean;
  selected?: number | null;
  onSelect?: (i: number) => void;
}) {
  const { getPlayer, getTeam } = usePlatform();
  const rule = formation === SQUAD_FORMATION.id ? SQUAD_FORMATION : undefined;
  const positions: Position[] = SQUAD_FORMATION.positions;
  return (
    <div className={`pitch ${compact ? "compact" : ""} ${rule ? "" : "is-empty"}`}>
      <PitchMarkings />
      <div className="pitch-rows">
        {ROWS.map((position) => (
          <div className="pitch-row" key={position}>
            {positions.map((pos, i) => {
              if (pos !== position) return null;
              const p = rule ? getPlayer(slots[i]) : undefined;
              const body = p ? (
                <>
                  <Jersey kit={kit(getTeam(p.team))} />
                  <span className="pitch-name">{p.short || p.name}</span>
                  {!compact && <span className="pitch-value num">{money(p.price)}</span>}
                </>
              ) : (
                <>
                  <span className="jersey-wrap"><Jersey empty />{rule && !compact && <Plus size={18} className="jersey-plus" />}</span>
                  {rule && <span className="pitch-name open">{pos}</span>}
                </>
              );
              return onSelect && rule ? (
                <button
                  type="button"
                  className={`pitch-player ${p ? "filled" : ""} ${selected === i ? "selected" : ""}`}
                  onClick={() => onSelect(i)}
                  key={i}
                  aria-label={`${i + 1}번 ${pos} 자리 ${p?.name || "빈 자리"}`}
                  aria-pressed={selected === i}
                >
                  {body}
                </button>
              ) : (
                <div className={`pitch-player ${p ? "filled" : ""}`} key={i}>{body}</div>
              );
            })}
          </div>
        ))}
      </div>
      {!rule && !compact && (
        <div className="pitch-overlay">
          <strong>4-3-3 스쿼드</strong>
          <span>보유 선수로 나만의 베스트 11을 구성합니다.</span>
        </div>
      )}
    </div>
  );
}
const MARKET_SIZE = 8;
export function SquadScreen() {
  const { data, mock, status, getPlayer, getTeam, reload } = usePlatform();
  const member = data.member;
  const [selected, setSelected] = useState<number | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const slots = ownedSquadSlots(member?.holdings ?? [], member?.squad?.slots ?? [], member?.squad?.formationId ?? SQUAD_FORMATION.id, getPlayer);
  const selectedPosition = selected == null ? position : SQUAD_FORMATION.positions[selected];
  const selectedPlayer = selected == null ? undefined : getPlayer(slots[selected]);
  const capacity = squadCapacity(member?.holdings ?? [], getPlayer);
  const remote = useCatalogPage<Player>("players", { q: query, position: selectedPosition ?? undefined, page, size: MARKET_SIZE, sort: "name" });
  const local = data.players.filter(p => (!selectedPosition || p.position === selectedPosition) && `${p.name} ${p.english ?? ""} ${getTeam(p.team)?.name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const players = mock ? local.slice((page - 1) * MARKET_SIZE, page * MARKET_SIZE) : remote.data.items;
  const total = mock ? local.length : remote.data.total;
  const listStatus = mock ? status : remote.status;
  const filled = slots.filter(Boolean).length;
  const lineup = slots.map(id => getPlayer(id)).filter(Boolean) as Player[];
  const value = member?.financialReady !== false && member && lineup.every(p => p.price != null) ? lineup.reduce((sum, p) => sum + p.price!, 0) : null;
  const excess = member?.holdings.filter(h => !slots.includes(h.playerId)) ?? [];
  function selectSlot(i: number) { setSelected(selected === i ? null : i); setPosition(null); setPage(1); }
  return <>
    <PageHeading eyebrow="BUILD YOUR STARTING XI" title="내 스쿼드" description="4-3-3 · GK 1명, DF 4명, MF 3명, FW 3명. 매입하면 경기장에 바로 반영됩니다."/>
    <MemberNotice/>
    <MatchNotificationToggle/>
    <div className="squad-layout automatic-squad">
      <section className="squad-board">
        <div className="squad-toolbar">
          <div className="squad-team"><strong>{data.session?.profile?.nickname ? `${data.session.profile.nickname} FC` : "내 스쿼드"}</strong><span className="tag outline">자동 반영</span></div>
          <div className="squad-count"><span>보유 선수</span><strong className="num">{member ? capacity.total : "—"}<small> / 11</small></strong><span className="meter yellow" aria-hidden="true"><i style={{ width: `${Math.min(100, filled / 11 * 100)}%` }}/></span></div>
          <div className="squad-formation"><span>포메이션</span> <strong>4-3-3</strong></div>
        </div>
        <Pitch slots={slots} formation={SQUAD_FORMATION.id} selected={selected} onSelect={selectSlot}/>
        <div className="squad-footer">
          <div><span>스쿼드 가치</span><strong className="num">{money(value)}<span className="unit">P</span></strong></div>
          <div><span>평균 Performance</span><strong className="num">{score(filled ? member?.squad?.performance : null)}</strong></div>
          <div className="squad-composition"><span>포지션별 보유 현황</span><span className="squad-pos-list">{(["GK", "DF", "MF", "FW"] as const).map(pos => <span key={pos} className={capacity.counts[pos] < POSITION_LIMITS[pos] ? "short" : ""}><PositionBadge position={pos}/><b className="num">{capacity.counts[pos]}/{POSITION_LIMITS[pos]}</b></span>)}</span></div>
        </div>
      </section>
      <section className="panel squad-market" aria-label="스쿼드 선수 시장">
        <div className="section-title"><h2>선수 시장</h2><Link className="text-link" href="/market">전체 보기 →</Link></div>
        <p className="slot-hint">빈자리를 누르면 해당 포지션을 검색합니다. 보유 선수를 누르면 바로 매각할 수 있습니다.</p>
        {selected != null && <div className="slot-note" role="status"><span><b>{selectedPosition}</b> {selectedPlayer ? `${selectedPlayer.name} 보유 중` : "빈자리 · 매입할 선수 찾기"}</span><button type="button" aria-label="포지션 선택 해제" className="icon-button" onClick={() => setSelected(null)}><X size={16}/></button></div>}
        {selected != null && <div className="squad-selected-player">{selectedPlayer ? <PlayerPortrait player={selectedPlayer} size="sm"/> : <span/>}<div>{selectedPlayer ? <><strong>{selectedPlayer.name}</strong><span className="num">{money(selectedPlayer.price)} P</span></> : <span>해당 포지션의 선수를 아래에서 매입하세요.</span>}</div><TradeButton player={selectedPlayer} side="sell" className={`button secondary small ${selectedPlayer ? "" : "squad-sale-hidden"}`}/></div>}
        <div className="squad-market-positions" role="group" aria-label="스쿼드 시장 포지션">{([null, "GK", "DF", "MF", "FW"] as const).map(pos => <button key={pos ?? "all"} className={selectedPosition === pos ? "active" : ""} aria-pressed={selectedPosition === pos} onClick={() => { setPosition(pos); setSelected(null); setPage(1); }}>{pos ?? "전체"}{pos && <small className="num">{capacity.counts[pos]}/{POSITION_LIMITS[pos]}</small>}</button>)}</div>
        <label className="input-search"><Search size={16}/><input aria-label="스쿼드 선수 검색" placeholder="선수·구단 검색" maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/></label>
        {capacity.excess && <p className="field-error" role="alert">기존 보유 정원을 초과했습니다. 초과 포지션 선수를 먼저 매각하면 새 선수를 매입할 수 있습니다.</p>}
        {listStatus !== "ready" ? <DataEmpty entity="선수" status={listStatus} retry={mock ? reload : remote.reload} rows={3}/> : <>
          <ul className="squad-market-list">{players.map(p => {
            const owned = member?.holdings.some(h => h.playerId === p.id);
            return <li key={p.id}><Link href={`/players/${p.id}`} aria-label={`${p.name} 상세`}><PlayerPortrait player={p} size="sm"/></Link><div className="squad-market-name"><Link href={`/players/${p.id}`}><strong>{p.name}</strong></Link><span>{getTeam(p.team)?.name ?? "—"} · {p.position ?? "—"}</span><b className="num">{money(p.price)} P <Change value={p.change}/></b></div><TradeButton player={p} side={owned ? "sell" : "buy"} className={`button ${owned ? "secondary" : "primary"} small`}/></li>;
          })}</ul>
          {!players.length && <p className="feed-empty">검색 조건에 맞는 선수가 없습니다.</p>}
          <Pagination page={mock ? page : remote.data.page} total={total} size={MARKET_SIZE} onPage={setPage} label="스쿼드 선수"/>
        </>}
      </section>
    </div>
    {!!excess.length && <section className="panel squad-legacy" aria-label="정원 조정이 필요한 보유 선수"><h2>정원 조정이 필요한 보유 선수</h2><p>기존 보유 자산은 유지됩니다. 포지션 정원을 넘겨 경기장에 표시되지 않은 선수는 여기서 매각할 수 있습니다.</p><ul>{excess.map(h => {
      const p = getPlayer(h.playerId);
      return <li key={h.playerId}>{p ? <><PlayerPortrait player={p} size="sm"/><Link href={`/players/${p.id}`}>{p.name}</Link><PositionBadge position={p.position}/><TradeButton player={p} side="sell" className="button secondary small"/></> : <span>선수 정보를 확인하고 있습니다.</span>}</li>;
    })}</ul></section>}
  </>;
}
