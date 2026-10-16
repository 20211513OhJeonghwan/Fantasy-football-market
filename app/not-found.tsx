import Link from "next/link";
import { ArrowLeft } from "lucide-react";
export default function NotFound() {
  return (
    <div className="empty">
      <span className="eyebrow">404 · OFF THE PITCH</span>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>주소를 확인하거나 홈에서 다시 시작해 주세요.</p>
      <Link className="button primary" href="/">
        <ArrowLeft size={16} />
        홈으로 돌아가기
      </Link>
    </div>
  );
}
