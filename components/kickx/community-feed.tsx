"use client";
import {PollEditor,pollDraftError,type PollDraft} from "./community-poll";
import { UserAvatar, MemberName } from "./avatar";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { canPostToClub, supportedTeams } from "@/lib/kickx/support";
import { Pagination } from "./pagination";
import { LoaderCircle, Lock, Paperclip, Pencil, Search, Send, X } from "lucide-react";
import type { Post } from "@/lib/kickx/types";
import { dateText, money } from "@/lib/kickx/data";
import { apiRequest } from "@/lib/kickx/client";
import { COMMUNITY_PATHS, postTitle, type CommunityScope } from "@/lib/kickx/community";
import {usePostTradeAttachments} from "./post-trades";
import { POST_LIMITS, validatePost } from "@/lib/kickx/validation";
import { usePlatform, useResource } from "./provider";
import { Select } from "./select";
import { ClubCrest, DataEmpty } from "./ui";
import { clubIdentity, luminance } from "@/lib/kickx/club-identity";
import type { CSSProperties } from "react";

const SIZE = 20;
const emptyFeed = () => ({ items: [] as Post[], total: 0, page: 1, size: SIZE });

/** Fixed scope and, inside a lounge, fixed target. Requests retain their UUID on retry. */
function ComposerForm({ scope, target, targetName, onSaved, onClose }: { scope: CommunityScope; target?: string; targetName?: string; onSaved: () => void; onClose: () => void }) {
  const { data, mock, notify, getTeam, getPlayer } = usePlatform();
  const selected = target ?? (scope === "club" ? data.session?.profile?.primaryTeam ?? "" : "");
  const [poll,setPoll]=useState<PollDraft|null>(null);
  const [body, setBody] = useState(""), [title, setTitle] = useState(""), [transaction, setTransaction] = useState("");
  const [advanced, setAdvanced] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const attachments=usePostTradeAttachments(scope,selected,advanced);
  const transactions=attachments.items;
  const request = useRef(""), lock = useRef(false), id = useId();
  const name = targetName || (scope === "club" ? getTeam(selected)?.name : getPlayer(selected)?.name);
  function changed() { request.current = ""; setError(""); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const draft = { scope, target: selected, title: title.normalize("NFC").trim(), body, transaction };
    const errors = validatePost(draft, { myTeam: data.session?.profile?.team ?? null, myTeams: supportedTeams(data.session?.profile),primaryTeam:data.session?.profile?.primaryTeam??null, targets: selected ? [selected] : [], transactions: transactions.map(t => t.id) });
    const pollError=pollDraftError(poll);if(pollError){setError(pollError);return;}
    if (Object.keys(errors).length) { setError(Object.values(errors).join(" ")); return; }
    if (mock) { notify("예시 모드 · 실제로 저장되지 않습니다."); return; }
    lock.current = true; setBusy(true); setError(""); request.current ||= crypto.randomUUID();
    try {
      await apiRequest<{ id: string }>("/api/kickx/community", "POST", { ...draft, title, poll, action: "createPost", requestId: request.current });
      notify("이야기를 게시했습니다."); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "게시하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="feed-composer-form" onSubmit={submit} aria-busy={busy}>
    <fieldset disabled={busy}>
      <div className="feed-composer-heading"><strong>{scope === "club" ? "구단 이야기" : "선수 이야기"}{name ? ` · ${name}` : ""}</strong><button type="button" className="icon-button" aria-label="빠른 글쓰기 닫기" onClick={() => { if ((!body && !title && !poll) || window.confirm("작성 중인 내용을 닫을까요?")) onClose(); }}><X size={17} /></button></div>
      <label htmlFor={`${id}-title`}>제목 <span className="req" aria-hidden="true">*</span></label>
      <input id={`${id}-title`} aria-label="빠른 글 제목" required minLength={POST_LIMITS.titleMin} maxLength={POST_LIMITS.titleMax} value={title} placeholder="제목을 입력하세요" onChange={e => { changed(); setTitle(e.target.value); }}/>

      <label className="sr-only" htmlFor={`${id}-body`}>빠른 글 내용</label>
      <textarea id={`${id}-body`} value={body} rows={4} maxLength={POST_LIMITS.bodyMax} autoFocus placeholder={scope === "player" ? "경기력과 가격에 대한 생각을 나눠보세요." : "경기와 응원 구단에 대한 이야기를 나눠보세요."} onChange={e => { changed(); setBody(e.target.value); }} />
      <div className="feed-composer-options"><button type="button" className="text-link" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>거래 내역 첨부 {advanced ? "닫기" : "추가"}</button><span className="fine-print num">{[...body].length} / {POST_LIMITS.bodyMax}</span></div>
      {advanced && <div className="feed-composer-advanced">
        {!!transactions.length && <Select label="빠른 글 거래 첨부" value={transaction} onChange={v => { changed(); setTransaction(v); }} options={[{ value: "", label: "첨부 안 함" }, ...transactions.map(t => ({ value: t.id, label: `${t.playerName} · ${t.type === "buy" ? "매입" : "매각"} · ${money(t.price)} P`, hint: dateText(t.date) }))]} />}
        {!transactions.length && <p className="fine-print">{scope === "player" ? "이 선수의 첨부 가능한 거래 내역이 없습니다." : "첨부 가능한 거래 내역이 없습니다."}</p>}
        {attachments.loading&&<small role="status">거래 내역을 확인하고 있습니다…</small>}
        {attachments.error&&<button type="button" className="text-link" onClick={attachments.reload}>거래 내역 다시 불러오기</button>}
        {attachments.hasMore&&<button type="button" className="text-link" onClick={attachments.loadMore}>이전 거래 더 불러오기</button>}
        {(() => { const t = transactions.find(x => x.id === transaction); return t ? <div className="attached-trade compact"><span className="attached-label"><Paperclip size={14} />첨부 미리보기</span><div className="attached-row"><span className={`trade-type ${t.type}`}>{t.type === "buy" ? "매입" : "매각"}</span><strong>{t.playerName}</strong><span className="num">{money(t.price)} P</span><span className="muted">{dateText(t.date)}</span><button type="button" className="attachment-remove" aria-label="빠른 글 거래 첨부 취소" onClick={() => { changed(); setTransaction(""); }}><X size={14}/>첨부 취소</button></div></div> : null; })()}
      </div>}
      <PollEditor value={poll} onChange={value=>{changed();setPoll(value);}} disabled={busy}/>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="feed-composer-foot"><span className="fine-print">내용 {POST_LIMITS.bodyMin}자 이상 · {scope === "club" ? "응원 구단에 게시" : "이 선수에 게시"}</span><button className="button primary small" disabled={busy || !title.trim() || !body.trim() || !selected}>{busy ? <LoaderCircle size={15} className="kx-spin" /> : <Send size={15} />}게시하기</button></div>
    </fieldset>
  </form>;
}
export function CommunityComposer(props: { scope: CommunityScope; target?: string; targetName?: string; onSaved: () => void }) {
  const { data, status, reload: reloadPlatform } = usePlatform();
  const [open, setOpen] = useState(false);
  const fan = props.scope === "player" || canPostToClub(data.session?.profile,props.target);
  const canWrite = !!data.session?.profile && fan && (props.scope === "club" || !!props.target);
  return <section className="feed-composer panel" aria-label={`${props.scope === "club" ? "구단" : "선수"} 빠른 글쓰기`}>
    {status !== "ready" ? <DataEmpty entity="커뮤니티" status={status} retry={reloadPlatform} rows={1} /> : !canWrite ? <div className="feed-composer-locked"><Lock size={16} aria-hidden="true" /><p>{!data.session ? "로그인하고 이야기를 나눠보세요." : !data.session.profile ? "프로필을 설정하면 이야기를 작성할 수 있습니다." : props.scope === "player" ? "선수 상세페이지에서 글쓰기를 시작해 주세요." : "게시글은 본진 구단에만 작성할 수 있습니다. 서브팀에서는 댓글과 투표에 참여할 수 있습니다."}</p><Link className="button secondary small" href={!data.session ? "/login" : "/mypage"}>{!data.session ? "로그인" : "프로필 설정"}</Link></div> : open ? <ComposerForm {...props} onSaved={() => { setOpen(false); props.onSaved(); }} onClose={() => setOpen(false)} /> : <button className="feed-composer-open" onClick={() => setOpen(true)}><UserAvatar className="rank-avatar" avatar={data.session?.profile?.avatar} seed={data.session?.userId ?? "guest"} /><span className="feed-composer-prompt">{props.target && props.targetName ? `${props.targetName}에 대한 이야기를 남겨보세요` : props.scope === "club" ? "응원 구단에 대한 이야기를 남겨보세요" : "선수에 대한 생각을 나눠보세요"}</span><span className="feed-composer-cta"><Pencil size={15} /></span></button>}
  </section>;
}

/** Compact bulletin board. Mutations remain on the post detail page. */
export function CommunityFeed({ scope, target, targetName, title = "게시글", compose = true, filter }: { scope: CommunityScope; target?: string; targetName?: string; title?: string; compose?: boolean; filter?: React.ReactNode }) {
  const { data, mock, status, reload: reloadPlatform, getTeam, getPlayer } = usePlatform();
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[sort,setSort]=useState('new'),[page,setPage]=useState(1);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
  const params=new URLSearchParams({scope,q:search,sort,page:String(page)});if(target)params.set('target',target);
  const remote=useResource(!mock&&status==='ready'?`/api/kickx/community?${params}`:null,emptyFeed);
  const local=data.posts.filter(p=>p.scope===scope&&(!target||p.target===target)&&`${p.title} ${p.body}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sort==='popular'?b.likes-a.likes:Date.parse(b.date)-Date.parse(a.date));
  const items=(mock?local.slice((page-1)*SIZE,page*SIZE):remote.data.items).filter(p=>p.scope===scope&&(!target||p.target===target));
  const total=mock?local.length:remote.data.total;
  const shownPage=mock?page:remote.data.page;
  const feedStatus=status!=='ready'?status:mock?status:remote.status;
  return <div className="community-feed" data-scope={scope}>
    {compose&&<CommunityComposer key={`${scope}:${target??'hub'}`} scope={scope} target={target} targetName={targetName} onSaved={()=>{setPage(1);remote.reload();}}/>}
    <section className="panel flush community-board" aria-label={`${scope==='club'?'구단':'선수'} 게시글 목록`}>
      <div className="post-browser-title"><h2>{title}{feedStatus==='ready'&&<span className="num">{money(total)}건</span>}</h2></div>
      <div className="toolbar post-tools">{filter}<label className="input-search"><Search size={16}/><input aria-label="게시글 검색" maxLength={100} value={query} placeholder="제목·내용 검색" onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label><Select label="게시글 정렬" value={sort} onChange={v=>{setSort(v);setPage(1);}} options={[{value:'new',label:'최신순'},{value:'popular',label:'추천순'}]} variant="compact"/></div>
      {feedStatus!=='ready'?<DataEmpty entity="게시글" status={feedStatus} retry={status==='ready'?remote.reload:reloadPlatform}/>:items.length?<div className="board-list-scroll"><table className="community-board-table"><thead><tr><th className="board-number">번호</th><th className="board-subject">제목</th><th>작성자</th><th>작성일</th><th className="board-views">조회</th><th className="board-likes">추천</th></tr></thead><tbody>
        {items.map((post,index)=>{
          const name=post.targetName||(scope==='club'?getTeam(post.target)?.name:getPlayer(post.target)?.name)||'—';
          // Club colour marks the row edge and the club chip so mixed boards scan by club.
          const club=scope==='club'?clubIdentity(getTeam(post.target)):null;
          const clubStyle=club?{'--club':luminance(club.primary)>0.8?club.secondary:club.primary} as CSSProperties:undefined;
          return <tr key={post.id} data-scope={post.scope} className={club&&!target?'has-club':''} style={clubStyle}><td className="board-number num">{total-(shownPage-1)*SIZE-index}</td>
            <td className="board-subject">{!target&&<Link className="board-target" href={`${COMMUNITY_PATHS[scope]}/${post.target}`}>{scope==='club'&&<ClubCrest id={post.target} size="small"/>}<span>{name}</span></Link>}
              <Link className="board-post-link" href={`/community/posts/${post.id}`}>{post.title||postTitle('',post.body)}{post.poll&&<span className="tag outline">투표</span>}{post.transaction&&<Paperclip size={13} aria-label="거래 첨부"/>}{post.commentCount>0&&<b className="board-comment-count num">[{post.commentCount}]</b>}</Link>
              <span className="board-mobile-meta"><Link href={`/community/authors/${post.authorId}`}><MemberName primaryTeam={post.authorPrimaryTeam} holdsPlayer={post.authorHoldsPlayer}>{post.author}</MemberName></Link> · {dateText(post.date,false)} · 조회 {money(post.views)} · 추천 {money(post.likes)}</span>
            </td><td className="board-author"><Link className="board-author-link" href={`/community/authors/${post.authorId}`}><UserAvatar className="rank-avatar" avatar={post.authorId===data.session?.userId?data.session?.profile?.avatar:post.authorAvatar} seed={post.authorId}/><MemberName primaryTeam={post.authorPrimaryTeam} holdsPlayer={post.authorHoldsPlayer}>{post.author}</MemberName></Link></td><td className="board-date"><time dateTime={post.date}>{dateText(post.date,false)}</time></td><td className="board-views num">{money(post.views)}</td><td className="board-likes num">{money(post.likes)}</td></tr>;
        })}
      </tbody></table></div>:<div className="feed-empty"><h3>{query?'조건에 맞는 게시글이 없습니다':'아직 게시글이 없습니다'}</h3><p>{query?'검색어를 바꿔보세요.':'첫 게시글을 작성해 보세요.'}</p></div>}
      {feedStatus==='ready'&&<Pagination page={shownPage} total={total} size={SIZE} onPage={setPage} label="게시글"/>}
    </section>
  </div>;
}
