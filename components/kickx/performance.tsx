"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown } from "lucide-react";
import type { Player } from "@/lib/kickx/types";
import { dateText, score, money } from "@/lib/kickx/data";
import { METRIC_LABELS, SCORE_STATUS, warningText } from "@/lib/kickx/score-labels";
import { usePlatform } from "./provider";

type ScoreRow = NonNullable<Player["scoreDetails"]>[number];
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + score(Math.abs(n));
/** Stored Performance breakdowns per match. Only displays server results; never recalculates. */
export function PerformanceDetails({ player }: { player: Player }) {
  const { data, getTeam } = usePlatform();
  const rows = player.scoreDetails ?? [];
  function match(row: ScoreRow) {
    const record = player.records.find((r) => r.id === row.fixture_id);
    if (record) return { title: `vs ${record.opponent}`, date: record.playedAt };
    const fixture = data.fixtures.find((f) => f.id === row.fixture_id);
    // The stored result carries only the fixture id; without a matching record the match name is unknown here.
    if (!fixture) return { title: `경기 ${row.fixture_id.replace(/^bsd-/, "#")}`, date: null };
    const opponent = fixture.home === player.team ? fixture.away : fixture.home;
    return { title: `vs ${getTeam(opponent)?.name ?? "상대 팀"}`, date: fixture.startsAt };
  }
  const counts = Object.fromEntries(Object.keys(SCORE_STATUS).map((k) => [k, rows.filter((r) => r.status === k).length]));
  const baseline=player.pricing?.baseline;
  const lastPrice=player.pricing?.recent[0];
  return (<>
    {baseline && <section className="panel score-panel">
      <div className="score-panel-head"><div><h2>선수 가치 산정 근거</h2><p>과거 경기로 최초 기준을 만들고, 최근 5출전 점수로 경기마다 가치를 갱신합니다.</p></div><Link className="text-link" href="/rules">가격 규칙 보기 <ArrowRight size={14}/></Link></div>
      <dl className="rules-policy"><div><dt>초기 가격</dt><dd className="num">{money(baseline.price)}P</dd></div><div><dt>초기 평가 기록</dt><dd>{baseline.gameCount}출전 경기 · {baseline.source==='previous-season'?'이전 시즌':baseline.source==='available-history'?'확보된 과거 기록':'기록 부족 · 기준값'}</dd></div><div><dt>초기 보정 점수</dt><dd className="num">{score(baseline.seedScore)}</dd></div>{lastPrice&&<div><dt>최근 5경기 가중 점수</dt><dd className="num">{score(lastPrice.form_score)}</dd></div>}</dl>
      {baseline.warnings.length>0&&<p className="fine-print">{baseline.source!=='previous-season'?'직전 시즌 자료가 없어 확보된 기록 또는 기준 점수로 평가했습니다. ':''}{baseline.gameCount<10?'출전 기록이 적어 기준 점수와 섞어 보정했습니다. ':''}{baseline.warnings.includes('PROVISIONAL_HISTORY')?'잠정 경기 점수가 포함되어 기록 확인 후 값이 달라질 수 있습니다.':''}</p>}
      {lastPrice&&<p>최근 반영 경기: {dateText(lastPrice.played_at,false)} · {lastPrice.window_fixture_ids.length}경기 사용 · 목표가 {money(lastPrice.target_price)}P · {money(lastPrice.price_before)}P → {money(lastPrice.price_after)}P</p>}
    </section>}
    <section className="panel score-panel">
      <div className="score-panel-head">
        <div>
          <h2>Performance 산정 내역</h2>
          <p>경기별 점수 근거입니다. 점수는 서버에 저장된 결과이며 잠정 점수는 기록 검증 후 달라질 수 있습니다.</p>
        </div>
        <Link className="text-link" href="/rules">점수표 보기 <ArrowRight size={14} /></Link>
      </div>
      {rows.length > 0 && (
        <div className="score-summary">
          {Object.entries(SCORE_STATUS).map(([key, s]) => counts[key] > 0 && (
            <span key={key} className={`score-status ${s.tone}`}>{s.label} <b className="num">{counts[key]}</b></span>
          ))}
          <span className="tag outline">{rows[0].rule_version}</span>
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
                      <p className="score-empty">{row.status === "not-played" ? "출전 기록이 없어 점수와 가치 변동이 없습니다." : "점수 근거가 없습니다."}</p>
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
    </section></>
  );
}
