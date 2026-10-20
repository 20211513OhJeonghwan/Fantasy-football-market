"use client";
import { useState, useRef, type CSSProperties } from "react";
import { clubIdentity, luminance } from "@/lib/kickx/club-identity";
import { Plus, RotateCcw, Save, X } from "lucide-react";
import { apiRequest } from "@/lib/kickx/client";
import { money, score } from "@/lib/kickx/data";
import { fixedSquadSlots, positionCapacity, SQUAD_FORMATION } from "@/lib/kickx/squad";
import type { Player, Position } from "@/lib/kickx/types";
import { usePlatform } from "./provider";
import { Change, DataEmpty, MemberNotice, PageHeading, PlayerPortrait, PositionBadge, Tabs } from "./ui";

const ROWS: Position[] = ["FW", "MF", "DF", "GK"];
const MAX_SQUAD = 11;
/** Kit colours from the presentation-only club identity; the trim keeps readable contrast. */
function kit(team: Parameters<typeof clubIdentity>[0]) {
  const id = clubIdentity(team);
  if (!id) return undefined;
  const ink = Math.abs(luminance(id.primary) - luminance(id.secondary)) > 0.25 ? id.secondary : luminance(id.primary) > 0.4 ? "#111110" : "#FFFFFF";
  return { "--kit": id.primary, "--kit-2": ink } as CSSProperties;
}
function Jersey({ empty = false, style }: { empty?: boolean; style?: CSSProperties }) {
  return (
    <svg className={`jersey ${empty ? "jersey-empty" : ""}`} viewBox="0 0 64 60" aria-hidden="true" style={style}>
      <path d="M22 4 L12 7 L2 18 L9 28 L15 24 L15 57 L49 57 L49 24 L55 28 L62 18 L52 7 L42 4 C40 9 36 11 32 11 C28 11 24 9 22 4 Z" />
      {!empty && <path className="jersey-trim" d="M22 4 C24 9 28 11 32 11 C36 11 40 9 42 4" />}
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
                  <Jersey style={kit(getTeam(p.team))} />
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
export function SquadScreen() {
  const { data, mock, notify, getPlayer, getTeam, reload } = usePlatform();
  const member = data.member;
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState<{message:string;stale:boolean}|null>(null);
  const [savedAt,setSavedAt]=useState<number|null>(null);
  const lock=useRef(false);
  const baseRevision=useRef<number|null>(null);
  const [draft, setDraft] = useState<{ formationId: string; slots: (string | null)[] } | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [filter, setFilter] = useState("전체");
  const formation = SQUAD_FORMATION.id;
  const legacyFormation = !!member?.squad && member.squad.formationId !== formation;
  const changed = !!draft || legacyFormation;
  const slots = draft?.slots || member?.squad?.slots || [];
  const rule = SQUAD_FORMATION,
    target = selected == null ? null : rule?.positions[selected];
  const owned = (member?.holdings.map(h=>getPlayer(h.playerId)).filter(Boolean) ?? []) as Player[];
  const safeSlots = fixedSquadSlots(slots, draft?.formationId || member?.squad?.formationId || formation,
    id => owned.find(p => p.id === id));
  const filled = safeSlots.filter(Boolean).length;
  const lineup = safeSlots.map((id) => getPlayer(id)).filter(Boolean) as Player[];
  const visible = owned.filter((p) => (filter === "전체" || p.position === filter) && (!target || p.position === target));
  const counts = ROWS.slice().reverse().map((pos) => [pos, rule?.positions.filter((x) => x === pos).length ?? 0, lineup.filter((p) => p.position === pos).length] as const);
  function captureRevision(){if(baseRevision.current==null)baseRevision.current=member?.squad?.revision??0;setSavedAt(null);}
  function discardDraft(){setDraft(null);baseRevision.current=null;setSelected(null);setSaveError(null);reload();}
  async function save(){
    if(!changed || lock.current)return;
    if(mock){notify("스쿼드 저장 예시입니다. 실제로 저장되지 않습니다.");return;}
    lock.current=true;setSaving(true);
    setSaveError(null);
    try{await apiRequest("/api/kickx/squad","PUT",{formationId:formation,slots:safeSlots,revision:baseRevision.current??member?.squad?.revision??0});setDraft(null);baseRevision.current=null;setSavedAt(Date.now());reload();notify("스쿼드를 저장했습니다.");}
    catch(e){
      const message=e instanceof Error?e.message:"저장하지 못했습니다.";
      // A stale revision means another tab saved first; the draft stays so the user can compare before discarding.
      setSaveError({message,stale:/다른 창/.test(message)});notify(message,"error");
    }
    finally{lock.current=false;setSaving(false);}
  }
  function place(p: Player) {
    captureRevision();
    if (saving || selected == null || !rule || p.position !== target) return;
    setDraft({
      formationId: formation,
      slots: rule.positions.map((_, i) => (i === selected ? p.id : safeSlots[i] === p.id ? null : safeSlots[i] || null)),
    });
    setSelected(null);
  }
  return (
    <>
      <PageHeading
        eyebrow="BUILD YOUR STARTING XI"
        title="내 스쿼드"
        description="4-3-3으로 라인업을 구성하세요. GK 1명 · DF 4명 · MF 3명 · FW 3명까지 보유할 수 있습니다."
        action={
          <>
            <button className="button secondary" disabled={!changed} onClick={discardDraft}>
              <RotateCcw size={16} />되돌리기
            </button>
            <button className="button primary" disabled={!changed || saving || !data.session} onClick={()=>void save()}><Save size={17} />{saving?"저장 중…":"스쿼드 저장"}</button>
          </>
        }
      />
      <MemberNotice />
      <div className="squad-layout">
        <section className="squad-board">
          <div className="squad-toolbar">
            <div className="squad-team">
              <strong>{data.session?.profile?.nickname ? `${data.session.profile.nickname} FC` : "내 라인업"}</strong>
              {changed ? <span className="tag yellow">편집 중 · 미저장</span> : savedAt && <span className="tag outline">저장됨</span>}
            </div>
            <div className="squad-count">
              <span>등록 선수</span>
              <strong className="num">{rule ? filled : "—"}<small> / {MAX_SQUAD}</small></strong>
              <span className="meter yellow" aria-hidden="true"><i style={{ width: `${(filled / MAX_SQUAD) * 100}%` }} /></span>
            </div>
            <div className="squad-formation">
              <span>포메이션</span> <strong>4-3-3</strong>
            </div>
          </div>
          {legacyFormation && <p className="slot-hint">기존 라인업을 4-3-3에 맞춰 표시합니다. 확인 후 스쿼드를 저장해 주세요. 보유 선수는 유지됩니다.</p>}
          {saveError && (
            <div className={`squad-alert ${saveError.stale ? "stale" : ""}`} role="alert">
              <span><b>{saveError.stale ? "다른 창에서 스쿼드가 먼저 저장되었습니다." : "스쿼드를 저장하지 못했습니다."}</b>{saveError.stale ? " 편집 중인 라인업은 그대로 두었습니다. 최신 스쿼드를 불러오면 편집 내용은 사라집니다." : ` ${saveError.message}`}</span>
              {saveError.stale ? <button className="button primary small" onClick={discardDraft}>최신 스쿼드 불러오기</button> : <button className="button secondary small" onClick={() => setSaveError(null)}>닫기</button>}
            </div>
          )}
          <Pitch slots={safeSlots} formation={formation || null} selected={selected} onSelect={(i) => setSelected(selected === i ? null : i)} />
          <div className="squad-footer">
            <div><span>라인업 가치</span><strong className="num">{lineup.length ? money(lineup.every(p=>p.price!=null)?lineup.reduce((s,p)=>s+p.price!,0):null) : money(member?.squad?.value)}<span className="unit">P</span></strong></div>
            <div><span>저장된 평균 Performance</span><strong className="num">{score(member?.squad?.performance)}</strong></div>
            <div className="squad-composition">
              <span>포지션 구성</span>
              <span className="squad-pos-list">
                {counts.map(([pos, need, have]) => (
                  <span key={pos} className={rule && have < need ? "short" : ""}><PositionBadge position={pos} /><b className="num">{rule ? `${have}/${need}` : "—"}</b></span>
                ))}
              </span>
            </div>
          </div>
        </section>
        <section className="panel squad-bench">
          <div className="section-title">
            <h2>{target ? `${target} 선수 선택` : "보유 선수"}<span>{member ? `${owned.length}명` : ""}</span></h2>
          </div>
          {target ? (
            <div className="slot-note" role="status">
              <span><b>{selected! + 1}번 {target}</b> 자리에 배치할 선수를 고르세요.</span>
              <button type="button" aria-label="선택 취소" className="icon-button" onClick={() => setSelected(null)}><X size={16} /></button>
            </div>
          ) : (
            <p className="slot-hint">피치에서 자리를 먼저 선택하면 해당 포지션 선수만 표시됩니다.</p>
          )}
          {!target && <Tabs items={["전체", "FW", "MF", "DF", "GK"]} value={filter} onChange={setFilter} variant="segment" label="포지션 필터" />}
          <div className="capacity-strip" role="group" aria-label="포지션별 보유 정원">
            <ul>
              {(["GK", "DF", "MF", "FW"] as const).map(pos => {
                const capacity = positionCapacity(member, pos, id => owned.find(p => p.id === id))!;
                return (
                  <li key={pos} className={capacity.full ? "full" : ""}>
                    <span className="capacity-head"><PositionBadge position={pos} /><b className="num">{capacity.count}/{capacity.limit}</b></span>
                    <span className="capacity-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (capacity.count / capacity.limit) * 100)}%` }} /></span>
                    <small>{capacity.full ? "정원 마감" : `${capacity.limit - capacity.count}명 매입 가능`}</small>
                  </li>
                );
              })}
            </ul>
            <p>보유 선수 기준입니다. 라인업에서 빼도 정원은 비워지지 않으며, 매각하면 다시 매입할 수 있습니다.</p>
          </div>
          <ul className="bench-list">
            {visible.map((p) => {
              const inLineup = safeSlots.includes(p.id);
              return (
                <li className={`bench-player ${inLineup ? "in-lineup" : ""}`} key={p.id}>
                  <PlayerPortrait player={p} size="sm" />
                  <span className="bench-text">
                    <strong>{p.name}</strong>
                    <span>{getTeam(p.team)?.name || "—"} · <b className="num">{money(p.price)}</b></span>
                  </span>
                  <PositionBadge position={p.position} />
                  {target ? (
                    <button type="button" className="button primary small" onClick={() => place(p)}>{inLineup ? "이동" : "배치"}</button>
                  ) : (
                    <span className={`bench-state ${inLineup ? "on" : ""}`}>{inLineup ? "출전" : "벤치"}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {!visible.length && <DataEmpty financial entity="보유 선수" filtered={owned.length > 0} rows={3} />}
          {selected !== null && safeSlots[selected] && (
            <button
              className="button danger full"
              onClick={() => {
                captureRevision();
                setDraft({ formationId: formation, slots: safeSlots.map((id, i) => (i === selected ? null : id)) });
                setSelected(null);
              }}
            >
              선택한 자리 비우기
            </button>
          )}
          {lineup.length > 0 && !target && (
            <div className="bench-best">
              <span>라인업 최고 상승</span>
              {(() => {
                const best = [...lineup].sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity))[0];
                return <strong>{best.name} <Change value={best.change} /></strong>;
              })()}
            </div>
          )}
          <p className="fine-print">{mock ? "예시 모드 · 편집 내용은 저장되지 않습니다." : "저장 버튼을 누르면 반영됩니다. 선수를 판매하면 해당 자리는 자동으로 비워집니다."}</p>
        </section>
      </div>
    </>
  );
}
