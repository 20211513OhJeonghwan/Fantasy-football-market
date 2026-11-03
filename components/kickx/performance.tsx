"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown, Info } from "lucide-react";
import type { Player } from "@/lib/kickx/types";
import { dateText, score } from "@/lib/kickx/data";
import { METRIC_LABELS, SCORE_STATUS, warningText } from "@/lib/kickx/score-labels";
import { usePlatform } from "./provider";
import { LeagueMark } from "./ui";

type ScoreRow = NonNullable<Player["scoreDetails"]>[number];
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + score(Math.abs(n));
function resultTone(result: string | null) { return !result ? "" : /승/.test(result) ? "win" : /패/.test(result) ? "loss" : /무/.test(result) ? "draw" : ""; }
/**
 * Stored items for one match: the split bar shows how gains and deductions add up to the stored total,
 * then items by impact. Values come from `row.breakdown` as saved; nothing is recomputed or filled in.
 */
function ScoreBreakdown({ row }: { row: ScoreRow }) {
  const items = [...row.breakdown].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const gain = items.filter(b => b.points > 0).reduce((s, b) => s + b.points, 0);
  const loss = items.filter(b => b.points < 0).reduce((s, b) => s - b.points, 0);
  const scale = Math.max(1, ...items.map(b => Math.abs(b.points)));
  return (
    <div className="score-breakdown">
      <div className="score-split" role="img" aria-label={`가점 ${signed(gain)}, 감점 ${signed(-loss)}, 합계 ${score(row.score)}점`}>
        <div className="score-split-bar">
          {gain + loss > 0 && <><i className="gain" style={{ flexGrow: gain }} /><i className="loss" style={{ flexGrow: loss }} /></>}
        </div>
        <dl>
          <div><dt>가점</dt><dd className="num up">{signed(gain)}</dd></div>
          <div><dt>감점</dt><dd className={`num ${loss ? "down" : ""}`}>{loss ? signed(-loss) : "0"}</dd></div>
          <div className="total"><dt>합계</dt><dd className="num">{score(row.score)}점</dd></div>
        </dl>
      </div>
      <ul className="score-items">
        {items.map(b => (
          <li key={b.metric} className={b.points > 0 ? "up" : b.points < 0 ? "down" : ""}>
            <span className="score-item-label">{METRIC_LABELS[b.metric] ?? b.metric}<small className="num">기록 {score(b.value)}</small></span>
            <span className="score-item-bar" aria-hidden="true"><i style={{ width: `${(Math.abs(b.points) / scale) * 100}%` }} /></span>
            <b className="num">{signed(b.points)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
/** Stored Performance breakdowns per match. Only displays server results; never recalculates. */
export function PerformanceDetails({ player }: { player: Player }) {
  const { data, getTeam, getLeague } = usePlatform();
  const rows = player.scoreDetails ?? [];
  function match(row: ScoreRow) {
    const record = player.records.find((r) => r.fixtureId === row.fixture_id || r.id === row.fixture_id);
    if (record) return { title: `vs ${record.opponent}`, date: record.playedAt, leagueId:record.leagueId, result:record.result, minutes:record.minutes };
    const fixture = data.fixtures.find((f) => f.id === row.fixture_id);
    // The stored result carries only the fixture id; without a matching record the match name is unknown here.
    if (!fixture) return { title: `경기 ${row.fixture_id.replace(/^bsd-/, "#")}`, date: null, leagueId:null, result:null, minutes:null };
    const opponent = fixture.home === player.team ? fixture.away : fixture.home;
    return { title: `vs ${getTeam(opponent)?.name ?? "상대 팀"}`, date: fixture.startsAt, leagueId:fixture.leagueId, result:null as string | null, minutes:null as number | null };
  }
  const counts = Object.fromEntries(Object.keys(SCORE_STATUS).map((k) => [k, rows.filter((r) => r.status === k).length]));
  counts.ready=(counts.ready??0)+(counts.provisional??0);
  return (
    <section className="panel score-panel">
      <div className="score-panel-head">
        <div>
          <h2>Performance 산정 내역</h2>
          <p>확인된 경기 기록으로 산정한 점수입니다. 경기를 펼치면 항목별 기여를 확인할 수 있습니다.</p>
        </div>
        <Link className="text-link" href="/rules">점수표 보기 <ArrowRight size={14} /></Link>
      </div>
      {rows.length > 0 && (
        <div className="score-summary">
          {Object.entries(SCORE_STATUS).map(([key, s]) => key!=="provisional" && counts[key] > 0 && (
            <span key={key} className={`score-status ${s.tone}`}>{s.label} <b className="num">{counts[key]}</b></span>
          ))}
        </div>
      )}
      {rows.length ? (
        <ul className="score-list">
          {rows.map((row) => {
            const m = match(row), status = SCORE_STATUS[row.status] ?? { label: row.status, tone: "off" as const };
            const notes = [...new Set(row.warnings.map(warningText))];
            return (
              <li key={row.fixture_id}>
                <details className={`score-row ${row.status}`}>
                  <summary>
                    <span className="score-competition"><LeagueMark league={getLeague(m.leagueId)} size="sm"/><span>{getLeague(m.leagueId)?.name??"대회 정보 없음"}</span></span>
                    <span className="score-match">
                      <strong>{m.title}</strong>
                      <span className="num">{m.date ? dateText(m.date, false) : "—"}</span>
                    </span>
                    <span className={`score-result ${resultTone(m.result)}`}>{m.result ?? "—"}</span>
                    <span className="score-minutes num">{m.minutes != null ? `${m.minutes}′` : "—"}</span>
                    <span className={`score-status ${status.tone}`}>{status.label}</span>
                    <span className={`score-value num ${row.score == null ? "none" : row.score < 0 ? "neg" : ""}`}>{score(row.score)}<small>점</small></span>
                    <ChevronDown size={18} className="score-chevron" aria-hidden="true" />
                  </summary>
                  <div className="score-body">
                    {row.breakdown.length > 0 ? <ScoreBreakdown row={row} /> : (
                      <p className="score-empty">{row.status === "not-played" ? "미출전 경기는 경기력 점수와 출전 횟수에 포함하지 않습니다." : "점수 근거가 없습니다."}</p>
                    )}
                    {notes.length > 0 && (
                      <div className={`score-notes ${row.status === "blocked" ? "blocked" : ""}`}>
                        <strong>{row.status === "blocked" ? <><AlertTriangle size={15} />필수 기록 확인이 필요해 보류했습니다</> : <><Info size={15} />산정 기준</>}</strong>
                        <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
                        <details className="score-codes"><summary>원본 코드</summary><code>{row.warnings.join(" · ")}</code></details>
                      </div>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="score-empty">아직 저장된 산정 내역이 없습니다. 경기 데이터 수집과 자동 산정 후 표시됩니다.</p>
      )}
    </section>
  );
}
