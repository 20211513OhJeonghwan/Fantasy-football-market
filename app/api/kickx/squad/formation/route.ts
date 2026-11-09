import { authenticatedClient, failure, json, readJson, requireOrigin, HttpError } from '@/server/kickx/http';
import { asObject, checkDatabase, identity } from '@/server/kickx/prototype';
import { FORMATIONS } from '@/lib/kickx/squad';

export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { client } = await authenticatedClient(), body = asObject(await readJson(request));
    if (!FORMATIONS.some(f => f.id === body.formationId) || !Array.isArray(body.benchPlayerIds) || body.benchPlayerIds.length > 11
      || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new HttpError(400,'포메이션과 벤치 이동 선수를 확인해 주세요.');
    const ids = body.benchPlayerIds.map(id => identity(id));
    if (new Set(ids).size !== ids.length) throw new HttpError(400,'같은 선수를 중복 선택할 수 없습니다.');
    const { data, error } = await client.rpc('kickx_change_formation',{ p_formation: body.formationId, p_bench: ids, p_revision: body.revision });
    checkDatabase(error); return json(data);
  } catch (error) { return failure(error); }
}
