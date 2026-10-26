import { parseProfile } from "@/lib/kickx/validation";
import { DOMESTIC_LEAGUES } from '@/lib/kickx/support';
import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { client, user } = await authenticatedClient();
    const profile = parseProfile(await readJson(request));
    if (profile.teams.length) {
      const teams = await client.from("teams").select("id,league_id").in("id", profile.teams);
      if (teams.error) throw teams.error;
      if (teams.data?.length !== profile.teams.length || teams.data.some(t => !DOMESTIC_LEAGUES.includes(t.league_id as typeof DOMESTIC_LEAGUES[number])) || new Set(teams.data.map(t => t.league_id)).size !== profile.teams.length)
        throw new HttpError(400, "5대 리그에서 리그별로 응원 구단을 1개씩 선택해 주세요.");
    }
    const current = await client.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (current.error) throw current.error;
    const values = { nickname: profile.nickname, team_id: profile.team, team_ids: profile.teams };
    const result = current.data
      ? await client.from("profiles").update(values).eq("id", user.id).select("nickname,team_id,team_ids").single()
      : await client.from("profiles").insert({ id: user.id, ...values }).select("nickname,team_id,team_ids").single();
    if (result.error) {
      if (result.error.code === "23505") throw new HttpError(409, "이미 사용 중인 닉네임입니다. 다른 이름으로 다시 시도해 주세요.");
      throw result.error;
    }
    return json({ profile: { nickname: result.data.nickname, team: result.data.team_id, teams: result.data.team_ids } });
  } catch (error) { return failure(error); }
}
