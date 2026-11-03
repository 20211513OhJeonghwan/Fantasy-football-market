import type { MatchReport } from './match-report';

export type ReportLoadState = {
  report: MatchReport | null;
  loading: boolean;
  generating: boolean;
  error: string;
};
export const emptyReportLoad = (): ReportLoadState => ({ report: null, loading: true, generating: false, error: '' });
type Listener = (state: ReportLoadState) => void;

/** One bounded request per opened report, shared only within the signed-in account. */
export function createReportLoader({ fetcher = fetch, now = Date.now, getTimeoutMs = 10000, postTimeoutMs = 35000 } = {}) {
  const cache = new Map<string, { at: number; report: MatchReport }>();
  const inFlight = new Map<string, { state: ReportLoadState; listeners: Set<Listener> }>();
  async function request(url: string, method: 'GET' | 'POST'): Promise<MatchReport> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('리포트 응답이 지연되고 있습니다. 잠시 후 다시 확인해 주세요.'));
      }, method === 'GET' ? getTimeoutMs : postTimeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetcher(url, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : '리포트를 불러오지 못했습니다.');
        if (!result || !['ready', 'missing', 'pending', 'cooldown', 'limited', 'unavailable'].includes(result.status) || typeof result.canGenerate !== 'boolean')
          throw new Error('리포트 응답을 확인하지 못했습니다. 다시 확인해 주세요.');
        return result as MatchReport;
      })()]);
    } finally { clearTimeout(timer); }
  }
  function subscribe(userId: string, url: string, listener: Listener): () => void {
    const key = `${userId}:${url}`;
    const saved = cache.get(key);
    if (saved && now() - saved.at < 60000) {
      listener({ report: saved.report, loading: false, generating: false, error: '' });
      return () => {};
    }
    cache.delete(key);
    let running = inFlight.get(key);
    if (!running) {
      const entry = { state: emptyReportLoad(), listeners: new Set<Listener>() };
      inFlight.set(key, entry);
      running = entry;
      const emit = (state: ReportLoadState) => { entry.state = state; entry.listeners.forEach(notify => notify(state)); };
      void (async () => {
        try {
          let report = await request(url, 'GET');
          const generate = report.status === 'missing' && report.canGenerate;
          // Numerical facts must render before the model finishes, even on a slow free-tier response.
          emit({ report, loading: false, generating: generate, error: '' });
          if (generate) {
            try { report = await request(url, 'POST'); }
            catch {
              emit({ report, loading: false, generating: false, error: 'AI 설명 작성이 지연되고 있습니다. 저장된 산정 요약을 먼저 확인해 주세요.' });
              return;
            }
          }
          if (report.status === 'ready') {
            if (cache.size >= 40) cache.delete(cache.keys().next().value!);
            cache.set(key, { at: now(), report });
          }
          emit({ report, loading: false, generating: false, error: '' });
        } catch (error) {
          emit({ report: null, loading: false, generating: false, error: error instanceof Error ? error.message : '리포트를 불러오지 못했습니다.' });
        } finally { inFlight.delete(key); }
      })();
    }
    running.listeners.add(listener);
    listener(running.state);
    const entry = running;
    // Closing a dialog detaches its UI; an already claimed generation can finish once and be cached.
    return () => { entry.listeners.delete(listener); };
  }
  return { subscribe };
}
