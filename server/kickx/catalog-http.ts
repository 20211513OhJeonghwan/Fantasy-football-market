import "server-only";
import { CatalogInputError, parseCatalogQuery } from "@/lib/kickx/catalog-query";
import { fixtureGroup, koreanDay } from "@/lib/kickx/fixtures";
import { getKickxRepository } from "./repository";
import { createPublicClient } from "./supabase";
import { authenticatedClient, failure, HttpError, json } from "./http";
import {prototypeAvailable} from "./prototype";
import { readFixturePage, readPlayerDetail, readPlayerPage } from "./catalog-pages";
import { timedRead } from "./read-timing";
export function catalogPage(request: Request, kind: "players" | "fixtures") {
  return timedRead(()=>readCatalogPage(request,kind));
}
async function readCatalogPage(request: Request, kind: "players" | "fixtures") {
  try {
    const input=parseCatalogQuery(new URL(request.url).searchParams,kind);
    const repo=getKickxRepository();
    const empty={items:[],total:0,page:input.page,size:input.size};
    if(!repo.configured) return json({status:"not-configured",data:empty});
    if(repo.source !== "mock") {
      const client=kind === "players" && ["watch","owned"].includes(input.scope) ? (await authenticatedClient()).client : createPublicClient();
      if(kind==="players"&&input.scope==="owned"&&!await prototypeAvailable(client))return json({status:"not-configured",data:empty});
      return json({status:"ready",data:await (kind === "players" ? readPlayerPage(client,input) : readFixturePage(client,input))});
    }
    const data=await repo.getPublicData(),member=await repo.getMemberData((await repo.getSession())!.userId);
    const matches=(text: string)=>text.toLowerCase().includes(input.q.toLowerCase());
    const items=kind === "players" ? data.players.filter(p=>{
      const t=data.teams.find(t=>t.id === p.team),l=data.leagues.find(l=>l.id === t?.leagueId);
      return matches([p.name,p.english,t?.name,t?.english,l?.name].join(" ")) && (!input.team || p.team === input.team)
        && (!input.league || t?.leagueId === input.league) && (!input.position || p.position === input.position)
        && (input.scope !== "watch" || member?.watchlist.includes(p.id)) && (input.scope !== "owned" || member?.holdings.some(h=>h.playerId===p.id))
        && (input.scope !== "rising" || (p.change ?? 0)>0) && (input.scope !== "falling" || (p.change ?? 0)<0);
    }).sort((a,b)=>{
      if(input.sort === "name") return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      const key=(input.sort === "price-asc" ? "price" : input.sort) as "price"|"change"|"performance"|"volume";
      const x=a[key],y=b[key];
      return (x == null ? (y == null ? 0 : 1) : y == null ? -1 : ["price-asc"].includes(input.sort) ? x-y : y-x) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }) : data.fixtures.filter(f=>{
      const h=data.teams.find(t=>t.id === f.home),a=data.teams.find(t=>t.id === f.away);
      return matches([h?.name,h?.english,a?.name,a?.english].join(" ")) && (!input.league || f.leagueId === input.league) && (!input.team || f.home === input.team || f.away === input.team)
        && (!input.day || koreanDay(f.startsAt) === input.day) && (input.state === "all" || fixtureGroup(f.status)===input.state);
    }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id));
    return json({status:"ready",source:"mock",data:{...empty,items:items.slice((input.page-1)*input.size,input.page*input.size),total:items.length}});
  } catch(error) { return error instanceof CatalogInputError ? json({error:error.message},400) : failure(error); }
}
export function catalogDetail(id: string) {return timedRead(()=>readCatalogDetail(id));}
async function readCatalogDetail(id: string) {
  try {
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new HttpError(400,"선수 ID를 확인해 주세요.");
    const repo=getKickxRepository();
    if(!repo.configured) return json({status:"not-configured",data:{player:null}});
    const player=repo.source === "mock" ? (await repo.getPublicData()).players.find(p=>p.id===id) ?? null : await readPlayerDetail(createPublicClient(),id);
    return json({status:"ready",...(repo.source ? {source:repo.source} : {}),data:{player}});
  } catch(error) {return failure(error);}
}
