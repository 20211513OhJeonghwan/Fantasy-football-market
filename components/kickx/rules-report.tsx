"use client";
import { usePlatform } from './provider';
import { REPORT_PARAMETERS as P } from '@/server/kickx/engine/report-policy';
import { dateText } from '@/lib/kickx/data';
const rows=[
 ['확인된 출전 · 중립 기본 평가','6','6','6','6'],
 ['득점','4','3','2.5','2'],['도움','2','1.5','1.5','1.5'],['유효 슈팅','—','—','0.2','0.25'],
 ['키패스','—','0.15','0.25','0.15'],['성공 크로스','—','0.1','0.1','0.1'],
 ['패스 성공률 85% 이상·시도 1회 이상','—','0.3','0.3','—'],
 ['출전 중 무실점·60분 이상·퇴장 제외','1','1','0.3','—'],
 ['태클 성공 + 가로채기','—','3회당 0.3','회당 0.15','—'],
 ['출전 중 2실점당','−0.5','−0.5','—','—'],['3선방당','0.5','—','—','—'],
 ['PK 선방','3','—','—','—'],['경고 / 퇴장 / 자책골','−0.7 / −2.5 / −1.5','−0.7 / −2.5 / −1.5','−0.7 / −2.5 / −1.5','−0.7 / −2.5 / −1.5'],
];
export default function ReportRules(){
 const {data}=usePlatform();
 const parameters={
  initialMin:data.policy?.reportParameters?.initialMin??P.initialMin,
  initialMax:data.policy?.reportParameters?.initialMax??P.initialMax,
  minPrice:data.policy?.reportParameters?.minPrice??P.minPrice,
  maxPrice:data.policy?.reportParameters?.maxPrice??P.maxPrice,
 };
 const startMs=data.policy?.reportParameters?.valuationStartMs;
 const startDate=dateText(startMs!=null?new Date(startMs).toISOString():data.policy?.pricingReferenceAt);
 const startLabel=startDate==='—'?'서비스 가격 발행 시작 시점':`${startDate} KST`;
 return <div className="rules-page">
  <header className="rules-hero"><span className="tag yellow">KICK-X</span><h1>게임 규칙</h1><p>이전 시즌의 경기력으로 초기 가격을 정하고, 각 경기의 평가 점수로 가치를 갱신합니다.</p></header>
  <section className="rules-section"><h2>자산과 선수단</h2><div className="rules-policy">
   <div><span>최초 지급</span><strong className="num">{(data.policy?.initialPoints??1300000).toLocaleString()}</strong><small>P · 회원당 1회</small></div>
   <div><span>판매 수수료</span><strong className="num">{(data.policy?.sellFeeBps??200)/100}</strong><small>% · 매입 0%</small></div>
   <div><span>경기당 변동</span><strong className="num">±{P.maxUp*100}</strong><small>% · 확인된 미출전은 −1.5%</small></div></div>
   <ul className="rules-list"><li>최대 11명까지 보유하며 같은 선수를 중복 보유할 수 없습니다.</li><li>4-3-3 기준 GK 1명·DF 4명·MF 3명·FW 3명입니다. 매입하면 자동으로 해당 포지션의 빈자리에 들어가며, 매각하면 자리가 비워집니다.</li><li>5대 정규 리그 경기를 반영합니다. 경기 시작 90분 전부터 종료 확인 후 10분까지 해당 선수의 매입·매각을 제한합니다.</li><li>해당 경기의 구단 소속이 확인된 미출전 선수는 직전 가격에서 1.5% 하락합니다. 미출전에는 경기력 점수를 부여하지 않으며 통계 누락을 미출전으로 취급하지 않습니다.</li><li>{startLabel} 이전 출전도 경기력 기록에 남기며, 가격 변동은 이 시점 이후 경기 종료를 기준으로 기록합니다.</li><li>초기 포인트·지갑·기존 거래는 시즌이 바뀌어도 초기화하지 않습니다.</li></ul>
  </section>
  <section className="rules-section"><h2>경기 점수표</h2><div className="table-scroll"><table className="rules-table"><thead><tr><th>항목</th>{['GK','DF','MF','FW'].map(p=><th key={p}>{p}</th>)}</tr></thead><tbody>{rows.map(([name,...values])=><tr key={name}><td>{name}</td>{values.map((v,i)=><td className="numeric num" key={i}>{v}</td>)}</tr>)}</tbody></table></div><p>경기별 확정 라인업 포지션을 사용합니다. 추가시간을 포함한 실제 출전 기록을 검증하며, 미출전과 통계 미확인을 구분합니다. 경고 누적 퇴장은 앞선 경고와 퇴장을 반영합니다.</p></section>
  <section className="rules-section"><h2>초기 가격</h2><div className="rules-formula"><code>B = (이전 시즌 점수 합계 + λ × 포지션 평균) / (이전 시즌 출전 수 + λ)</code><code>초기 가격 = 최저 초기 가격 + (최고 초기 가격 − 최저 초기 가격) × 포지션 내 백분위</code></div><p>이전 시즌 모집단은 고정하며, 동점에는 중간 백분위를 적용합니다. 개인 기록이 없으면 검증된 이전 시즌 포지션 기준을 사용합니다. 포지션 기준도 없으면 가격 산정을 보류합니다.</p></section>
  <section className="rules-section"><h2>경기별 가치 변동</h2><div className="rules-formula"><code>경기 점수 = 6 + 확인된 가점 − 확인된 감점 (0~10점)</code><code>변동률 = (경기 점수 − 6) × 2.5% × min(출전 시간 / 60, 1), 최대 ±10%</code><code>경기 후 가격 = 직전 가격 × (1 + 변동률), 포인트 반올림 및 전체 가격 범위 적용</code></div><p>6점은 중립입니다. 60분 이상 출전 기준 8점은 +5%, 4점은 −5%, 10점은 +10%입니다. 짧은 교체 출전은 출전 비율만큼 반영하며, 누적 목표가격을 뒤따르던 상승·하락은 사용하지 않습니다. 확인된 미출전은 별도로 −1.5%를 적용합니다. 데이터 정정은 같은 출발점부터 다시 계산하며 체결 거래와 매입 원가는 보존합니다.</p><p className="fine-print">초기 가격 범위 {parameters.initialMin.toLocaleString()}~{parameters.initialMax.toLocaleString()}P. 전체 가격 범위 {parameters.minPrice.toLocaleString()}~{parameters.maxPrice.toLocaleString()}P. 확인되지 않은 통계를 나쁜 경기로 간주하지 않으며, 팀 승리 별도 가점은 없습니다.</p></section>
  <section className="rules-section"><h2>본진·서브팀과 커뮤니티</h2><p>본진 1개는 경고 안내를 확인한 뒤 영구 고정하며 닉네임 앞에 공식 엠블럼을 표시합니다. 본진에서는 게시글·댓글·투표, 서브팀에서는 댓글·투표에 참여할 수 있습니다. 다른 구단 게시판은 읽을 수 있습니다. 본진을 포함해 리그별 1개, 최대 5개 구단을 응원할 수 있습니다.</p><p>서브팀은 가입 후 1시간 동안 변경할 수 있습니다. 이후에는 매년 2월·9월 1~7일(한국 시간)에 리그별 한 번씩 변경할 수 있습니다. 모든 선수 게시판에는 글을 쓸 수 있고, 해당 선수를 현재 보유한 회원에게 보유 인증을 표시합니다. 투표는 1인 1표이며 마감 전 변경할 수 있습니다.</p></section>
 </div>;
}
