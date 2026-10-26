"use client";
import { usePlatform } from './provider';
import { REPORT_PARAMETERS as P } from '@/server/kickx/engine/report-policy';
const rows=[
 ['60분 이상 출전','2','2','2','2'],['60분 미만 출전','1','1','1','1'],
 ['득점','10','6','5','4'],['도움','5','4','3','3'],['유효 슈팅','—','—','0.5','1'],
 ['키패스','—','0.5','1','0.5'],['성공 크로스','—','0.5','0.5','0.5'],
 ['패스 성공률 85% 이상·시도 1회 이상','—','1','1','—'],
 ['출전 중 무실점·60분 이상·퇴장 제외','4','4','1','—'],
 ['태클 성공 + 가로채기','—','3회당 1','회당 0.5','—'],
 ['출전 중 2실점당','−1','−1','—','—'],['3선방당','1','—','—','—'],
 ['PK 선방','5','—','—','—'],['경고 / 퇴장 / 자책골','−1 / −3 / −2','−1 / −3 / −2','−1 / −3 / −2','−1 / −3 / −2'],
];
export default function ReportRules(){
 const {data}=usePlatform();
 return <div className="rules-page">
  <header className="rules-hero"><span className="tag yellow">REPORT V3</span><h1>게임 규칙</h1><p>이전 시즌의 경기력으로 초기 가격을 정하고, 이번 시즌 누적 경기력으로 가치를 갱신합니다.</p></header>
  <section className="rules-section"><h2>자산과 선수단</h2><div className="rules-policy">
   <div><span>최초 지급</span><strong className="num">{(data.policy?.initialPoints??1300000).toLocaleString()}</strong><small>P · 회원당 1회</small></div>
   <div><span>판매 수수료</span><strong className="num">{(data.policy?.sellFeeBps??200)/100}</strong><small>% · 매입 0%</small></div>
   <div><span>경기당 변동</span><strong className="num">±{P.maxUp*100}</strong><small>% · 미출전 제외</small></div></div>
   <ul className="rules-list"><li>보유 인원에는 제한이 없으며 같은 선수를 중복 보유할 수 없습니다.</li><li>선발 선수단은 4-3-3으로 최대 11명입니다. 후보로 보유한 선수와 선발 편성을 구분합니다.</li><li>5대 정규 리그 경기를 반영합니다. 경기 시작 90분 전부터 종료 확인 후 10분까지 해당 선수의 매입·매각을 제한합니다.</li><li>초기 포인트·지갑·기존 거래는 시즌이 바뀌어도 초기화하지 않습니다.</li></ul>
  </section>
  <section className="rules-section"><h2>경기 점수표</h2><div className="table-scroll"><table className="rules-table"><thead><tr><th>항목</th>{['GK','DF','MF','FW'].map(p=><th key={p}>{p}</th>)}</tr></thead><tbody>{rows.map(([name,...values])=><tr key={name}><td>{name}</td>{values.map((v,i)=><td className="numeric num" key={i}>{v}</td>)}</tr>)}</tbody></table></div><p>경기별 확정 라인업 포지션을 사용합니다. 추가시간을 포함한 실제 출전 기록을 검증하며, 미출전과 통계 미확인을 구분합니다. 경고 누적 퇴장은 앞선 경고와 퇴장을 반영합니다.</p></section>
  <section className="rules-section"><h2>초기 가격</h2><div className="rules-formula"><code>B = (이전 시즌 점수 합계 + λ × 포지션 평균) / (이전 시즌 출전 수 + λ)</code><code>초기 가격 = 최저 초기 가격 + (최고 초기 가격 − 최저 초기 가격) × 포지션 내 백분위</code></div><p>이전 시즌 모집단은 고정하며, 동점에는 중간 백분위를 적용합니다. 개인 기록이 없으면 검증된 이전 시즌 포지션 기준을 사용합니다. 포지션 기준도 없으면 가격 산정을 보류합니다.</p></section>
  <section className="rules-section"><h2>시즌 누적 가격</h2><div className="rules-formula"><code>누적 점수 C = (κ × B + 이번 시즌 보정 점수 합계) / (κ + 출전 수)</code><code>목표가격 = 초기 가격 × exp(β × 제한된 상대 경기력 변화)</code></div><p>경기 점수 원본은 보존하고 가격 계산에 사용하는 극단값만 이전 시즌 분포의 범위로 제한합니다. 시즌의 모든 유효 출전을 한 번씩 반영하며 경기당 변동은 ±2% 이내입니다. 정정 시 같은 기준부터 재계산하고 체결된 거래를 소급 변경하지 않습니다.</p><p className="fine-print">기본 계수: λ={P.lambda}, κ={P.kappa}, β={P.beta}, 분모 하한={P.s}, 편차 범위=±{P.deviationLimit}. 초기·전체 가격 범위 {P.minPrice.toLocaleString()}~{P.maxPrice.toLocaleString()}P. 팀 승리 별도 가점은 없습니다.</p></section>
 </div>;
}
