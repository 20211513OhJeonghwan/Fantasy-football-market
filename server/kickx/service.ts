import type { KickxRepository } from "./repository";
import type { AdminData, DataResponse, PlatformData } from "@/lib/kickx/types";
import { emptyAdminData, emptyPlatformData } from "@/lib/kickx/data";
export class AccessError extends Error {
  constructor(public readonly status: 401 | 403) {
    super(
      status === 401 ? "로그인이 필요합니다." : "관리자 권한이 필요합니다.",
    );
  }
}
export async function readPlatform(
  repository: KickxRepository,
): Promise<DataResponse<PlatformData>> {
  if (!repository.configured)
    return { status: "not-configured", data: emptyPlatformData() };
  const session = await repository.getSession();
  const [publicData, member] = await Promise.all([
    repository.getPublicData(),
    session ? repository.getMemberData(session.userId) : Promise.resolve(null),
  ]);
  const data = { ...publicData, session, member };
  return repository.source
    ? { status: "ready", source: repository.source, data }
    : { status: "ready", data };
}
export async function readAdmin(
  repository: KickxRepository,
): Promise<DataResponse<AdminData>> {
  if (!repository.configured)
    return { status: "not-configured", data: emptyAdminData() };
  const session = await repository.getSession();
  if (!session) throw new AccessError(401);
  if (session.role !== "admin") throw new AccessError(403);
  if (repository.adminConfigured === false)
    return { status: "not-configured", data: emptyAdminData() };
  const data = await repository.getAdminData();
  return repository.source
    ? { status: "ready", source: repository.source, data }
    : { status: "ready", data };
}
