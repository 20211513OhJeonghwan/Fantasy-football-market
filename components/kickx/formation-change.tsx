"use client";
import { useRef, useState } from 'react';
import { FORMATIONS, formationChangePlan, formationRule } from '@/lib/kickx/squad';
import { apiRequest } from '@/lib/kickx/client';
import { money } from '@/lib/kickx/data';
import type { Position } from '@/lib/kickx/types';
import { usePlatform } from './provider';
import { Modal, PlayerPortrait, PositionBadge } from './ui';

const POSITIONS: Position[] = ['GK','DF','MF','FW'];
export function FormationChangeDialog({ onClose }: { onClose: () => void }) {
  const { data, getPlayer, reload, notify, mock } = usePlatform(), member = data.member;
  const current = member?.squad?.formationId ?? '4-3-3';
  const [target, setTarget] = useState(current), [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), [revision] = useState(member?.squad?.revision ?? 0);
  const plan = formationChangePlan(member?.holdings ?? [], getPlayer, target);
  const outdated = revision !== (member?.squad?.revision ?? 0);
  const count = (pos: Position) => selected.filter(id => getPlayer(id)?.position === pos).length;
  const complete = POSITIONS.every(pos => count(pos) === plan.required[pos]);
  function toggle(id: string, pos: Position) {
    setError('');
    setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : ids.filter(x => getPlayer(x)?.position === pos).length < plan.required[pos] ? [...ids,id] : ids);
  }
  async function submit() {
    if (lock.current || !complete || outdated || plan.unknown || target === current || !member) return;
    if (mock) { setError('예시 화면에서는 포메이션을 저장하지 않습니다. 로그인 후 이용해 주세요.'); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      await apiRequest('/api/kickx/squad/formation','POST',{ formationId: target, benchPlayerIds: selected, revision });
      reload(); notify(`포메이션을 ${target}(으)로 변경했습니다.${selected.length ? ` ${selected.length}명은 벤치로 이동했습니다.` : ''}`); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : '포메이션을 변경하지 못했습니다.'); }
    finally { lock.current=false; setSaving(false); }
  }
  const totalRequired = plan.benchCount, totalSelected = selected.length;
  return <Modal title="포메이션 변경" eyebrow="SQUAD FORMATION" size="lg" onClose={() => { if (!saving) onClose(); }}>
    <div className="formation-dialog">
      {/* 1. Before → after first, each with a small shape of its lines. */}
      <div className="formation-comparison">
        <div className="formation-side"><span>현재</span><b>{current}</b><FormationShape id={current} /></div>
        <span className="formation-arrow" aria-hidden="true">→</span>
        <div className={`formation-side next${target !== current ? ' changed' : ''}`}>
          <label htmlFor="formation-target">변경</label>
          <select id="formation-target" aria-label="새 포메이션" value={target} disabled={saving} onChange={e => { setTarget(e.target.value); setSelected([]); setError(''); }}>
            {[3,4,5].map(back => <optgroup key={back} label={`백${back}`}>{FORMATIONS.filter(f => f.id.startsWith(`${back}-`)).map(f => <option key={f.id} value={f.id}>{f.name}{f.id === current ? ' (현재)' : ''}</option>)}</optgroup>)}
          </select>
          <FormationShape id={target} />
        </div>
      </div>
      {/* 2. Position quotas, then how far the required bench selection has got. */}
      <ul className="formation-limits">{POSITIONS.map(pos => <li key={pos} className={plan.required[pos] ? (count(pos) === plan.required[pos] ? 'done' : 'need') : ''}><PositionBadge position={pos}/><strong className="num">{plan.counts[pos]} / {plan.limits[pos]}</strong><small>{plan.required[pos] ? `${count(pos)} / ${plan.required[pos]}명 선택` : '유지'}</small></li>)}</ul>
      {plan.unknown > 0 && <p className="form-error" role="alert">일부 보유 선수의 포지션을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.</p>}
      {target !== current && !plan.benchCount && <p className="formation-safe">정원을 초과하는 선수가 없습니다. 모든 주전 선수를 유지한 채 배치를 조정합니다.</p>}
      {!!totalRequired && <div className="formation-progress" role="status"><span>벤치로 이동할 선수 <b className="num">{totalSelected} / {totalRequired}명</b> 선택</span><i aria-hidden="true"><span style={{ width: `${Math.min(100, totalSelected / totalRequired * 100)}%` }} /></i></div>}
      {POSITIONS.filter(pos => plan.required[pos] > 0).map(pos => <fieldset className="formation-choices" key={pos} disabled={saving}>
        <legend><PositionBadge position={pos}/> 벤치 이동 선수 선택 <b className={`num${count(pos) === plan.required[pos] ? ' done' : ''}`}>{count(pos)} / {plan.required[pos]}명</b></legend>
        {(member?.holdings ?? []).filter(h => !h.bench && getPlayer(h.playerId)?.position === pos).map(h => {
          const player = getPlayer(h.playerId)!, checked = selected.includes(h.playerId), locked = !!player.tradeWindow?.locked, full = !checked && count(pos) >= plan.required[pos];
          // State is spelled out in text so it never depends on colour alone.
          const state = locked ? '경기 거래 제한 · 선택 불가' : checked ? '선택됨 · 벤치로 이동' : full ? '선택 완료 · 다른 선수를 해제하면 선택 가능' : '선택 시 벤치로 이동';
          return <label key={h.playerId} className={`${checked ? 'checked' : ''}${locked ? ' locked' : ''}${full && !locked ? ' full' : ''}`}>
            <input type="checkbox" checked={checked} disabled={locked || full} onChange={() => toggle(h.playerId,pos)}/>
            <PlayerPortrait player={player} size="sm"/><span><strong>{player.name}</strong><small>{state}</small></span><b className="num">{money(player.price)} P</b>
          </label>;
        })}
      </fieldset>)}
      {/* 3. One shared rules note instead of a warning on every row. */}
      {!!plan.benchCount && <div className="formation-warning"><b>벤치도 현재 시세를 반영합니다</b><p>벤치도 현재 시세로 평가되어 전체 보유 인원은 11명을 넘을 수 있습니다. 주전은 11명과 포지션별 정원을 지켜야 합니다. 7일 안에 빈 포지션으로 복귀하거나 매각할 수 있으며, 기한이 지나면 수수료 2%를 적용해 자동 매각합니다. 경기 거래 제한 중에는 해제 후 처리합니다. 계속 벤치인 선수의 시작 시각과 기한은 유지됩니다.</p></div>}
      {formationRule(target).rows.length > 4 && <p className="fine-print">중간의 공격형 미드필더 줄도 MF 정원으로 계산합니다.</p>}
      {outdated && <p className="form-error" role="alert">보유 선수나 배치가 변경되었습니다. 이 창을 닫고 최신 스쿼드에서 다시 변경해 주세요.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions formation-actions"><button className="button secondary" disabled={saving} onClick={onClose}>취소</button><button className="button primary" disabled={!complete || outdated || plan.unknown > 0 || target === current || saving || !member || member.financialReady === false} onClick={submit}>{saving ? '변경 중…' : plan.benchCount ? `${plan.benchCount}명 벤치 이동 후 변경` : '포메이션 변경 확정'}</button></div>
    </div>
  </Modal>;
}
/** Small line diagram of a formation, front line on top. */
function FormationShape({ id }: { id: string }) {
  const rows = [...formationRule(id).rows].reverse();
  return <span className="formation-shape" aria-hidden="true">{rows.map((row, i) => <span key={i}>{row.slots.map(slot => <i key={slot} />)}</span>)}</span>;
}
