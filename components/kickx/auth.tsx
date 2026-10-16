"use client";
import { Select } from "./select";
import { useTeamOptions } from "./options";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, LogOut, Mail, Save, ShieldCheck } from "lucide-react";
import { usePlatform } from "./provider";
import { Logo } from "./shell";
import { PlaybookArt } from "./playbook-art";
import { DataNotice, MemberNotice, MockBadge, PageHeading, SectionTitle, StatCard, TeamBadge } from "./ui";
import { apiRequest } from "@/lib/kickx/client";
import { dateText, money } from "@/lib/kickx/data";
import { parseProfile, PROFILE_LIMITS, safeReturnPath } from "@/lib/kickx/validation";
import type { Profile } from "@/lib/kickx/types";

function AuthVisual() {
  return (
    <section className="auth-visual">
      <Logo />
      <PlaybookArt variant="hero" className="auth-art" />
      <div className="auth-copy">
        <span className="eyebrow plain">REAL FOOTBALL. YOUR GAME.</span>
        <h1>당신의 축구가<br />새롭게 시작되는 곳.</h1>
        <p>실제 경기 기록으로 움직이는 선수 가치,<br />가상 포인트로 즐기는 선수 트레이딩.</p>
        <ul className="auth-features">
          {["실제 경기 기반 선수 가치", "가상 포인트 선수 거래", "베스트 11 스쿼드", "구단 · 선수 커뮤니티"].map((t) => <li key={t}><Check size={16} />{t}</li>)}
        </ul>
      </div>
      <span className="auth-caption">KICK-X · FOOTBALL MARKET · 2026</span>
    </section>
  );
}
export function LoginScreen() {
  const search = useSearchParams();
  const { data } = usePlatform();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const errors: Record<string, string> = {
    oauth: "로그인이 완료되지 않았습니다. Google 계정을 선택해 다시 시도해 주세요.",
    profile: "계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    "not-configured": "로그인 서비스 연결을 준비하고 있습니다.",
  };
  const [error, setError] = useState("");
  const message = error || errors[search.get("error") || ""] || "";
  const next = safeReturnPath(search.get("next"));
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((result) => { if (!controller.signal.aborted) setEnabled(result.enabled === true); })
      .catch(() => { if (!controller.signal.aborted) { setEnabled(false); setError("로그인 연결 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요."); } });
    return () => controller.abort();
  }, []);
  async function signIn() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await apiRequest<{ url: string }>("/api/auth/login", "POST", { next });
      window.location.assign(result.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "로그인을 시작하지 못했습니다.");
      setBusy(false); lock.current = false;
    }
  }
  return (
    <div className="auth-layout">
      <AuthVisual />
      <section className="auth-form-side">
        <Link className="back-link" href="/"><ArrowLeft size={16} />홈으로</Link>
        <div className="login-form">
          <span className="eyebrow">WELCOME TO KICK-X</span>
          <h2>경기의 다음 장면을,<br />함께 만들어가요.</h2>
          <p>Google 계정 하나로 바로 시작할 수 있습니다.</p>
          {message && <p className="form-error" role="alert">{message}</p>}
          {data.session ? (
            <Link className="button primary large full" href={data.session.profile ? next : "/onboarding?next=" + encodeURIComponent(next)}>로그인한 계정으로 계속하기<ArrowRight size={18} /></Link>
          ) : (
            <button type="button" disabled={!enabled || busy} className="google-button" onClick={signIn}>
              {busy ? <LoaderCircle size={20} className="kx-spin" /> : <span className="google-mark" aria-hidden="true">G</span>}
              {busy ? "Google로 이동 중…" : "Google로 계속하기"}
            </button>
          )}
          {!data.session && !enabled && <p className="auth-connection-note">{enabled === null ? "로그인 연결을 확인하고 있습니다." : "로그인 서비스 연결을 준비하고 있습니다."}</p>}
          <div className="or-divider"><span>먼저 둘러보고 싶다면</span></div>
          <Link href="/market" className="button secondary full">선수 시장 둘러보기<ArrowRight size={18} /></Link>
          <div className="login-note"><ShieldCheck size={20} /><p>Google 비밀번호는 KICK-X에 저장되지 않습니다. KICK-X는 가상 포인트만 사용합니다.</p></div>
        </div>
        <span className="auth-copyright">© 2026 KICK-X. All rights reserved.</span>
      </section>
    </div>
  );
}
function ProfileForm({ onboarding = false }: { onboarding?: boolean }) {
  const { data, status, mock, updateProfile, notify } = usePlatform();
  const search = useSearchParams(), router = useRouter();
  const [draftName, setDraftName] = useState<string | null>(null), [draftTeam, setDraftTeam] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const nickname = draftName ?? data.session?.profile?.nickname ?? "";
  const team = draftTeam ?? data.session?.profile?.team ?? "";
  const teamOptions = useTeamOptions("나중에 선택", "all", "");
  const canSave = status === "ready" && !!data.session;
  const dirty = !data.session?.profile || nickname !== data.session.profile.nickname || team !== (data.session.profile.team || "");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || lock.current) return;
    setError("");
    try {
      const values = parseProfile({ nickname, team });
      lock.current = true; setBusy(true);
      const profile = mock ? values : (await apiRequest<{ profile: Profile }>("/api/kickx/profile", "POST", values)).profile;
      updateProfile(profile); setDraftName(null); setDraftTeam(null);
      notify(mock ? "프로필을 저장했습니다. (예시 모드 · 저장되지 않음)" : "프로필을 저장했습니다.");
      if (onboarding) { router.replace(safeReturnPath(search.get("next"))); router.refresh(); }
    } catch (error) { setError(error instanceof Error ? error.message : "프로필을 저장하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return (
    <form onSubmit={save} className={"panel " + (onboarding ? "frame onboarding-form" : "settings-form")}>
      {!onboarding && <SectionTitle title="프로필 설정" />}
      <label htmlFor="profile-nickname">
        <span id="profile-nickname-label">닉네임</span>
        <input id="profile-nickname" aria-labelledby="profile-nickname-label" value={nickname} onChange={(event) => setDraftName(event.target.value)} placeholder="사용할 닉네임을 입력하세요" autoComplete="nickname" required minLength={PROFILE_LIMITS.min} maxLength={PROFILE_LIMITS.max} disabled={busy} aria-describedby="nickname-help" aria-invalid={!!error} />
        <small id="nickname-help">2–20자 · 문자, 숫자, 공백, 밑줄, 하이픈</small>
      </label>
      <label htmlFor="profile-team">
        <span id="profile-team-label">응원 구단</span>
        <Select id="profile-team" describedBy="team-help" value={team} disabled={busy || !data.teams.length} onChange={setDraftTeam} options={teamOptions} placeholder="나중에 선택" />
        <small id="team-help">{data.teams.length ? "응원 구단 라운지에서 글과 댓글을 작성할 수 있습니다." : "구단 정보가 준비되면 선택할 수 있습니다."}</small>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {!canSave && <p className="fine-print">{data.session ? "서비스 연결 후 저장할 수 있습니다." : "로그인 후 프로필을 저장할 수 있습니다."}</p>}
        <button type="submit" className="button primary" disabled={!canSave || !dirty || busy}>
          {busy ? <LoaderCircle size={16} className="kx-spin" /> : <Save size={16} />} {busy ? "저장 중…" : onboarding ? "프로필 등록" : "변경사항 저장"}
        </button>
      </div>
    </form>
  );
}
export function OnboardingScreen() {
  const { data, status, reload } = usePlatform();
  return (
    <div className="onboarding">
      <Logo />
      <div className="onboarding-intro">
        <span className="eyebrow">MAKE IT YOURS</span>
        <h1>어떤 팀과 함께할까요?</h1>
        <p>닉네임과 응원 구단으로 나만의 축구를 시작하세요.</p>
      </div>
      <DataNotice status={status} reload={reload} />
      <MemberNotice />
      <ProfileForm key={data.session?.userId || "guest"} onboarding />
      <Link className="back-link" href="/">홈으로 돌아가기</Link>
    </div>
  );
}
export function MyPageScreen() {
  const { data, mock, getTeam, notify } = usePlatform();
  const [busy, setBusy] = useState(false);
  const profile = data.session?.profile, member = data.member?.financialReady === false ? null : data.member;
  const buys = member?.transactions.filter((t) => t.type === "buy") ?? [];
  const sells = member?.transactions.filter((t) => t.type === "sell") ?? [];
  async function signOut() {
    if (busy) return;
    if (mock) { notify("예시 모드에서는 로그아웃할 수 없습니다."); return; }
    setBusy(true);
    try { await apiRequest("/api/auth/logout", "POST"); window.location.replace("/"); }
    catch (error) { notify(error instanceof Error ? error.message : "로그아웃하지 못했습니다.", "error"); setBusy(false); }
  }
  return (
    <>
      <PageHeading eyebrow="MY KICK-X" title="마이페이지" description="프로필과 응원 구단, 나의 자산과 거래 요약을 관리하세요." />
      <MemberNotice />
      <div className="settings-layout">
        <aside className="profile-card">
          <div className="profile-card-top">
            <span className="profile-avatar">{profile?.nickname.slice(0, 1) || "—"}</span>
            <MockBadge compact />
          </div>
          <h2>{profile?.nickname || (data.session ? "프로필을 완성해 주세요" : "로그인이 필요합니다")}</h2>
          <div className="profile-club"><TeamBadge id={profile?.team || null} /><div><span>응원 구단</span><strong>{getTeam(profile?.team)?.name || "미선택"}</strong></div></div>
          <dl className="profile-facts">
            <div><dt>보유 선수</dt><dd className="num">{member ? `${new Set(member.holdings.map((h) => h.playerId)).size}명` : "—"}</dd></div>
            <div><dt>거래 기록</dt><dd className="num">{member ? `${member.transactions.length}건` : "—"}</dd></div>
            <div><dt>주간 순위</dt><dd className="num">{member?.weeklyRank != null ? `${member.weeklyRank}위` : "—"}</dd></div>
          </dl>
          {data.session ? (
            <button className="button secondary full" onClick={signOut} disabled={busy}><LogOut size={16} />{busy ? "로그아웃 중…" : "로그아웃"}</button>
          ) : (
            <Link className="button primary full" href="/login?next=/mypage">로그인</Link>
          )}
        </aside>
        <div className="settings-main">
          <section>
            <SectionTitle title="자산 요약" href="/portfolio" link="내 자산" />
            <div className="stat-grid three">
              <StatCard label="총자산" value={money(member?.totalAssets)} unit="P" change={member ? member.returnRate : undefined} tone="yellow" />
              <StatCard label="보유 포인트" value={money(member?.points)} unit="P" />
              <StatCard label="선수 평가액" value={money(member?.playerAssets)} unit="P" />
            </div>
          </section>
          <section>
            <SectionTitle title="거래 요약" href="/transactions" link="거래 내역" />
            <div className="stat-grid three">
              <StatCard label="매입" value={member ? buys.length : "—"} unit="건" hint={member ? `${money(buys.reduce((s, t) => s + t.net, 0))} P` : undefined} />
              <StatCard label="매각" value={member ? sells.length : "—"} unit="건" hint={member ? `정산 ${money(sells.reduce((s, t) => s + t.net, 0))} P` : undefined} />
              <StatCard label="최근 거래" value={member?.transactions[0] ? member.transactions[0].playerName : "—"} hint={member?.transactions[0] ? dateText(member.transactions[0].date) : undefined} />
            </div>
          </section>
          <ProfileForm key={data.session?.userId || "guest"} />
          <section className="panel account-settings">
            <SectionTitle title="계정 설정" />
            <div className="settings-row">
              <Mail size={20} />
              <div><strong>Google 계정 연결</strong><span>{data.session ? "Google로 로그인한 계정입니다." : "로그인 후 확인할 수 있습니다."}</span></div>
              <span className={`status-pill ${data.session ? "ok" : ""}`}>{data.session ? "연결됨" : "미로그인"}</span>
            </div>
            <div className="settings-row">
              <ShieldCheck size={20} />
              <div><strong>가상 포인트 정책</strong><span>KICK-X는 실제 금전 거래·환전을 제공하지 않습니다.</span></div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
