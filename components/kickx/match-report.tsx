"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { reportSentences } from '@/lib/kickx/match-report';
import { createReportLoader, emptyReportLoad, type ReportLoadState } from '@/lib/kickx/report-client';
import type { PlayerRecord } from "@/lib/kickx/types";
import { dateText, money, score } from "@/lib/kickx/data";
import { METRIC_LABELS } from "@/lib/kickx/score-labels";
import { Modal, Change } from "./ui";
import { usePlatform } from "./provider";

// No persistent browser storage, background polling, or page-load report fetches.
const loader = createReportLoader();

export function MatchReportDialog({ playerId, record, onClose }: { playerId: string; record: PlayerRecord; onClose: () => void }) {
  const { data } = usePlatform();
  const [snapshot, setSnapshot] = useState<{ key: string; state: ReportLoadState }>({ key: '', state: emptyReportLoad() });
  const [attempt, setAttempt] = useState(0);
  const signedIn = !!data.session?.profile;
  const userId = data.session?.userId ?? '';
  const url = `/api/kickx/players/${encodeURIComponent(playerId)}/matches/${encodeURIComponent(record.fixtureId!)}/report`;
  const key = `${userId}:${url}`;
  const { report, loading, generating, error } = snapshot.key === key ? snapshot.state : emptyReportLoad();
  useEffect(() => {
    if (!signedIn) return;
    return loader.subscribe(userId, url, state => setSnapshot({ key: `${userId}:${url}`, state }));
  }, [url, signedIn, userId, attempt]);
  if (!signedIn) return null;
  const facts = report?.facts;
  const text = report?.status === "ready" ? report.text : null;
  const signed = (n: number) => `${n > 0 ? "+" : ""}${score(n)}`;
  return <Modal title={`vs ${record.opponent}`} eyebrow={`MATCH REPORT · ${dateText(record.playedAt, false)}`} onClose={onClose} size="lg">
    <div className="match-report" aria-busy={loading}>
      {loading && <p role="status" className="report-notice"><Sparkles size={16} />리포트를 준비하고 있습니다.</p>}
      {error && <div className="report-notice" role="alert"><p>{error}</p><button className="button secondary small" onClick={() => setAttempt(n => n + 1)}>다시 확인</button></div>}
      {facts && <>
        <div className="report-numbers">
          <div><span>Performance</span><strong className="num">{score(facts.score)}<small>점</small></strong><small>{facts.minutes}분 출전 · {facts.scoreStatus === "provisional" ? "확인 기록 기준" : "산정 완료"}</small></div>
          <div><span>이번 경기 가치 변동</span><strong><Change value={facts.changePercent} /></strong><small>{money(facts.priceBefore)} P → {money(facts.priceAfter)} P</small></div>
        </div>
        {text && <section className="report-section">
          <h3><Sparkles size={16} />AI 경기력 설명</h3>
          <div className="report-explanation">{reportSentences(text.performance).map((sentence,i)=><p key={i}>{sentence}</p>)}</div>
        </section>}
        {(facts.contributions.length > 0 || !text) && <section className="report-section">
          <div className="report-section-head"><h3>{text ? "점수 기여 항목" : "경기력 산정 요약"}</h3>{facts.contributions.length > 0 && <small>영향이 큰 순</small>}</div>
          {facts.contributions.length > 0 && <dl className="report-contributions">
            {[...facts.contributions].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 5).map(c => <div key={c.metric}><dt>{METRIC_LABELS[c.metric] || c.metric}</dt><dd className={`num ${c.points < 0 ? "down" : c.points > 0 ? "up" : ""}`}>{signed(c.points)}점</dd></div>)}
          </dl>}
        </section>}
        {generating && <p role="status" className="report-notice"><Sparkles size={16} />AI 경기력 설명을 작성하고 있습니다. 산정 요약을 먼저 확인해 주세요.</p>}
        {!loading && !generating && !text && !error && <div className="report-notice">
          {!report.canGenerate ? <p>현재 AI 설명을 제공할 수 없습니다. 저장된 산정 요약은 위에서 확인할 수 있습니다.</p>
            : report.status === "pending" ? <p>AI 설명을 작성 중입니다. 잠시 후 다시 확인해 주세요.</p>
            : report.status === "limited" ? <p>현재 생성 가능한 분량을 모두 사용했습니다. 산정 요약을 확인해 주세요.</p>
            : report.status === "cooldown" ? <p>AI 설명 작성이 지연되고 있습니다. 잠시 후 다시 확인해 주세요.</p>
            : <p>산정 결과가 갱신됐습니다. 다시 확인해 주세요.</p>}
          {report.canGenerate && signedIn && report.status !== "limited" && <button className="button secondary small" onClick={() => setAttempt(n => n + 1)}>다시 확인</button>}
        </div>}
        <p className="fine-print">{text ? "AI가 실제 경기 기록과 점수 산정 내역을 바탕으로 작성한 설명입니다." : "숫자는 서버에 저장된 실제 산정 결과입니다."}</p>
      </>}
      {!loading && !error && report?.status === "unavailable" && (report.unavailableReason === "baseline-history"
        ? <div className="report-notice"><p>이 경기는 초기 가격을 산정할 때 반영된 과거 경기입니다. 별도의 경기 전후 가격 변동 기록이 없어 AI 가치 변동 리포트는 제공되지 않습니다.</p>{record.performance != null && <p>Performance <strong className="num">{score(record.performance)}점</strong> · {record.minutes}분 출전</p>}</div>
        : <p className="report-notice">이 경기의 Performance와 가치 변동 산정 결과를 아직 함께 확인할 수 없습니다. 기록 수집·산정이 반영된 뒤 다시 확인해 주세요.</p>)}
    </div>
  </Modal>;
}
