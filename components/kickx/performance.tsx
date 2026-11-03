"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown } from "lucide-react";
import type { Player } from "@/lib/kickx/types";
import { dateText, score } from "@/lib/kickx/data";
import { METRIC_LABELS, SCORE_STATUS, warningText } from "@/lib/kickx/score-labels";
import { usePlatform } from "./provider";
import { LeagueMark } from "./ui";

type ScoreRow = NonNullable<Player["scoreDetails"]>[number];
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + score(Math.abs(n));
/** Stored Performance breakdowns per match. Only displays server results; never recalculates. */
export function PerformanceDetails({ player }: { player: Player }) {
  const { data, getTeam, getLeague } = usePlatform();
  const rows = player.scoreDetails ?? [];
  function match(row: ScoreRow) {
    const record = player.records.find((r) => r.fixtureId === row.fixture_id || r.id === row.fixture_id);
    if (record) return { title: `vs ${record.opponent}`, date: record.playedAt, leagueId:record.leagueId };
    const fixture = data.fixtures.find((f) => f.id === row.fixture_id);
    // The stored result carries only the fixture id; without a matching record the match name is unknown here.
    if (!fixture) return { title: `경기 ${row.fixture_id.replace(/^bsd-/, "#")}`, date: null, leagueId:null };
    const opponent = fixture.home === player.team ? fixture.away : fixture.home;
    return { title: `vs ${getTeam(opponent)?.name ?? "상대 팀"}`, date: fixture.startsAt, leagueId:fixture.leagueId };
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
                <details className="score-row">
                  <summary>
                    <span className="score-match">
                      <span className="score-competition"><LeagueMark league={getLeague(m.leagueId)} size="sm"/><span>{getLeague(m.leagueId)?.name??"대회 정보 없음"}</span></span>
                      <strong>{m.title}</strong>
                      <span className="num">{m.date ? dateText(m.date, false) : "—"}</span>
                    </span>
                    <span className={`score-status ${status.tone}`}>{status.label}</span>
                    <span className={`score-value num ${row.score == null ? "none" : row.score < 0 ? "neg" : ""}`}>{score(row.score)}<small>점</small></span>
                    <ChevronDown size={18} className="score-chevron" aria-hidden="true" />
                  </summary>
                  <div className="score-body">
                    {row.breakdown.length > 0 ? (
                      <table className="score-table">
                        <thead><tr><th>항목</th><th className="numeric">기록</th><th className="numeric">점수</th></tr></thead>
                        <tbody>
                          {row.breakdown.map((b) => (
                            <tr key={b.metric}>
                              <td>{METRIC_LABELS[b.metric] ?? b.metric}</td>
                              <td className="numeric num">{score(b.value)}</td>
                              <td className={`numeric num points ${b.points > 0 ? "up" : b.points < 0 ? "down" : ""}`}>{signed(b.points)}</td>
                            </tr>
                          ))}
                        </tbody>
                        {row.score != null && <tfoot><tr><td colSpan={2}>합계</td><td className="numeric num">{score(row.score)}</td></tr></tfoot>}
                      </table>
                    ) : (
                      <p className="score-empty">{row.status === "not-played" ? "미출전 경기는 경기력 점수와 출전 횟수에 포함하지 않습니다." : "점수 근거가 없습니다."}</p>
                    )}
                    {notes.length > 0 && (
                      <div className="score-notes">
                        <strong><AlertTriangle size={15} />{row.status === "blocked" ? "계산을 보류한 이유" : "확인 사항"}</strong>
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
