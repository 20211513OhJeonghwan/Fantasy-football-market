import type { Formation, Holding, Player, Position } from './types';

export type FormationRule = Formation & { rows: { position: Position; slots: number[] }[] };
// Middle lines use MF (including attacking midfield); the final line uses FW.
export const FORMATION_IDS = ['4-3-3','4-4-2','4-2-3-1','4-3-1-2','4-2-2-2','4-3-2-1','4-1-4-1','4-1-2-3','4-5-1','4-4-1-1','4-2-4',
  '3-5-2','3-4-3','3-4-1-2','3-4-2-1','3-2-4-1','5-3-2','5-4-1','5-2-3'] as const;
export const FORMATIONS: FormationRule[] = FORMATION_IDS.map(id => {
  const lines = id.split('-').map(Number), positions: Position[] = ['GK'];
  const rows: FormationRule['rows'] = [{ position: 'GK', slots: [0] }];
  lines.forEach((count, i) => {
    const position: Position = i === 0 ? 'DF' : i === lines.length - 1 ? 'FW' : 'MF';
    const slots = Array.from({ length: count }, () => { positions.push(position); return positions.length - 1; });
    rows.push({ position, slots });
  });
  return { id, name: id, positions, rows };
});
export const SQUAD_FORMATION = FORMATIONS[0];
export function formationRule(id?: string | null) { return FORMATIONS.find(f => f.id === id) ?? SQUAD_FORMATION; }
export function positionLimits(id?: string | null): Record<Position, number> {
  const limits: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of formationRule(id).positions) limits[p]++;
  return limits;
}
export const POSITION_LIMITS = positionLimits(SQUAD_FORMATION.id);
export const SQUAD_LIMIT = 11;

/** Teammate's compact pitch label: keep one-word registered names, otherwise show the final name part. */
export function compactPlayerName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

/** Holdings, rather than a separately saved lineup, determine purchase capacity. */
export function squadCapacity(holdings: Pick<Holding, 'playerId' | 'bench'>[], getPlayer: (id: string) => Pick<Player, 'position'> | undefined, formationId?: string | null) {
  const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const limits = positionLimits(formationId);
  const ids = [...new Set(holdings.filter(h => !h.bench).map(h => h.playerId))];
  let unknown = 0;
  for (const id of ids) {
    const position = getPlayer(id)?.position;
    if (position && position in counts) counts[position]++;
    else unknown++;
  }
  return { counts, limits, total: ids.length, unknown, excess: ids.length > SQUAD_LIMIT || Object.entries(counts).some(([p, n]) => n > limits[p as Position]) };
}
export function formationChangePlan(holdings: Pick<Holding, 'playerId' | 'bench'>[], getPlayer: (id: string) => Pick<Player, 'position'> | undefined, formationId: string) {
  const capacity = squadCapacity(holdings, getPlayer, formationId);
  const required = Object.fromEntries(Object.entries(capacity.counts).map(([p, count]) => [p, Math.max(0, count - capacity.limits[p as Position])])) as Record<Position, number>;
  return { ...capacity, required, benchCount: Object.values(required).reduce((a, b) => a + b, 0) };
}

export function purchaseBlock(player: Pick<Player, 'id' | 'position'>, holdings: Pick<Holding, 'playerId' | 'bench'>[], getPlayer: (id: string) => Pick<Player, 'position'> | undefined, formationId?: string | null) {
  const capacity = squadCapacity(holdings, getPlayer, formationId);
  if (holdings.some(h => h.playerId === player.id)) return '이미 보유한 선수입니다.';
  if (!player.position) return '포지션 정보를 확인한 뒤 매입할 수 있습니다.';
  if (capacity.unknown) return '보유 선수의 포지션 정보를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.';
  if (capacity.excess) return '보유 정원을 초과했습니다. 초과 포지션 선수를 먼저 매각해 주세요.';
  if (capacity.total >= SQUAD_LIMIT) return '스쿼드 11명을 모두 보유 중입니다. 선수를 매각한 뒤 매입해 주세요.';
  if (capacity.counts[player.position] >= capacity.limits[player.position]) return `${player.position} 보유 정원 ${capacity.limits[player.position]}명이 찼습니다. 같은 포지션 선수를 매각한 뒤 매입해 주세요.`;
  return null;
}

/** Match the database's automatic placement, retaining valid occupied slots. Legacy excess assets stay owned. */
export function ownedSquadSlots(holdings: Pick<Holding, 'playerId' | 'bench'>[], slots: (string | null)[], formationId: string,
  getPlayer: (id: string) => Player | undefined): (string | null)[] {
  const active = holdings.filter(h => !h.bench);
  const owned = new Set(active.map(h => h.playerId));
  const result = fixedSquadSlots(slots, formationId, id => owned.has(id) ? getPlayer(id) : undefined);
  const used = new Set(result.filter(Boolean));
  return result.map((id, i) => {
    if (id) return id;
    const next = active.find(h => !used.has(h.playerId) && getPlayer(h.playerId)?.position === formationRule(formationId).positions[i]);
    if (!next) return null;
    used.add(next.playerId);
    return next.playerId;
  });
}

/** Keep valid positions or preview a formation change without modifying any holding. */
export function fixedSquadSlots(slots: (string | null)[], formationId: string,
  getPlayer: (id: string) => Pick<Player, 'position'> | undefined, targetFormationId = formationId): (string | null)[] {
  const used = new Set<string>();
  return formationRule(targetFormationId).positions.map((position, i) => {
    const id = formationId === targetFormationId ? slots[i]
      : slots.find(id => id && !used.has(id) && getPlayer(id)?.position === position);
    if (!id || used.has(id) || getPlayer(id)?.position !== position) return null;
    used.add(id);
    return id;
  });
}
