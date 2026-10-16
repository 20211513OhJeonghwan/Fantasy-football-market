"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="empty">
      <span className="eyebrow">PAUSE THE GAME</span>
      <h1>화면을 불러오지 못했습니다</h1>
      <p>일시적인 문제일 수 있습니다. 다시 시도해 주세요.</p>
      <button className="button primary" onClick={reset}>
        다시 시도
      </button>
    </div>
  );
}
