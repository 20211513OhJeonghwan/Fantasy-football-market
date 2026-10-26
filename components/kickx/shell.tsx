"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, History, LogOut, Search, Settings, Wallet } from "lucide-react";
import { apiRequest } from "@/lib/kickx/client";
import { dateText, money } from "@/lib/kickx/data";
import { DataNotice, MockBadge } from "./ui";
import { usePlatform } from "./provider";
import { PlaybookArt } from "./playbook-art";

const links = [
  { href: "/", label: "홈" },
  { href: "/market", label: "선수 시장" },
  { href: "/squad", label: "스쿼드" },
  { href: "/ranking", label: "랭킹" },
  { href: "/community/clubs", label: "구단 커뮤니티" },
];
const utility = [
  { href: "/players", label: "선수 탐색" },
  { href: "/fixtures", label: "경기 일정" },
  { href: "/portfolio", label: "내 자산" },
  { href: "/transactions", label: "거래 내역" },
  { href: "/mypage", label: "마이페이지" },
];
function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (href === "/market") return pathname.startsWith("/market") || (pathname.startsWith("/players") && pathname !== "/players");
  return pathname === href || pathname.startsWith(href + "/");
}
export function Logo() {
  return <Link href="/" className="logo wordmark" aria-label="KICK-X 홈">KICK-X</Link>;
}
function AccountMenu() {
  const { data, mock, notify } = usePlatform();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  if (!data.session)
    return <Link href={"/login?next=" + encodeURIComponent(pathname)} className="account-login"><span>로그인</span><ArrowRight size={22} /></Link>;
  const nickname = data.session.profile?.nickname || "내 계정";
  const points = data.member?.financialReady === false ? null : data.member?.points;
  async function signOut() {
    if (busy) return;
    if (mock) { notify("예시 모드에서는 로그아웃할 수 없습니다."); setOpen(false); return; }
    setBusy(true);
    try { await apiRequest("/api/auth/logout", "POST"); window.location.replace("/"); }
    catch (error) { notify(error instanceof Error ? error.message : "로그아웃하지 못했습니다.", "error"); setBusy(false); }
  }
  return (
    <div className="account" ref={ref}>
      <button type="button" className="account-trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}>
        <span className="account-avatar" aria-hidden="true">{nickname.slice(0, 1)}</span>
        <span className="account-text">
          <strong>{nickname}</strong>
          <span className="num">{money(points)}<span className="unit">P</span></span>
        </span>
        <ChevronDown size={18} className="account-chevron" />
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            <span>보유 포인트</span>
            <strong className="num">{money(points)}<span className="unit">P</span></strong>
          </div>
          <Link role="menuitem" href="/portfolio"><Wallet size={17} />내 자산</Link>
          <Link role="menuitem" href="/transactions"><History size={17} />거래 내역</Link>
          <Link role="menuitem" href="/mypage"><Settings size={17} />마이페이지</Link>
          <button role="menuitem" type="button" onClick={() => void signOut()} disabled={busy}><LogOut size={17} />{busy ? "로그아웃 중…" : "로그아웃"}</button>
        </div>
      )}
    </div>
  );
}
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, status, reload } = usePlatform();
  const [query, setQuery] = useState("");
  const standalone = pathname === "/login" || pathname === "/onboarding";
  const isHome = pathname === "/";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    router.push(`/players?q=${encodeURIComponent(query.trim())}`);
  };
  if (standalone) return <>{children}</>;
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">본문으로 바로가기</a>
      <div className="topbar">
        <span className="topbar-brand">KICK-X / FOOTBALL MARKET</span>
        <span className="topbar-market">
          {data.market ? (
            <>
              <span>상승 <b className="up num">{money(data.market.rising)}</b></span>
              <span>하락 <b className="down num">{money(data.market.falling)}</b></span>
              <span>경기 확인 <b className="num">{dateText(data.freshness?.lastCheckedAt ?? null)}</b></span>
              <span>가격 적용 <b className="num">{dateText(data.updatedAt)}</b></span>
            </>
          ) : <span>REAL FOOTBALL. YOUR GAME.</span>}
        </span>
        <span className="topbar-end"><MockBadge compact /><span>가상 포인트 전용 서비스</span></span>
      </div>
      <header className="masthead">
        <Logo />
        <p className="masthead-tagline">축구를 더 가깝게,<br />선수를 소유하는 새로운 방법.</p>
        <nav className="main-nav" aria-label="주 메뉴">
          {links.map(({ href, label }) => (
            <Link href={href} key={href} aria-current={isActive(href, pathname) ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <PlaybookArt variant="header" className="masthead-art" />
        <AccountMenu />
        <span className="masthead-manifesto">PLAYERS<br />MARKET<br />SQUAD<br />COMMUNITY<br />FOR A BIGGER FOOTBALL</span>
      </header>
      <div className="subnav">
        <nav aria-label="내 활동 메뉴">
          {utility.map(({ href, label }) => (
            <Link href={href} key={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <form onSubmit={submit} role="search" className="subnav-search">
          <Search size={16} />
          <input aria-label="선수, 구단, 리그 통합 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="선수 · 구단 · 리그 검색" />
          <button type="submit">검색</button>
        </form>
      </div>
      <main id="main-content" className={isHome ? "content home" : "content"}>
        {!isHome && <DataNotice status={status} reload={reload} />}
        {children}
      </main>
      <footer className="footer">
        <div className="footer-brand">
          <span className="wordmark small">KICK-X</span>
          <p>실제 경기 기록으로 움직이는 선수 가치,<br />가상 포인트로 즐기는 판타지 축구 트레이딩.</p>
        </div>
        <nav aria-label="서비스 메뉴">
          <strong>서비스</strong>
          <Link href="/market">선수 시장</Link>
          <Link href="/players">선수 탐색</Link>
          <Link href="/fixtures">경기 일정</Link>
          <Link href="/ranking">랭킹</Link>
        </nav>
        <nav aria-label="커뮤니티 메뉴">
          <strong>커뮤니티</strong>
          <Link href="/community/clubs">구단 커뮤니티</Link>
          <Link href="/community/write">글쓰기</Link>
        </nav>
        <nav aria-label="내 계정 메뉴">
          <strong>내 계정</strong>
          <Link href="/portfolio">내 자산</Link>
          <Link href="/transactions">거래 내역</Link>
          <Link href="/mypage">마이페이지</Link>
        </nav>
        <p className="footer-legal">
          KICK-X는 서비스 내부 가상 포인트만 사용하며 실제 금전 거래·환전·스포츠 베팅을 제공하지 않습니다. 선수 가치는 KICK-X 내부 지표로 실제 이적료와 무관합니다.
          <span>© 2026 KICK-X · Capstone Design Project</span>
        </p>
      </footer>
    </div>
  );
}
