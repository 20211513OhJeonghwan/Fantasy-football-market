import { parseProfile } from "@/lib/kickx/validation";
import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { client, user } = await authenticatedClient();
    const profile = parseProfile(await readJson(request));
    if (profile.team) {
      const team = await client.from("teams").select("id").eq("id", profile.team).maybeSingle();
      if (team.error) throw team.error;
      if (!team.data) throw new HttpError(400, "등록된 응원 구단을 선택해 주세요.");
    }
    const current = await client.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (current.error) throw current.error;
    const values = { nickname: profile.nickname, team_id: profile.team };
    const result = current.data
      ? await client.from("profiles").update(values).eq("id", user.id).select("nickname,team_id").single()
      : await client.from("profiles").insert({ id: user.id, ...values }).select("nickname,team_id").single();
    if (result.error) {
      if (result.error.code === "23505") throw new HttpError(409, "이미 사용 중인 닉네임입니다. 다른 이름으로 다시 시도해 주세요.");
      throw result.error;
    }
    return json({ profile: { nickname: result.data.nickname, team: result.data.team_id } });
  } catch (error) { return failure(error); }
}
