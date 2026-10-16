import { connection } from "next/server";
import { catalogDetail } from "@/server/kickx/catalog-http";
export async function GET(_request: Request, context: {params:Promise<{id:string}>}) {
  await connection(); return catalogDetail((await context.params).id);
}
