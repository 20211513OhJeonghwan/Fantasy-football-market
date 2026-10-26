import "server-only";
import { attachTradeWindows } from "./trading";
import type { KickxRepository } from "./repository";
import type { MemberData, Session } from "@/lib/kickx/types";
import { createRequestClient } from "./supabase";
import { mapPlayer } from "./catalog";
import { readCachedCatalog } from "./public-cache";
import { checkDatabase, migrationMissing } from "./prototype";
import { readOperations } from "./ingestion";
export class SupabaseKickxRepository implements KickxRepository {
  readonly configured = true;
  readonly adminConfigured = true;
  private client: ReturnType<typeof createRequestClient> | null = null;
  private getClient() { return this.client ||= createRequestClient(); }
  private session: Promise<Session | null> | null = null;
  getSession() {
    this.session ||= this.readSession();
    return this.session;
  }
  private async readSession(): Promise<Session | null> {
    const client = await this.getClient();
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (error.name === "AuthSessionMissingError" || error.status === 401 || error.code === "refresh_token_not_found" || error.code === "refresh_token_already_used") return null;
      throw error;
    }
    if (!data.user) return null;
    const [profile, role] = await Promise.all([
      client.from("profiles").select("nickname,team_id,team_ids").eq("id", data.user.id).maybeSingle(),
      client.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle(),
    ]);
    if (profile.error) throw profile.error;
    if (role.error) throw role.error;
    return {
      userId: data.user.id, role: role.data?.role === "admin" ? "admin" : "member",
      profile: profile.data ? { nickname: profile.data.nickname, team: profile.data.team_id, teams: profile.data.team_ids ?? (profile.data.team_id ? [profile.data.team_id] : []) } : null,
    };
  }
  async getPublicData() {
    const [data, session] = await Promise.all([readCachedCatalog(), this.getSession()]);
    if (!session) return data;
    // Likes and moderation flags depend on identity and stay outside the cache.
    const posts = await (await this.getClient()).rpc("kickx_posts", { p_size: 20 });
    checkDatabase(posts.error);
    return { ...data, posts: posts.data.items };
  }
  async getMemberData(userId: string): Promise<MemberData | null> {
    const session = await this.getSession();
    if (!session || session.userId !== userId) throw new Error("Member identity mismatch");
    const client = await this.getClient();
    if (session.profile) {
      // Existing wallets are a read-only operation. open_wallet takes the global
      // economy lock and must only run once for a member without a wallet.
      let result = await client.rpc("kickx_member_data");
      if (result.error?.code === "P0001" && result.error.message === "PROFILE_REQUIRED") {
        const wallet=await client.rpc("kickx_open_wallet");
        checkDatabase(wallet.error);
        result=await client.rpc("kickx_member_data");
      }
      if (!migrationMissing(result.error)) {
        checkDatabase(result.error);
        return {...result.data, ownedPlayers: await attachTradeWindows(client,(result.data.ownedPlayers ?? []).map((p: Record<string,unknown>)=>mapPlayer(p,p)))};
      }
    }
    const watchlist: string[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("watchlists").select("player_id").eq("user_id", session.userId).order("player_id").range(offset, offset + 499);
      if (error) throw error;
      if (!data) throw new Error("Missing watchlist result");
      watchlist.push(...data.map(row => row.player_id as string));
      if (data.length < 500) break;
      if (offset >= 19500) throw new Error("Watchlist limit reached");
    }
    // Finance stays explicitly unavailable until the ledger and transaction service exist.
    return { financialReady: false, points: null, totalAssets: null, playerAssets: null,
      profit: null, returnRate: null, weeklyRank: null, holdings: [], transactions: [],
      watchlist, assetHistory: [], squad: null };
  }
  async getAdminData() {
    if ((await this.getSession())?.role !== "admin") throw new Error("Admin identity required");
    return readOperations();
  }
}
