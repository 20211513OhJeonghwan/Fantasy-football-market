import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Player } from '@/lib/kickx/types';
import { checkDatabase, migrationMissing } from './prototype';
export async function attachTradeWindows(db: SupabaseClient, players: Player[]) {
  if(!players.length)return players;
  // Bounded batches also cover portfolios containing more than one page of players.
  for(let offset=0;offset<players.length;offset+=100) {
    const batch=players.slice(offset,offset+100);
    const reply=await db.rpc('kickx_trade_windows',{p_players:batch.map(p=>p.id)});
    if(migrationMissing(reply.error)) {
      for(const player of batch)player.status ||= '거래 규칙 적용 중';
      continue;
    }
    checkDatabase(reply.error);
    for(const player of batch) {
      player.tradeWindow=reply.data?.[player.id]??{locked:false};
    }
  }
  return players;
}
