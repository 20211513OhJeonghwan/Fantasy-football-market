import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
import { requireAdmin } from "@/server/kickx/admin-db";
import { asObject, checkDatabase, identity } from "@/server/kickx/prototype";
export async function POST(request:Request){try{
 requireOrigin(request);await requireAdmin();const body=asObject(await readJson(request));
 if(body.action!=="moderate")throw new HttpError(400,"게임 데이터·계산·랭킹은 자동 처리됩니다.");
 const {client}=await authenticatedClient();const r=await client.rpc("kickx_moderate",{p_report:identity(body.reportId,true),p_action:body.operation,p_reason:body.reason});checkDatabase(r.error);return json(r.data);
}catch(error){return failure(error);}}
