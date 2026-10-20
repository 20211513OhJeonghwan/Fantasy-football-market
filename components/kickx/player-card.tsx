"use client";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { money, score } from "@/lib/kickx/data";
import type { Player } from "@/lib/kickx/types";
import { usePlatform } from "./provider";
import { Change, ClubCrest, LeagueMark, Sparkline, useClub, WatchButton } from "./ui";

const POSITION_NAME = { GK: "골키퍼", DF: "수비수", MF: "미드필더", FW: "공격수" } as const;

/** Collectible-style player card: club-coloured stage, name plate and honest stats. */
export function PlayerCard({ player, variant = "grid", rank }: { player: Player; variant?: "grid" | "feature"; rank?: number }) {
  const { data, getLeague } = usePlatform();
  const { team, identity } = useClub(player.team);
  const [failed, setFailed] = useState<string | null>(null);
  const photo = player.photo && failed !== player.photo ? player.photo : null;
  const owned = data.member?.holdings.some((h) => h.playerId === player.id);
  const league = getLeague(team?.leagueId);
  const valued = player.price != null;
  const matches = player.statsScope === "imported_matches" ? player.importedMatches : null;
  const meta = [player.age != null ? `${player.age}세` : null, player.country].filter(Boolean).join(" · ");
  return (
    <article
      className={`pcard ${variant} ${photo ? "has-photo" : "no-photo"}`}
      style={{ "--club": identity?.primary ?? "#55554f", "--club-2": identity?.secondary ?? "#ffffff" } as CSSProperties}
    >
      <Link href={`/players/${player.id}`} className="pcard-stage" aria-label={`${player.name} 상세 보기`}>
        <span className="pcard-bg" aria-hidden="true" />
        <span className="pcard-slash" aria-hidden="true" />
        <span className="pcard-top">
          <span className="pcard-pos" title={player.position ? POSITION_NAME[player.position] : "포지션 정보 없음"}>{player.position ?? "—"}</span>
          {rank != null && <span className="pcard-rank num">#{rank}</span>}
          {owned && <span className="tag ink">보유</span>}
        </span>
        <span className="pcard-crest"><ClubCrest id={player.team} size="normal" /></span>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pcard-photo" src={photo} alt="" loading="lazy" decoding="async" onError={() => setFailed(player.photo ?? null)} />
        ) : (
          <svg className="pcard-photo silhouette" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
            <path d="M14 100 C15 76 30 64 50 63 C70 64 85 76 86 100 Z" />
            <path d="M42 52 L58 52 L59 66 L50 70 L41 66 Z" />
            <ellipse cx="50" cy="38" rx="14" ry="17" />
          </svg>
        )}
      </Link>
      <span className="pcard-watch"><WatchButton id={player.id} /></span>
      <div className="pcard-plate">
        <Link href={`/players/${player.id}`} className="pcard-name"><h3>{player.name}</h3></Link>
        <p className="pcard-club">
          <span>{team?.name ?? "소속 정보 없음"}</span>
          {league && <LeagueMark league={league} size="sm" />}
        </p>
        {meta && <p className="pcard-meta">{meta}</p>}
      </div>
      <div className="pcard-stats">
        {valued ? (
          <>
            <div className="pcard-value"><span>현재 가치</span><strong className="num">{money(player.price)}<small>P</small></strong></div>
            <div className="pcard-change"><Change value={player.change} /><Sparkline values={player.history.slice(-14).map((v) => v.value)} down={(player.change ?? 0) < 0} /></div>
          </>
        ) : (
          <div className="pcard-pending" title="Performance 계산이 연결되면 선수 가치가 표시됩니다.">
            <span className="pcard-pending-dot" aria-hidden="true" />가치 산정 전
          </div>
        )}
        <dl className="pcard-facts">
          <div><dt>{matches != null ? "경기" : "PERF"}</dt><dd className="num">{matches != null ? money(matches) : score(player.performance)}</dd></div>
          <div><dt>골</dt><dd className="num">{money(player.goals)}</dd></div>
          <div><dt>도움</dt><dd className="num">{money(player.assists)}</dd></div>
        </dl>
      </div>
    </article>
  );
}
