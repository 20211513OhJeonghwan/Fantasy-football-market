"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  FlaskConical,
  Info,
  LoaderCircle,
  RefreshCw,
  Search,
  Star,
  TriangleAlert,
  X,
} from "lucide-react";
import { dateText, money, percent, unavailableAction } from "@/lib/kickx/data";
import { tradeService } from "@/lib/kickx/trade";
import type { DataStatus, Player, Position, SeriesPoint, TradeQuote } from "@/lib/kickx/types";
import { usePlatform } from "./provider";
import { clubIdentity, leagueIdentity, luminance, type CrestShape } from "@/lib/kickx/club-identity";

/* ---------- Layout primitives ---------- */
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </header>
  );
}
export function SectionTitle({
  title,
  meta,
  href,
  link = "전체 보기",
  action,
}: {
  title: string;
  meta?: string;
  href?: string;
  link?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <h2>
        {title}
        {meta && <span>{meta}</span>}
      </h2>
      {action}
      {href && (
        <Link className="text-link" href={href}>
          {link}
          <ArrowRight size={15} />
        </Link>
      )}
    </div>
  );
}
export function StatCard({
  label,
  value,
  unit,
  change,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  change?: number | null;
  hint?: ReactNode;
  tone?: "default" | "yellow" | "ink";
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value num">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </strong>
      {(change !== undefined || hint) && (
        <span className="stat-foot">
          {change !== undefined && <Change value={change} />}
          {hint && <span>{hint}</span>}
        </span>
      )}
    </div>
  );
}

/* ---------- Market atoms ---------- */
export function Change({ value, size = "md" }: { value: number | null | undefined; size?: "md" | "lg" }) {
  const known = value != null && Number.isFinite(value);
  const tone = !known || value === 0 ? "flat" : value > 0 ? "up" : "down";
  return (
    <span className={`change ${tone} ${size}`}>
      {tone !== "flat" && <span aria-hidden="true" className="change-mark">{tone === "up" ? "▲" : "▼"}</span>}
      <span className="num">{percent(value)}</span>
      {tone !== "flat" && <span className="sr-only">{tone === "up" ? "상승" : "하락"}</span>}
    </span>
  );
}
const CREST_PATHS: Record<CrestShape, string> = {
  shield: "M6 4 H94 V58 C94 84 72 98 50 108 C28 98 6 84 6 58 Z",
  heater: "M4 8 Q50 -4 96 8 V54 C96 86 70 100 50 110 C30 100 4 86 4 54 Z",
  round: "M50 6 A50 50 0 1 1 49.99 6 Z",
  square: "M16 6 H84 Q96 6 96 18 V94 Q96 106 84 106 H16 Q4 106 4 94 V18 Q4 6 16 6 Z",
};
// BSD team image path is unverified; logos only replace the generated crest after they load.
const logoState = { failures: 0, successes: 0 };
function teamLogo(id: string | null | undefined) {
  const match = id?.match(/^bsd-(\d+)$/);
  if (!match || (logoState.failures >= 4 && logoState.successes === 0)) return null;
  return `https://sports.bzzoiro.com/img/team/${match[1]}/`;
}
export function useClub(id: string | null | undefined) {
  const { getTeam } = usePlatform();
  const team = getTeam(id);
  return { team, identity: clubIdentity(team) };
}
/** Generated club crest (shape + pattern + code) with an optional real logo on top once it loads. */
export function ClubCrest({ id, size = "normal", title }: { id: string | null; size?: "small" | "normal" | "large" | "xl"; title?: string }) {
  const { team, identity } = useClub(id);
  const clip = useId().replace(/:/g, "");
  const logo = teamLogo(team?.id);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = !!logo && loaded === logo && failed !== logo;
  if (!team || !identity)
    return <span className={`crest ${size} unknown`} title={title ?? "구단 정보 없음"} aria-hidden="true"><svg viewBox="0 0 100 112"><path d={CREST_PATHS.shield} className="crest-empty" /></svg></span>;
  const { primary, secondary, shape, pattern, code } = identity;
  const light = luminance(primary) > 0.55;
  const ink = light ? "#111110" : "#ffffff";
  const fontSize = code.length >= 4 ? 23 : code.length === 2 ? 36 : 30;
  return (
    <span className={`crest ${size} ${showLogo ? "has-logo" : ""}`} title={title ?? team.name} aria-hidden="true" style={{ "--club": primary, "--club-2": secondary } as CSSProperties}>
      {logo && failed !== logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" loading="lazy" className="crest-logo"
          onLoad={() => { logoState.successes++; setLoaded(logo); }}
          onError={() => { logoState.failures++; setFailed(logo); }} />
      )}
      <svg viewBox="0 0 100 112" className="crest-art">
        <defs><clipPath id={clip}><path d={CREST_PATHS[shape]} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}>
          <rect width="100" height="112" fill={primary} />
          {pattern === "half" && <rect x="50" width="50" height="112" fill={secondary} />}
          {pattern === "band" && <polygon points="0,78 78,0 100,0 100,20 20,112 0,112" fill={secondary} opacity=".92" />}
          {pattern === "stripes" && [18, 42, 66].map((x) => <rect key={x} x={x} width="14" height="112" fill={secondary} opacity=".95" />)}
          {pattern === "ring" && <path d={CREST_PATHS[shape]} fill="none" stroke={secondary} strokeWidth="16" />}
        </g>
        <path d={CREST_PATHS[shape]} fill="none" stroke="#111110" strokeWidth="4" vectorEffect="non-scaling-stroke" />
        <text x="50" y={shape === "round" ? 66 : 64} textAnchor="middle" fontSize={fontSize} fill={ink}
          stroke={light ? "#ffffff" : primary} strokeWidth="5" paintOrder="stroke" className="crest-code">{code}</text>
      </svg>
    </span>
  );
}
export function TeamBadge({ id, size = "normal" }: { id: string | null; size?: "small" | "normal" | "large" }) {
  return <ClubCrest id={id} size={size} />;
}
export function LeagueMark({ league, size = "md" }: { league: { name: string } | null | undefined; size?: "sm" | "md" | "lg" }) {
  const mark = leagueIdentity(league);
  if (!mark) return null;
  return <span className={`league-mark ${size}`} title={league?.name} style={{ "--league": mark.color, "--league-ink": mark.ink } as CSSProperties}>{mark.short}</span>;
}
/** Player photo on a club-coloured stage. Falls back to an illustrated silhouette (never presented as a real photo). */
export function PlayerPortrait({
  player,
  size = "md",
}: {
  player: Player;
  size?: "sm" | "md" | "wide" | "lg" | "xl";
}) {
  const { identity } = useClub(player.team);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photo = player.photo && failedPhoto !== player.photo ? player.photo : null;
  return (
    <span
      className={`portrait ${size} ${photo ? "has-photo" : "no-photo"}`}
      style={{ "--club": identity?.primary ?? "#8a8a83", "--club-2": identity?.secondary ?? "#ffffff" } as CSSProperties}
      aria-hidden="true"
    >
      <span className="portrait-fx" />
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setFailedPhoto(player.photo ?? null)} />
      ) : (
        <svg viewBox="0 6 100 94" preserveAspectRatio="xMidYMax meet">
          <path className="portrait-body" d="M18 104 C19 80 31 70 50 69 C69 70 81 80 82 104 Z" />
          <path className="portrait-neck" d="M43 58 L57 58 L58 71 L50 75 L42 71 Z" />
          <ellipse className="portrait-head" cx="50" cy="45" rx="13" ry="15.5" />
          <path className="portrait-hair" d="M37 42 C36 30 44 26 51 27 C60 27 65 33 63 43 C60 37 55 35 50 35 C44 35 40 38 37 42 Z" />
          {player.number != null && size !== "sm" && (
            <text x="50" y="96" textAnchor="middle" className="portrait-number">{player.number}</text>
          )}
        </svg>
      )}
    </span>
  );
}
export function PlayerAvatar({ player, large = false }: { player: Player; large?: boolean }) {
  return <PlayerPortrait player={player} size={large ? "lg" : "sm"} />;
}
export function PositionBadge({ position }: { position: Position | null }) {
  return (
    <span className={`position ${position?.toLowerCase() || ""}`} title={position ? { GK: "골키퍼", DF: "수비수", MF: "미드필더", FW: "공격수" }[position] : "포지션 정보 없음"}>
      {position || "—"}
    </span>
  );
}
export function PlayerIdentity({ player, size = "sm" }: { player: Player; size?: "sm" | "wide" }) {
  const { getTeam } = usePlatform();
  return (
    <Link className={`player-identity ${size}`} href={`/players/${player.id}`}>
      <PlayerPortrait player={player} size={size} />
      <span className="player-identity-text">
        <strong>{player.name}</strong>
        <span>
          {getTeam(player.team)?.name || "소속 정보 없음"}
          {size === "sm" && player.position && <><i aria-hidden="true">·</i>{player.position}</>}
        </span>
      </span>
    </Link>
  );
}
export function WatchButton({ id }: { id: string }) {
  const { data, status, setWatched, pendingWatch } = usePlatform();
  const pathname = usePathname();
  const active = data.member?.watchlist.includes(id) || false;
  const pending = pendingWatch.includes(id);
  if (!data.session && status === "ready")
    return (
      <Link href={"/login?next=" + encodeURIComponent(pathname)} className="icon-button watch" aria-label="로그인하고 관심 선수 추가" title="로그인하고 관심 선수 추가">
        <Star size={18} />
      </Link>
    );
  return (
    <button
      type="button"
      disabled={status !== "ready" || !data.session || !data.member || pending}
      title={status !== "ready" ? "서비스 연결 후 이용할 수 있습니다." : active ? "관심 선수 해제" : "관심 선수 추가"}
      className={`icon-button watch ${active ? "selected" : ""} ${pending ? "is-pending" : ""}`}
      aria-label={active ? "관심 선수 해제" : "관심 선수 추가"}
      aria-pressed={active}
      aria-busy={pending}
      onClick={() => void setWatched(id, !active)}
    >
      <Star size={18} fill={active ? "currentColor" : "none"} />
    </button>
  );
}
export function MockBadge({ compact = false }: { compact?: boolean }) {
  const { mock } = usePlatform();
  if (!mock) return null;
  return (
    <span className={`mock-badge ${compact ? "compact" : ""}`} title="개발용 예시 데이터입니다. 실제 경기 기록·가치·거래가 아닙니다.">
      <FlaskConical size={13} />
      예시 데이터
    </span>
  );
}

/* ---------- States ---------- */
export function Empty({
  title = "검색 결과가 없습니다",
  description = "검색어나 필터를 바꿔 다시 확인해 주세요.",
  action,
  icon,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol" aria-hidden="true">{icon ?? <Search size={24} />}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Skeleton({ rows = 4, variant = "rows" }: { rows?: number; variant?: "rows" | "cards" }) {
  return (
    <div className={`skeleton ${variant}`} role="status" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-item" key={i}>
          <i className="sk-thumb" />
          <span><i className="sk-line" /><i className="sk-line short" /></span>
          <i className="sk-chip" />
        </div>
      ))}
    </div>
  );
}
export function DataEmpty({
  entity,
  filtered = false,
  status: supplied,
  retry,
  financial = false,
  rows = 4,
}: {
  entity: string;
  filtered?: boolean;
  status?: DataStatus;
  retry?: () => void;
  financial?: boolean;
  rows?: number;
}) {
  const resource = usePlatform();
  const status = supplied || (financial && resource.status === "ready"
    ? !resource.data.session ? "unauthorized"
      : !resource.data.member || resource.data.member.financialReady === false ? "not-configured" : "ready"
    : resource.status);
  if (status === "loading")
    return (
      <div className="loading-state">
        <Skeleton rows={rows} />
        <h3 className="sr-only">불러오는 중입니다</h3>
      </div>
    );
  if (status === "error")
    return (
      <Empty
        icon={<TriangleAlert size={24} />}
        title="데이터를 불러오지 못했습니다"
        description="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
        action={(retry || !supplied) && <button type="button" className="button secondary small" onClick={retry || resource.reload}><RefreshCw size={14} />다시 시도</button>}
      />
    );
  if (status === "unauthorized" || status === "forbidden")
    return (
      <Empty
        icon={<Info size={24} />}
        title={status === "forbidden" ? "관리자 권한이 필요합니다" : "로그인이 필요합니다"}
        description={status === "forbidden" ? "접근 권한이 확인된 계정으로 이용해 주세요." : "로그인하면 내 정보가 이곳에 표시됩니다."}
        action={status === "unauthorized" && <Link className="button primary small" href="/login">로그인</Link>}
      />
    );
  return (
    <Empty
      icon={status === "not-configured" ? <Database size={24} /> : undefined}
      title={status === "not-configured" ? `${entity} 정보를 준비하고 있습니다` : filtered ? "검색 조건에 맞는 결과가 없습니다" : `아직 등록된 ${entity} 정보가 없습니다`}
      description={
        status === "not-configured"
          ? "데이터가 준비되면 이곳에 표시됩니다."
          : filtered
            ? "검색어나 필터를 바꿔 다시 확인해 주세요."
            : "등록된 데이터가 아직 없습니다."
      }
    />
  );
}
export function DataNotice({ status, reload }: { status: DataStatus; reload: () => void }) {
  if (status === "ready" || status === "loading") return null;
  const message =
    status === "error"
      ? "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
      : status === "unauthorized"
        ? "로그인이 필요합니다."
        : status === "forbidden"
          ? "관리자 권한이 필요합니다."
          : "서비스 준비 중 · 데이터가 준비되면 화면에 표시됩니다.";
  return (
    <div className={`data-notice ${status === "error" ? "error" : ""}`} role="status">
      {status === "error" ? <TriangleAlert size={16} /> : <Info size={16} />}
      <span>{message}</span>
      {status === "error" && (
        <button className="text-link" onClick={reload}>
          <RefreshCw size={14} />
          다시 시도
        </button>
      )}
    </div>
  );
}
export function MemberNotice() {
  const { data, status } = usePlatform();
  if (status !== "ready" || data.session) return null;
  return (
    <div className="data-notice">
      <Info size={16} />
      <span>로그인 후 내 정보를 확인할 수 있습니다.</span>
      <Link className="text-link" href="/login">
        로그인 <ArrowRight size={14} />
      </Link>
    </div>
  );
}
export function DisabledAction({ children, className = "button secondary" }: { children: ReactNode; className?: string }) {
  return (
    <button type="button" disabled className={className} title={unavailableAction}>
      {children}
    </button>
  );
}

/* ---------- Controls ---------- */
export function Tabs({
  items,
  value,
  onChange,
  variant = "line",
  label = "보기 선택",
}: {
  items: string[];
  value: string;
  onChange: (s: string) => void;
  variant?: "line" | "segment";
  label?: string;
}) {
  return (
    <div className={`tabs ${variant}`} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={value === item}
          className={value === item ? "active" : ""}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

/* ---------- Charts ---------- */
export function Sparkline({ values, down = false }: { values: number[]; down?: boolean }) {
  if (values.length < 2 || values.some((v) => !Number.isFinite(v))) return <span className="muted">—</span>;
  const min = Math.min(...values),
    range = Math.max(...values) - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 120},${30 - ((v - min) / range) * 26}`).join(" ");
  return (
    <svg className={`sparkline ${down ? "negative" : ""}`} viewBox="0 0 120 34" preserveAspectRatio="none" role="img" aria-label={`가격 추이 ${down ? "하락" : "상승"}`}>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" points={points} />
    </svg>
  );
}
export function PriceChart({ points, label = "선수 가치" }: { points: SeriesPoint[]; label?: string }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const valid = points
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(Date.parse(p.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (valid.length < 2)
    return (
      <div className="chart-empty">
        <Database size={24} />
        <strong>{valid.length ? `${label} ${money(valid[0].value)} P` : "아직 표시할 추이가 없습니다"}</strong>
        <span>{valid.length ? "기록이 더 쌓이면 추이를 확인할 수 있습니다." : "저장된 기록을 기준으로 그래프가 표시됩니다."}</span>
      </div>
    );
  const W = 880, H = 240, top = 16, bottom = 24;
  const values = valid.map((p) => p.value);
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const pad = (rawMax - rawMin || rawMax * 0.05 || 1) * 0.12;
  const min = rawMin - pad, max = rawMax + pad, range = max - min;
  const first = Date.parse(valid[0].at), span = Date.parse(valid[valid.length - 1].at) - first;
  const coords = valid.map((p, i) => [
    span ? ((Date.parse(p.at) - first) / span) * W : (i / (valid.length - 1)) * W,
    top + (1 - (p.value - min) / range) * (H - top - bottom),
  ]);
  const path = coords.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const rising = values[values.length - 1] >= values[0];
  const selected = hover == null ? null : Math.min(hover, valid.length - 1);
  const ticks = [0, 1, 2, 3].map((i) => max - (range * i) / 3);
  const delta = values[values.length - 1] - values[0];
  return (
    <div className={`chart-wrap ${rising ? "rising" : "falling"}`}>
      <div className="chart-inner">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label} 추이: ${dateText(valid[0].at, false)} ${money(values[0])} P에서 ${dateText(valid[valid.length - 1].at, false)} ${money(values[values.length - 1])} P (${delta >= 0 ? "+" : ""}${money(delta)} P)`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * W;
            setHover(coords.reduce((best, c, i) => (Math.abs(c[0] - x) < Math.abs(coords[best][0] - x) ? i : best), 0));
          }}
        >
          <defs>
            <linearGradient id={uid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="chart-stop" stopOpacity=".55" />
              <stop offset="100%" className="chart-stop" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((_, i) => {
            const y = top + (i / 3) * (H - top - bottom);
            return <line key={i} x1="0" y1={y} x2={W} y2={y} className="chart-grid" vectorEffect="non-scaling-stroke" />;
          })}
          <path d={`${path} L${W} ${H} L0 ${H} Z`} fill={`url(#${uid})`} className="chart-area" />
          <path d={path} pathLength={1} className="chart-line" fill="none" vectorEffect="non-scaling-stroke" />
          {selected !== null && (
            <line x1={coords[selected][0]} x2={coords[selected][0]} y1={top} y2={H - bottom} className="chart-cross" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {selected !== null && (
          <>
            <span className="chart-dot" style={{ left: `${(coords[selected][0] / W) * 100}%`, top: `${(coords[selected][1] / H) * 100}%` }} />
            <span className="chart-tooltip" style={{ left: `${Math.min(86, Math.max(14, (coords[selected][0] / W) * 100))}%` }}>
              <small>{dateText(valid[selected].at, false)}</small>
              <strong className="num">{money(valid[selected].value)} P</strong>
            </span>
          </>
        )}
        <div className="chart-axis" aria-hidden="true">
          {ticks.map((v, i) => <span key={i} className="num">{money(v)}</span>)}
        </div>
      </div>
      <div className="chart-labels" aria-hidden="true">
        <span>{dateText(valid[0].at, false)}</span>
        <span>{dateText(valid[Math.floor(valid.length / 2)].at, false)}</span>
        <span>{dateText(valid[valid.length - 1].at, false)}</span>
      </div>
    </div>
  );
}

/* ---------- Overlays ---------- */
export function Modal({
  title,
  children,
  onClose,
  eyebrow,
  size = "md",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  eyebrow?: string;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${size}`}
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          {eyebrow && <span className="eyebrow plain">{eyebrow}</span>}
          <h2 id={id}>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="닫기">
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
type TradeState = "loading" | "review" | "submitting" | "done" | "failed";
function TradeDialog({ player, side, onClose }: { player: Player; side: "buy" | "sell"; onClose: () => void }) {
  const { data, mock, getTeam, notify, reload } = usePlatform();
  const service = tradeService(mock);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef("");
  useEffect(() => {
    let active = true;
    setQuote(null); setError(""); setState("loading"); lock.current=false;
    void service.quote(player, side, data.member).then(q => {if(active){setQuote(q);requestId.current=crypto.randomUUID();setState("review");}}).catch(e=>{if(active){setError(e instanceof Error?e.message:"견적을 불러오지 못했습니다.");setState("failed");}});
    return ()=>{active=false;};
  // A confirmed quote is frozen until the user explicitly requests a new one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.id, side, mock, attempt]);
  const [state, setState] = useState<TradeState>("loading");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const lock = useRef(false);
  const label = side === "buy" ? "매입" : "매각";
  const insufficient = side === "buy" && quote?.balanceAfter != null && quote.balanceAfter < 0;
  const expiresAt = quote?.expiresAt ? Date.parse(quote.expiresAt) : null;
  const quotedAt = quote?.quotedAt ? Date.parse(quote.quotedAt) : null;
  const remaining = expiresAt == null ? null : Math.max(0, Math.floor((expiresAt - now) / 1000));
  const expired = state === "review" && expiresAt != null && expiresAt <= now;
  // Errors that a fresh quote can resolve (expired quote, changed price).
  const renewable = state === "failed" && (!quote || /견적|가격이 변경/.test(error));
  useEffect(() => {
    if (state !== "review" || expiresAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state, expiresAt]);
  async function confirm() {
    if (lock.current || !quote || !service.available || insufficient || expired) return;
    lock.current = true;
    setState("submitting");
    setError("");
    try {
      await service.submit(quote, requestId.current);
      if(!mock) reload();
      setState("done");
      notify(`${player.name} ${label}이 완료되었습니다.${mock ? " (예시 모드 · 저장되지 않음)" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "거래를 처리하지 못했습니다.");
      setState("failed");
      lock.current = false;
    }
  }
  const rows: [string, ReactNode, string?][] = [
    ["현재 가치", <>{money(quote?.price)}<span className="unit">P</span></>],
    ["수량", <>{quote?.quantity ?? "—"}<span className="unit">명</span></>],
    [side === "sell" ? "판매 수수료" : "수수료", quote?.fee == null ? "—" : <>{side === "sell" && quote.fee > 0 ? "−" : ""}{money(quote?.fee)}<span className="unit">P</span></>, "minor"],
    [side === "buy" ? "결제 금액" : "예상 정산액", quote?.settlement == null ? "—" : <>{money(quote?.settlement)}<span className="unit">P</span></>, "total"],
  ];
  return (
    <Modal title={`${player.name} ${label}`} eyebrow={side === "buy" ? "CONFIRM PURCHASE" : "CONFIRM SALE"} onClose={onClose}>
      {state === "done" ? (
        <div className="trade-done">
          <span className="trade-done-mark"><CheckCircle2 size={34} /></span>
          <h3>{label}이 완료되었습니다</h3>
          <p>{mock ? "예시 모드에서는 실제 자산과 거래 내역이 변경되지 않습니다." : "체결 결과는 거래 내역에서 확인할 수 있습니다."}</p>
          <div className="modal-actions">
            <Link className="button secondary" href="/transactions">거래 내역</Link>
            <button className="button primary" onClick={onClose}>확인</button>
          </div>
        </div>
      ) : (
        <>
          <div className="trade-player">
            <PlayerPortrait player={player} size="md" />
            <div>
              <strong>{player.name}</strong>
              <span>{getTeam(player.team)?.name || "소속 정보 없음"} · {player.position || "—"}</span>
            </div>
            <Change value={player.change} />
          </div>
          <dl className="trade-summary">
            {rows.map(([term, value, tone]) => (
              <div key={term} className={tone}>
                <dt>{term}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
          </dl>
          <dl className="trade-balance">
            <div><dt>보유 포인트</dt><dd className="num">{money(quote?.balance)}<span className="unit">P</span></dd></div>
            <div className={insufficient ? "warn" : ""}><dt>{side === "buy" ? "거래 후 잔액" : "정산 후 잔액"}</dt><dd className="num">{money(quote?.balanceAfter)}<span className="unit">P</span></dd></div>
          </dl>
          {state === "loading" && <p className="trade-state loading" role="status"><LoaderCircle size={16} className="kx-spin" />서버에서 견적을 확인하고 있습니다…</p>}
          {state === "review" && remaining != null && !expired && (
            <div className={`trade-timer ${remaining <= 10 ? "urgent" : ""}`} role="timer" aria-live="off">
              <span>견적 유효 시간</span>
              <b className="num">{remaining}초</b>
              {expiresAt != null && quotedAt != null && expiresAt > quotedAt && <i aria-hidden="true" style={{ width: `${Math.min(100, ((expiresAt - now) / (expiresAt - quotedAt)) * 100)}%` }} />}
            </div>
          )}
          {expired && (
            <div className="trade-state warn" role="alert">
              <span>견적이 만료되었습니다. 현재 가격으로 새 견적을 받아 주세요.</span>
              <button className="button secondary small" onClick={() => setAttempt((a) => a + 1)}>새 견적 받기</button>
            </div>
          )}
          {insufficient && <p className="trade-state error" role="alert">보유 포인트가 부족합니다. 거래 후 잔액이 0P보다 작을 수 없습니다.</p>}
          {state === "failed" && (
            <div className="trade-state error" role="alert">
              <span>{error || "거래를 처리하지 못했습니다."}</span>
              {renewable && <button className="button secondary small" onClick={() => setAttempt((a) => a + 1)}>새 견적 받기</button>}
            </div>
          )}
          <p className="fine-print">
            {service.available
              ? `${mock ? "예시 모드 · 수수료와 정산액은 예시 값입니다. " : ""}확정 시점의 가격으로 체결되며, 가격이 바뀌면 다시 확인을 요청합니다.`
              : "거래 서비스 준비 중입니다. 현재는 주문을 접수할 수 없습니다."}
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={onClose} disabled={state === "submitting"}>취소</button>
            <button
              className={`button ${side === "buy" ? "primary" : "accent"}`}
              disabled={!quote || !service.available || insufficient || expired || !(state === "review" || (state === "failed" && !renewable))}
              title={service.available ? undefined : unavailableAction}
              aria-busy={state === "submitting"}
              onClick={() => void confirm()}
            >
              {state === "submitting" ? <><LoaderCircle size={17} className="kx-spin" />처리 중…</> : `${label} 확정`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
export function TradeButton({
  player,
  side = "buy",
  className = "button primary",
  label,
}: {
  player?: Player;
  side?: "buy" | "sell";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const {data}=usePlatform();
  const duplicate=side==="buy" && data.member?.holdings.some(h=>h.playerId===player?.id);
  return (
    <>
      <button type="button" className={className} disabled={duplicate || !player || !!player.status || player.price == null} title={player?.status || undefined} onClick={() => setOpen(true)}>
        {duplicate ? "보유 중" : player?.status || label || (side === "buy" ? "매입" : "매각")}
      </button>
      {open && player && <TradeDialog player={player} side={side} onClose={() => setOpen(false)} />}
    </>
  );
}
export function BackLink({ href = "/players", label = "선수 목록" }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="back-link">
      <ArrowLeft size={16} />
      {label}
    </Link>
  );
}
