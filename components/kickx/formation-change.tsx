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
  return <Modal title="포메이션 변경" eyebrow="SQUAD FORMATION" size="lg" onClose={() => { if (!saving) onClose(); }}>
    <div className="formation-dialog">
      <label className="modal-field">새 포메이션
        <select aria-label="새 포메이션" value={target} disabled={saving} onChange={e => { setTarget(e.target.value); setSelected([]); setError(''); }}>
          {[3,4,5].map(back => <optgroup key={back} label={`백${back}`}>{FORMATIONS.filter(f => f.id.startsWith(`${back}-`)).map(f => <option key={f.id} value={f.id}>{f.name}{f.id === current ? ' (현재)' : ''}</option>)}</optgroup>)}
        </select>
      </label>
      <div className="formation-comparison"><span>현재 <b>{current}</b></span><span aria-hidden="true">→</span><span>변경 <b>{target}</b></span></div>
      <ul className="formation-limits">{POSITIONS.map(pos => <li key={pos}><PositionBadge position={pos}/><strong>{plan.counts[pos]} / {plan.limits[pos]}</strong><small>{plan.required[pos] ? `${plan.required[pos]}명 벤치 선택 필요` : '유지 가능'}</small></li>)}</ul>
      {plan.unknown > 0 && <p className="form-error" role="alert">일부 보유 선수의 포지션을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.</p>}
      {target !== current && !plan.benchCount && <p className="formation-safe">정원을 초과하는 선수가 없습니다. 모든 주전 선수를 유지한 채 배치를 조정합니다.</p>}
      {POSITIONS.filter(pos => plan.required[pos] > 0).map(pos => <fieldset className="formation-choices" key={pos} disabled={saving}>
        <legend>{pos} 벤치 이동 선수 선택 <b>{count(pos)} / {plan.required[pos]}명</b></legend>
        {(member?.holdings ?? []).some(h => !h.bench && getPlayer(h.playerId)?.position === pos && getPlayer(h.playerId)?.tradeWindow?.locked) && <p className="fine-print">경기 거래 제한 중인 선수는 선택할 수 없습니다. 해당 선수의 제한이 끝난 뒤 다시 선택해 주세요.</p>}
        {(member?.holdings ?? []).filter(h => !h.bench && getPlayer(h.playerId)?.position === pos).map(h => {
          const player = getPlayer(h.playerId)!, checked = selected.includes(h.playerId), locked = !!player.tradeWindow?.locked;
          return <label key={h.playerId} className={checked ? 'checked' : ''}>
            <input type="checkbox" checked={checked} disabled={locked || !checked && count(pos) >= plan.required[pos]} onChange={() => toggle(h.playerId,pos)}/>
            <PlayerPortrait player={player} size="sm"/><span><strong>{player.name}</strong><small>{locked ? '경기 거래 제한 중' : '선택 시 벤치로 이동'}</small></span><b className="num">{money(player.price)} P</b>
          </label>;
        })}
      </fieldset>)}
      {!!plan.benchCount && <p className="formation-warning"><b>벤치로 이동하면 재배치할 수 없습니다.</b>선택한 선수의 매각 기준가는 이동 당시 가격으로 유지됩니다. 7일 안에 직접 매각하지 않으면 2% 수수료를 적용해 자동 매각됩니다. 기존 벤치의 가격과 기한은 유지됩니다.</p>}
      {formationRule(target).rows.length > 4 && <p className="fine-print">중간의 공격형 미드필더 줄도 MF 정원으로 계산합니다.</p>}
      {outdated && <p className="form-error" role="alert">보유 선수나 배치가 변경되었습니다. 이 창을 닫고 최신 스쿼드에서 다시 변경해 주세요.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button secondary" disabled={saving} onClick={onClose}>취소</button><button className="button primary" disabled={!complete || outdated || plan.unknown > 0 || target === current || saving || !member || member.financialReady === false} onClick={submit}>{saving ? '변경 중…' : plan.benchCount ? `${plan.benchCount}명 벤치 이동 후 변경` : '포메이션 변경 확정'}</button></div>
    </div>
  </Modal>;
}
