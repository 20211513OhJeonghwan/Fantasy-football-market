import "server-only";
import type { MatchReport, ReportFacts, ReportText } from "@/lib/kickx/match-report";
import { createAdminDatabase } from "./admin-db";
import { authenticatedClient, failure, json, requireOrigin } from "./http";
import { checkDatabase, identity } from "./prototype";
import { generateReport, reportModelConfig, ReportModelError } from "./report-model";

type StoredReport = { status: MatchReport["status"] | "claimed"; facts?: ReportFacts | null; text?: ReportText; generatedAt?: string; retryAt?: string; inputHash?: string; claimToken?: string };
function publicReport(result: StoredReport): MatchReport {
  return {
    status: result.status === "claimed" ? "pending" : result.status,
    facts: result.facts ?? null, text: result.status === "ready" ? result.text ?? null : null,
    generatedAt: result.status === "ready" ? result.generatedAt ?? null : null,
    canGenerate: !!reportModelConfig(), retryAt: result.retryAt ?? null,
  };
}
export async function readMatchReport(playerId: string, fixtureId: string) {
  try {
    const db = createAdminDatabase();
    const result = await db.rpc("kickx_read_match_report", { p_player: identity(playerId), p_fixture: identity(fixtureId) });
    checkDatabase(result.error);
    const data = publicReport(result.data as StoredReport);
    // Cookie-free, public text only. The CDN shares a bounded response across visitors.
    return Response.json(data, { headers: { "Cache-Control": `public, max-age=0, s-maxage=${data.status === "ready" ? 60 : 10}` } });
  } catch (error) { return failure(error); }
}

export async function createMatchReport(request: Request, playerId: string, fixtureId: string) {
  try {
    requireOrigin(request);
    const player = identity(playerId), fixture = identity(fixtureId);
    const { user } = await authenticatedClient();
    const db = createAdminDatabase();
    const config = reportModelConfig();
    if (!config) {
      // No model key: still return the real stored numerical explanation, without a write.
      const existing = await db.rpc("kickx_read_match_report", { p_player: player, p_fixture: fixture });
      checkDatabase(existing.error);
      return json(publicReport(existing.data as StoredReport));
    }
    const claim = await db.rpc("kickx_claim_match_report", { p_player: player, p_fixture: fixture, p_user: user.id });
    checkDatabase(claim.error);
    const result = claim.data as StoredReport;
    if (result.status !== "claimed") return json(publicReport(result));
    let text: ReportText | null = null;
    let errorCode: string | null = null;
    try { text = await generateReport(result.facts!, config); }
    catch (error) { errorCode = error instanceof ReportModelError ? error.code : "provider"; }
    // Compare the claim token AND current source fingerprint, so corrected records cannot
    // be overwritten by an older in-flight response. Provider errors never enter DB logs.
    const finished = await db.rpc("kickx_finish_match_report", {
      p_player: player, p_fixture: fixture, p_token: result.claimToken, p_hash: result.inputHash,
      p_body: text, p_model: config.model, p_error: errorCode,
    });
    checkDatabase(finished.error);
    // Always re-read: the source may have changed or another request may own a newer lease.
    const latest = await db.rpc("kickx_read_match_report", { p_player: player, p_fixture: fixture });
    checkDatabase(latest.error);
    return json(publicReport(latest.data as StoredReport));
  } catch (error) { return failure(error); }
}
