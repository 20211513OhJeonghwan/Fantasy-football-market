import "server-only";
import { attachTradeWindows } from "./trading";
import type { KickxRepository } from "./repository";
import type { MemberData, Session } from "@/lib/kickx/types";
import { createRequestClient } from "./supabase";
import { readCatalog, mapPlayer } from "./catalog";
import { checkDatabase, migrationMissing } from "./prototype";
import { readOperations } from "./ingestion";
export class SupabaseKickxRepository implements KickxRepository {
  readonly configured = true;
  readonly adminConfigured = true;
  private client = createRequestClient();
  private session: Promise<Session | null> | null = null;
  getSession() {
    this.session ||= this.readSession();
    return this.session;
  }
  private async readSession(): Promise<Session | null> {
    const client = await this.client;
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (error.name === "AuthSessionMissingError" || error.status === 401 || error.code === "refresh_token_not_found" || error.code === "refresh_token_already_used") return null;
      throw error;
    }
    if (!data.user) return null;
    const [profile, role] = await Promise.all([
      client.from("profiles").select("nickname,team_id").eq("id", data.user.id).maybeSingle(),
      client.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle(),
    ]);
    if (profile.error) throw profile.error;
    if (role.error) throw role.error;
    return {
      userId: data.user.id, role: role.data?.role === "admin" ? "admin" : "member",
      profile: profile.data ? { nickname: profile.data.nickname, team: profile.data.team_id } : null,
    };
  }
  async getPublicData() { return readCatalog(await this.client); }
  async getMemberData(userId: string): Promise<MemberData | null> {
    const session = await this.getSession();
    if (!session || session.userId !== userId) throw new Error("Member identity mismatch");
    const client = await this.client;
    if (session.profile) {
      const wallet = await client.rpc("kickx_open_wallet");
      if (!migrationMissing(wallet.error)) {
        checkDatabase(wallet.error);
        const result = await client.rpc("kickx_member_data");
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
