"use client";
import { UserAvatar, MemberName } from "./avatar";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, History, LogOut, Search, Settings, Wallet } from "lucide-react";
import { apiRequest } from "@/lib/kickx/client";
import { dateText, money } from "@/lib/kickx/data";
import { CATALOG_SEARCH_MAX_LENGTH, normalizeCatalogSearch } from "@/lib/kickx/catalog-query";
import { DataNotice, MockBadge } from "./ui";
import { usePlatform } from "./provider";
import { PlaybookArt } from "./playbook-art";
import { NotificationBell, NotificationProvider } from "./notifications";

const links = [
  { href: "/", label: "홈" },
  { href: "/market", label: "선수 시장" },
  { href: "/squad", label: "스쿼드" },
  { href: "/ranking", label: "랭킹" },
  { href: "/community/clubs", label: "구단 커뮤니티" },
];
const utility = [
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
/** Striker mark traced from the approved silhouette, thickened to match the wordmark weight; follows the ink colour. */
function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 1215 1162" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M 1173.3 24.1 C 1164.5 25.8, 1161.2 28.6, 1135.4 57 C 1115.8 78.6, 1101.7 93.4, 1095.5 98.8 C 1083.3 109.4, 1063.3 117.8, 985.5 145 C 963.3 152.8, 951.5 157.8, 931 168.2 C 898 184.9, 866.9 192.8, 800.9 201 C 779.1 203.7, 767 205.9, 738.1 212.5 C 701.7 220.8, 699.2 220.5, 692.2 206.5 C 689.5 201.1, 689.2 199.2, 688.5 187.5 C 685.6 134.2, 665.6 99.7, 630 86.4 C 581.6 68.3, 528.5 102.7, 522.1 156.2 C 518.6 186, 537.3 222.8, 568.8 248.1 C 573 251.5, 576.6 254.6, 576.8 254.9 C 576.9 255.3, 573 256.8, 568.1 258.4 C 538.6 267.6, 529.5 276.7, 506 320.5 C 475.8 376.7, 464.5 393.6, 445.8 409.6 C 420.5 431.4, 412.1 440.9, 391 471.5 C 346.2 536.4, 345.5 537.2, 318.5 552.5 C 300.7 562.5, 295 567.5, 280.1 586 C 270.3 598.2, 268.2 601.7, 267.1 607.4 C 263.8 625.2, 278.8 638.5, 298.2 635 C 311.8 632.5, 341.4 621.7, 353.9 614.6 C 367.5 606.8, 374 600.8, 389 581.6 C 400.2 567.2, 407.6 560.6, 458.5 519.5 C 482.7 500, 488.7 493.4, 509.5 464 C 518.7 450.9, 523.7 445.2, 541.9 426.7 L 563.5 404.9 564.3 408.7 C 564.7 410.8, 565.3 422.5, 565.7 434.7 C 566.2 455.3, 566.1 457.3, 564.1 463.8 C 562 470.9, 550.4 494.4, 542.6 507.4 C 518 548.5, 512.8 562.6, 511.4 591.5 C 510.1 617.4, 517.7 685.8, 523.3 699.3 C 524.7 702.5, 524.6 702.7, 514.3 720.5 C 501 743.7, 483.8 778.3, 476 798 C 466.3 822.2, 467.8 820.2, 441.8 843.7 C 412.8 870, 406.6 877.8, 360.5 946 C 322.2 1002.8, 319.9 1005.5, 292 1028.9 C 282.4 1036.9, 270 1047.5, 264.5 1052.4 L 254.5 1061.4 253.8 1057 C 249.3 1030.6, 229 1004.4, 203.9 992.6 C 152.2 968.2, 92.6 992.9, 74.5 1046.2 C 60.6 1086.9, 76.7 1131.7, 113.4 1154.9 L 118.4 1158 163.1 1158 L 207.8 1158 215.6 1152.4 C 224.6 1146, 230.9 1140.2, 234.6 1134.9 L 237.1 1131.2 242.3 1133.5 C 259.4 1141.3, 279.6 1137.6, 317.6 1119.5 C 339.6 1109.1, 345.4 1102.7, 356.6 1076.3 C 364.9 1056.8, 366.3 1055.3, 408 1022.1 C 421.5 1011.4, 439 997.5, 447 991.1 C 512.5 939.1, 523.8 925.2, 539.3 877.9 C 547.3 853.7, 548 852.3, 558.2 842.4 C 574.8 826.4, 596.9 806, 597.9 806 C 598.4 806, 601.1 807.5, 603.9 809.4 C 614.8 816.7, 628.7 820, 640.8 818 C 650.6 816.4, 694.9 800.5, 735.5 784 C 761.6 773.4, 837.2 746, 859.9 739 C 869.7 735.9, 871 735.8, 879.9 736.4 C 891.4 737.1, 914.8 740.8, 936 745.1 C 961.3 750.2, 970.7 749.3, 979.3 740.6 C 988.2 731.7, 989.7 720.7, 983.6 707.5 C 980.3 700.3, 970.2 689.9, 952 675.1 C 943.5 668.2, 933.1 659.6, 929 656 C 911.7 640.9, 906 637.6, 895.6 636.5 C 882.8 635.1, 872.7 638.7, 858.3 649.9 C 847.2 658.4, 834.8 666.8, 830.7 668.5 C 820.7 672.7, 796.7 675.4, 751.5 677.5 C 733.3 678.4, 715.8 679.5, 712.5 680 C 709.2 680.5, 705.9 681, 705.3 681 C 704.6 681, 705.8 678.2, 708 674.5 C 723.7 648.8, 733 621.7, 733 601.5 C 733 592.8, 729.9 576.9, 725.1 560.6 C 718.5 538.4, 719.2 534, 733.9 499.7 C 742.6 479.5, 775.1 406.6, 785.5 384 C 789.2 376, 794.4 364.6, 797.1 358.6 C 807.9 334.8, 818.8 319.2, 830.5 311 C 850 297.4, 907.1 272.6, 962 253.8 C 987.4 245.1, 995.2 241.2, 1031.5 219 C 1101.8 176, 1121.1 164.5, 1137.2 155.6 C 1156.2 145.2, 1164.8 134.8, 1180.1 103.5 C 1204 54.7, 1206.4 42.1, 1194 30.1 C 1188.4 24.7, 1181.3 22.6, 1173.3 24.1" />
    </svg>
  );
}
export function Logo() {
  return <Link href="/" className="logo wordmark" aria-label="KICK-X 홈"><LogoMark />KICK-X</Link>;
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
      <button type="button" className="account-trigger" aria-label={`${nickname} 계정 메뉴`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}>
        <UserAvatar className="account-avatar" avatar={data.session?.profile?.avatar} seed={data.session?.userId ?? nickname} />
        <span className="account-text">
          <strong><MemberName primaryTeam={data.session?.profile?.primaryTeam}>{nickname}</MemberName></strong>
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
  const { data, status, stale, reload } = usePlatform();
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const standalone = pathname === "/login" || pathname === "/onboarding";
  const isHome = pathname === "/";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const normalized = normalizeCatalogSearch(query);
      searchInput.current?.setCustomValidity("");
      router.push(`/market?q=${encodeURIComponent(normalized)}`);
    } catch (error) {
      searchInput.current?.setCustomValidity(error instanceof Error ? error.message : "검색어를 확인해 주세요.");
      searchInput.current?.reportValidity();
    }
  };
  if (standalone) return <>{children}</>;
  return (
    <NotificationProvider key={data.session?.userId??"guest"}><div className="app">
      <a className="skip-link" href="#main-content">본문으로 바로가기</a>
      <div className="topbar">
        <span className="topbar-market">
          {data.market ? (
            <>
              <span title="미출전을 제외한 직전 가격 상승 선수">상승 <b className="up num">{money(data.market.rising)}</b></span>
              <span title="미출전을 제외한 직전 가격 하락 선수">하락 <b className="down num">{money(data.market.falling)}</b></span>
              <span title="직전 가격 반영 경기에서 확인된 미출전 선수">미출전 <b className="num">{money(data.market.notPlayed)}</b></span>
              <span>가격 적용 <b className="num">{dateText(data.updatedAt)}</b></span>
            </>
          ) : <span>REAL FOOTBALL. YOUR GAME.</span>}
        </span>
        <MockBadge compact />
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
        <div className="masthead-account"><NotificationBell/><AccountMenu /></div>
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
          <input ref={searchInput} aria-label="선수, 구단, 리그 통합 검색" maxLength={CATALOG_SEARCH_MAX_LENGTH} value={query} onChange={event => { event.target.setCustomValidity(""); setQuery(event.target.value); }} placeholder="선수 · 구단 · 리그 검색" />
          <button type="submit">검색</button>
        </form>
      </div>
      <main id="main-content" className={isHome ? "content home" : "content"}>
        {stale&&<div className="kx-stale-notice" role="status"><span>연결이 잠시 끊겨 마지막으로 확인한 정보를 표시하고 있습니다.</span><button type="button" onClick={reload}>다시 확인</button></div>}
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
    </div></NotificationProvider>
  );
}
