"use client";
import type { CSSProperties, ReactNode } from "react";
import { AVATAR_ICONS, type AvatarIcon, parseAvatar } from "@/lib/kickx/validation";
import { ClubCrest } from "./ui";

/** Solid football glyphs on a 24px grid. `.cut` shapes take the avatar background to read as holes. */
const GLYPHS: Record<AvatarIcon, ReactNode> = {
  ball: <>
    <circle cx="12" cy="12" r="10" />
    <path className="cut" d="M12 8.4 15.4 10.9 14.1 14.9H9.9L8.6 10.9Z" />
    <path className="cut-line" d="M12 8.4V3.4M15.4 10.9 20 9.4M14.1 14.9 17 19M9.9 14.9 7 19M8.6 10.9 4 9.4" />
  </>,
  jersey: <>
    <path d="M8.2 2.5 4.3 4.2 1.3 9.2l3.3 2.2 1.6-1.7V21.5h11.6V9.7l1.6 1.7 3.3-2.2-3-5L15.8 2.5c-.7 1.9-2.1 3-3.8 3s-3.1-1.1-3.8-3Z" />
    <path className="cut" d="M10.4 12.5h3.2v5h-3.2Z" />
  </>,
  trophy: <>
    <path d="M6 2.5h12v6a6 6 0 0 1-12 0Z" />
    <path className="line" d="M6 5H3.2v1.6A4 4 0 0 0 6.6 10.5M18 5h2.8v1.6a4 4 0 0 1-3.4 3.9" />
    <path d="M10.6 14h2.8v3.6h-2.8ZM7 17.6h10v3.9H7Z" />
  </>,
  boot: <>
    <path d="M2.5 16.5V9.2q0-1.6 1.6-1.9L8.6 6.4V4h4.6l.9 3.4c2.7.7 5.6 1.8 7.3 3.2.9.8 1.6 2 1.6 3.2v2.7Z" />
    <path className="cut-line" d="M10.2 9.4l3-.7M10.8 11.8l3.3-.8M2.5 14.6h20" />
    <path d="M3.8 17h2.6v2.6H3.8ZM9.2 17h2.6v2.6H9.2ZM14.6 17h2.6v2.6h-2.6ZM19.4 17h2.6v2.6h-2.6Z" />
  </>,
  whistle: <>
    <circle cx="9.2" cy="14.3" r="6.7" />
    <path d="M9.2 7.6h13.3v5.1h-7.6Z" />
    <circle className="cut" cx="9.2" cy="14.3" r="2.2" />
    <circle className="line" cx="4.2" cy="5.2" r="2" />
  </>,
  goal: <>
    <path className="line thick" d="M2.5 20.5v-15h19v15" />
    <path className="line net" d="M7 5.5v15M12 5.5v15M17 5.5v15M2.5 10.5h19M2.5 15.5h19" />
    <circle cx="15.5" cy="17.6" r="3.2" />
  </>,
};
export const AVATAR_LABELS: Record<AvatarIcon, string> = { ball: "축구공", jersey: "유니폼", trophy: "트로피", boot: "축구화", whistle: "호루라기", goal: "골대" };

const TONES = ["tone-yellow", "tone-ink", "tone-paper"] as const;
function hash(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.codePointAt(0)!, 16777619); return h >>> 0; }

export function AvatarGlyph({ icon }: { icon: AvatarIcon }) {
  return <svg className="avatar-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{GLYPHS[icon]}</svg>;
}

/**
 * Member avatar. A saved choice (`icon:*` or a supported `club:*`) wins; without one the icon and tone
 * come from a stable hash of the seed, so a member keeps the same mark everywhere.
 */
export function UserAvatar({ avatar, seed, className = "", label, style }: { avatar?: string | null; seed: string; className?: string; label?: string; style?: CSSProperties }) {
  const choice = parseAvatar(avatar);
  const h = hash(seed || "kickx");
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  if (choice?.kind === "club")
    return <span className={`user-avatar club ${className}`} style={style} {...a11y}><ClubCrest id={choice.id} size="small" /></span>;
  const icon = choice?.kind === "icon" ? choice.icon : AVATAR_ICONS[h % AVATAR_ICONS.length];
  const tone = choice ? "tone-yellow" : TONES[(h >>> 8) % TONES.length];
  return <span className={`user-avatar ${tone} ${className}`} style={style} {...a11y}><AvatarGlyph icon={icon} /></span>;
}

/** Permanent club identity is separate from the member's changeable profile icon. */
export function MemberName({primaryTeam,holdsPlayer,children}:{primaryTeam?:string|null;holdsPlayer?:boolean;children:ReactNode}){
 return <span className="member-name">{primaryTeam&&<span className="primary-name-crest" title="메인 응원 구단"><ClubCrest id={primaryTeam} size="small"/></span>}<span>{children}</span>{holdsPlayer&&<small className="ownership-badge" title="현재 이 선수를 보유한 회원입니다">보유 인증</small>}</span>;
}
