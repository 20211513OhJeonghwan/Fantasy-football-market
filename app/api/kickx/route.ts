import { connection } from "next/server";
import { getKickxRepository } from "@/server/kickx/repository";
import { readPlatform } from "@/server/kickx/service";
import { timedRead } from "@/server/kickx/read-timing";
export async function GET() {
  await connection();
  return timedRead(async()=>{
  try {
    return Response.json(await readPlatform(getKickxRepository()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "데이터를 불러오지 못했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  });
}
