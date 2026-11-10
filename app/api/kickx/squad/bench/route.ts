import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from '@/server/kickx/http';
import { asObject, checkDatabase, identity } from '@/server/kickx/prototype';
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { client } = await authenticatedClient(), body = asObject(await readJson(request));
    const playerId = identity(body.playerId);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new HttpError(400, '최신 스쿼드에서 다시 시도해 주세요.');
    const { data, error } = await client.rpc('kickx_restore_bench', { p_player: playerId, p_revision: body.revision });
    checkDatabase(error); return json(data);
  } catch (error) { return failure(error); }
}
