import { connection } from "next/server";
import { createMatchReport, readMatchReport } from "@/server/kickx/match-reports";

export const maxDuration = 30;
type Context = { params: Promise<{ id: string; fixtureId: string }> };
export async function GET(_request: Request, context: Context) {
  await connection();
  const { id, fixtureId } = await context.params;
  return readMatchReport(id, fixtureId);
}
export async function POST(request: Request, context: Context) {
  await connection();
  const { id, fixtureId } = await context.params;
  return createMatchReport(request, id, fixtureId);
}
