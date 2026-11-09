"use client";
import { useEffect, useState } from 'react';
import { benchTimeRemaining } from '@/lib/kickx/bench';
import { dateText } from '@/lib/kickx/data';

/** Uses the saved deadline; ticking never fetches or writes data. */
export function BenchDeadline({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 30000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  // Urgency only changes emphasis; the deadline itself always comes from the server.
  const left = now == null ? null : Date.parse(expiresAt) - now;
  const tone = left == null || !Number.isFinite(left) ? '' : left <= 0 ? ' expired' : left < 3600000 ? ' critical' : left < 86400000 ? ' soon' : '';
  return <span className={`bench-deadline${tone}`}><strong>{now == null ? '자동 매각 예정' : benchTimeRemaining(expiresAt, now)}</strong><time dateTime={expiresAt}>{dateText(expiresAt)} 만료</time></span>;
}
