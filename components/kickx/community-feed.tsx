"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { supportsTeam, supportedTeams } from "@/lib/kickx/support";
import { Pagination } from "./pagination";
import { LoaderCircle, Lock, Paperclip, Pencil, Search, Send, X } from "lucide-react";
import type { Player, Post } from "@/lib/kickx/types";
import { dateText, money } from "@/lib/kickx/data";
import { apiRequest } from "@/lib/kickx/client";
import { COMMUNITY_PATHS, postTitle, type CommunityScope } from "@/lib/kickx/community";
import { POST_LIMITS, validatePost } from "@/lib/kickx/validation";
import { usePlatform, useResource } from "./provider";
import { useCatalogPage, useCatalogPlayer } from "./catalog";
import { Select } from "./select";
import { DataEmpty, PlayerPortrait } from "./ui";

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
  const [selected, setSelected] = useState(target ?? (scope === "club" ? supportedTeams(data.session?.profile)[0] ?? "" : ""));
  const [body, setBody] = useState(""), [title, setTitle] = useState(""), [transaction, setTransaction] = useState("");
  const [advanced, setAdvanced] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef(""), lock = useRef(false), id = useId();
  const name = targetName || (scope === "club" ? getTeam(selected)?.name : getPlayer(selected)?.name);
  function changed() { request.current = ""; setError(""); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const draft = { scope, target: selected, title: postTitle(title, body), body, transaction };
    const errors = validatePost(draft, { myTeam: data.session?.profile?.team ?? null, myTeams: supportedTeams(data.session?.profile), targets: selected ? [selected] : [], transactions: data.member?.transactions.map(t => t.id) ?? [] });
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
  const fan = props.scope === "player" || supportedTeams(data.session?.profile).length>0 && (!props.target || supportsTeam(data.session?.profile,props.target));
  const canWrite = !!data.session?.profile && fan;
  return <section className="feed-composer panel" aria-label={`${props.scope === "club" ? "구단" : "선수"} 빠른 글쓰기`}>
    {status !== "ready" ? <DataEmpty entity="커뮤니티" status={status} retry={reloadPlatform} rows={1} /> : !canWrite ? <div className="feed-composer-locked"><Lock size={16} aria-hidden="true" /><p>{!data.session ? "로그인하고 이야기를 나눠보세요." : !data.session.profile ? "프로필을 설정하면 이야기를 작성할 수 있습니다." : "구단 이야기는 해당 구단의 응원 팬만 작성할 수 있습니다."}</p><Link className="button secondary small" href={!data.session ? "/login" : "/mypage"}>{!data.session ? "로그인" : "프로필 설정"}</Link></div> : open ? <ComposerForm {...props} onSaved={() => { setOpen(false); props.onSaved(); }} onClose={() => setOpen(false)} /> : <button className="feed-composer-open" onClick={() => setOpen(true)}><span className="rank-avatar" aria-hidden="true">{data.session?.profile?.nickname.slice(0, 1) ?? "?"}</span><span className="feed-composer-prompt">{props.target && props.targetName ? `${props.targetName}에 대한 이야기를 남겨보세요` : props.scope === "club" ? "응원 구단에 대한 이야기를 남겨보세요" : "선수에 대한 생각을 나눠보세요"}</span><span className="feed-composer-cta"><Pencil size={15} /></span></button>}
  </section>;
}

/** Compact bulletin board. Mutations remain on the post detail page. */
export function CommunityFeed({ scope, target, targetName, title = "게시글", compose = true }: { scope: CommunityScope; target?: string; targetName?: string; title?: string; compose?: boolean }) {
  const { data, mock, status, reload: reloadPlatform, getTeam, getPlayer } = usePlatform();
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[sort,setSort]=useState('new'),[page,setPage]=useState(1);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
  const params=new URLSearchParams({scope,q:search,sort,page:String(page)});if(target)params.set('target',target);
  const remote=useResource(!mock&&status==='ready'?`/api/kickx/community?${params}`:null,emptyFeed);
  const local=data.posts.filter(p=>p.scope===scope&&(!target||p.target===target)&&`${p.title} ${p.body}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sort==='popular'?b.likes-a.likes:Date.parse(b.date)-Date.parse(a.date));
  const items=(mock?local.slice((page-1)*SIZE,page*SIZE):remote.data.items).filter(p=>p.scope===scope&&(!target||p.target===target));
  const total=mock?local.length:remote.data.total;
  const feedStatus=status!=='ready'?status:mock?status:remote.status;
  return <div className="community-feed" data-scope={scope}>
    {compose&&<CommunityComposer key={`${scope}:${target??'hub'}`} scope={scope} target={target} targetName={targetName} onSaved={()=>{setPage(1);remote.reload();}}/>}
    <section className="panel flush community-board" aria-label={`${scope==='club'?'구단':'선수'} 게시글 목록`}>
      <div className="post-browser-title"><h2>{title}{feedStatus==='ready'&&<span className="num">{money(total)}건</span>}</h2></div>
      <div className="toolbar post-tools"><label className="input-search"><Search size={16}/><input aria-label="게시글 검색" maxLength={100} value={query} placeholder="제목·내용 검색" onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label><Select label="게시글 정렬" value={sort} onChange={v=>{setSort(v);setPage(1);}} options={[{value:'new',label:'최신순'},{value:'popular',label:'추천순'}]} variant="compact"/></div>
      {feedStatus!=='ready'?<DataEmpty entity="게시글" status={feedStatus} retry={status==='ready'?remote.reload:reloadPlatform}/>:items.length?<div className="board-list-scroll"><table className="community-board-table"><thead><tr><th className="board-number">번호</th><th className="board-subject">제목</th><th>작성자</th><th>작성일</th><th className="board-views">조회</th><th className="board-likes">추천</th></tr></thead><tbody>
        {items.map((post,index)=>{
          const name=post.targetName||(scope==='club'?getTeam(post.target)?.name:getPlayer(post.target)?.name)||'—';
          return <tr key={post.id} data-scope={post.scope}><td className="board-number num">{total-(page-1)*SIZE-index}</td>
            <td className="board-subject">{!target&&<Link className="board-target" href={`${COMMUNITY_PATHS[scope]}/${post.target}`}>{name}</Link>}
              <Link className="board-post-link" href={`/community/posts/${post.id}`}>{post.title||postTitle('',post.body)}{post.transaction&&<Paperclip size={13} aria-label="거래 첨부"/>}{post.commentCount>0&&<b className="board-comment-count num">[{post.commentCount}]</b>}</Link>
              <span className="board-mobile-meta">{post.author} · {dateText(post.date,false)} · 조회 {money(post.views)} · 추천 {money(post.likes)}</span>
            </td><td className="board-author">{post.author}</td><td className="board-date"><time dateTime={post.date}>{dateText(post.date,false)}</time></td><td className="board-views num">{money(post.views)}</td><td className="board-likes num">{money(post.likes)}</td></tr>;
        })}
      </tbody></table></div>:<div className="feed-empty"><h3>{query?'조건에 맞는 게시글이 없습니다':'아직 게시글이 없습니다'}</h3><p>{query?'검색어를 바꿔보세요.':'첫 게시글을 작성해 보세요.'}</p></div>}
      {feedStatus==='ready'&&<Pagination page={page} total={total} size={SIZE} onPage={setPage} label="게시글"/>}
    </section>
  </div>;
}
