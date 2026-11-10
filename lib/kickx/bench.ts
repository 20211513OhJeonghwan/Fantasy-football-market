import type { Holding, Player, Position } from './types';

export const BENCH_DAYS = 7;
export function tradeExecutionStatus(reason?: string | null) {
  return reason === 'bench_expired' ? '벤치 자동 매각' : reason === 'bench_manual' ? '벤치 매각' : '체결';
}
export function benchReason(reason: NonNullable<Holding['bench']>['reason']) {
  return { transfer: '소속 구단 변경', position: '포지션 변경', transfer_position: '소속 구단·포지션 변경', formation: '포메이션 변경' }[reason];
}
export function benchTimeRemaining(expiresAt: string, now = Date.now()) {
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining)) return '자동 매각 기한 확인 중';
  if (remaining <= 0) return '자동 매각 처리 중';
  if (remaining < 60000) return '자동 매각까지 1분 미만';
  const minutes = Math.floor(remaining / 60000), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return `자동 매각까지 ${days ? `${days}일 ` : ''}${hours ? `${hours}시간 ` : ''}${minutes % 60}분`;
}
export function benchExpired(bench: Holding['bench'], now = Date.now()) {
  return !!bench && Date.parse(bench.expiresAt) <= now;
}
/** Bench sale follows current shared prices and the ordinary match lock. */
export function benchSalePlayer(player: Player, holding?: Pick<Holding, 'bench'>): Player {
  return holding?.bench ? { ...player, price: player.price ?? holding.bench.price, status: null } : player;
}

export function benchRestoreBlock(player: Player | undefined, bench: Holding['bench'],
  capacity: { counts: Record<Position, number>; limits: Record<Position, number>; total: number; unknown: number; excess: boolean },
  inScope: boolean, now = Date.now()) {
  if (!bench) return '이미 주전인 선수입니다.';
  if (benchExpired(bench, now)) return '자동 매각 처리 중';
  if (!player || !player.position) return '포지션 확인 필요';
  if (!inScope) return '5대 리그 소속 선수만 복귀 가능';
  if (player.status) return player.status;
  if (player.price == null) return '가격 확인 필요';
  if (player.tradeWindow?.locked) return '경기 거래 제한';
  if (capacity.unknown || capacity.excess) return '주전 정원 확인 필요';
  if (capacity.total >= 11) return '주전 정원 마감';
  if (capacity.counts[player.position] >= capacity.limits[player.position]) return `${player.position} 정원 마감`;
  return null;
}
