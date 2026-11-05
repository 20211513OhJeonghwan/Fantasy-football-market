"use client";
import {useEffect,useState} from 'react';
import type {Transaction} from '@/lib/kickx/types';
import {attachmentTrades,type CommunityScope} from '@/lib/kickx/community';
import {usePlatform,useResource} from './provider';
const empty=()=>({items:[] as Transaction[],total:0,page:1,size:50});

/** Read on demand, filtered by player on the server. Old trades need not be in the member preview. */
export function usePostTradeAttachments(scope:CommunityScope,target:string,enabled:boolean){
 const {data,mock}=usePlatform();
 const [page,setPage]=useState(1),[history,setHistory]=useState<{key:string;items:Transaction[]}>({key:'',items:[]});
 const key=`${data.session?.userId??'guest'}:${scope}:${target}`;
 const active=enabled&&!mock&&!!data.session&&scope==='player'&&!!target;
 const remote=useResource(active?`/api/kickx/trades?playerId=${encodeURIComponent(target)}&page=${page}`:null,empty);
 useEffect(()=>{
  if(!active||remote.status!=='ready')return;
  setHistory(old=>({key,items:[...new Map([...(old.key===key?old.items:[]),...remote.data.items].map(t=>[t.id,t])).values()]}));
 },[active,key,remote.status,remote.data]);
 const items=attachmentTrades([...new Map([...(data.member?.transactions??[]),...(history.key===key?history.items:[]),...(active&&remote.status==='ready'?remote.data.items:[])].map(t=>[t.id,t])).values()],scope,target);
 return {items,loading:active&&remote.status==='loading',error:active&&remote.status==='error',reload:remote.reload,
  hasMore:active&&remote.status==='ready'&&items.length<remote.data.total,loadMore:()=>setPage(p=>p+1)};
}
