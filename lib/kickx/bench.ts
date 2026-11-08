import type { Holding, Player } from './types';

export const BENCH_DAYS = 14;
export function tradeExecutionStatus(reason?: string | null) {
  return reason === 'bench_expired' ? '벤치 자동 매각' : reason === 'bench_manual' ? '벤치 매각' : '체결';
}
export function benchReason(reason: NonNullable<Holding['bench']>['reason']) {
  return { transfer: '소속 구단 변경', position: '포지션 변경', transfer_position: '소속 구단·포지션 변경' }[reason];
}
export function benchExpired(bench: Holding['bench'], now = Date.now()) {
  return !!bench && Date.parse(bench.expiresAt) <= now;
}
/** A sale preview must use the owner's protected value, including out-of-scope/paused players. */
export function benchSalePlayer(player: Player, holding?: Pick<Holding, 'bench'>): Player {
  return holding?.bench ? { ...player, price: holding.bench.price, change: null, status: null, tradeWindow: { locked: false } } : player;
}
