import Link from "next/link";
import { calculatePerformance, priceFromScores } from "@/server/kickx/engine/legacy-performance";

const ROWS: [string, string, string, string, string][] = [
  ["60분 이상 / 미만 출전", "2 / 1", "2 / 1", "2 / 1", "2 / 1"],
  ["득점", "10", "6", "5", "4"],
  ["도움", "5", "4", "3", "3"],
  ["유효 슈팅", "—", "—", "0.5", "1"],
  ["키패스", "—", "0.5", "1", "0.5"],
  ["성공 크로스", "—", "0.5", "0.5", "0.5"],
  ["30회 이상 패스, 성공률 85% 이상", "—", "1", "1", "—"],
  ["60분 이상 무실점", "4", "4", "1", "—"],
  ["성공 태클 + 가로채기 3회당", "—", "1", "0.5", "—"],
  ["실점 2골당", "−1", "−1", "—", "—"],
  ["선방 3회당 / PK 선방", "1 / 5", "—", "—", "—"],
  ["경고 / 퇴장 / 자책골", "−1 / −3 / −2", "−1 / −3 / −2", "−1 / −3 / −2", "−1 / −3 / −2"],
];
const POLICY: [string, string, string][] = [
  ["최초 지급", "1,300,000", "P · 회원당 1회"],
  ["선수 기본 가치", "100,000", "P · 첫 산정 기준"],
  ["매각 수수료", "2", "% · 매입은 0%"],
  ["경기별 변화율", "±5", "% · 최대"],
];
const EXAMPLE_PARTS: [string, number][] = [["출전 90분", 2], ["무실점", 4], ["태클+가로채기 6회", 2], ["패스 36/40", 1]];

export default function LegacyRules() {
  const players = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, position: i === 0 ? "G" : "D" }));
  const example = calculatePerformance({
    fixtureId: "example", playerId: "bsd-2", teamId: "bsd-1", status: "FT", homeTeam: "bsd-1", awayTeam: "bsd-2", homeScore: 0, awayScore: 0,
    stats: { minutes_played: 90, goals: 0, won_tackle: 3, interception: 3, total_pass: 40, accurate_pass: 36 }, legacy: null,
    source: { lineups: { lineup_status: "confirmed", lineups: { home: { team_id: 1, players }, away: { team_id: 2, players: players.map((p) => ({ ...p, id: p.id + 11 })) } } }, incidents: { incidents: [] } },
  });
  const after = priceFromScores([example]);
  return (
    <div className="rules-page">
      <header className="rules-hero">
        <span className="tag yellow">PROTOTYPE V1 · 시범 정책</span>
        <h1>게임 규칙</h1>
        <p>명세서 점수표를 토대로 한 잠정 규칙입니다. 실제 경기 데이터와 사용 경험을 보고 조정합니다.</p>
        <nav className="rules-toc" aria-label="규칙 목차">
          <a href="#points">포인트와 자산</a><a href="#score">경기 점수표</a><a href="#example">계산 예시</a><a href="#ranking">랭킹</a>
        </nav>
      </header>

      <section id="points" className="rules-section">
        <h2><span className="rules-step num">01</span>포인트와 선수 자산</h2>
        <div className="rules-policy">
          {POLICY.map(([label, value, unit]) => (
            <div key={label}><span>{label}</span><strong className="num">{value}</strong><small>{unit}</small></div>
          ))}
        </div>
        <div className="rules-formula">
          <span>경기별 가치 변화율</span>
          <code>(Performance − 4) %</code>
          <small>최소 −5%, 최대 +5% · 가치 범위 10,000 ~ 1,000,000P</small>
        </div>
        <ul className="rules-list">
          <li>경기 시작 90분 전부터 종료 확인 후 10분까지 해당 구단 선수의 매입·매각을 제한합니다. 연장전·승부차기도 종료를 확인한 뒤 계산합니다.</li>
          <li>사용자는 시스템을 상대로 매입·매각합니다. 거래량이나 수요는 가격을 바꾸지 않습니다.</li>
          <li>같은 선수는 회원당 한 명만 보유할 수 있습니다. 다른 회원은 같은 선수를 보유할 수 있습니다.</li>
          <li>완료된 유효 경기를 시간순으로 적용하며, 경기마다 1P 단위로 반올림합니다.</li>
          <li>미출전·계산 보류 경기는 가격에 반영하지 않습니다. Performance는 음수와 소수를 포함한 원점수입니다.</li>
        </ul>
      </section>

      <section id="score" className="rules-section">
        <h2><span className="rules-step num">02</span>경기 점수표</h2>
        <p className="rules-lead">점수는 현재 소속 포지션이 아니라 해당 경기의 확정 라인업 포지션 기준입니다.</p>
        <div className="table-scroll">
          <table className="rules-table">
            <thead>
              <tr><th>항목</th>{["GK", "DF", "MF", "FW"].map((p) => <th key={p} className="numeric"><span className={`position ${p.toLowerCase()}`}>{p}</span></th>)}</tr>
            </thead>
            <tbody>
              {ROWS.map(([label, ...values]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {values.map((v, i) => <td key={i} className={`numeric num ${v.startsWith("−") ? "down" : v === "—" ? "none" : ""}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="rules-notes">
          <li>MF의 태클·가로채기 점수는 명세서의 모호한 단위를 3회당 0.5점으로 해석했습니다.</li>
          <li>연장전·승부차기 경기는 세부 규칙 검토 전까지 계산을 보류합니다.</li>
          <li>퇴장 이후의 실점도 반영하며, 퇴장 선수는 무실점 보너스를 받지 못합니다.</li>
          <li>확인되지 않은 기록은 0으로 확정하지 않고 점수에서 제외한 뒤 잠정 산정으로 표시합니다.</li>
        </ul>
      </section>

      <section id="example" className="rules-section rules-example">
        <h2><span className="rules-step num">03</span>계산 예시 <span className="tag yellow">예시 데이터</span></h2>
        <p className="rules-lead">수비수가 90분 무실점, 성공 태클 3회 + 가로채기 3회, 패스 40회 중 36회 성공을 기록한 경우</p>
        <div className="rules-equation">
          {EXAMPLE_PARTS.map(([label, points], i) => (
            <span key={label} className="rules-term">{i > 0 && <i aria-hidden="true">+</i>}<b className="num">{points}</b><small>{label}</small></span>
          ))}
          <span className="rules-term total"><i aria-hidden="true">=</i><b className="num">{example.score ?? "—"}</b><small>Performance</small></span>
        </div>
        <div className="rules-price">
          <span className="num">100,000P</span>
          <span className="rules-arrow" aria-hidden="true">→</span>
          <strong className="num">{after.toLocaleString("ko-KR")}P</strong>
          <span className="change up">{after >= 100_000 ? "+" : "−"}{Math.abs((after - 100_000) / 1_000)}%</span>
        </div>
        <p className="fine-print">이 숫자는 실제 계산 함수로 만든 설명용 예시이며, 저장된 선수 기록이나 거래가 아닙니다.</p>
      </section>

      <section id="ranking" className="rules-section">
        <h2><span className="rules-step num">04</span>랭킹</h2>
        <ul className="rules-list">
          <li>주간은 한국 시간 월요일 00시, 월간은 매월 1일 00시 기준 총자산 수익률을 비교합니다.</li>
          <li>기간 중 가입한 회원은 실제 최초 지급액이 기준입니다. 동률은 공동 순위입니다.</li>
          <li>자산 변경과 정기 작업을 통해 랭킹이 자동 갱신됩니다.</li>
          <li>실제 적용값은 서버가 발행한 거래 견적이 기준입니다.</li>
        </ul>
        <div className="button-row"><Link className="button primary" href="/players">선수 탐색</Link><Link className="button secondary" href="/ranking">랭킹 보기</Link></div>
      </section>
    </div>
  );
}
