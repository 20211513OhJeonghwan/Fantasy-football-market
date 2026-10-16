import { parseWatch } from "@/lib/kickx/validation";
import { authenticatedClient, failure, HttpError, json, readJson, requireOrigin } from "@/server/kickx/http";
export async function PUT(request: Request) {
  try {
    requireOrigin(request);
    const { client, user } = await authenticatedClient();
    const input = parseWatch(await readJson(request));
    if (input.watched) {
      const player = await client.from("players").select("id").eq("id", input.playerId).maybeSingle();
      if (player.error) throw player.error;
      if (!player.data) throw new HttpError(404, "선수를 찾을 수 없습니다.");
      const { error } = await client.from("watchlists").upsert(
        { user_id: user.id, player_id: input.playerId },
        { onConflict: "user_id,player_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    } else {
      const { error } = await client.from("watchlists").delete().eq("user_id", user.id).eq("player_id", input.playerId);
      if (error) throw error;
    }
    return json(input);
  } catch (error) { return failure(error); }
}
