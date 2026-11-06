import { parseProfile } from "@/lib/kickx/validation";
import { checkDatabase } from "@/server/kickx/prototype";
import { DOMESTIC_LEAGUES } from '@/lib/kickx/support';
import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { client } = await authenticatedClient();
    const profile = parseProfile(await readJson(request));
    if (profile.teams.length) {
      const teams = await client.from("teams").select("id,league_id").in("id", profile.teams);
      if (teams.error) throw teams.error;
      if (teams.data?.length !== profile.teams.length || teams.data.some(t => !DOMESTIC_LEAGUES.includes(t.league_id as typeof DOMESTIC_LEAGUES[number])) || new Set(teams.data.map(t => t.league_id)).size !== profile.teams.length)
        throw new HttpError(400, "5대 리그에서 리그별로 응원 구단을 1개씩 선택해 주세요.");
    }
    const result=await client.rpc("kickx_save_profile",{p_input:profile});
    if(result.error?.code==='23505')throw new HttpError(409,'이미 사용 중인 닉네임입니다.');
    checkDatabase(result.error);
    return json({profile:result.data});
  } catch (error) { return failure(error); }
}
