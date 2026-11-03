import { parseProfile } from "@/lib/kickx/validation";
import { DOMESTIC_LEAGUES } from '@/lib/kickx/support';
import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
/** PostgREST reports an unknown `profiles.avatar` column as 42703 (select) or PGRST204 (write). */
const missingAvatarColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42703" || error.code === "PGRST204") && /avatar/.test(error.message ?? "");
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
    const base = { nickname: profile.nickname, team_id: profile.team, team_ids: profile.teams };
    const write = (values: Record<string, unknown>, columns: string) => current.data
      ? client.from("profiles").update(values).eq("id", user.id).select(columns).single()
      : client.from("profiles").insert({ id: user.id, ...values }).select(columns).single();
    let result = await write("avatar" in profile ? { ...base, avatar: profile.avatar } : base, "nickname,team_id,team_ids,avatar");
    // Until the avatar migration is applied, keep saving the rest of the profile.
    if (missingAvatarColumn(result.error)) {
      if ("avatar" in profile && profile.avatar) throw new HttpError(503, "프로필 아이콘 저장을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
      result = await write(base, "nickname,team_id,team_ids");
    }
    if (result.error) {
      if (result.error.code === "23505") throw new HttpError(409, "이미 사용 중인 닉네임입니다. 다른 이름으로 다시 시도해 주세요.");
      throw result.error;
    }
    const row = result.data as unknown as { nickname: string; team_id: string | null; team_ids: string[]; avatar?: string | null };
    return json({ profile: { nickname: row.nickname, team: row.team_id, teams: row.team_ids, avatar: row.avatar ?? null } });
  } catch (error) { return failure(error); }
}
