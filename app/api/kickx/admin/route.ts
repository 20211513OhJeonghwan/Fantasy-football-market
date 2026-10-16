import { connection } from "next/server";
import { getKickxRepository } from "@/server/kickx/repository";
import { AccessError, readAdmin } from "@/server/kickx/service";
export async function GET() {
  await connection();
  try {
    return Response.json(await readAdmin(getKickxRepository()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const denied = error instanceof AccessError;
    return Response.json(
      { error: denied ? error.message : "운영 데이터를 불러오지 못했습니다." },
      {
        status: denied ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
