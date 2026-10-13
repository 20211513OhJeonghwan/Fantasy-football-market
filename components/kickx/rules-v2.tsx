"use client";
import Link from "next/link";
import { usePlatform } from "./provider";
import LegacyRules from "./rules-legacy";
import { SCORING as S, PRICING as P, RULE_VERSION } from "@/server/kickx/engine/policy";
import { calculatePerformance } from "@/server/kickx/engine/performance";
import { METRIC_LABELS } from "@/lib/kickx/score-labels";
const ROWS = [
 ["실제 출전", ...Array(4).fill(`${S.appearance} + ${S.fullMinutes} × 출전분/90`)],
 ["득점", ...Object.values(S.goals).map(String)],
 ["도움", ...Array(4).fill(String(S.assist))],
 ["유효 슈팅 / 키패스 / 성공 크로스", "—", ...Array(3).fill(`${S.shotOnTarget} / ${S.keyPass} / ${S.cross}`)],
 ["성공 태클 / 가로채기", "—", ...Array(3).fill(`${S.tackle} / ${S.interception}`)],
 ["패스 30회 이상·성공률 85% 이상", "—", ...Array(3).fill(String(S.passBonus))],
 ["팀 무실점·출전시간 비례", ...Object.values(S.cleanSheet).map(v=>v ? `${v} × 출전분/90` : "—")],
 ["팀 승리·출전시간 비례", ...Array(4).fill(`${S.teamWin} × 출전분/90`)],
 ["출전 중 실점 1골", String(S.conceded),String(S.conceded),"—","—"],
 ["선방 / PK 선방", `${S.save} / ${S.penaltySave}`,"—","—","—"],
 ["경고 / 퇴장 / 자책골", ...Array(4).fill(`${S.yellow} / ${S.red} / ${S.ownGoal}`)],
];
export default function Rules() {
 const {data} = usePlatform();
 // Until the DB migration is applied, the page continues to explain the live v1 rule.
 if (data.policy?.version !== RULE_VERSION) return <LegacyRules />;
 const players=Array.from({length:11},(_,i)=>({id:i+1,position:'D'}));
 const sample=calculatePerformance({fixtureId:'example',playerId:'bsd-2',teamId:'bsd-1',status:'FT',homeTeam:'bsd-1',awayTeam:'bsd-2',homeScore:0,awayScore:0,stats:{minutes_played:90,goals:0,won_tackle:3,interception:3,total_pass:40,accurate_pass:36},legacy:null,source:{lineups:{lineup_status:'confirmed',lineups:{home:{team_id:1,players},away:{team_id:2,players:players.map(p=>({...p,id:p.id+11}))}}},incidents:{incidents:[]}}});
 return <div className="rules-page">
  <header className="rules-hero"><span className="tag yellow">FORM V2</span><h1>게임 규칙</h1><p>경기마다 활약을 점수로 기록하고, 최근 5출전 경기의 흐름으로 선수 가치를 갱신합니다.</p><nav className="rules-toc" aria-label="규칙 목차"><a href="#points">초기 가격과 가치</a><a href="#score">경기 점수표</a><a href="#example">계산 예시</a><a href="#ranking">랭킹</a></nav></header>
  <section id="points" className="rules-section"><h2><span className="rules-step num">01</span>초기 가격과 가치 변동</h2>
   <div className="rules-policy">{[['최초 지급','1,300,000','P · 회원당 1회'],['점수 환산','2,000','P · 점수 1점당'],['매각 수수료','2','% · 매입 0%'],['경기당 변동','±8','% · 짧은 출전은 축소']].map(([label,value,unit])=><div key={label}><span>{label}</span><strong className="num">{value}</strong><small>{unit}</small></div>)}</div>
   <div className="rules-formula"><span>초기 가격</span><code>(과거 점수 합계 + 50 × 5) / (과거 출전 경기 수 + 5) × 2,000P</code><small>직전 시즌 우선 · 자료가 없으면 확보한 과거 기록 · 확인된 출전 경기만 사용</small></div>
   <div className="rules-formula"><span>경기 후 가격</span><code>최근 5출전 점수 × 최신부터 5:4:3:2:1 → 목표가 → 현재가에서 차이의 40% 이동</code><small>목표가 = 가중 점수 × 2,000P · 경기당 ±8% · 가격 범위 {P.minPrice.toLocaleString()} ~ {P.maxPrice.toLocaleString()}P</small></div>
   <ul className="rules-list"><li>확보한 과거 기록과 5경기 분량의 기준 점수 50점을 섞어 작은 표본을 보정합니다. API 자료 누락을 실제 0점으로 취급하지 않습니다.</li><li>최근 출전 기록이 5경기보다 적으면 나머지 칸을 선수의 초기 보정 점수로 채웁니다.</li><li>60분 미만 출전은 변동 상한을 출전분/60만큼 줄입니다. 미출전은 점수·평균·가격 변동에서 제외합니다.</li><li>목표가에 가까워지면 같은 활약으로 계속 복리 상승하지 않습니다. 시즌이 바뀌어도 자산과 가격을 초기화하지 않습니다.</li><li>시스템 상대 거래이며 수요·거래량은 가격에 반영하지 않습니다. 경기 기록 정정은 최초 기준부터 다시 계산하며 이전 발행 내역은 보존합니다.</li><li>여러 경기를 한 번에 반영하거나 규칙을 전환하면 직전 발행 대비 변화가 경기당 상한보다 클 수 있습니다.</li></ul>
  </section>
  <section id="score" className="rules-section"><h2><span className="rules-step num">02</span>경기 점수표</h2><p className="rules-lead">해당 경기의 확정 라인업 포지션을 사용합니다. 100점 상한 없이 공격·수비·팀 기여를 합산합니다.</p><div className="table-scroll"><table className="rules-table"><thead><tr><th>항목</th>{['GK','DF','MF','FW'].map(p=><th key={p} className="numeric">{p}</th>)}</tr></thead><tbody>{ROWS.map(([label,...values])=><tr key={label}><td>{label}</td>{values.map((value,i)=><td key={i} className="numeric num">{value}</td>)}</tr>)}</tbody></table></div><ul className="rules-notes"><li>팀 무실점은 최종 스코어 기준이며 퇴장 선수는 보너스에서 제외합니다. 실점 감점은 실제 출전 중 실점만 반영합니다.</li><li>득점과 유효 슈팅은 함께 가산합니다. 두 번째 경고에 의한 퇴장은 앞선 경고와 퇴장만 반영합니다.</li><li>각 기여를 소수 둘째 자리로 반올림해 합산합니다. 확정할 수 없는 세부 통계는 제외하고 잠정 점수로 표시합니다.</li><li>핵심 기록이 불완전하거나 연장·승부차기이면 계산을 보류합니다. 완료 경기의 보류 상태를 최근 5경기에서 몰래 빼고 가격을 바꾸지 않습니다.</li></ul></section>
  <section id="example" className="rules-section rules-example"><h2><span className="rules-step num">03</span>계산 예시 <span className="tag yellow">설명용</span></h2><p className="rules-lead">수비수 90분·팀 무실점·성공 태클 3회·가로채기 3회·패스 36/40</p><div className="rules-equation">{sample.breakdown.filter(b=>b.points>0).map((b,i)=><span className="rules-term" key={b.metric}>{i>0&&<i>+</i>}<b className="num">{b.points}</b><small>{METRIC_LABELS[b.metric]??b.metric}</small></span>)}<span className="rules-term total"><i>=</i><b className="num">{sample.score}</b><small>Performance</small></span></div><p className="fine-print">과거 10경기 평균 80점인 선수의 초기 보정 점수는 70점, 초기 가격은 140,000P입니다. 실제 선수 가격은 제공된 기록과 최근 5경기에 따라 달라집니다.</p></section>
  <section id="ranking" className="rules-section"><h2><span className="rules-step num">04</span>랭킹</h2><ul className="rules-list"><li>주간은 한국 시간 월요일 00시, 월간은 매월 1일 00시 기준 총자산 수익률을 비교합니다.</li><li>가격 발행·자산 변경과 정기 작업에 따라 자동 갱신합니다. 기간 중 가입자는 최초 지급액을 기준으로 비교합니다.</li></ul><div className="button-row"><Link className="button primary" href="/players">선수 탐색</Link><Link className="button secondary" href="/ranking">랭킹 보기</Link></div></section>
 </div>;
}
