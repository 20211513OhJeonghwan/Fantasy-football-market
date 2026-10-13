import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicData, Player, Position } from "@/lib/kickx/types";
import { emptyPublicData } from "@/lib/kickx/data";
import { readPrototypePublic } from "./public-prototype";
type Row = Record<string, unknown>;
const text = (v: unknown) => typeof v === "string" ? v : null;
const number = (v: unknown) => v != null && (typeof v === "number" || typeof v === "string") && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
function required(v: unknown) { const s = text(v); if (!s) throw new Error("Invalid catalog identity"); return s; }
/** Explicit paging avoids Supabase's default row cap silently truncating the catalog.
 * Used only for the small league/team reference dictionaries. Player/fixture lists are paginated.
 */
export async function readRows(client: SupabaseClient, table: string, columns: string, since?: { column: string; at: string }) {
  const rows: Row[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    let query = client.from(table).select(columns).order("id").range(offset, offset + 499);
    if (since) query = query.gte(since.column, since.at);
    const { data, error } = await query;
    if (error) throw error;
    if (!data) throw new Error("Missing catalog result");
    rows.push(...(data as unknown as Row[]));
    if (data.length < 500) return rows;
  }
  throw new Error("Catalog bootstrap limit reached; use dedicated paginated endpoints");
}
function ageAt(birthDate: unknown, now: Date) {
  const value = text(birthDate);
  if (!value) return null;
  const birth = new Date(value);
  if (!Number.isFinite(birth.getTime()) || birth > now) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}
export function mapPlayer(row: Row, snapshot?: Row): Player {
  const position = ["GK","DF","MF","FW"].includes(String(row.position)) ? row.position as Position : null;
  const photo = text(row.photo);
  return {
    id:required(row.id),name:text(row.name_ko)||text(row.display_name)||required(row.name),originalName:required(row.name),aliases:Array.isArray(row.aliases)?row.aliases:[],english:text(row.english)||text(row.name),short:text(row.name_ko)||text(row.display_name)||text(row.short_name),
    team:text(row.team_id),position,number:number(row.shirt_number),country:text(row.country),age:ageAt(row.birth_date,new Date()),
    photo:photo && /^https:\/\/sports\.bzzoiro\.com\/img\/player\/[0-9]+\//.test(photo) ? photo : null,
    season:number(row.season),statsScope:text(row.stats_scope),importedMatches:number(row.matches_imported),price:number(snapshot?.price),change:number(snapshot?.change_percent),performance:number(snapshot?.performance),volume:number(snapshot?.volume),
    goals:number(snapshot?.goals),assists:number(snapshot?.assists),minutes:number(snapshot?.minutes),history:[],records:[],analysis:null,
    updatedAt:text(snapshot?.market_updated_at) || text(snapshot?.updated_at) || text(row.updated_at),status:text(row.trade_status),
  };
}
export function mapFixture(row: Row) {
  return {id:required(row.id),leagueId:text(row.league_id),home:required(row.home_team_id),away:required(row.away_team_id),startsAt:required(row.starts_at),status:required(row.status),homeScore:number(row.home_score),awayScore:number(row.away_score),stage:text(row.stage),roundLabel:text(row.round_label),penaltiesHome:number(row.penalties_home),penaltiesAway:number(row.penalties_away),reflectionStatus:text(row.reflection_status)};
}
/** Only bounded previews and the small league/team reference catalog are bootstrapped.
 * Full searches and player histories use dedicated page/detail endpoints.
 */
export async function readCatalog(client: SupabaseClient): Promise<PublicData> {
  const query = async (table: string, column: string, ascending=false, limit=24, since?: string) => {
    let q=client.from(table).select("*").order(column,{ascending,nullsFirst:false}).order("id").limit(limit);
    if(table==='player_catalog')q=q.in('league_id',['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6']);
    if(since) q=q.gte("starts_at",since);
    const {data,error}=await q;
    if(error) throw error;
    if(!data) throw new Error("Missing catalog preview");
    return data as Row[];
  };
  const [leagues,teams,price,rising,falling,fixtures,summary]=await Promise.all([
    readRows(client,"leagues","id,name"),readRows(client,"teams","*"),
    query("player_catalog","price"),query("player_catalog","change_percent",false,5),query("player_catalog","change_percent",true,5),
    query("fixtures","starts_at",true,20,new Date(Date.now()-86400000).toISOString()),
    client.from("player_catalog").select("id",{count:"exact",head:true}).in('league_id',['bsd-1','bsd-3','bsd-4','bsd-5','bsd-6']),
  ]);
  if(summary.error || summary.count == null) throw summary.error || new Error("Missing player count");
  const players=[...new Map([...price,...rising,...falling].map(row=>[required(row.id),mapPlayer(row,row)])).values()];
  return {...emptyPublicData(),...await readPrototypePublic(client),
    leagues:leagues.map(row=>({id:required(row.id),name:required(row.name)})),
    teams:teams.map(row=>({id:required(row.id),name:text(row.name_ko)||required(row.name),english:text(row.english)||required(row.name),code:text(row.code),color:text(row.color),leagueId:text(row.league_id)})),
    players,fixtures:fixtures.map(mapFixture),playerTotal:summary.count,
    updatedAt:players.map(p=>p.updatedAt).filter((v):v is string=>!!v).sort().at(-1)||null,
  };
}
