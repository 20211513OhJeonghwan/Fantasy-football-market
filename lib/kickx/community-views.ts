type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export const viewDay = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
/** Strict Mode/remounts share pending requests; a bounded per-tab journal also survives reloads. */
export function createViewRecorder(send: (postId: string) => Promise<unknown>, storage?: () => StorageLike | undefined, clock = () => Date.now()) {
  const entries = new Map<string, { pending?: Promise<void>; done?: boolean; retryAt?: number }>();
  const journalKey = 'kickx-community-views-v1';
  function read(): string[] {
    try { const value: unknown = JSON.parse(storage?.()?.getItem(journalKey) ?? '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(-200) : []; } catch { return []; }
  }
  return (userId: string, postId: string, day = viewDay(new Date(clock()))) => {
    const key = `${userId}:${postId}:${day}`, previous = entries.get(key);
    if (previous?.pending) return previous.pending;
    if (previous?.done || (previous?.retryAt ?? 0) > clock() || read().includes(key)) return Promise.resolve();
    const pending = Promise.resolve().then(() => send(postId)).then(() => {
      entries.set(key, { done: true });
      try { storage?.()?.setItem(journalKey, JSON.stringify([...read().filter(v => v.endsWith(day) && v !== key), key].slice(-200))); } catch { /* In-memory deduplication still applies. */ }
    }).catch(() => { entries.set(key, { retryAt: clock() + 30000 }); }).finally(() => {
      if (entries.size > 200) for (const [id, value] of entries) { if (!value.pending) entries.delete(id); if (entries.size <= 200) break; }
    });
    entries.set(key, { pending });
    return pending;
  };
}
