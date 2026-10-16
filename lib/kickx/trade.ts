import type { MemberData, Player, TradeQuote } from './types';
import {apiRequest} from './client';
/** All real quotes and settlement values come from the atomic database service. */
export type TradeService = {
 available: boolean; mock: boolean;
 quote(player:Player,side:TradeQuote['side'],member:MemberData|null):Promise<TradeQuote>;
 submit(quote:TradeQuote,requestId:string):Promise<{accepted:true}>;
};
const live:TradeService={available:true,mock:false,
 quote:(player,side)=>apiRequest('/api/kickx/trades/quote','POST',{playerId:player.id,side}),
 submit:(quote,requestId)=>apiRequest('/api/kickx/trades','POST',{quoteId:quote.id,requestId}),
};
const sample:TradeService={available:true,mock:true,
 async quote(player,side,member){
  if(player.price==null)throw new Error('가치 산정 전입니다.');
  const price=player.price,fee=side==='sell'?Math.round(price*.02):0,settlement=price-fee,balance=member?.points??null;
  return {playerId:player.id,side,quantity:1,price,fee,settlement,balance,balanceAfter:balance==null?null:balance+(side==='buy'?-settlement:settlement),quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString()};
 },
 async submit(){return {accepted:true};},
};
export function tradeService(mock:boolean):TradeService{return mock?sample:live;}
