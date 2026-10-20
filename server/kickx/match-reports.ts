import "server-only";
import type { MatchReport, ReportFacts, ReportText } from "@/lib/kickx/match-report";
import { createAdminDatabase } from "./admin-db";
import { authenticatedClient, failure, json, requireOrigin } from "./http";
import { checkDatabase, identity } from "./prototype";
import { generateReport, reportModelConfig, ReportModelError, REPORT_PROMPT_VERSION } from "./report-model";

type StoredReport = { status: MatchReport["status"] | "claimed"; facts?: ReportFacts | null; text?: ReportText; generatedAt?: string; retryAt?: string; unavailableReason?: MatchReport["unavailableReason"]; inputHash?: string; claimToken?: string; promptVersion?: string };
function publicReport(result: StoredReport): MatchReport {
  const current = result.promptVersion === REPORT_PROMPT_VERSION;
  return {
    status: result.status === "claimed" ? "pending" : result.status === "ready" && !current ? "missing" : result.status,
    facts: result.facts ?? null, text: result.status === "ready" && current ? result.text ?? null : null,
    generatedAt: result.status === "ready" ? result.generatedAt ?? null : null,
    canGenerate: !!reportModelConfig() && current, retryAt: result.retryAt ?? null,
    unavailableReason: result.unavailableReason ?? null,
  };
}
export async function readMatchReport(playerId: string, fixtureId: string) {
  try {
    const player = identity(playerId), fixture = identity(fixtureId);
    await authenticatedClient();
    const db = createAdminDatabase();
    const result = await db.rpc("kickx_read_match_report", { p_player: player, p_fixture: fixture });
    checkDatabase(result.error);
    const data = publicReport(result.data as StoredReport);
    // Authenticate every HTTP read; the browser reuses completed reports for 60 seconds.
    // A shared CDN response must never bypass the signed-in requirement.
    return json(data);
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
    if (result.status !== "claimed" || result.promptVersion !== REPORT_PROMPT_VERSION) return json(publicReport(result));
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
