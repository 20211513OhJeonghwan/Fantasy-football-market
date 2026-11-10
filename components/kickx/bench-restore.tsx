"use client";
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/kickx/client';
import { benchRestoreBlock } from '@/lib/kickx/bench';
import { squadCapacity } from '@/lib/kickx/squad';
import { DOMESTIC_LEAGUES } from '@/lib/kickx/support';
import { usePlatform } from './provider';
export function BenchRestoreButton({ playerId }: { playerId: string }) {
  const { data, getPlayer, getTeam, reload, notify, mock } = usePlatform();
  const member = data.member, player = getPlayer(playerId), bench = member?.holdings.find(h => h.playerId === playerId)?.bench;
  const capacity = squadCapacity(member?.holdings ?? [], getPlayer, member?.squad?.formationId);
  const league = getTeam(player?.team ?? null)?.leagueId;
  const [saving, setSaving] = useState(false), [now, setNow] = useState<number | undefined>();
  const lock = useRef(false);
  useEffect(() => {
    if (!bench) return;
    const update = () => setNow(Date.now());
    const timer = setTimeout(update, Math.max(0, Date.parse(bench.expiresAt) - Date.now() + 20));
    document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [bench]);
  const blocked = benchRestoreBlock(player, bench, capacity, !!league && (DOMESTIC_LEAGUES as readonly string[]).includes(league), now);
  async function restore() {
    if (lock.current || blocked || !member || member.financialReady === false) return;
    if (mock) { notify('예시 화면에서는 복귀를 저장하지 않습니다.', 'error'); return; }
    lock.current = true; setSaving(true);
    try {
      await apiRequest('/api/kickx/squad/bench', 'POST', { playerId, revision: member.squad?.revision ?? 0 });
      reload(); notify(`${player?.name ?? '선수'}이(가) 주전으로 복귀했습니다.`);
    } catch (e) { notify(e instanceof Error ? e.message : '복귀하지 못했습니다.', 'error'); reload(); }
    finally { lock.current = false; setSaving(false); }
  }
  return <span className="bench-restore"><button type="button" className="button primary small" disabled={saving || !!blocked || !member || member.financialReady === false} aria-busy={saving} title={blocked ?? '매입 원가를 유지한 채 빈 포지션으로 복귀합니다.'} onClick={() => void restore()}>{saving ? '복귀 중…' : '주전 복귀'}</button>{blocked && <small>{blocked}</small>}</span>;
}
