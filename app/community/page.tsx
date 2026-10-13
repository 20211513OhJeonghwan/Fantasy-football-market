import Link from "next/link";
import { Users, UserRound, ArrowRight } from "lucide-react";
import { PageHeading } from "@/components/kickx/ui";
/** Separate entry points; there is deliberately no mixed post feed. */
export default function Page() {
  return <><PageHeading eyebrow="COMMUNITY" title="커뮤니티" description="선수에 대한 의견과 응원 구단의 이야기를 각각 나눠보세요." /><div className="community-entry-grid">
    <Link className="panel community-entry-card" href="/community/players"><UserRound size={28}/><h2>선수 커뮤니티</h2><p>경기력, 가격 변화, 거래 판단에 대한 이야기</p><span>선수 이야기 보기 <ArrowRight size={17}/></span></Link>
    <Link className="panel community-entry-card" href="/community/clubs"><Users size={28}/><h2>구단 커뮤니티</h2><p>응원 팬끼리 나누는 경기와 구단 이야기</p><span>구단 이야기 보기 <ArrowRight size={17}/></span></Link>
  </div></>;
}
