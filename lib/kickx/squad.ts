import type { Formation, Holding, Player, Position } from './types';

export const SQUAD_FORMATION: Formation = {
  id: '4-3-3', name: '4-3-3',
  positions: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'],
};
export const POSITION_LIMITS: Record<Position, number> = { GK: 1, DF: 4, MF: 3, FW: 3 };
export const SQUAD_LIMIT = 11;

/** Holdings, rather than a separately saved lineup, determine purchase capacity. */
export function squadCapacity(holdings: Pick<Holding, 'playerId' | 'bench'>[], getPlayer: (id: string) => Pick<Player, 'position'> | undefined) {
  const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const ids = [...new Set(holdings.filter(h => !h.bench).map(h => h.playerId))];
  let unknown = 0;
  for (const id of ids) {
    const position = getPlayer(id)?.position;
    if (position && position in counts) counts[position]++;
    else unknown++;
  }
  return { counts, total: ids.length, unknown, excess: ids.length > SQUAD_LIMIT || Object.entries(counts).some(([p, n]) => n > POSITION_LIMITS[p as Position]) };
}

export function purchaseBlock(player: Pick<Player, 'id' | 'position'>, holdings: Pick<Holding, 'playerId' | 'bench'>[], getPlayer: (id: string) => Pick<Player, 'position'> | undefined) {
  const capacity = squadCapacity(holdings, getPlayer);
  if (holdings.some(h => h.playerId === player.id)) return '이미 보유한 선수입니다.';
  if (!player.position) return '포지션 정보를 확인한 뒤 매입할 수 있습니다.';
  if (capacity.unknown) return '보유 선수의 포지션 정보를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.';
  if (capacity.excess) return '보유 정원을 초과했습니다. 초과 포지션 선수를 먼저 매각해 주세요.';
  if (capacity.total >= SQUAD_LIMIT) return '스쿼드 11명을 모두 보유 중입니다. 선수를 매각한 뒤 매입해 주세요.';
  if (capacity.counts[player.position] >= POSITION_LIMITS[player.position]) return `${player.position} 보유 정원 ${POSITION_LIMITS[player.position]}명이 찼습니다. 같은 포지션 선수를 매각한 뒤 매입해 주세요.`;
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
    const next = active.find(h => !used.has(h.playerId) && getPlayer(h.playerId)?.position === SQUAD_FORMATION.positions[i]);
    if (!next) return null;
    used.add(next.playerId);
    return next.playerId;
  });
}

/** Preserve valid 4-3-3 slots; preview an older formation by position without selling assets. */
export function fixedSquadSlots(slots: (string | null)[], formationId: string,
  getPlayer: (id: string) => Player | undefined): (string | null)[] {
  const used = new Set<string>();
  return SQUAD_FORMATION.positions.map((position, i) => {
    const id = formationId === SQUAD_FORMATION.id ? slots[i]
      : slots.find(id => id && !used.has(id) && getPlayer(id)?.position === position);
    if (!id || used.has(id) || getPlayer(id)?.position !== position) return null;
    used.add(id);
    return id;
  });
}
