import { authenticatedClient, failure, json, readJson, requireOrigin } from "@/server/kickx/http";
import { asObject, checkDatabase } from "@/server/kickx/prototype";
export async function PUT(request:Request){try{requireOrigin(request);const {client}=await authenticatedClient();const body=asObject(await readJson(request));const {data,error}=await client.rpc("kickx_save_squad",{p_formation:body.formationId,p_slots:body.slots,p_revision:body.revision});checkDatabase(error);return json(data);}catch(error){return failure(error);}}
