"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, LoaderCircle, MessageCircle, Paperclip, Pencil, Search, Send, X } from "lucide-react";
import type { Player, Post } from "@/lib/kickx/types";
import { dateText, money, relativeTime } from "@/lib/kickx/data";
import { apiRequest } from "@/lib/kickx/client";
import { COMMUNITY_PATHS, postHeading, postTitle, type CommunityScope } from "@/lib/kickx/community";
import { POST_LIMITS, validatePost } from "@/lib/kickx/validation";
import { usePlatform, useResource } from "./provider";
import { useCatalogPage, useCatalogPlayer } from "./catalog";
import { usePost } from "./community-detail";
import { Select } from "./select";
import { ClubCrest, DataEmpty, PlayerPortrait, Tabs } from "./ui";

const SIZE = 20;
const emptyFeed = () => ({ items: [] as Post[], total: 0, page: 1, size: SIZE });

function PlayerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data, mock, getTeam } = usePlatform();
  const [query, setQuery] = useState("");
  const remote = useCatalogPage<Player>("players", { q: query, size: 50, sort: "name" });
  const selected = useCatalogPlayer(value || null).player;
  const players = mock ? data.players.filter(p => `${p.name} ${p.english ?? ""}`.toLowerCase().includes(query.toLowerCase())) : remote.status === "ready" ? remote.data.items : [];
  const options = [...new Map([...players, ...(selected ? [selected] : [])].map(p => [p.id, p])).values()];
  return <div className="feed-player-picker">
    <label className="input-search"><Search size={16} /><input aria-label="빠른 글쓰기 선수 검색" value={query} maxLength={100} placeholder="한글·영문 선수 검색" onChange={e => setQuery(e.target.value)} /></label>
    <Select label="이야기할 선수" value={value} onChange={onChange} placeholder="선수 선택" options={options.map(p => ({ value: p.id, label: p.name, hint: getTeam(p.team)?.name, icon: <PlayerPortrait player={p} size="sm" /> }))} />
    {!mock && remote.status === "error" && <button type="button" className="text-link" onClick={remote.reload}>선수 목록 다시 불러오기</button>}
  </div>;
}

/** Fixed scope and, inside a lounge, fixed target. Requests retain their UUID on retry. */
function ComposerForm({ scope, target, targetName, onSaved, onClose }: { scope: CommunityScope; target?: string; targetName?: string; onSaved: () => void; onClose: () => void }) {
  const { data, mock, notify, getTeam, getPlayer } = usePlatform();
  const [selected, setSelected] = useState(target ?? (scope === "club" ? data.session?.profile?.team ?? "" : ""));
  const [body, setBody] = useState(""), [title, setTitle] = useState(""), [category, setCategory] = useState("자유"), [transaction, setTransaction] = useState("");
  const [advanced, setAdvanced] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef(""), lock = useRef(false), id = useId();
  const name = targetName || (scope === "club" ? getTeam(selected)?.name : getPlayer(selected)?.name);
  function changed() { request.current = ""; setError(""); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const draft = { scope, target: selected, title: postTitle(title, body), body, category, transaction };
    const errors = validatePost(draft, { myTeam: data.session?.profile?.team ?? null, categories: data.categories, targets: selected ? [selected] : [], transactions: data.member?.transactions.map(t => t.id) ?? [] });
    if (Object.keys(errors).length) { setError(Object.values(errors).join(" ")); return; }
    if (mock) { notify("예시 모드 · 실제로 저장되지 않습니다."); return; }
    lock.current = true; setBusy(true); setError(""); request.current ||= crypto.randomUUID();
    try {
      await apiRequest<{ id: string }>("/api/kickx/community", "POST", { ...draft, title, action: "createPost", requestId: request.current });
      notify("이야기를 게시했습니다."); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "게시하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="feed-composer-form" onSubmit={submit} aria-busy={busy}>
    <fieldset disabled={busy}>
      <div className="feed-composer-heading"><strong>{scope === "club" ? "구단 이야기" : "선수 이야기"}{name ? ` · ${name}` : ""}</strong><button type="button" className="icon-button" aria-label="빠른 글쓰기 닫기" onClick={() => { if ((!body && !title) || window.confirm("작성 중인 내용을 닫을까요?")) onClose(); }}><X size={17} /></button></div>
      {scope === "player" && !target && <PlayerPicker value={selected} onChange={v => { changed(); setSelected(v); }} />}
      <label className="sr-only" htmlFor={`${id}-body`}>빠른 글 내용</label>
      <textarea id={`${id}-body`} value={body} rows={4} maxLength={POST_LIMITS.bodyMax} autoFocus placeholder={scope === "player" ? "경기력과 가격에 대한 생각을 나눠보세요." : "경기와 응원 구단에 대한 이야기를 나눠보세요."} onChange={e => { changed(); setBody(e.target.value); }} />
      <div className="feed-composer-options"><button type="button" className="text-link" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>제목·주제·거래 첨부 {advanced ? "닫기" : "추가"}</button><span className="fine-print num">{[...body].length} / {POST_LIMITS.bodyMax}</span></div>
      {advanced && <div className="feed-composer-advanced">
        <label htmlFor={`${id}-title`}>제목 (선택)</label><input id={`${id}-title`} value={title} maxLength={POST_LIMITS.titleMax} onChange={e => { changed(); setTitle(e.target.value); }} />
        <Select label="빠른 글 주제" value={category} onChange={v => { changed(); setCategory(v); }} options={data.categories.map(c => ({ value: c, label: c }))} />
        {!!data.member?.transactions.length && <Select label="빠른 글 거래 첨부" value={transaction} onChange={v => { changed(); setTransaction(v); }} options={[{ value: "", label: "첨부 안 함" }, ...data.member.transactions.map(t => ({ value: t.id, label: `${t.playerName} · ${t.type === "buy" ? "매입" : "매각"} · ${money(t.price)} P`, hint: dateText(t.date) }))]} />}
      </div>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="feed-composer-foot"><span className="fine-print">내용 {POST_LIMITS.bodyMin}자 이상 · {scope === "club" ? "응원 구단에 게시" : "선택한 선수에 게시"}</span><button className="button primary small" disabled={busy || !body.trim() || !selected}>{busy ? <LoaderCircle size={15} className="kx-spin" /> : <Send size={15} />}게시하기</button></div>
    </fieldset>
  </form>;
}
export function CommunityComposer(props: { scope: CommunityScope; target?: string; targetName?: string; onSaved: () => void }) {
  const { data, status, reload: reloadPlatform } = usePlatform();
  const [open, setOpen] = useState(false);
  const fan = props.scope === "player" || !!data.session?.profile?.team && (!props.target || data.session.profile.team === props.target);
  const canWrite = !!data.session?.profile && fan;
  return <section className="feed-composer panel" aria-label={`${props.scope === "club" ? "구단" : "선수"} 빠른 글쓰기`}>
    {status !== "ready" ? <DataEmpty entity="커뮤니티" status={status} retry={reloadPlatform} rows={1} /> : !canWrite ? <div className="feed-composer-locked"><p>{!data.session ? "로그인하고 이야기를 나눠보세요." : !data.session.profile ? "프로필을 설정하면 이야기를 작성할 수 있습니다." : "구단 이야기는 해당 구단의 응원 팬만 작성할 수 있습니다."}</p><Link className="button secondary small" href={!data.session ? "/login" : "/mypage"}>{!data.session ? "로그인" : "프로필 설정"}</Link></div> : open ? <ComposerForm {...props} onSaved={() => { setOpen(false); props.onSaved(); }} onClose={() => setOpen(false)} /> : <button className="feed-composer-open" onClick={() => setOpen(true)}><Pencil size={18} /><span>{props.scope === "club" ? "응원 구단에 대한 이야기를 남겨보세요" : "선수에 대한 생각을 나눠보세요"}</span><span className="tag">글쓰기</span></button>}
  </section>;
}

function FeedCard({ post, showTarget }: { post: Post; showTarget: boolean }) {
  const { data, mock, notify, getPlayer, getTeam } = usePlatform();
  const [reaction, setReaction] = useState({ likes: post.likes, liked: !!post.liked, comments: post.commentCount });
  const [expanded, setExpanded] = useState(false), [commentsOpen, setCommentsOpen] = useState(false), [commentPage, setCommentPage] = useState(1);
  const [body, setBody] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), request = useRef("");
  const comments = usePost(commentsOpen ? post.id : null, commentPage);
  const fan = post.scope === "player" || data.session?.profile?.team === post.target;
  const player = post.scope === "player" ? getPlayer(post.target) : undefined;
  const name = post.targetName || (post.scope === "club" ? getTeam(post.target)?.name : player?.name) || "대상 정보 없음";
  const lounge = `${COMMUNITY_PATHS[post.scope]}/${encodeURIComponent(post.target)}`;
  const heading = postHeading(post.title, post.body);
  async function like() {
    if (lock.current || !data.session) return;
    if (mock) { notify("예시 모드 · 실제로 저장되지 않습니다."); return; }
    lock.current = true; setBusy(true); setError("");
    const liked = !reaction.liked;
    try { await apiRequest("/api/kickx/community", "POST", { action: "like", postId: post.id, liked }); setReaction(v => ({ ...v, liked, likes: Math.max(0, v.likes + (liked ? 1 : -1)) })); }
    catch (e) { setError(e instanceof Error ? e.message : "공감하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function comment(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || !body.trim()) return;
    if (mock) { notify("예시 모드 · 실제로 저장되지 않습니다."); return; }
    lock.current = true; setBusy(true); setError(""); request.current ||= crypto.randomUUID();
    try {
      await apiRequest("/api/kickx/community", "POST", { action: "comment", postId: post.id, body, requestId: request.current });
      setCommentPage(Math.ceil((reaction.comments + 1) / 50)); comments.reload(); setReaction(v => ({ ...v, comments: v.comments + 1 })); setBody(""); request.current = ""; notify("댓글을 등록했습니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "댓글을 등록하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <article className="community-feed-card" data-scope={post.scope} aria-label={`${post.author}의 ${post.scope === "club" ? "구단" : "선수"} 이야기`}>
    <header className="feed-card-header"><span className="rank-avatar" aria-hidden="true">{post.author.slice(0, 1)}</span><div><strong>{post.author}</strong><time dateTime={post.date} title={dateText(post.date)}>{relativeTime(post.date)}</time></div><span className="category-tag">{post.category}</span></header>
    {showTarget && <Link className="feed-card-target" href={lounge}>{player ? <PlayerPortrait player={player} size="sm" /> : <ClubCrest id={post.scope === "club" ? post.target : null} size="small" />}{name}</Link>}
    {heading && <h3><Link href={`/community/posts/${post.id}`}>{heading}</Link></h3>}
    <p className="feed-card-body">{expanded || [...post.body].length <= 400 ? post.body : [...post.body].slice(0, 400).join("") + "…"}</p>
    {[...post.body].length > 400 && <button type="button" className="text-link" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? "접기" : "더 보기"}</button>}
    {post.transaction && <div className="feed-trade-card"><Paperclip size={16} /><div><small>작성자가 공유한 체결 거래</small><strong>{post.transaction.playerName} · {post.transaction.type === "buy" ? "매입" : "매각"} · {money(post.transaction.price)} P</strong><time dateTime={post.transaction.date}>{dateText(post.transaction.date)}</time></div></div>}
    <div className="feed-card-actions"><button type="button" aria-label={`피드 공감 ${reaction.likes}`} aria-pressed={reaction.liked} disabled={!data.session || busy} onClick={() => void like()}><Heart size={17} fill={reaction.liked ? "currentColor" : "none"} />공감 {reaction.likes}</button><button type="button" aria-expanded={commentsOpen} onClick={() => setCommentsOpen(v => !v)}><MessageCircle size={17} />댓글 {reaction.comments}</button><Link href={`/community/posts/${post.id}`}>상세·신고</Link>{post.scope === "player" && <Link href={`/players/${encodeURIComponent(post.target)}`}>선수 정보</Link>}</div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {commentsOpen && <section className="feed-comments" aria-label="피드 댓글">
      {comments.status !== "ready" ? <DataEmpty entity="댓글" status={comments.status} retry={comments.reload} rows={2} /> : <><ul>{comments.data.comments.slice(-3).map(c => <li key={c.id}><strong>{c.author}</strong><p>{c.body}</p></li>)}</ul>{!comments.data.comments.length && <p className="fine-print">첫 댓글을 남겨보세요.</p>}</>}
      {!!data.session?.profile && fan ? <form onSubmit={comment}><label className="sr-only" htmlFor={`feed-comment-${post.id}`}>피드 댓글 내용</label><textarea id={`feed-comment-${post.id}`} rows={2} maxLength={1000} value={body} disabled={busy} placeholder="의견을 남겨보세요" onChange={e => { request.current = ""; setBody(e.target.value); }} /><button className="button secondary small" disabled={busy || !body.trim()}>댓글 등록</button></form> : <p className="fine-print">{post.scope === "club" && data.session?.profile ? "해당 구단 응원 팬만 댓글을 작성할 수 있습니다." : "로그인하고 프로필을 설정하면 댓글을 작성할 수 있습니다."}</p>}
      <Link className="text-link" href={`/community/posts/${post.id}`}>댓글 전체 보기 · 답글 작성</Link>
    </section>}
  </article>;
}

export function CommunityFeed({ scope, target, targetName, title = "이야기", compose = true }: { scope: CommunityScope; target?: string; targetName?: string; title?: string; compose?: boolean }) {
  const { data, mock, status, reload: reloadPlatform } = usePlatform();
  const [query, setQuery] = useState(""), [category, setCategory] = useState("전체"), [sort, setSort] = useState("new"), [page, setPage] = useState(1);
  const [search,setSearch]=useState("");
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
  const params = new URLSearchParams({ scope, q: search, sort, page: String(page) });
  if (target) params.set("target", target); if (category !== "전체") params.set("category", category);
  const remote = useResource(!mock && status === "ready" ? `/api/kickx/community?${params}` : null, emptyFeed);
  const local = data.posts.filter(p => p.scope === scope && (!target || p.target === target) && (category === "전체" || p.category === category) && `${p.title} ${p.body}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === "popular" ? b.likes - a.likes : Date.parse(b.date) - Date.parse(a.date));
  const items = (mock ? local.slice((page - 1) * SIZE, page * SIZE) : remote.data.items).filter(p => p.scope === scope && (!target || p.target === target));
  const total = mock ? local.length : remote.data.total, pages = Math.max(1, Math.ceil(total / SIZE));
  const feedStatus = status !== "ready" ? status : mock ? status : remote.status;
  const ready = feedStatus === "ready";
  return <div className="community-feed" data-scope={scope}>
    {compose && <CommunityComposer key={`${scope}:${target ?? "hub"}`} scope={scope} target={target} targetName={targetName} onSaved={() => { setPage(1); remote.reload(); }} />}
    <section className="panel flush" aria-label={`${scope === "club" ? "구단" : "선수"} 이야기 피드`}>
      <div className="post-browser-title"><h2>{title}{ready && <span className="num">{money(total)}건</span>}</h2></div>
      <div className="panel-head"><Tabs items={["전체", ...data.categories]} value={category} label="피드 주제" onChange={v => { setCategory(v); setPage(1); }} /></div>
      <div className="toolbar post-tools"><label className="input-search"><Search size={16} /><input aria-label="피드 검색" maxLength={100} value={query} placeholder="내용·제목 검색" onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><Select label="피드 정렬" value={sort} onChange={v => { setSort(v); setPage(1); }} options={[{ value: "new", label: "최신순" }, { value: "popular", label: "공감순", hint: "누적 공감" }]} variant="compact" />{(query || category !== "전체") && <button type="button" className="button ghost small" onClick={() => { setQuery(""); setCategory("전체"); setPage(1); }}>초기화</button>}</div>
      {!ready ? <DataEmpty entity="게시글" status={feedStatus} retry={status === "ready" ? remote.reload : reloadPlatform} /> : items.length ? <div className="feed-cards">{items.map(p => <FeedCard key={p.id} post={p} showTarget={!target} />)}</div> : <div className="feed-empty"><h3>{query || category !== "전체" ? "조건에 맞는 이야기가 없습니다" : "아직 이야기가 없습니다"}</h3><p>{query || category !== "전체" ? "검색어나 주제를 바꿔보세요." : "첫 이야기를 남겨보세요."}</p></div>}
      {ready && pages > 1 && <div className="panel-foot pagination"><span>{money(total)}건 · {page} / {pages}</span><div><button aria-label="이전 피드 페이지" disabled={page === 1} onClick={() => setPage(v => v - 1)}><ChevronLeft size={17} /></button><button aria-label="다음 피드 페이지" disabled={page >= pages} onClick={() => setPage(v => v + 1)}><ChevronRight size={17} /></button></div></div>}
    </section>
  </div>;
}
