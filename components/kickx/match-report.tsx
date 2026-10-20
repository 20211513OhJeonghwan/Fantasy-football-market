"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { MatchReport } from "@/lib/kickx/match-report";
import type { PlayerRecord } from "@/lib/kickx/types";
import { dateText, money, score } from "@/lib/kickx/data";
import { METRIC_LABELS } from "@/lib/kickx/score-labels";
import { Modal, Change } from "./ui";
import { usePlatform } from "./provider";

// A small in-memory cache avoids rereading a report when its dialog is reopened.
// No persistent browser storage and no polling, subscriptions, or page-load fetches.
const readyCache = new Map<string, { at: number; report: MatchReport }>();
type LoadedReport = { report: MatchReport; generationError?: string };
const inFlight = new Map<string, Promise<LoadedReport>>();
async function fetchReport(url: string, method: "GET" | "POST") {
  const response = await fetch(url, { method, credentials: method === "GET" ? "omit" : "same-origin" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "리포트를 불러오지 못했습니다.");
  return result as MatchReport;
}
function loadReport(url: string, generate: boolean) {
  const cached = readyCache.get(url);
  if (cached && Date.now() - cached.at < 60000) return Promise.resolve({ report: cached.report } as LoadedReport);
  const key = `${url}:${generate}`;
  const running = inFlight.get(key);
  if (running) return running;
  const promise = (async () => {
    let result = await fetchReport(url, "GET");
    if (generate && result.canGenerate && result.status === "missing") {
      try { result = await fetchReport(url, "POST"); }
      catch { return { report: result, generationError: "AI 설명을 작성하지 못했습니다. 저장된 산정 요약을 확인해 주세요." }; }
    }
    if (result.status === "ready") {
      if (readyCache.size >= 40) readyCache.delete(readyCache.keys().next().value!);
      readyCache.set(url, { at: Date.now(), report: result });
    }
    return { report: result };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function MatchReportDialog({ playerId, record, onClose }: { playerId: string; record: PlayerRecord; onClose: () => void }) {
  const { data } = usePlatform();
  const [report, setReport] = useState<MatchReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const signedIn = !!data.session?.profile;
  const url = `/api/kickx/players/${encodeURIComponent(playerId)}/matches/${encodeURIComponent(record.fixtureId!)}/report`;
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    loadReport(url, signedIn).then(result => { if (active) { setReport(result.report); setError(result.generationError ?? ""); } })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "리포트를 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [url, signedIn, attempt]);
  const facts = report?.facts;
  const text = report?.status === "ready" ? report.text : null;
  const signed = (n: number) => `${n > 0 ? "+" : ""}${score(n)}`;
  return <Modal title={`vs ${record.opponent}`} eyebrow="MATCH REPORT" onClose={onClose} size="lg">
    <div className="match-report" aria-busy={loading}>
      <p className="muted">{dateText(record.playedAt, false)} · 경기별 Performance와 가치 변동</p>
      {loading && <p role="status" className="report-notice"><Sparkles size={16} />리포트를 준비하고 있습니다.</p>}
      {error && <div className="report-notice" role="alert"><p>{error}</p><button className="button secondary small" onClick={() => setAttempt(n => n + 1)}>다시 확인</button></div>}
      {facts && <>
        <div className="report-numbers">
          <div><span>Performance</span><strong className="num">{score(facts.score)}<small>점</small></strong><small>{facts.minutes}분 출전 · {facts.scoreStatus === "provisional" ? "잠정 산정" : "산정 완료"}</small></div>
          <div><span>이번 경기 가치 변동</span><strong><Change value={facts.changePercent} /></strong><small>{money(facts.priceBefore)} P → {money(facts.priceAfter)} P</small></div>
        </div>
        {facts.scoreStatus === "provisional" && <p className="report-notice">미확인 통계를 제외한 잠정 결과입니다. 기록이 정정되면 점수와 리포트도 달라질 수 있습니다.</p>}
        <section className="report-section">
          <h3>{text ? <><Sparkles size={16} />AI 경기력 설명</> : "경기력 산정 요약"}</h3>
          {text && <p>{text.performance}</p>}
          {facts.contributions.length > 0 && <dl className="report-contributions">
            {[...facts.contributions].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 5).map(c => <div key={c.metric}><dt>{METRIC_LABELS[c.metric] || c.metric}</dt><dd className={`num ${c.points < 0 ? "down" : "up"}`}>{signed(c.points)}점</dd></div>)}
          </dl>}
        </section>
        <section className="report-section">
          <h3>{text ? "AI 가치 변동 설명" : "가치 변동 산정 요약"}</h3>
          {text ? <p>{text.value}</p> : <p>최근 출전 경기의 가중 점수로 정한 목표 가격이 직전 가격보다 {facts.targetPrice > facts.priceBefore ? "높아 상승 방향으로" : facts.targetPrice < facts.priceBefore ? "낮아 하락 방향으로" : "같아 유지 방향으로"} 반영됐습니다. 경기별 변동 제한과 출전 시간 보정이 적용됩니다.</p>}
          <dl className="report-contributions">
            <div><dt>최근 {facts.windowSize}출전 가중 점수</dt><dd className="num">{score(facts.formScore)}점</dd></div>
            <div><dt>이번 경기 목표 가격</dt><dd className="num">{money(facts.targetPrice)} P</dd></div>
          </dl>
          <p className="fine-print">최근 경기일수록 가중치가 큽니다. 출전 기록이 5경기보다 적으면 초기 보정 점수로 채웁니다. 한 경기 점수가 양수여도 가치는 하락할 수 있습니다.</p>
        </section>
        {!loading && !text && !error && <div className="report-notice">
          {!report.canGenerate ? <p>AI 설명을 준비하고 있습니다. 저장된 산정 요약은 위에서 확인할 수 있습니다.</p>
            : !data.session ? <p><Link className="text-link" href={`/login?next=${encodeURIComponent(`/players/${playerId}`)}`}>로그인</Link>하면 아직 없는 AI 설명을 작성할 수 있습니다. 작성된 리포트는 누구나 볼 수 있습니다.</p>
            : !signedIn ? <p><Link className="text-link" href="/onboarding">프로필 설정</Link> 후 AI 설명을 작성할 수 있습니다.</p>
            : report.status === "pending" ? <p>AI 설명을 작성 중입니다. 잠시 후 다시 확인해 주세요.</p>
            : report.status === "limited" ? <p>현재 생성 가능한 분량을 모두 사용했습니다. 산정 요약을 확인해 주세요.</p>
            : report.status === "cooldown" ? <p>AI 설명 작성이 지연되고 있습니다. 잠시 후 다시 확인해 주세요.</p>
            : <p>산정 결과가 갱신됐습니다. 다시 확인해 주세요.</p>}
          {report.canGenerate && signedIn && report.status !== "limited" && <button className="button secondary small" onClick={() => setAttempt(n => n + 1)}>다시 확인</button>}
        </div>}
        <p className="fine-print">{text ? `AI가 저장된 산정 결과를 설명한 참고 정보입니다. 숫자는 실제 계산 결과이며 AI가 가격을 결정하지 않습니다. · ${dateText(report.generatedAt)}` : "숫자는 서버에 저장된 실제 산정 결과입니다."}</p>
      </>}
      {!loading && !error && report?.status === "unavailable" && (report.unavailableReason === "baseline-history"
        ? <div className="report-notice"><p>이 경기는 초기 가격을 산정할 때 반영된 과거 경기입니다. 별도의 경기 전후 가격 변동 기록이 없어 AI 가치 변동 리포트는 제공되지 않습니다.</p>{record.performance != null && <p>Performance <strong className="num">{score(record.performance)}점</strong> · {record.minutes}분 출전</p>}</div>
        : <p className="report-notice">이 경기의 Performance와 가치 변동 산정 결과를 아직 함께 확인할 수 없습니다. 기록 수집·산정이 반영된 뒤 다시 확인해 주세요.</p>)}
    </div>
  </Modal>;
}
