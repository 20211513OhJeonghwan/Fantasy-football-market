import { authenticatedClient, failure, json, readJson, requireOrigin } from "@/server/kickx/http";
import { asObject, checkDatabase, identity, requireMatchTradingRules } from "@/server/kickx/prototype";
export async function POST(request:Request){try{requireOrigin(request);const {client}=await authenticatedClient();const body=asObject(await readJson(request));const quoteId=identity(body.quoteId,true),requestId=identity(body.requestId,true);await requireMatchTradingRules(client);const {data,error}=await client.rpc("kickx_trade",{p_quote:quoteId,p_request:requestId});checkDatabase(error);return json({accepted:true,trade:data});}catch(error){return failure(error);}}
export async function GET(request:Request){try{
 const {client}=await authenticatedClient();const params=new URL(request.url).searchParams;
 const page=Math.max(1,Math.min(10000,Math.floor(Number(params.get("page"))||1)));
 let query=client.from("trades").select("*",{count:"exact"});
 if(["buy","sell"].includes(params.get("side")??""))query=query.eq("side",params.get("side"));
 const search=(params.get("q")??"").slice(0,100).replace(/[\\%_]/g,"\\$&");if(search)query=query.ilike("player_name",`%${search}%`);
 if(["7","30"].includes(params.get("days")??""))query=query.gte("created_at",new Date(Date.now()-Number(params.get("days"))*86400000).toISOString());
 const {data,error,count}=await query.order("created_at",{ascending:false}).order("sequence",{ascending:false}).range((page-1)*50,page*50-1);checkDatabase(error);
 return json({status:"ready",data:{items:(data??[]).map(t=>({id:t.id,playerId:t.player_id,playerName:t.player_name,type:t.side,quantity:1,price:t.price,fee:t.fee,net:t.net,date:t.created_at,status:"체결"})),total:count,page,size:50}});
}catch(error){return failure(error);}}
