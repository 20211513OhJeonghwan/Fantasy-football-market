"use client";
import { Select } from "./select";
import { simple } from "./options";
import Link from "next/link";
import { useState } from "react";
import { BenchDeadline } from "./bench-deadline";
import { History, Search, Wallet } from "lucide-react";
import { money, percent, seriesForDays } from "@/lib/kickx/data";
import type {Transaction} from "@/lib/kickx/types";
import { usePlatform, useResource } from "./provider";
import { Change, DataEmpty, MemberNotice, PageHeading, PlayerPortrait, PriceChart, Tabs, TradeButton } from "./ui";

function signed(value: number | null | undefined) {
  return value != null && value > 0 ? `+${money(value)}` : money(value);
}
export function PortfolioScreen() {
  const { data, getPlayer, getTeam } = usePlatform();
  const member = data.member?.financialReady === false ? null : data.member;
  const [period, setPeriod] = useState("1개월"),
    [sort, setSort] = useState("가치 순");
  const total = member?.totalAssets,
    value = member?.playerAssets,
    cash = member?.points;
  const allocation = total != null && total > 0 && value != null && cash != null ? Math.min(100, Math.max(0, (value / total) * 100)) : null;
  const rows = [...(member?.holdings || [])].sort((a, b) =>
    sort === "수익률 순" ? (b.returnRate ?? -Infinity) - (a.returnRate ?? -Infinity)
      : sort === "손익 순" ? (b.profit ?? -Infinity) - (a.profit ?? -Infinity)
        : (b.value ?? -Infinity) - (a.value ?? -Infinity),
  );
  const history = seriesForDays(member?.assetHistory || [], period === "1주" ? 7 : 30);
  const tone = (n: number | null | undefined) => (n ?? 0) > 0 ? "up" : (n ?? 0) < 0 ? "down" : "";
  return (
    <>
      <PageHeading
        eyebrow="YOUR PORTFOLIO"
        title="내 자산"
        description="보유 포인트와 선수 평가액, 손익을 한눈에 확인하세요."
        action={<Link className="button secondary" href="/transactions"><History size={17} />거래 내역</Link>}
      />
      <MemberNotice />
      {/* Brokerage-style account summary: total and its flow first, composition and key figures beside it. */}
      <section className="pf-summary" aria-label="자산 요약">
        <div className="pf-overview">
          <div className="pf-total">
            <span className="pf-label">총자산</span>
            <strong className="num">{money(total)}<span className="unit">P</span></strong>
            <div className="pf-delta"><Change value={member?.returnRate} /><span>초기 자산 대비</span></div>
          </div>
          <div className="pf-chart">
            <div className="pf-chart-head"><span>자산 흐름</span><Tabs items={["1주", "1개월"]} value={period} onChange={setPeriod} variant="segment" label="기간 선택" /></div>
            {member || data.session ? <PriceChart points={history} label="총자산" /> : <DataEmpty financial entity="자산" />}
          </div>
        </div>
        <aside className="pf-side">
          <div className="pf-allocation">
            <h2>자산 구성</h2>
            <div className="allocation-bar" aria-hidden="true">
              {allocation != null ? <><i style={{ width: `${allocation}%` }} /><i style={{ width: `${100 - allocation}%` }} /></> : <i className="none" />}
            </div>
            <dl>
              <div><dt><span className="legend players" />선수 평가액</dt><dd className="num">{money(value)} P<small>{allocation == null ? "—" : `${allocation.toFixed(1)}%`}</small></dd></div>
              <div><dt><span className="legend points" />보유 포인트</dt><dd className="num">{money(cash)} P<small>{allocation == null ? "—" : `${(100 - allocation).toFixed(1)}%`}</small></dd></div>
            </dl>
          </div>
          <dl className="pf-kpis">
            <div><dt>평가손익</dt><dd className={`num ${tone(member?.profit)}`}>{signed(member?.profit)}<small>P</small></dd><small>매입가 대비</small></div>
            <div><dt>수익률</dt><dd className={`num ${tone(member?.returnRate)}`}>{percent(member?.returnRate)}</dd><small>초기 자산 대비</small></div>
            <div><dt>보유 선수</dt><dd className="num">{member ? member.holdings.length : "—"}<small>명</small></dd></div>
            <div><dt>주간 랭킹</dt><dd className="num">{member?.weeklyRank != null ? member.weeklyRank : "—"}<small>위</small></dd></div>
          </dl>
        </aside>
      </section>
      <section className="panel flush pf-holdings">
        <div className="panel-head">
          <h2>보유 선수 <span className="muted num">{member ? `${rows.length}명` : ""}</span></h2>
          <Tabs items={["가치 순", "손익 순", "수익률 순"]} value={sort} onChange={setSort} variant="segment" label="정렬" />
        </div>
        {rows.length > 0 && (
          <ul className="holding-list">
            <li className="holding-head" aria-hidden="true"><span>선수</span><span>매입가</span><span>현재 가치</span><span>평가손익</span><span>비중</span><span>스쿼드</span><span /></li>
            {rows.map((h) => {
              const p = getPlayer(h.playerId);
              const weight = value && h.value != null ? (h.value / value) * 100 : null;
              const starter = member?.squad?.slots.includes(h.playerId);
              return (
                <li key={h.id} className="holding-row">
                  {p ? <Link href={`/players/${p.id}`} className="holding-player"><PlayerPortrait player={p} size="sm" /><span><strong>{p.name}</strong><small>{[getTeam(p.team)?.name, p.position].filter(Boolean).join(" · ") || "—"}</small></span></Link>
                    : <span className="holding-player"><span><strong>{h.playerName}</strong></span></span>}
                  <span className="holding-cost num"><small>매입가</small>{money(h.cost)}</span>
                  <span className="holding-value num"><small>{h.bench ? "동결 가격" : "현재 가치"}</small><b>{money(h.value)}</b></span>
                  <span className={`holding-pl num ${tone(h.profit)}`}><small>평가손익</small><b>{signed(h.profit)}</b><Change value={h.returnRate} /></span>
                  <span className="holding-weight"><span className="meter"><i style={{ width: `${weight ?? 0}%` }} /></span><small className="num">{weight == null ? "—" : `${weight.toFixed(1)}%`}</small></span>
                  <span className="holding-state">{h.bench ? <><span className="tag">동결 벤치</span><BenchDeadline expiresAt={h.bench.expiresAt}/></> : starter ? <span className="tag ink">출전</span> : <span className="tag">벤치</span>}</span>
                  <span className="holding-action"><TradeButton player={p} side="sell" className="button secondary small" /></span>
                </li>
              );
            })}
          </ul>
        )}
        {!rows.length && <DataEmpty financial entity="보유 선수" />}
      </section>
    </>
  );
}
const emptyTransactions=()=>({items:[] as Transaction[],total:0,page:1,size:50});
const KST_DAY = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "short" });
const KST_TIME = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
/** Groups already-ordered rows by their KST calendar day for a statement-style list. */
function byDay(rows: Transaction[]) {
  const groups: [string, Transaction[]][] = [];
  for (const t of rows) {
    const day = Number.isFinite(Date.parse(t.date)) ? KST_DAY.format(new Date(t.date)) : "날짜 정보 없음";
    if (groups.at(-1)?.[0] === day) groups.at(-1)![1].push(t); else groups.push([day, [t]]);
  }
  return groups;
}
export function TransactionsScreen() {
  const { data, getPlayer, getTeam, mock, status } = usePlatform();
  const member = data.member?.financialReady === false ? null : data.member;
  const [tab, setTab] = useState("전체"),
    [q, setQ] = useState(""),
    [period, setPeriod] = useState("전체 기간");
  const [page,setPage]=useState(1);
  const query=new URLSearchParams({page:String(page),q,side:tab==="전체"?"":tab==="매입"?"buy":"sell",days:period==="최근 7일"?"7":period==="최근 30일"?"30":""});
  const remote=useResource(!mock&&status==="ready"&&data.session&&member?`/api/kickx/trades?${query}`:null,emptyTransactions);
  const all = mock ? member?.transactions || [] : remote.status==="ready"?remote.data.items:[];
  const rows = all.filter(
    (t) =>
      (tab === "전체" || t.type === (tab === "매입" ? "buy" : "sell")) &&
      t.playerName.toLowerCase().includes(q.toLowerCase()) &&
      (period === "전체 기간" || Date.parse(t.date) >= Date.now() - (period === "최근 7일" ? 7 : 30) * 86400000),
  );
  const sum = (type: "buy" | "sell") => (member ? all.filter((t) => t.type === type).reduce((s, t) => s + t.net, 0) : null);
  const count = (type: "buy" | "sell") => (member ? all.filter((t) => t.type === type).length : null);
  return (
    <>
      <PageHeading
        eyebrow="YOUR TRADING HISTORY"
        title="거래 내역"
        description="매입과 매각, 수수료와 정산까지 모든 거래를 기록합니다."
        action={<Link className="button secondary" href="/portfolio"><Wallet size={17} />내 자산</Link>}
      />
      <MemberNotice />
      <section className="tx-summary" aria-label="조회된 거래 요약">
        <div className="buy"><span>조회된 매입</span><strong className="num">{money(sum("buy"))}<small>P</small></strong><small className="num">{count("buy") ?? "—"}건</small></div>
        <div className="sell"><span>조회된 매각 정산</span><strong className="num">{money(sum("sell"))}<small>P</small></strong><small className="num">{count("sell") ?? "—"}건</small></div>
        <div><span>거래 건수</span><strong className="num">{member ? mock?all.length:remote.status==="ready"?remote.data.total:"—" : "—"}<small>건</small></strong><small>전체 기간 기준</small></div>
      </section>
      <section className="panel flush tx-panel">
        <div className="tx-tools">
          <Tabs items={["전체", "매입", "매각"]} value={tab} onChange={v=>{setTab(v);setPage(1);}} variant="segment" label="거래 유형" />
          <label className="input-search"><Search size={16} /><input aria-label="거래 선수 검색" placeholder="거래 선수 검색" value={q} onChange={(e) => {setQ(e.target.value);setPage(1);}} /></label>
          <Select label="거래 기간" value={period} onChange={v=>{setPeriod(v);setPage(1);}} options={simple(["전체 기간", "최근 7일", "최근 30일"])} variant="compact" />
        </div>
        {rows.length > 0 && byDay(rows).map(([day, items]) => (
          <div className="tx-day" key={day}>
            <h3>{day}</h3>
            <ul>
              {items.map((t) => {
                const p = getPlayer(t.playerId);
                return (
                  <li key={t.id} className={`tx-row ${t.type}`}>
                    {p ? <PlayerPortrait player={p} size="sm" /> : <span className="tx-portrait-empty" aria-hidden="true" />}
                    <span className="tx-main">
                      <strong>{p ? <Link href={`/players/${p.id}`}>{t.playerName}</Link> : t.playerName}</strong>
                      <small><span className={`trade-type ${t.type}`}>{t.type === "buy" ? "매입" : "매각"}</span><time className="num" dateTime={t.date}>{Number.isFinite(Date.parse(t.date)) ? KST_TIME.format(new Date(t.date)) : "—"}</time>{p && <span>{getTeam(p.team)?.name}</span>}</small>
                    </span>
                    <span className="tx-detail num"><span>거래 가격 {money(t.price)} P × {money(t.quantity)}</span><span>수수료 {t.fee ? `−${money(t.fee)}` : money(t.fee)} P</span></span>
                    <span className="tx-amount num"><b>{t.type === "buy" ? "−" : "+"}{money(t.net)}<small>P</small></b><small>{t.type === "buy" ? "결제" : "정산"} · {t.status}</small></span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!rows.length && <DataEmpty financial entity="거래 내역" status={mock||!member?undefined:remote.status} filtered={!!q||tab!=="전체"} />}
        {!mock&&<div className="button-row frame"><button className="button secondary small" disabled={page===1} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page} 페이지</span><button className="button secondary small" disabled={page*50>=remote.data.total} onClick={()=>setPage(p=>p+1)}>다음</button></div>}
        {rows.length > 0 && <div className="panel-foot"><span className="fine-print">금액 단위 P · 시각은 한국 시간 · 수수료와 정산액은 거래 당시 기록입니다.</span><span className="fine-print num">{rows.length}건</span></div>}
      </section>
    </>
  );
}
