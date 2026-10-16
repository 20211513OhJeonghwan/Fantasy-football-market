"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CornerDownRight, Flag, Heart, Lock, MessageCircle, Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import type { Comment, Post } from "@/lib/kickx/types";
import { apiRequest } from "@/lib/kickx/client";
import { dateText, money, relativeTime } from "@/lib/kickx/data";
import {postHeading} from "@/lib/kickx/community";
import { usePlatform, useResource } from "./provider";
import { BackLink, ClubCrest, DataEmpty, Empty, Modal, PlayerPortrait } from "./ui";

const COMMENT_PAGE = 50;
const COMMENT_MAX = 1000;
export const emptyPost = () => ({ post: null as Post | null, comments: [] as Comment[] });
export function usePost(id: string | null, page = 1) {
  const { data, mock, status } = usePlatform();
  const remote = useResource(!mock && status === "ready" && id ? `/api/kickx/community?postId=${encodeURIComponent(id)}&page=${page}` : null, emptyPost);
  return {
    ...remote,
    data: mock ? { post: data.posts.find((p) => p.id === id) ?? null, comments: data.comments.filter((c) => c.postId === id) } : remote.data,
    status: mock ? status : remote.status,
  };
}
/** Top-level comments followed by their replies; replies whose parent is not on this page stay visible on their own. */
function threads(comments: Comment[]) {
  const top = comments.filter((c) => !c.parentId);
  const ids = new Set(top.map((c) => c.id));
  const rows: { comment: Comment; reply: boolean; orphan: boolean }[] = [];
  for (const c of top) {
    rows.push({ comment: c, reply: false, orphan: false });
    for (const r of comments.filter((x) => x.parentId === c.id)) rows.push({ comment: r, reply: true, orphan: false });
  }
  for (const r of comments.filter((c) => c.parentId && !ids.has(c.parentId))) rows.push({ comment: r, reply: true, orphan: true });
  return rows;
}
type Action = { kind: "report" | "deletePost" | "deleteComment"; comment?: Comment };
export function PostDetail() {
  const { postId } = useParams<{ postId: string }>(), router = useRouter();
  const { data, mock, notify, getTeam, getPlayer, reload: reloadPlatform } = usePlatform();
  const [page, setPage] = useState(1);
  const resource = usePost(postId, page);
  const { post, comments } = resource.data;
  const [body, setBody] = useState(""), [reply, setReply] = useState<Comment | null>(null), [editing, setEditing] = useState<Comment | null>(null), [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null), [reason, setReason] = useState("");
  const lock = useRef(false), requestId = useRef("");
  const owner = !!post && post.authorId === data.session?.userId;
  const fan = post?.scope === "player" || data.session?.profile?.team === post?.target;
  const canWrite = !!data.session?.profile && fan;
  const lounge = post ? `/community/${post.scope === "club" ? "clubs" : "players"}/${post.target}` : "/community/clubs";
  const hub = post?.scope === "player" ? "/community/players" : "/community/clubs";
  const targetPlayer = post?.scope === "player" ? getPlayer(post.target) : undefined;
  const targetName = post ? post.targetName ?? (post.scope === "club" ? getTeam(post.target)?.name : targetPlayer?.name) ?? null : null;
  const pages = Math.max(1, Math.ceil((post?.commentCount ?? 0) / COMMENT_PAGE));
  useEffect(() => {
    if (!mock && post && data.session?.profile) void apiRequest("/api/kickx/community", "POST", { action: "view", postId: post.id }).catch(() => {});
  }, [mock, post, data.session?.profile]);
  async function mutate(payload: Record<string, unknown>) {
    if (lock.current) return false;
    if (mock) { notify("예시 모드 · 실제로 저장되지 않습니다."); return false; }
    lock.current = true; setBusy(true);
    try { await apiRequest("/api/kickx/community", "POST", { postId, ...payload }); resource.reload(); return true; }
    catch (e) { notify(e instanceof Error ? e.message : "저장하지 못했습니다.", "error"); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  function resetForm() { setBody(""); setReply(null); setEditing(null); requestId.current = ""; }
  async function submitComment() {
    requestId.current ||= crypto.randomUUID();
    const payload = editing
      ? { action: "editComment", commentId: editing.id, revision: editing.revision, body }
      : { action: "comment", parentId: reply?.id, body, requestId: requestId.current };
    if (await mutate(payload)) { resetForm(); notify(editing ? "댓글을 수정했습니다." : "댓글을 등록했습니다."); }
  }
  async function confirm() {
    if (!action) return;
    const payload = action.kind === "report"
      ? { action: "report", commentId: action.comment?.id, reason }
      : { action: action.kind, commentId: action.comment?.id, revision: action.comment?.revision ?? post?.revision };
    if (await mutate(payload)) {
      // Lounge post counts live in the bootstrap data; refresh them when a post disappears.
      if (action.kind === "deletePost") { reloadPlatform(); router.push(lounge); }
      notify(action.kind === "report" ? "신고를 접수했습니다." : "삭제했습니다.");
      setAction(null); setReason("");
    }
  }
  function startReply(c: Comment) { setReply(c); setEditing(null); setBody(""); requestId.current = ""; document.getElementById("comment-body")?.focus(); }
  function startEdit(c: Comment) { setEditing(c); setReply(null); setBody(c.body); document.getElementById("comment-body")?.focus(); }

  if (!post) {
    return (
      <div className="reading-width">
        <BackLink href="/community" label="커뮤니티" />
        <article className="article">
          {resource.status === "ready"
            ? <Empty title="게시글을 찾을 수 없습니다" description="삭제되었거나 주소가 올바르지 않습니다." action={<Link className="button primary small" href="/community">커뮤니티로</Link>} />
            : <DataEmpty entity="게시글" status={resource.status} retry={resource.reload} />}
        </article>
      </div>
    );
  }
  const reasonLength = reason.trim().length;
  return (
    <div className="reading-width">
      <BackLink href={lounge} label={targetName ? `${targetName} 라운지` : "커뮤니티"} />
      <article className="article">
        <div className="article-crumbs">
          <Link href={hub}>{post.scope === "club" ? "구단 커뮤니티" : "선수 커뮤니티"}</Link>
          <span aria-hidden="true">›</span>
          <Link href={lounge} className="article-target">
            {post.scope === "club" ? <ClubCrest id={post.target} size="small" /> : targetPlayer ? <PlayerPortrait player={targetPlayer} size="sm" /> : null}
            {targetName || "—"}
          </Link>
        </div>
        <h1>{postHeading(post.title,post.body) || `${targetName ?? (post.scope === "club" ? "구단" : "선수")} 이야기`}</h1>
        <div className="article-author">
          <span className="rank-avatar">{post.author.slice(0, 1)}</span>
          <div>
            <strong>{post.author}</strong>
            <span>{dateText(post.date)} · 조회 {money(post.views)}</span>
          </div>
          {owner && (
            <div className="button-row">
              <Link className="icon-button" href={`/community/write?edit=${post.id}`} aria-label="글 수정" title="글 수정"><Pencil size={17} /></Link>
              <button className="icon-button" aria-label="글 삭제" title="글 삭제" onClick={() => setAction({ kind: "deletePost" })}><Trash2 size={17} /></button>
            </div>
          )}
        </div>
        <div className="article-body">{post.body}</div>
        {post.transaction && (
          <div className="attached-trade">
            <span className="attached-label"><Paperclip size={14} />작성자의 거래 첨부</span>
            <div className="attached-row">
              <span className={`trade-type ${post.transaction.type}`}>{post.transaction.type === "buy" ? "매입" : "매각"}</span>
              <strong>{post.transaction.playerName}</strong>
              <span className="num">{money(post.transaction.price)} P</span>
              <span className="muted">{dateText(post.transaction.date)}</span>
            </div>
          </div>
        )}
        <div className="article-actions">
          <button
            className={`like-button ${post.liked ? "on" : ""}`}
            disabled={!data.session || busy}
            aria-pressed={!!post.liked}
            aria-label={`공감 ${post.likes}`}
            title={data.session ? undefined : "로그인 후 공감할 수 있습니다."}
            onClick={() => void mutate({ action: "like", liked: !post.liked })}
          >
            <Heart size={18} fill={post.liked ? "currentColor" : "none"} />공감 <b className="num">{money(post.likes)}</b>
          </button>
          <button className="button ghost small" aria-label="게시글 신고" disabled={!data.session} onClick={() => setAction({ kind: "report" })}><Flag size={15} />신고</button>
        </div>
      </article>

      <section className="comments">
        <h2 className="comments-title"><MessageCircle size={20} />댓글 <span className="num">{money(post.commentCount)}</span></h2>
        {canWrite ? (
          <form className={`comment-form ${reply || editing ? "targeted" : ""}`} onSubmit={(e) => { e.preventDefault(); void submitComment(); }}>
            {(reply || editing) && (
              <div className="comment-target">
                {editing ? <><Pencil size={14} />내 댓글 수정 중</> : <><CornerDownRight size={14} /><b>{reply?.author}</b>님에게 답글</>}
                <button type="button" className="icon-button" aria-label="답글·수정 취소" onClick={resetForm}><X size={15} /></button>
              </div>
            )}
            <label className="sr-only" htmlFor="comment-body">댓글 내용</label>
            <textarea id="comment-body" value={body} disabled={busy} maxLength={COMMENT_MAX} rows={3}
              onChange={(e) => { setBody(e.target.value); requestId.current = ""; }}
              placeholder={reply ? "답글을 입력하세요" : "근거 있는 의견을 남겨주세요"} />
            <div className="comment-form-foot">
              <span className={`fine-print num ${body.length > COMMENT_MAX * 0.9 ? "warn" : ""}`}>{body.length} / {COMMENT_MAX}</span>
              <button className="button primary small" disabled={busy || !body.trim()}><Send size={15} />{editing ? "수정 저장" : reply ? "답글 등록" : "댓글 등록"}</button>
            </div>
          </form>
        ) : (
          <div className="comment-locked">
            <Lock size={16} />
            {!data.session
              ? <span>로그인한 회원만 댓글을 작성할 수 있습니다. <Link className="text-link" href="/login">로그인</Link></span>
              : !data.session.profile
                ? <span>프로필을 만든 뒤 댓글을 작성할 수 있습니다. <Link className="text-link" href="/mypage">프로필 설정</Link></span>
                : <span>구단 라운지의 댓글은 <b>{targetName}</b> 응원 팬만 작성할 수 있습니다. 읽기는 누구나 가능합니다.</span>}
          </div>
        )}
        <ul className="comment-list">
          {threads(comments).map(({ comment: c, reply: isReply, orphan }) => {
            const mine = c.authorId === data.session?.userId;
            return (
              <li className={`comment ${isReply ? "reply" : ""} ${editing?.id === c.id ? "editing" : ""}`} key={c.id}>
                {isReply && <CornerDownRight size={16} className="comment-reply-mark" aria-hidden="true" />}
                <span className="rank-avatar">{c.author.slice(0, 1)}</span>
                <div>
                  <div className="comment-head">
                    <strong>{c.author}</strong>
                    {c.authorId === post.authorId && <span className="tag yellow">작성자</span>}
                    <time dateTime={c.date} title={dateText(c.date)}>{relativeTime(c.date)}</time>
                  </div>
                  {orphan && <p className="comment-orphan">삭제되었거나 다른 페이지에 있는 댓글의 답글입니다.</p>}
                  <p>{c.body}</p>
                  <div className="comment-actions">
                    {canWrite && !isReply && <button onClick={() => startReply(c)}><CornerDownRight size={13} />답글</button>}
                    {mine && <button onClick={() => startEdit(c)}><Pencil size={13} />수정</button>}
                    {mine && <button onClick={() => setAction({ kind: "deleteComment", comment: c })}><Trash2 size={13} />삭제</button>}
                    {data.session && !mine && <button onClick={() => setAction({ kind: "report", comment: c })}><Flag size={13} />신고</button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {!comments.length && <p className="comment-empty">{resource.status === "ready" ? "첫 댓글을 남겨보세요." : "댓글을 불러오고 있습니다."}</p>}
        {pages > 1 && (
          <div className="pagination comment-pages">
            <span>댓글 {money(post.commentCount)}개</span>
            <div>
              <button aria-label="이전 댓글 페이지" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button>
              <span className="num">{page} / {pages}</span>
              <button aria-label="다음 댓글 페이지" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button>
            </div>
          </div>
        )}
      </section>

      {action && (
        <Modal
          title={action.kind === "report" ? (action.comment ? "댓글 신고" : "게시글 신고") : action.kind === "deletePost" ? "게시글 삭제" : "댓글 삭제"}
          onClose={() => setAction(null)}
        >
          {action.kind === "report" ? (
            <>
              {action.comment && <blockquote className="report-quote">{action.comment.body}</blockquote>}
              <label className="modal-field">
                신고 사유
                <textarea value={reason} minLength={5} maxLength={500} rows={4} onChange={(e) => setReason(e.target.value)} placeholder="어떤 점이 문제인지 구체적으로 적어주세요" aria-describedby="report-count" />
              </label>
              <p id="report-count" className={`fine-print num ${reasonLength > 0 && reasonLength < 5 ? "warn" : ""}`}>{reasonLength} / 500 · 최소 5자</p>
              <p className="fine-print">신고는 관리자가 검토하며, 같은 대상은 처리 전까지 한 번만 신고할 수 있습니다.</p>
            </>
          ) : (
            <p>{action.kind === "deletePost" ? "삭제한 글은 목록과 라운지에서 사라지며 되돌릴 수 없습니다." : "삭제한 댓글은 다시 볼 수 없습니다."}</p>
          )}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setAction(null)}>취소</button>
            <button className={`button ${action.kind === "report" ? "primary" : "danger"}`} disabled={busy || (action.kind === "report" && reasonLength < 5)} onClick={() => void confirm()}>
              {action.kind === "report" ? "신고 제출" : "삭제"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
