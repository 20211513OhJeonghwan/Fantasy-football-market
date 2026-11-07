import "server-only";
import { unstable_cache } from "next/cache";
import {SCORING_REVISION,PRICING_REVISION} from "./engine/report-policy";
import type { CatalogQuery } from "@/lib/kickx/catalog-query";
import { createPublicClient } from "./supabase";
import { readCatalog } from "./catalog";
import { readPlayerPage, readFixturePage, readPlayerDetail } from "./catalog-pages";
import { readHomeClubFixture } from "./home-fixtures";

// Only anonymous, public data enters the shared server cache. Cookies, sessions,
// owned/watch lists, trade quotes and AI report access never enter these functions.
// A policy rollout must not serve a previous scoring epoch on its first stale cache hit.
const options = { revalidate: 15, tags: ["kickx-public"] };
export const readCachedCatalog = unstable_cache(
  async () => readCatalog(createPublicClient()), ["kickx-catalog-v2",SCORING_REVISION,PRICING_REVISION], options);
export const readCachedPlayerPage = unstable_cache(async (input: CatalogQuery) => {
  if (["watch", "owned"].includes(input.scope)) throw new Error("Private catalog cannot be cached");
  return readPlayerPage(createPublicClient(), input);
}, ["kickx-player-page-v2",SCORING_REVISION,PRICING_REVISION], options);
export const readCachedFixturePage = unstable_cache(
  async (input: CatalogQuery) => readFixturePage(createPublicClient(), input), ["kickx-fixture-page-v2",SCORING_REVISION,PRICING_REVISION], options);
export const readCachedPlayerDetail = unstable_cache(
  async (id: string) => readPlayerDetail(createPublicClient(), id), ["kickx-player-detail-v2",SCORING_REVISION,PRICING_REVISION], options);
// Cache public fixture rows per club, so supporters share one small read.
export const readCachedHomeClubFixture = unstable_cache(
  async (team: string) => readHomeClubFixture(createPublicClient(), team),
  ["kickx-home-club-fixture-v1"], { revalidate: 60, tags: ["kickx-public"] });
