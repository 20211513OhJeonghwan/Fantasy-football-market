import "server-only";
import { unstable_cache } from "next/cache";
import type { CatalogQuery } from "@/lib/kickx/catalog-query";
import { createPublicClient } from "./supabase";
import { readCatalog } from "./catalog";
import { readPlayerPage, readFixturePage, readPlayerDetail } from "./catalog-pages";

// Only anonymous, public data enters the shared server cache. Cookies, sessions,
// owned/watch lists, trade quotes and AI report access never enter these functions.
const options = { revalidate: 15, tags: ["kickx-public"] };
export const readCachedCatalog = unstable_cache(
  async () => readCatalog(createPublicClient()), ["kickx-catalog-v1"], options);
export const readCachedPlayerPage = unstable_cache(async (input: CatalogQuery) => {
  if (["watch", "owned"].includes(input.scope)) throw new Error("Private catalog cannot be cached");
  return readPlayerPage(createPublicClient(), input);
}, ["kickx-player-page-v1"], options);
export const readCachedFixturePage = unstable_cache(
  async (input: CatalogQuery) => readFixturePage(createPublicClient(), input), ["kickx-fixture-page-v1"], options);
export const readCachedPlayerDetail = unstable_cache(
  async (id: string) => readPlayerDetail(createPublicClient(), id), ["kickx-player-detail-v1"], options);
