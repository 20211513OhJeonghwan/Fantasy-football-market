import { connection } from "next/server";
import { catalogPage } from "@/server/kickx/catalog-http";
export async function GET(request: Request) { await connection(); return catalogPage(request,"fixtures"); }
