"use client";
import { useEffect, useState } from "react";
import type { Fixture, Player } from "@/lib/kickx/types";
import { usePlatform, useResource } from "./provider";
type Page<T> = {items:T[];total:number;page:number;size:number};
const emptyPlayers=():Page<Player>=>({items:[],total:0,page:1,size:12});
const emptyFixtures=():Page<Fixture>=>({items:[],total:0,page:1,size:20});
const emptyDetail=()=>({player:null as Player|null});
export function useCatalogPage<T extends Player|Fixture>(kind:"players"|"fixtures",params:Record<string,string|number|undefined>) {
  const {status,mock,cachePlayers,data}=usePlatform();
  const encoded=new URLSearchParams(Object.entries(params).filter(([,v])=>v != null && v !== "" && v !== "all").map(([k,v])=>[k,String(v)])).toString();
  const [settled,setSettled]=useState(encoded);
  useEffect(()=>{const timer=setTimeout(()=>setSettled(encoded),250);return()=>clearTimeout(timer);},[encoded]);
  const enabled=status === "ready" && !mock;
  const resource=useResource<Page<T>>(enabled ? `/api/kickx/${kind}?${settled}` : null, (kind === "players" ? emptyPlayers : emptyFixtures) as ()=>Page<T>,30000);
  const revision=data.member?.watchlist.join(",") ?? "";
  const reload=resource.reload, scope=params.scope;
  useEffect(()=>{if(enabled && kind === "players" && scope === "watch") reload();},[revision,enabled,kind,scope,reload]);
  useEffect(()=>{if(kind === "players" && resource.status === "ready") cachePlayers(resource.data.items as Player[]);},[kind,resource.status,resource.data,cachePlayers]);
  return {...resource,enabled,status:enabled && settled !== encoded ? "loading" as const : resource.status};
}
export function useCatalogPlayer(id: string | null) {
  const {getPlayer,status,mock,cachePlayers}=usePlatform();
  const enabled=!!id && status === "ready" && !mock;
  const resource=useResource(enabled ? `/api/kickx/players/${encodeURIComponent(id!)}` : null,emptyDetail,30000);
  useEffect(()=>{if(resource.status === "ready" && resource.data.player) cachePlayers([resource.data.player]);},[resource.status,resource.data,cachePlayers]);
  return {player:enabled ? resource.data.player : getPlayer(id),status:enabled ? resource.status : status,reload:resource.reload};
}
