import { connection } from "next/server";
import { homeFixtures } from "@/server/kickx/catalog-http";
export async function GET(request: Request) { await connection(); return homeFixtures(request); }
