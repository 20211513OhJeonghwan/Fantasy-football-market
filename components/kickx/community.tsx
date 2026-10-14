"use client";
import { Select } from "./select";
import { simple, useTeamOptions } from "./options";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, LoaderCircle, Lock, MessageCircle, Paperclip, Pencil, Search, UserRound, Users } from "lucide-react";
import { dateText, money, score } from "@/lib/kickx/data";
import type { Post, Player } from "@/lib/kickx/types";
import { clubIdentity } from "@/lib/kickx/club-identity";
import { POST_LIMITS, validatePost, type PostField } from "@/lib/kickx/validation";
import {apiRequest} from "@/lib/kickx/client";
import {usePost} from "./community-detail";
import {CommunityFeed} from "./community-feed";
import {postTitle, postHeading} from "@/lib/kickx/community";
import { usePlatform, useResource } from "./provider";
import { useCatalogPage, useCatalogPlayer } from "./catalog";
import { BackLink, Change, ClubCrest, LeagueMark, DataEmpty, MemberNotice, PageHeading, PlayerPortrait, PositionBadge, SectionTitle } from "./ui";

const HUB = { club: "/community/clubs", player: "/community/players" } as const;
const POST_PAGE = 20, LOUNGE_PAGE = 24;
function useTargetName() {
  const { getTeam, getPlayer } = usePlatform();
  return (post: Post) => post.targetName || (post.scope === "club" ? getTeam(post.target)?.name : getPlayer(post.target)?.name) || "—";
}
function Pager({ page, total, size, label, onPage }: { page: number; total: number; size: number; label: string; onPage: (page: number) => void }) {
  const count = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  return (
    <div className="panel-foot pagination">
      <span className="num">{`${(page - 1) * size + 1}–${Math.min(page * size, total)} / ${money(total)}`}</span>
      <div>
        <button aria-label={`이전 ${label} 페이지`} disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={17} /></button>
        <span className="num">{page} / {count}</span>
        <button aria-label={`다음 ${label} 페이지`} disabled={page >= count} onClick={() => onPage(page + 1)}><ChevronRight size={17} /></button>
      </div>
    </div>
  );
}
const emptyPosts=()=>({items:[] as Post[],total:0,page:1,size:POST_PAGE});
function PopularPosts({ posts,scope }: { posts: Post[];scope:"club"|"player" }) {
  const {mock,status}=usePlatform();
  const remote=useResource(!mock&&status==="ready"?`/api/kickx/community?scope=${scope}&sort=popular`:null,emptyPosts);
  const targetName = useTargetName();
  const top = [...(mock?posts:remote.data.items)].sort((a, b) => b.likes - a.likes).slice(0, 5);
  return (
    <section className="panel side-panel">
      <SectionTitle title="인기 게시글" meta="누적 공감 순" />
      {top.length ? (
        <ol className="popular-list">
          {top.map((p, i) => (
            <li key={p.id}>
              <span className="num">{i + 1}</span>
              <Link href={`/community/posts/${p.id}`}>
                <strong>{p.title}</strong>
                <small>{targetName(p)} · 공감 {money(p.likes)}</small>
              </Link>
            </li>
          ))}
        </ol>
      ) : <DataEmpty entity="인기 게시글" status={mock ? undefined : remote.status} rows={3} />}
    </section>
  );
}
/** Quick links to the lounges the member can act in: their club and the players they own. */
function MyLounges({kind}: {kind:"club"|"player"}) {
  const { data, status, getTeam, getPlayer } = usePlatform();
  const myTeam = getTeam(data.session?.profile?.team);
  const owned = (data.member?.holdings.map((h) => getPlayer(h.playerId)).filter(Boolean) ?? []) as Player[];
  if (status !== "ready") return null;
  return (
    <section className="my-lounges" data-scope={kind} aria-label="내 라운지 바로가기">
      {kind === "club" && (myTeam ? (
        <Link className="my-lounge club" href={`/community/clubs/${myTeam.id}`} style={{ "--club": clubIdentity(myTeam)?.primary } as CSSProperties}>
          <ClubCrest id={myTeam.id} size="large" />
          <span><small>나의 응원 구단</small><strong>{myTeam.name}</strong></span>
          <ArrowRight size={16} />
        </Link>
      ) : (
        <Link className="my-lounge unset" href={data.session ? "/mypage" : "/login"}>
          <span className="my-lounge-icon"><Users size={20} /></span>
          <span><small>{data.session ? "응원 구단 미설정" : "로그인 전"}</small><strong>{data.session ? "응원 구단 정하기" : "로그인하고 참여하기"}</strong></span>
          <ArrowRight size={16} />
        </Link>
      ))}
      {kind === "player" && <div className="my-lounge-players">
        <small>보유 선수 라운지{owned.length ? ` · ${owned.length}` : ""}</small>
        {owned.length ? (
          <div>{owned.map((p) => <Link key={p.id} href={`/community/players/${p.id}`} className="lounge-chip"><PlayerPortrait player={p} size="sm" />{p.short || p.name}</Link>)}</div>
        ) : <p>{data.session ? "선수를 보유하면 여기에서 바로 라운지로 이동할 수 있습니다." : "로그인하면 보유 선수 라운지가 표시됩니다."}</p>}
      </div>}
    </section>
  );
}
function ClubExplorer({ count }: { count: (target: string) => number | null }) {
  const { data, status, getTeam } = usePlatform();
  const permitted = new Set(useTeamOptions(null).map(t=>t.value));
  const leagues = data.leagues.filter(l=>data.teams.some(t=>permitted.has(t.id)&&t.leagueId===l.id));
  const [league, setLeague] = useState("");
  const current = leagues.some(l=>l.id===league) ? league : leagues[0]?.id;
  const myTeam = getTeam(data.session?.profile?.team);
  const clubs = data.teams.filter((t) => t.leagueId === current);
  return (
    <section className="panel flush explorer">
      <div className="explorer-head">
        <h2>구단 라운지 찾기<span className="num">{permitted.size ? `${permitted.size}개 구단` : ""}</span></h2>
        <div className="league-switch compact" role="group" aria-label="리그 선택">
          {leagues.map((l) => (
            <button key={l.id} type="button" aria-pressed={current === l.id} className={current === l.id ? "active" : ""} onClick={() => setLeague(l.id)}>
              <LeagueMark league={l} size="sm" /><span>{l.name}</span>
            </button>
          ))}
        </div>
      </div>
      {clubs.length ? (
        <ul className="club-list">
          {clubs.map((t) => (
            <li key={t.id}>
              <Link href={`/community/clubs/${t.id}`} className={t.id === myTeam?.id ? "mine" : ""} style={{ "--club": clubIdentity(t)?.primary } as CSSProperties}>
                <ClubCrest id={t.id} size="small" />
                <span className="club-list-name"><strong>{t.name}</strong>{t.english && t.english !== t.name && <small>{t.english}</small>}</span>
                {t.id === myTeam?.id && <span className="tag yellow">MY</span>}
                <span className="club-list-count num" title="게시글"><MessageCircle size={12} />{count(t.id) ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <DataEmpty entity="구단 라운지" status={status === "ready" && data.teams.length ? "ready" : undefined} />}
    </section>
  );
}
function PlayerExplorer({ count }: { count: (target: string) => number | null }) {
  const { data, status, getTeam } = usePlatform();
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  // Real mode pages through the server catalog; the mock sample is small and filtered locally.
  const remote = useCatalogPage<Player>("players", { q, size: LOUNGE_PAGE, sort: "name", page });
  const local = data.players.filter((p) => `${p.name} ${p.english || ""} ${getTeam(p.team)?.name || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const items = remote.enabled ? (remote.status === "ready" ? remote.data.items : []) : local.slice((page - 1) * LOUNGE_PAGE, page * LOUNGE_PAGE);
  const total = remote.enabled ? remote.data.total : local.length;
  return (
    <section className="panel flush explorer">
      <div className="explorer-head">
        <h2>선수 라운지 찾기<span className="num">{remote.enabled ? (remote.status === "ready" ? `${money(total)}명` : "") : `${money(total)}명`}</span></h2>
        <label className="input-search hub-search"><Search size={16} /><input aria-label="선수 라운지 검색" placeholder="한글·영문 선수 이름" value={q} maxLength={100} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
      </div>
      {items.length ? (
        <ul className="lounge-grid">
          {items.map((p) => (
            <li key={p.id}>
              <Link className="lounge-card" href={`/community/players/${p.id}`} style={{ "--club": clubIdentity(getTeam(p.team))?.primary ?? "var(--ink)" } as CSSProperties}>
                <PlayerPortrait player={p} size="sm" />
                <span className="lounge-card-text">
                  <strong>{p.name}</strong>
                  <span>{getTeam(p.team)?.name || "소속 정보 없음"}</span>
                </span>
                <span className="lounge-card-meta">
                  <PositionBadge position={p.position} />
                  <small className="num" title="게시글"><MessageCircle size={12} />{count(p.id) ?? "—"}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <DataEmpty entity="선수 라운지" status={remote.enabled ? remote.status : status} retry={remote.enabled ? remote.reload : undefined} filtered={!!q} />}
      <Pager page={page} total={total} size={LOUNGE_PAGE} label="선수 라운지" onPage={setPage} />
    </section>
  );
}
export function CommunityHub({ kind }: { kind: "club" | "player" }) {
  const { data } = usePlatform();
  const posts = data.posts.filter((p) => p.scope === kind);
  // Post counts come from the bootstrap response; null when the server does not report them.
  const count = (target: string) => data.communityCounts?.find(c=>c.scope===kind&&c.target===target)?.count ?? (data.policy ? 0 : data.communityCounts ? 0 : posts.filter(p=>p.target===target).length);
  return (
    <>
      <PageHeading
        eyebrow="COMMUNITY"
        title={kind === "club" ? "구단 커뮤니티" : "선수 커뮤니티"}
        description={kind === "club" ? "응원 구단 팬끼리 경기·구단 이야기를 나눕니다. 읽기는 누구나, 글쓰기는 응원 팬만 가능합니다." : "선수의 경기력과 가치 변화, 거래 판단을 함께 이야기합니다. 프로필을 만든 회원 누구나 쓸 수 있습니다."}
        action={<Link className="button primary" href={`/community/write?scope=${kind}`}><Pencil size={16} />글쓰기</Link>}
      />
      <nav className="community-switch" aria-label="커뮤니티 종류">
        <Link href={HUB.club} aria-current={kind === "club" ? "page" : undefined}><Users size={16} />구단 커뮤니티</Link>
        <Link href={HUB.player} aria-current={kind === "player" ? "page" : undefined}><UserRound size={16} />선수 커뮤니티</Link>
      </nav>
      <MyLounges kind={kind} />
      <div className="hub-layout">
        <CommunityFeed key={kind} scope={kind} title={kind === "club" ? "구단 이야기" : "선수 이야기"} />
        <aside className="hub-aside">
          <PopularPosts posts={posts} scope={kind} />
        </aside>
      </div>
      {kind === "club" ? <ClubExplorer count={count} /> : <PlayerExplorer count={count} />}
    </>
  );
}
export function CommunityScreen({ scope }: { scope: "club" | "player" }) {
  const params = useParams();
  const { data, getTeam, getLeague, status } = usePlatform();
  const target = scope === "club" ? String(params.teamId) : String(params.playerId);
  const detail=useCatalogPlayer(scope === "player" ? target : null);
  const team = scope === "club" ? getTeam(target) : undefined,
    player = scope === "player" ? detail.player : undefined;
  const found = !!(team || player);
  const posts = data.posts.filter((p) => p.scope === scope && p.target === target);
  const roster=useCatalogPage<Player>("players",{team:team?.id,size:12,sort:"number"});
  const squad=roster.enabled ? (team && roster.status === "ready" ? roster.data.items : []) : team ? data.players.filter(p=>p.team===team.id) : [];
  const identity = clubIdentity(team ?? getTeam(player?.team));
  const style = identity ? ({ "--club": identity.primary, "--club-2": identity.secondary } as CSSProperties) : undefined;
  const postCount = found ? (data.communityCounts?.find(c=>c.scope===scope&&c.target===target)?.count ?? (data.policy || data.communityCounts ? 0 : posts.length)) : null;
  const league = getLeague(team?.leagueId ?? getTeam(player?.team)?.leagueId);
  const name = team?.name ?? player?.name;
  return (
    <>
      <BackLink href={HUB[scope]} label={scope === "club" ? "구단 커뮤니티" : "선수 커뮤니티"} />
      <header className={`lounge-head ${scope}`} style={style}>
        <div className="lounge-head-mark">
          {team ? <ClubCrest id={team.id} size="large" /> : player ? <PlayerPortrait player={player} size="md" /> : <MessageCircle size={28} />}
        </div>
        <div className="lounge-head-text">
          <span className="lounge-head-kicker">
            {scope === "club" ? "구단 라운지" : "선수 라운지"}
            {league && <LeagueMark league={league} size="sm" />}
          </span>
          <h1>{name ? `${name} 라운지` : status === "ready" && (scope === "club" || detail.status !== "loading") ? "라운지를 찾을 수 없습니다" : "라운지"}</h1>
          <p>
            {team && [team.english, league?.name].filter(Boolean).join(" · ")}
            {player && [player.originalName && player.originalName !== player.name ? player.originalName : player.english !== player.name ? player.english : null, getTeam(player.team)?.name, player.position].filter(Boolean).join(" · ")}
            {!found && status === "ready" && "주소를 확인하거나 커뮤니티에서 라운지를 찾아 주세요."}
          </p>
        </div>
        <dl className="lounge-head-stats">
          <div><dt>게시글</dt><dd className="num">{postCount ?? "—"}</dd></div>
          {player && <div><dt>현재 가치</dt><dd className="num">{player.price != null ? `${money(player.price)} P` : "산정 전"}</dd></div>}
          {team && <div><dt>소속 선수</dt><dd className="num">{roster.enabled ? (roster.status === "ready" ? roster.data.total : "—") : squad.length}</dd></div>}
        </dl>
        <div className="lounge-head-links">
          {team && <Link className="text-link" href={`/teams/${team.id}`}>구단 정보 <ArrowRight size={14} /></Link>}
          {player && <Link className="text-link" href={`/players/${player.id}`}>선수 상세 <ArrowRight size={14} /></Link>}
        </div>
      </header>
      <MemberNotice />
      <div className="hub-layout">
        {found ? <CommunityFeed key={`${scope}:${target}`} scope={scope} target={target} targetName={name} title="라운지 이야기" /> : <DataEmpty entity="라운지" status={scope === "player" ? detail.status : status} />}
        <aside className="hub-aside">
          {team ? (
            <section className="panel side-panel">
              <SectionTitle title="소속 선수 라운지" meta="등번호 순" />
              {squad.length ? (
                <ul className="side-players">
                  {squad.map((p) => (
                    <li key={p.id}>
                      <Link href={`/community/players/${p.id}`}>
                        <PlayerPortrait player={p} size="sm" />
                        <span><strong>{p.name}</strong><small>{[p.number != null ? `#${p.number}` : null, p.position].filter(Boolean).join(" · ") || "—"}</small></span>
                        <ArrowRight size={14} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <DataEmpty entity="선수" status={roster.enabled ? roster.status : status} retry={roster.enabled ? roster.reload : undefined} rows={3} />}
              {roster.enabled && roster.data.total > 12 && <Link className="text-link" href={`/teams/${team.id}`}>소속 선수 전체 보기 <ArrowRight size={14} /></Link>}
            </section>
          ) : player ? (
            <section className="panel side-panel">
              <SectionTitle title="선수 요약" href={`/players/${player.id}`} link="상세" />
              <dl className="summary-list">
                <div><dt>현재 가치</dt><dd>{player.price != null ? `${money(player.price)} P` : "산정 전"}</dd></div>
                <div><dt>직전 발행 대비</dt><dd><Change value={player.change} /></dd></div>
                <div><dt>최근 경기 Performance</dt><dd>{score(player.performance)}</dd></div>
                <div><dt>시즌 득점 · 도움</dt><dd>{money(player.goals)} · {money(player.assists)}</dd></div>
              </dl>
            </section>
          ) : null}
          <PopularPosts posts={data.posts.filter((p) => p.scope === scope)} scope={scope} />
        </aside>
      </div>
    </>
  );
}
export {PostDetail} from "./community-detail";
type DraftState = { scope: "club" | "player"; target: string; category: string; title: string; body: string; transaction: string };
const FIELD_ORDER: PostField[] = ["target", "category", "title", "body", "transaction"];
const FIELD_LABEL: Record<PostField, string> = { scope: "게시판 종류", target: "대상", category: "주제", title: "제목", body: "내용", transaction: "거래 첨부" };
function Counter({ value, min, max }: { value: string; min: number; max: number }) {
  const count = [...value.trim()].length;
  const tone = count > max ? "over" : count >= max * 0.9 ? "near" : count > 0 && count < min ? "under" : "";
  return <small className={`char-count num ${tone}`} aria-live="polite">{count.toLocaleString("ko-KR")} / {max.toLocaleString("ko-KR")}</small>;
}
export function WritePost() {
  const sp = useSearchParams();
  const { data, status, mock, notify, getTeam, reload } = usePlatform();
  const detail=usePost(sp.get("edit"));
  const existing=detail.data.post?.authorId===data.session?.userId?detail.data.post:undefined;
  const requestId=useRef("");
  const revision=useRef<number|null>(null);
  const [savedId,setSavedId]=useState<string|null>(null);
  const [playerSearch,setPlayerSearch]=useState("");
  const searched=useCatalogPage<Player>("players",{q:playerSearch,size:50,sort:"name"});
  const myTeam = data.session?.profile?.team ?? null;
  const initialScope: DraftState["scope"] = existing?.scope ?? (sp.get("scope") === "player" ? "player" : "club");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const value: DraftState = draft ?? {
    scope: initialScope,
    target: existing?.target ?? sp.get("target") ?? (initialScope === "club" ? myTeam ?? "" : ""),
    category: existing?.category ?? "",
    title: existing ? postHeading(existing.title, existing.body) : "",
    body: existing?.body ?? "",
    transaction: existing?.transaction?.id ?? "",
  };
  const [touched, setTouched] = useState<Partial<Record<PostField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"edit" | "saving" | "done">("edit");
  const [serverNote, setServerNote] = useState("");
  const lock = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const selectedPlayer=useCatalogPlayer(value.scope==="player"?value.target:null);
  const selectablePlayers=[...new Map([...(searched.enabled?searched.data.items:data.players),...(selectedPlayer.player?[selectedPlayer.player]:[])].map(p=>[p.id,p])).values()];
  const targets = value.scope === "club" ? data.teams : selectablePlayers;
  const clubTargets = useTeamOptions(null).filter((o) => o.value === myTeam);
  const errors = validatePost({...value,title:postTitle(value.title,value.body)}, {
    myTeam,
    categories: data.categories,
    targets: targets.map((t) => t.id),
    transactions: data.member?.transactions.map((t) => t.id) ?? [],
  });
  const errorFields = FIELD_ORDER.filter((f) => errors[f]);
  const visible = (field: PostField) => (attempted || touched[field]) && errors[field];
  const dirty = draft !== null && phase === "edit";
  const isEdit = sp.has("edit");
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = (patch: Partial<DraftState>) => { revision.current ??= existing?.revision??0;requestId.current="";setDraft({ ...value, ...patch }); setServerNote(""); };
  const blur = (field: PostField) => () => setTouched((t) => ({ ...t, [field]: true }));
  const fieldProps = (field: PostField) => ({
    id: `post-${field}`,
    "aria-invalid": !!visible(field),
    "aria-describedby": `post-${field}-hint${visible(field) ? ` post-${field}-error` : ""}`,
    onBlur: blur(field),
    disabled: phase !== "edit",
  });
  const fieldError = (field: PostField) => visible(field) ? <p className="field-error" id={`post-${field}-error`}>{errors[field]}</p> : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (errorFields.length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    if (lock.current) return;
    lock.current = true;setPhase("saving");requestId.current ||= crypto.randomUUID();
    try{
      if(mock){setPhase("done");notify("게시글 등록 예시입니다. 실제로 저장되지 않습니다.");}
      else{const result=await apiRequest<{id:string}>("/api/kickx/community","POST",{...value,action:isEdit?"editPost":"createPost",postId:existing?.id,revision:revision.current??existing?.revision,requestId:requestId.current});setSavedId(result.id);setPhase("done");reload();notify("게시글을 저장했습니다.");}
    }catch(e){setServerNote(e instanceof Error?e.message:"저장하지 못했습니다.");setPhase("edit");}finally{lock.current=false;}
  }
  const hub = HUB[value.scope];
  const targetName = value.scope === "club" ? getTeam(value.target)?.name : selectedPlayer.player?.name;
  const attached = data.member?.transactions.find((t) => t.id === value.transaction);
  if(isEdit&&!existing)return <DataEmpty entity="수정할 게시글" status={detail.status}/>;
  if (phase === "done")
    return (
      <div className="reading-width">
        <section className="panel frame write-done">
          <span className="trade-done-mark"><Pencil size={28} /></span>
          <h1>게시글을 {isEdit ? "수정" : "등록"}했습니다</h1>
          <p>{mock ? "예시 모드에서는 게시글이 실제로 저장되지 않습니다." : "라운지에서 게시글을 확인할 수 있습니다."}</p>
          <div className="button-row">
            {savedId&&<Link className="button primary" href={`/community/posts/${savedId}`}>저장한 게시글 보기</Link>}
            <Link className="button secondary" href={hub}>{value.scope === "club" ? "구단 커뮤니티" : "선수 커뮤니티"}</Link>
            {value.target && <Link className="button primary" href={`${hub}/${value.target}`}>{targetName ? `${targetName} 라운지` : "라운지"}로 이동 <ArrowRight size={16} /></Link>}
          </div>
        </section>
      </div>
    );
  return (
    <div className="reading-width">
      <BackLink href={hub} label={value.scope === "club" ? "구단 커뮤니티" : "선수 커뮤니티"} />
      <PageHeading eyebrow="SHARE YOUR PERSPECTIVE" title={isEdit ? "게시글 수정" : "새 게시글"} description="경기를 본 시선, 선수에 대한 생각, 나의 거래 판단을 나눠보세요." />
      <MemberNotice />
      <form onSubmit={submit} noValidate className="panel frame write-form" aria-busy={phase === "saving"}>
        {attempted && errorFields.length > 0 && (
          <div className="error-summary" ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="error-summary-title">
            <strong id="error-summary-title">입력 내용을 확인해 주세요 · {errorFields.length}건</strong>
            <ul>
              {errorFields.map((f) => (
                <li key={f}><a href={`#post-${f}`} onClick={(e) => { e.preventDefault(); document.getElementById(`post-${f}`)?.focus(); }}><b>{FIELD_LABEL[f]}</b> {errors[f]}</a></li>
              ))}
            </ul>
          </div>
        )}
        <fieldset className="write-scope" disabled={phase !== "edit" || isEdit}>
          <legend className="sr-only">게시판 종류</legend>
          {(["club", "player"] as const).map((scope) => (
            <button key={scope} type="button" aria-pressed={value.scope === scope} className={value.scope === scope ? "active" : ""}
              onClick={() => update({ scope, target: scope === "club" ? myTeam ?? "" : "" })}>
              <strong>{scope === "club" ? "구단 커뮤니티" : "선수 커뮤니티"}</strong>
              <span>{scope === "club" ? "응원 구단 팬 전용" : "모든 회원"}</span>
            </button>
          ))}
        </fieldset>
        <div className="form-grid">
          <div className={`field ${visible("target") ? "invalid" : ""}`}>
            <label htmlFor="post-target">대상 {value.scope === "club" ? "구단" : "선수"} <span className="req" aria-hidden="true">*</span></label>
            {value.scope==="player"&&!isEdit&&<input aria-label="게시글 대상 선수 검색" value={playerSearch} onChange={e=>setPlayerSearch(e.target.value)} placeholder="한글·영문 선수 검색"/>}
            <Select id="post-target" invalid={!!visible("target")} describedBy={`post-target-hint${visible("target") ? " post-target-error" : ""}`} onBlur={blur("target")}
              disabled={isEdit || phase !== "edit" || !targets.length || (value.scope === "club" && !myTeam)} value={targets.some((t) => t.id === value.target) ? value.target : ""}
              onChange={(target) => update({ target })} placeholder={value.scope === "club" ? "구단 선택" : "선수 선택"}
              options={value.scope === "club" ? clubTargets : selectablePlayers.map((p) => ({ value: p.id, label: p.name, hint: getTeam(p.team)?.name, icon: <ClubCrest id={p.team} size="small" /> }))} />
            <small id="post-target-hint">{value.scope === "club" ? (myTeam ? "응원 구단 라운지에만 작성할 수 있습니다." : <>응원 구단이 없습니다. <Link className="text-link" href="/mypage">마이페이지에서 설정</Link></>) : "선수 라운지에 게시됩니다."}</small>
            {fieldError("target")}
          </div>
          <div className={`field ${visible("category") ? "invalid" : ""}`}>
            <label htmlFor="post-category">주제 <span className="req" aria-hidden="true">*</span></label>
            <Select id="post-category" invalid={!!visible("category")} describedBy={`post-category-hint${visible("category") ? " post-category-error" : ""}`} onBlur={blur("category")}
              disabled={phase !== "edit" || !data.categories.length} value={value.category} onChange={(category) => update({ category })} placeholder="주제 선택" options={simple(data.categories)} />
            <small id="post-category-hint">경기 리뷰, 선수 분석, 거래 전략 등</small>
            {fieldError("category")}
          </div>
        </div>
        <div className={`field ${visible("title") ? "invalid" : ""}`}>
          <div className="label-row"><label htmlFor="post-title">제목 (선택)</label><Counter value={value.title} min={0} max={POST_LIMITS.titleMax} /></div>
          <input {...fieldProps("title")} value={value.title} onChange={(e) => update({ title: e.target.value })} placeholder="분석 제목이 있다면 입력하세요" />
          <small id="post-title-hint">제목 없이도 게시할 수 있습니다. 입력할 경우 {POST_LIMITS.titleMin}–{POST_LIMITS.titleMax}자</small>
          {fieldError("title")}
        </div>
        <div className={`field ${visible("body") ? "invalid" : ""}`}>
          <div className="label-row"><label htmlFor="post-body">내용 <span className="req" aria-hidden="true">*</span></label><Counter value={value.body} min={POST_LIMITS.bodyMin} max={POST_LIMITS.bodyMax} /></div>
          <textarea {...fieldProps("body")} value={value.body} onChange={(e) => update({ body: e.target.value })} rows={11} placeholder="경기에 대한 생각과 선수에 대한 이야기를 나눠보세요" />
          <small id="post-body-hint">{POST_LIMITS.bodyMin}자 이상 · 근거 있는 의견과 서로에 대한 존중을 부탁드립니다.</small>
          {fieldError("body")}
        </div>
        <div className={`field attachment ${visible("transaction") ? "invalid" : ""}`}>
          <div className="label-row"><label htmlFor="post-transaction"><Paperclip size={15} /> 내 거래 내역 첨부</label><small>선택</small></div>
          <Select id="post-transaction" invalid={!!visible("transaction")} describedBy={`post-transaction-hint${visible("transaction") ? " post-transaction-error" : ""}`} onBlur={blur("transaction")}
            disabled={phase !== "edit" || !data.member?.transactions.length} value={value.transaction} onChange={(transaction) => update({ transaction })} placeholder="첨부하지 않음"
            options={[{ value: "", label: "첨부하지 않음" }, ...(data.member?.transactions.map((t) => ({ value: t.id, label: `${t.playerName} · ${t.type === "buy" ? "매입" : "매각"}`, hint: `${money(t.price)} P · ${dateText(t.date, false)}` })) ?? [])]} />
          <small id="post-transaction-hint">{data.member?.transactions.length ? "본인의 거래만 첨부할 수 있으며 게시글에 함께 공개됩니다." : "첨부할 수 있는 거래 내역이 없습니다."}</small>
          {fieldError("transaction")}
          {attached && (
            <div className="attached-trade compact">
              <span className="attached-label"><Paperclip size={14} />첨부 미리보기</span>
              <div className="attached-row">
                <span className={`trade-type ${attached.type}`}>{attached.type === "buy" ? "매입" : "매각"}</span>
                <strong>{attached.playerName}</strong>
                <span className="num">{money(attached.price)} P</span>
                <span className="muted">{dateText(attached.date)}</span>
              </div>
            </div>
          )}
        </div>
        {serverNote && (
          <div className="data-notice" role="alert">
            <Lock size={15} />
            <span>{serverNote}{/다른 창/.test(serverNote) && " 작성 중인 내용은 그대로 남아 있습니다. 필요한 부분을 복사한 뒤 최신 글을 확인해 주세요."}</span>
            {/다른 창/.test(serverNote) && existing && <Link className="text-link" href={`/community/posts/${existing.id}`} target="_blank">최신 글 새 창에서 보기</Link>}
          </div>
        )}
        <div className="form-actions">
          <p className="fine-print">{mock ? "예시 모드 · 등록해도 실제로 저장되지 않습니다." : status === "ready" && !data.session ? "로그인 후 작성할 수 있습니다." : "저장한 글은 해당 라운지에 공개됩니다."}</p>
          <Link className="button secondary" href={hub}>취소</Link>
          <button type="submit" className="button primary" disabled={phase !== "edit" || !data.session} aria-busy={phase === "saving"}>
            {phase === "saving" ? <><LoaderCircle size={16} className="kx-spin" />등록 중…</> : <><Pencil size={16} />{isEdit ? "수정 저장" : "게시글 등록"}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
