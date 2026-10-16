"use client";
import { Select } from "./select";
import { simple } from "./options";
import Link from "next/link";
import { useState } from "react";
import { History, Search, Wallet } from "lucide-react";
import { dateText, money, percent, seriesForDays } from "@/lib/kickx/data";
import type {Transaction} from "@/lib/kickx/types";
import { usePlatform, useResource } from "./provider";
import { Change, DataEmpty, MemberNotice, PageHeading, PlayerIdentity, PriceChart, StatCard, Tabs, TradeButton } from "./ui";

function signed(value: number | null | undefined) {
  return value != null && value > 0 ? `+${money(value)}` : money(value);
}
export function PortfolioScreen() {
  const { data, getPlayer } = usePlatform();
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
  return (
    <>
      <PageHeading
        eyebrow="YOUR PORTFOLIO"
        title="내 자산"
        description="보유 포인트와 선수 평가액, 손익을 한눈에 확인하세요."
        action={<Link className="button secondary" href="/transactions"><History size={17} />거래 내역</Link>}
      />
      <MemberNotice />
      <div className="portfolio-top">
        <section className="portfolio-hero">
          <span className="eyebrow plain">TOTAL ASSETS · 총자산</span>
          <div className="portfolio-total">
            <strong className="num">{money(total)}<span className="unit">P</span></strong>
            <Change value={member?.returnRate} size="lg" />
          </div>
          <p>보유 포인트 + 보유 선수 현재 가치 합계{member?.weeklyRank != null && <> · 주간 랭킹 <b>{member.weeklyRank}위</b></>}</p>
        </section>
        <section className="panel allocation">
          <h2>자산 구성</h2>
          <div className="allocation-bar" aria-hidden="true">
            {allocation != null ? <><i style={{ width: `${allocation}%` }} /><i style={{ width: `${100 - allocation}%` }} /></> : <i className="none" />}
          </div>
          <dl>
            <div><dt><span className="legend players" />선수 평가액</dt><dd className="num">{money(value)} P<small>{allocation == null ? "—" : `${allocation.toFixed(1)}%`}</small></dd></div>
            <div><dt><span className="legend points" />보유 포인트</dt><dd className="num">{money(cash)} P<small>{allocation == null ? "—" : `${(100 - allocation).toFixed(1)}%`}</small></dd></div>
          </dl>
        </section>
      </div>
      <div className="stat-grid portfolio-stats">
        <StatCard label="보유 포인트" value={money(cash)} unit="P" />
        <StatCard label="선수 평가액" value={money(value)} unit="P" hint={member ? `${member.holdings.length}명 보유` : undefined} />
        <StatCard label="총 평가손익" value={<span className={(member?.profit ?? 0) > 0 ? "up" : (member?.profit ?? 0) < 0 ? "down" : ""}>{signed(member?.profit)}</span>} unit="P" hint="매입가 대비" />
        <StatCard label="수익률" value={<span className={(member?.returnRate ?? 0) > 0 ? "up" : (member?.returnRate ?? 0) < 0 ? "down" : ""}>{percent(member?.returnRate)}</span>} hint="초기 자산 대비" tone="yellow" />
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>자산 흐름</h2>
          <Tabs items={["1주", "1개월"]} value={period} onChange={setPeriod} variant="segment" label="기간 선택" />
        </div>
        {member || data.session ? <PriceChart points={history} label="총자산" /> : <DataEmpty financial entity="자산" />}
      </section>
      <section className="panel flush">
        <div className="panel-head">
          <h2>보유 선수 <span className="muted num">{member ? `${rows.length}명` : ""}</span></h2>
          <Tabs items={["가치 순", "손익 순", "수익률 순"]} value={sort} onChange={setSort} variant="segment" label="정렬" />
        </div>
        <div className="table-scroll">
          <table className="data-table holdings-table">
            <thead>
              <tr>
                <th>선수</th>
                <th className="numeric">매입가</th>
                <th className="numeric">현재 가치</th>
                <th className="numeric">평가손익</th>
                <th className="numeric">수익률</th>
                <th className="hide-md">비중</th>
                <th>스쿼드</th>
                <th className="cell-actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const p = getPlayer(h.playerId);
                const weight = value && h.value != null ? (h.value / value) * 100 : null;
                return (
                  <tr key={h.id}>
                    <td>{p ? <PlayerIdentity player={p} /> : h.playerName}</td>
                    <td className="numeric">{money(h.cost)}</td>
                    <td className="numeric strong">{money(h.value)}</td>
                    <td className={`numeric ${(h.profit ?? 0) > 0 ? "up" : (h.profit ?? 0) < 0 ? "down" : ""}`}>{signed(h.profit)}</td>
                    <td className="numeric"><Change value={h.returnRate} /></td>
                    <td className="hide-md"><span className="weight"><span className="meter"><i style={{ width: `${weight ?? 0}%` }} /></span><small className="num">{weight == null ? "—" : `${weight.toFixed(1)}%`}</small></span></td>
                    <td>{member?.squad?.slots.includes(h.playerId) ? <span className="tag ink">출전</span> : <span className="tag">벤치</span>}</td>
                    <td className="cell-actions"><TradeButton player={p} side="sell" className="button secondary small" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <DataEmpty financial entity="보유 선수" />}
      </section>
    </>
  );
}
const emptyTransactions=()=>({items:[] as Transaction[],total:0,page:1,size:50});
export function TransactionsScreen() {
  const { data, getPlayer, mock, status } = usePlatform();
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
  return (
    <>
      <PageHeading
        eyebrow="YOUR TRADING HISTORY"
        title="거래 내역"
        description="매입과 매각, 수수료와 정산까지 모든 거래를 기록합니다."
        action={<Link className="button secondary" href="/portfolio"><Wallet size={17} />내 자산</Link>}
      />
      <MemberNotice />
      <div className="stat-grid transaction-stats three">
        <div className="stat-card"><span className="stat-label">조회된 매입 금액</span><strong className="stat-value num">{money(sum("buy"))} <small className="unit">P</small></strong></div>
        <div className="stat-card"><span className="stat-label">조회된 매각 정산</span><strong className="stat-value num">{money(sum("sell"))} <small className="unit">P</small></strong></div>
        <div className="stat-card"><span className="stat-label">거래 건수</span><strong className="stat-value num">{member ? mock?all.length:remote.status==="ready"?remote.data.total:"—" : "—"} <small className="unit">건</small></strong></div>
      </div>
      <section className="panel flush">
        <div className="panel-head">
          <Tabs items={["전체", "매입", "매각"]} value={tab} onChange={v=>{setTab(v);setPage(1);}} variant="segment" label="거래 유형" />
          <div className="toolbar">
            <label className="input-search"><Search size={16} /><input aria-label="거래 선수 검색" placeholder="거래 선수 검색" value={q} onChange={(e) => {setQ(e.target.value);setPage(1);}} /></label>
            <Select label="거래 기간" value={period} onChange={v=>{setPeriod(v);setPage(1);}} options={simple(["전체 기간", "최근 7일", "최근 30일"])} variant="compact" />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>거래 일시 (KST)</th>
                <th>선수</th>
                <th>유형</th>
                <th className="numeric">거래 가격</th>
                <th className="numeric">수량</th>
                <th className="numeric">수수료</th>
                <th className="numeric">정산액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const p = getPlayer(t.playerId);
                return (
                  <tr key={t.id}>
                    <td className="muted num">{dateText(t.date)}</td>
                    <td>{p ? <PlayerIdentity player={p} /> : t.playerName}</td>
                    <td><span className={`trade-type ${t.type}`}>{t.type === "buy" ? "매입" : "매각"}</span></td>
                    <td className="numeric">{money(t.price)}</td>
                    <td className="numeric">{money(t.quantity)}</td>
                    <td className="numeric muted">{t.fee ? `−${money(t.fee)}` : money(t.fee)}</td>
                    <td className="numeric strong">{money(t.net)}</td>
                    <td><span className="status-pill ok">{t.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <DataEmpty financial entity="거래 내역" status={mock||!member?undefined:remote.status} filtered={!!q||tab!=="전체"} />}
        {!mock&&<div className="button-row frame"><button className="button secondary small" disabled={page===1} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page} 페이지</span><button className="button secondary small" disabled={page*50>=remote.data.total} onClick={()=>setPage(p=>p+1)}>다음</button></div>}
        {rows.length > 0 && <div className="panel-foot"><span className="fine-print">금액 단위 P · 수수료와 정산액은 거래 당시 기록입니다.</span><span className="fine-print num">{rows.length}건</span></div>}
      </section>
    </>
  );
}
