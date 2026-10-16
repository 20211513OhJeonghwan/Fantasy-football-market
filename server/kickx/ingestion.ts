import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminData, IngestionState } from "@/lib/kickx/types";
import { emptyAdminData } from "@/lib/kickx/data";
import {prototypeAvailable,checkDatabase} from "./prototype";
import { createAdminDatabase } from "./admin-db";
import { readBulkState } from "@/scripts/lib/bulk-sync.mjs";

export async function ingestionState(db: SupabaseClient): Promise<IngestionState> {
  try {
    const state = await readBulkState(db);
    return { enabled: !!process.env.BSD_API_KEY?.trim(), reason: process.env.BSD_API_KEY?.trim() ? null : "서버의 BSD_API_KEY를 설정해 주세요.", ...state };
  } catch {
    return { enabled: false, reason: "수집 작업 DB를 확인해 주세요. 새 수동 갱신 SQL 적용이 필요할 수 있습니다.", latest: null, current: null, warnings: [], runs: [] };
  }
}
export async function readOperations(): Promise<AdminData> {
 const empty=emptyAdminData();const db=createAdminDatabase();
 const ready=await prototypeAvailable(db);
 if(!ready)return empty;
 const [trades,reports,audit,members,restricted,tradeCount,pending]=await Promise.all([
  db.from("trades").select("*").order("created_at",{ascending:false}).limit(200),
  db.from("community_reports").select("*,community_posts(title,body),community_comments(body)").order("created_at",{ascending:false}).limit(200),
  db.from("operation_audit").select("*").or("action.like.community.%,action.like.member.%").order("created_at",{ascending:false}).limit(100),
  db.from("profiles").select("id",{count:"exact",head:true}),
  db.from("member_restrictions").select("user_id",{count:"exact",head:true}).gt("suspended_until",new Date().toISOString()),
  db.from("trades").select("id",{count:"exact",head:true}),
  db.from("community_reports").select("id",{count:"exact",head:true}).eq("status","open")
 ]);
 for(const r of [trades,reports,audit,members,tradeCount,pending])checkDatabase(r.error);
 // Preserve community/trade visibility during the one-time new migration rollout.
 const restrictedCount=restricted.error?null:restricted.count;
 return {...empty,prototypeReady:true,summary:{players:null,completedJobs:null,failedJobs:null,pendingReports:pending.count,members:members.count,restrictedMembers:restrictedCount,trades:tradeCount.count},
 trades:(trades.data??[]).map(t=>({id:t.id,userId:t.user_id,playerId:t.player_id,playerName:t.player_name,type:t.side,quantity:1,price:t.price,fee:t.fee,net:t.net,date:t.created_at,status:"체결"})),
 reports:(reports.data??[]).map(r=>({id:r.id,postId:r.post_id,commentId:r.comment_id,title:r.community_posts?.title??"삭제된 글",content:r.comment_id?r.community_comments?.body:r.community_posts?.body,reason:r.reason,status:({open:"접수",hidden:"숨김",dismissed:"기각",restored:"복원"} as Record<string,string>)[r.status],date:r.created_at})),
 audit:(audit.data??[]).map(a=>({id:a.id,description:`${a.action} · ${a.target??""} · ${JSON.stringify(a.detail)}`,date:a.created_at}))};
}
