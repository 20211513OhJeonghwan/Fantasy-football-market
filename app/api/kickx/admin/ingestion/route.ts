import { requireAdmin, createAdminDatabase } from "@/server/kickx/admin-db";
import { failure, HttpError, json, requireOrigin } from "@/server/kickx/http";
import { ingestionState } from "@/server/kickx/ingestion";
export async function GET() {
 try { await requireAdmin();return json(await ingestionState(createAdminDatabase())); }catch(error){return failure(error);}
}
export async function POST(request:Request){
 try { requireOrigin(request);await requireAdmin();throw new HttpError(410,"축구 데이터는 자동 갱신됩니다. 관리자 수동 수집은 종료되었습니다."); }catch(error){return failure(error);}
}
