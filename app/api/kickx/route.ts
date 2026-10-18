import { connection } from "next/server";
import { getKickxRepository } from "@/server/kickx/repository";
import { readPlatform } from "@/server/kickx/service";
import { timedRead } from "@/server/kickx/read-timing";
import { failure } from "@/server/kickx/http";
export async function GET() {
  await connection();
  return timedRead(async()=>{
  try {
    return Response.json(await readPlatform(getKickxRepository()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return failure(error); }
  });
}
