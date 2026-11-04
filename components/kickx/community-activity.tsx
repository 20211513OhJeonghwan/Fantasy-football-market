'use client';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useParams } from 'next/navigation';
import { MessageCircle, FileText } from 'lucide-react';
import { activityHref, emptyActivity, type ActivityKind } from '@/lib/kickx/community-activity';
import { dateText, money } from '@/lib/kickx/data';
import { usePlatform, useResource } from './provider';
import { UserAvatar } from './avatar';
import { Pagination } from './pagination';
import { BackLink, DataEmpty, PageHeading } from './ui';

export function CommunityActivityPanel({ authorId }: { authorId?: string }) {
  const { data, status } = usePlatform();
  const [kind, setKind] = useState<ActivityKind>('posts'), [page, setPage] = useState(1);
  const id = useId(), own = !authorId || authorId === data.session?.userId;
  const params = new URLSearchParams({ kind, page: String(page) });
  if (authorId) params.set('author', authorId);
  const enabled = !!authorId || status === 'ready' && !!data.session?.profile;
  const resource = useResource(enabled ? `/api/kickx/community/activity?${params}` : null, emptyActivity);
  const activity = resource.data;
  const choices = [{ value: 'posts' as const, label: own ? '내 글' : '게시글', count: activity.postCount, icon: FileText }, { value: 'comments' as const, label: own ? '내 댓글' : '댓글·답글', count: activity.commentCount, icon: MessageCircle }];
  function select(next: ActivityKind) { setKind(next); setPage(1); }
  if (!authorId && !data.session) return <section className="panel community-activity"><h2>내 커뮤니티 활동</h2><p>로그인하면 내가 쓴 글과 댓글을 모아볼 수 있습니다.</p><Link className="button secondary small" href="/login?next=/mypage">로그인</Link></section>;
  return <section className="panel flush community-activity" aria-label={own ? '내 커뮤니티 활동' : '작성자 활동'}>
    <header className="activity-heading">
      {authorId && activity.author ? <><UserAvatar className="rank-avatar" avatar={own ? data.session?.profile?.avatar ?? activity.author.avatar : activity.author.avatar} seed={activity.author.id} /><div><h2>{activity.author.nickname}</h2><p>공개된 게시글과 댓글·답글입니다.</p></div></> : <div><h2>내 커뮤니티 활동</h2><p>내가 쓴 글과 참여한 대화를 모아보세요.</p></div>}
    </header>
    <div className="activity-tabs" role="tablist" aria-label="커뮤니티 활동 종류">
      {choices.map(({ value, label, count, icon: Icon }, index) => <button key={value} id={`${id}-${value}`} role="tab" aria-selected={kind === value} aria-controls={`${id}-panel`} tabIndex={kind === value ? 0 : -1} onClick={() => select(value)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = choices[1 - index].value; select(next); document.getElementById(`${id}-${next}`)?.focus(); } }}><Icon size={16} />{label}<span className="num">{resource.status === 'ready' ? money(count) : '—'}</span></button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${kind}`} className="activity-panel" tabIndex={0}>
      {resource.status !== 'ready' ? <DataEmpty entity="커뮤니티 활동" status={resource.status} retry={resource.reload} rows={2} /> : !activity.author ? <p className="activity-empty">작성자를 찾을 수 없습니다.</p> : !activity.items.length ? <p className="activity-empty">{kind === 'posts' ? '아직 공개된 게시글이 없습니다.' : '아직 공개된 댓글·답글이 없습니다.'}</p> : <ul className="activity-list">{activity.items.map(item => <li key={item.id}><Link href={activityHref(item.postId, kind === 'comments' ? item.id : null)}>
        <div className="activity-item-meta"><span className="tag">{item.targetName ?? (item.scope === 'club' ? '구단 이야기' : '선수 이야기')}</span>{kind === 'comments' && <span>{item.reply ? '답글' : '댓글'}</span>}<time dateTime={item.date}>{dateText(item.date)}</time></div>
        <strong>{item.title}</strong><p>{item.body}</p>
      </Link></li>)}</ul>}
    </div>
    {resource.status === 'ready' && <Pagination page={activity.page} total={activity.total} size={activity.size} onPage={setPage} label="활동" centered allowJump />}
  </section>;
}

export function AuthorActivityScreen() {
  const { userId } = useParams<{ userId: string }>();
  return <div className="reading-width"><BackLink href="/community/clubs" label="구단 커뮤니티" /><PageHeading eyebrow="COMMUNITY" title="작성자 활동" /><CommunityActivityPanel key={userId} authorId={userId} /></div>;
}
