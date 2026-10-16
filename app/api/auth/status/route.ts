import { connection } from "next/server";
import { getSupabaseConfig } from "@/server/kickx/config";
import { json } from "@/server/kickx/http";
export async function GET() {
  await connection();
  return json({ enabled: !!getSupabaseConfig() });
}
