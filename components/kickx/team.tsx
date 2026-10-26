"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, MessageCircle, Users } from "lucide-react";
import type { Fixture, Player } from "@/lib/kickx/types";
import { money } from "@/lib/kickx/data";
import { clubIdentity } from "@/lib/kickx/club-identity";
import { usePlatform } from "./provider";
import { useCatalogPage } from "./catalog";
import { MatchRow } from "./fixtures";
import { BackLink, ClubCrest, DataEmpty, LeagueMark, PlayerPortrait, PositionBadge } from "./ui";

const PAGE = 20;
function Pager({ page, total, label, onPage }: { page: number; total: number; label: string; onPage: (page: number) => void }) {
  const count = Math.max(1, Math.ceil(total / PAGE));
  if (total <= PAGE) return null;
  return (
    <div className="panel-foot pagination">
      <span>{`${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, total)} / ${total}`}</span>
      <div>
        <button aria-label={`이전 ${label} 페이지`} disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={17} /></button>
        <span className="num">{page} / {count}</span>
        <button aria-label={`다음 ${label} 페이지`} disabled={page >= count} onClick={() => onPage(page + 1)}><ChevronRight size={17} /></button>
      </div>
    </div>
  );
}
export function TeamScreen() {
  const { teamId } = useParams<{ teamId: string }>();
  const { data, getTeam, getLeague, mock, status } = usePlatform();
  const team = getTeam(teamId);
  const identity = clubIdentity(team);
  const league = getLeague(team?.leagueId);
  const [page, setPage] = useState(1), [matchPage, setMatchPage] = useState(1);
  const roster = useCatalogPage<Player>("players", { team: teamId, sort: "name", page, size: PAGE });
  const schedule = useCatalogPage<Fixture>("fixtures", { team: teamId, page: matchPage, size: PAGE });
  const localPlayers = data.players.filter((p) => p.team === teamId).sort((a, b) => a.name.localeCompare(b.name));
  const localMatches = data.fixtures.filter((f) => f.home === teamId || f.away === teamId).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const players = mock ? localPlayers : roster.status === "ready" ? roster.data.items : [];
  const matches = mock ? localMatches : schedule.status === "ready" ? schedule.data.items : [];
  const playerTotal = mock ? localPlayers.length : roster.status === "ready" ? roster.data.total : null;
  const matchTotal = mock ? localMatches.length : schedule.status === "ready" ? schedule.data.total : null;
  const posts = data.communityCounts?.find((c) => c.scope === "club" && c.target === teamId)?.count ?? (mock ? data.posts.filter((p) => p.scope === "club" && p.target === teamId).length : null);
  const heroStyle = identity ? ({ "--club": identity.primary, "--club-2": identity.secondary } as CSSProperties) : undefined;
  return (
    <>
      <BackLink href="/fixtures" label="경기 일정" />
      <section className="lounge-hero team-hero" style={heroStyle}>
        <span className="lounge-hero-code" aria-hidden="true">{identity?.code ?? ""}</span>
        <div className="lounge-hero-mark"><ClubCrest id={team ? teamId : null} size="xl" /></div>
        <div className="lounge-hero-text">
          <span className="eyebrow plain">TEAM PROFILE{league && <> · <LeagueMark league={league} size="sm" /></>}</span>
          <h1>{team?.name ?? (status === "ready" ? "구단을 찾을 수 없습니다" : "구단 정보")}</h1>
          <p>{team ? [team.english, league?.name].filter(Boolean).join(" · ") : "요청한 구단 정보가 없습니다."}</p>
        </div>
        <div className="lounge-hero-stats">
          <div><span>소속 선수</span><b className="num">{playerTotal ?? "—"}</b></div>
          <div><span>수집 경기</span><b className="num">{matchTotal ?? "—"}</b></div>
          <div><span>팬 게시글</span><b className="num">{posts ?? "—"}</b></div>
        </div>
        {team && (
          <div className="lounge-hero-actions">
            <Link className="button primary" href={`/community/clubs/${teamId}`}><MessageCircle size={16} />팬 라운지</Link>
          </div>
        )}
      </section>
      <section className="panel flush team-section">
        <div className="panel-head">
          <h2><Users size={18} />소속 선수 <span className="muted">이름순</span></h2>
          <span className="muted num">{playerTotal != null ? `${playerTotal}명` : ""}</span>
        </div>
        {players.length > 0 && (
          <ul className="roster-grid">
            {players.map((p) => (
              <li key={p.id}>
                <Link className="roster-card hover-lift" href={`/players/${p.id}`}>
                  <PlayerPortrait player={p} size="sm" />
                  <span className="roster-text">
                    <strong>{p.name}</strong>
                    <span>{[p.country, p.age != null ? `${p.age}세` : null].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  <span className="roster-side">
                    <PositionBadge position={p.position} />
                    <small className="num">{p.price != null ? `${money(p.price)} P` : "산정 전"}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!players.length && <DataEmpty entity="소속 선수" status={mock ? status : roster.status} retry={mock ? undefined : roster.reload} />}
        {!mock && <Pager page={page} total={roster.data.total} label="선수" onPage={setPage} />}
      </section>
      <section className="panel flush team-section">
        <div className="panel-head">
          <h2>경기 일정 · 결과 <span className="muted">전체 대회</span></h2>
          <Link className="text-link" href="/fixtures">전체 일정 <ArrowRight size={14} /></Link>
        </div>
        {matches.length > 0 && <ul className="match-list">{matches.map((f) => <MatchRow fixture={f} key={f.id} showDate />)}</ul>}
        {!matches.length && <DataEmpty entity="경기" status={mock ? status : schedule.status} retry={mock ? undefined : schedule.reload} />}
        {!mock && <Pager page={matchPage} total={schedule.data.total} label="경기" onPage={setMatchPage} />}
      </section>
    </>
  );
}
