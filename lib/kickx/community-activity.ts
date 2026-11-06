export type ActivityKind = 'posts' | 'comments';
export type CommunityActivity = {
  author: { id: string; nickname: string; avatar: string | null;primaryTeam?:string|null } | null;
  items: { id: string; postId: string; title: string; body: string; date: string; reply: boolean; scope: 'club' | 'player'; target: string; targetName: string | null }[];
  total: number; page: number; size: number; postCount: number; commentCount: number;
};
export const emptyActivity = (): CommunityActivity => ({ author: null, items: [], total: 0, page: 1, size: 20, postCount: 0, commentCount: 0 });
export function activityHref(postId: string, commentId?: string | null) {
  const path = `/community/posts/${encodeURIComponent(postId)}`;
  return commentId ? `${path}?comment=${encodeURIComponent(commentId)}#comment-${encodeURIComponent(commentId)}` : path;
}
export function parseActivityQuery(params: URLSearchParams) {
  const author = params.get('author'), kind = params.get('kind') ?? 'posts', page = params.get('page') ?? '1';
  if (author !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(author)) throw Error('작성자 주소를 확인해 주세요.');
  if (kind !== 'posts' && kind !== 'comments') throw Error('활동 종류를 확인해 주세요.');
  if (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 10000) throw Error('페이지 범위를 확인해 주세요.');
  return { author, kind: kind as ActivityKind, page: Number(page) };
}
