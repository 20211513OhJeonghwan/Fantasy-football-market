import type { Formation, Player, Position } from './types';

export const SQUAD_FORMATION: Formation = {
  id: '4-3-3', name: '4-3-3',
  positions: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'],
};
export const POSITION_LIMITS: Record<Position, number> = { GK: 1, DF: 4, MF: 3, FW: 3 };

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
