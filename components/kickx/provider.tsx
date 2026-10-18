"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { emptyAdminData, emptyPlatformData } from "@/lib/kickx/data";
import { apiRequest } from "@/lib/kickx/client";
import type { DataResponse, DataSource, DataStatus, PlatformData, Profile, Player } from "@/lib/kickx/types";
export function useResource<T>(url: string | null, initial: () => T, refreshMs = 0) {
  const [snapshot,setSnapshot]=useState<{url:string|null;data:T;status:DataStatus;source:DataSource|null}>(()=>({url:null,data:initial(),status:'loading',source:null}));
  const setData=useCallback((next:SetStateAction<T>)=>setSnapshot(current=>({...current,data:typeof next==='function'?(next as (value:T)=>T)(current.data):next})),[]);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(a => a + 1), []);
  useEffect(() => {
    if (!url) {setSnapshot({url:null,data:initial(),status:'loading',source:null});return;}
    const controller = new AbortController();
    // Reload the same data in the background. A new search still gets an
    // explicit loading state, and old requests cannot commit after navigation.
    setSnapshot(current=>current.url===url&&current.status==='ready'?current:{url,data:initial(),status:'loading',source:null});
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response=await fetch(url, { signal: controller.signal, cache: "no-store", credentials: "same-origin" });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (!controller.signal.aborted) setSnapshot({url,data:initial(),status:response.status === 401 ? "unauthorized" : "forbidden",source:null});
            return;
          }
          throw new Error("Request failed");
        }
        const result=await response.json() as DataResponse<T>;
        if (!["ready", "not-configured"].includes(result.status) || !result.data) throw new Error("Invalid response");
        if (!controller.signal.aborted) setSnapshot({url,data:result.data,status:result.status,source:result.status === "ready" ? result.source ?? "database" : null});
      } catch { if (!controller.signal.aborted) setSnapshot({url,data:initial(),status:'error',source:null}); }
      finally { inFlight = false; }
    };
    void refresh();
    const visibleRefresh=()=>{if(document.visibilityState === "visible")void refresh();};
    const timer=refreshMs>0?setInterval(visibleRefresh,refreshMs):null;
    if(refreshMs>0)document.addEventListener("visibilitychange",visibleRefresh);
    return () => { controller.abort(); if(timer)clearInterval(timer);document.removeEventListener("visibilitychange",visibleRefresh); };
  }, [url, attempt, initial, refreshMs]);
  // A route/account change must never expose the previous resource's data while
  // its effect is still starting, even for a single render.
  const current=snapshot.url===url;
  return { data:current?snapshot.data:initial(), status:current?snapshot.status:'loading' as DataStatus, source:current?snapshot.source:null, reload, setData };
}
type Notice = { message: string; kind: "success" | "error" };
type PlatformContext = {
  cachedPlayers: Player[]; cachePlayers: (players: Player[]) => void;
  data: PlatformData; status: DataStatus; reload: () => void;
  /** True while the server returns development sample data. Writes stay local and are labeled. */
  mock: boolean;
  pendingWatch: string[]; setWatched: (id: string, watched: boolean) => Promise<void>;
  updateProfile: (profile: Profile) => void;
  notify: (message: string, kind?: Notice["kind"]) => void;
};
const Context = createContext<PlatformContext | null>(null);
export function PlatformProvider({ children }: { children: ReactNode }) {
  const { data, status, source, reload, setData } = useResource("/api/kickx", emptyPlatformData, 30000);
  const mock = source === "mock";
  const [cachedPlayers,setCachedPlayers]=useState<Player[]>([]);
  const cachePlayers=useCallback((players:Player[])=>setCachedPlayers(current=>{
    if(!players.length) return current;
    const ids=new Set(players.map(p=>p.id));
    return [...current.filter(p=>!ids.has(p.id)),...players].slice(-200);
  }),[]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingWatch, setPendingWatch] = useState<string[]>([]);
  const locks = useRef(new Set<string>());
  const notify = useCallback((message: string, kind: Notice["kind"] = "success") => setNotice({ message, kind }), []);
  useEffect(() => {
    try { localStorage.removeItem("kickx-ui-demo-v1"); } catch { /* No fallback demo state. */ }
  }, []);
  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const setWatched = useCallback(async (id: string, watched: boolean) => {
    if (!data.session || status !== "ready" || locks.current.has(id)) return;
    const userId = data.session.userId;
    const apply = () => setData(current => {
      if (current.session?.userId !== userId || !current.member) return current;
      const watchlist = current.member.watchlist.filter(value => value !== id);
      if (watched) watchlist.push(id);
      return { ...current, member: { ...current.member, watchlist } };
    });
    if (mock) {
      apply();
      notify(`${watched ? "관심 선수에 추가했습니다." : "관심 선수에서 해제했습니다."} (예시 모드 · 저장되지 않음)`);
      return;
    }
    locks.current.add(id); setPendingWatch([...locks.current]);
    try {
      const result = await apiRequest<{ playerId: string; watched: boolean }>("/api/kickx/watchlist", "PUT", { playerId: id, watched });
      if (result.playerId !== id || result.watched !== watched) throw new Error("저장 상태를 확인하지 못했습니다. 새로고침 후 확인해 주세요.");
      apply();
      notify(watched ? "관심 선수에 추가했습니다." : "관심 선수에서 해제했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "관심 선수를 저장하지 못했습니다.", "error");
    } finally { locks.current.delete(id); setPendingWatch([...locks.current]); }
  }, [data.session, status, mock, setData, notify]);
  const updateProfile = useCallback((profile: Profile) => {
    setData(current => current.session ? { ...current, session: { ...current.session, profile } } : current);
  }, [setData]);
  const value = useMemo(() => ({ cachedPlayers, cachePlayers, data, status, reload, mock, pendingWatch, setWatched, updateProfile, notify }), [cachedPlayers, cachePlayers, data, status, reload, mock, pendingWatch, setWatched, updateProfile, notify]);
  return (
    <Context.Provider value={value}>
      {children}
      <div className="kx-notice-region" aria-live="polite" aria-atomic="true">
        {notice && (
          <div className={"kx-toast " + notice.kind}>
            {notice.kind === "error" ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
            <span>{notice.message}</span>
            <button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)}><X size={18} /></button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
export function usePlatform() {
  const context = useContext(Context);
  if (!context) throw new Error("PlatformProvider is required");
  return useMemo(() => ({
    ...context,
    getPlayer: (id: string | null | undefined) => context.data.member?.ownedPlayers?.find(p => p.id === id) || context.cachedPlayers.find(p => p.id === id) || context.data.players.find(p => p.id === id),
    getTeam: (id: string | null | undefined) => context.data.teams.find(t => t.id === id),
    getLeague: (id: string | null | undefined) => context.data.leagues.find(l => l.id === id),
  }), [context]);
}
export function useAdminData() {
  const { data, status, reload } = useResource("/api/kickx/admin", emptyAdminData);
  return { data, status, reload };
}
