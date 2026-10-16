import "server-only";
import { getSupabaseConfig } from "./config";
import { SupabaseKickxRepository } from "./supabase-repository";
import { mockAdminData, mockMemberData, mockPublicData, mockSession } from "./mock-data";
import { emptyAdminData, emptyPublicData } from "@/lib/kickx/data";
import type {
  AdminData,
  MemberData,
  PublicData,
  Session,
} from "@/lib/kickx/types";

/** Implement this boundary with server-side Supabase queries. Never accept a client user ID as authentication. */
export interface KickxRepository {
  readonly configured: boolean;
  readonly adminConfigured?: boolean;
  /** Set only by the development sample adapter so the UI can label the data. */
  readonly source?: "mock";
  getSession(): Promise<Session | null>;
  getPublicData(): Promise<PublicData>;
  getMemberData(userId: string): Promise<MemberData | null>;
  getAdminData(): Promise<AdminData>;
}
// Deliberately disconnected: no seed rows, generated stats or in-memory write simulator.
// Keep the empty adapter until migration + OAuth setup are explicitly enabled.
const unconfiguredRepository: KickxRepository = {
  configured: false,
  async getSession() {
    return null;
  },
  async getPublicData() {
    return emptyPublicData();
  },
  async getMemberData() {
    return null;
  },
  async getAdminData() {
    return emptyAdminData();
  },
};
// Development sample adapter: opt-in with KICKX_MOCK_DATA=true and only while no database is configured.
// Writes are not accepted by the server; the client keeps sample interactions local and labels them.
const mockRepository: KickxRepository = {
  configured: true,
  adminConfigured: true,
  source: "mock",
  async getSession() {
    return mockSession;
  },
  async getPublicData() {
    return mockPublicData();
  },
  async getMemberData() {
    return mockMemberData();
  },
  async getAdminData() {
    return mockAdminData();
  },
};
export function getKickxRepository(): KickxRepository {
  if (getSupabaseConfig()) return new SupabaseKickxRepository();
  return process.env.KICKX_MOCK_DATA === "true" ? mockRepository : unconfiguredRepository;
}
