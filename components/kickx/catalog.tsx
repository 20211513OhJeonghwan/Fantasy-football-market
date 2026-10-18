"use client";
import { useEffect, useRef, useState } from "react";
import type { Fixture, Player } from "@/lib/kickx/types";
import { usePlatform, useResource } from "./provider";
type Page<T> = {items:T[];total:number;page:number;size:number};
const emptyPlayers=():Page<Player>=>({items:[],total:0,page:1,size:12});
const emptyFixtures=():Page<Fixture>=>({items:[],total:0,page:1,size:20});
const emptyDetail=()=>({player:null as Player|null});
export function useCatalogPage<T extends Player|Fixture>(kind:"players"|"fixtures",params:Record<string,string|number|undefined>) {
  const {status,mock,cachePlayers,data}=usePlatform();
  const search=String(params.q??'');
  const [settledSearch,setSettledSearch]=useState(search);
  useEffect(()=>{if(search===settledSearch)return;const timer=setTimeout(()=>setSettledSearch(search),250);return()=>clearTimeout(timer);},[search,settledSearch]);
  const settled=new URLSearchParams(Object.entries({...params,q:settledSearch}).filter(([,v])=>v != null && v !== "" && v !== "all").map(([k,v])=>[k,String(v)])).toString();
  const privateScope=params.scope==='watch'||params.scope==='owned';
  // Public lists have their own validated endpoint and need not wait for the
  // dashboard, ranking, community and member bootstrap to finish.
  const enabled=!mock && (status==='ready'||status==='loading'&&!privateScope);
  const resource=useResource<Page<T>>(enabled ? `/api/kickx/${kind}?${settled}` : null, (kind === "players" ? emptyPlayers : emptyFixtures) as ()=>Page<T>,30000);
  const revision=data.member?.watchlist.join(",") ?? "";
  const reload=resource.reload, scope=params.scope;
  const previousWatch=useRef<string|null>(null);
  useEffect(()=>{
    if(!enabled||kind!=='players'||scope!=='watch'){previousWatch.current=null;return;}
    if(previousWatch.current!==null&&previousWatch.current!==revision)reload();
    previousWatch.current=revision;
  },[revision,enabled,kind,scope,reload]);
  useEffect(()=>{if(kind === "players" && resource.status === "ready" && resource.source !== 'mock') cachePlayers(resource.data.items as Player[]);},[kind,resource.status,resource.source,resource.data,cachePlayers]);
  return {...resource,enabled,status:enabled && (search !== settledSearch || resource.source === 'mock' && !mock) ? "loading" as const : resource.status};
}
export function useCatalogPlayer(id: string | null) {
  const {getPlayer,status,mock,cachePlayers}=usePlatform();
  const enabled=!!id && !mock && (status === "ready" || status === "loading");
  const resource=useResource(enabled ? `/api/kickx/players/${encodeURIComponent(id!)}` : null,emptyDetail,30000);
  useEffect(()=>{if(resource.status === "ready" && resource.source !== 'mock' && resource.data.player) cachePlayers([resource.data.player]);},[resource.status,resource.source,resource.data,cachePlayers]);
  const waitingForMock=enabled && resource.source === 'mock' && !mock;
  return {player:waitingForMock?null:enabled ? resource.data.player : getPlayer(id),status:waitingForMock?'loading' as const:enabled ? resource.status : status,reload:resource.reload};
}
