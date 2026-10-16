import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/server/kickx/config';
import { calculatePlayer } from '@/server/kickx/engine/service';
import { runRealtimeFootball } from '@/scripts/lib/realtime-football.mjs';
export const maxDuration = 60;
/** Machine-only: Supabase validates the supplied service credential through an RPC
 * denied to every public/member role. No key is accepted based on a decoded JWT. */
export async function POST(request: Request) {
  const config=getSupabaseConfig(),authorization=request.headers.get('authorization')??'';
  const key=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!config || !key || key===config.key || key.length>2048)return Response.json({error:'UNAUTHORIZED'},{status:401});
  const db=createClient(config.url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(8000)})}});
  let token: string | null=null;
  try {
    // Do not read credentials in the body before authenticating the caller.
    const claim=await db.rpc('kickx_realtime_claim');
    if(claim.error)return Response.json({error:'UNAUTHORIZED'},{status:401});
    if(claim.data.busy)return Response.json({busy:true});
    token=claim.data.token;
    const length=Number(request.headers.get('content-length')??0);
    if(length>2048)throw new Error('INVALID_INPUT');
    const raw=await request.text();if(raw.length>2048)throw new Error('INVALID_INPUT');
    const body=JSON.parse(raw);
    if(typeof body.bsdKey!=='string' || body.bsdKey.length<8 || body.bsdKey.length>512)throw new Error('INVALID_INPUT');
    const summary=await runRealtimeFootball(db,body.bsdKey,{claim:claim.data,calculate:(id:string)=>calculatePlayer(db,id,null)});
    token=null;
    return Response.json(summary,{status:summary.error?503:200,headers:{'Cache-Control':'no-store'}});
  } catch {
    if(token)await db.rpc('kickx_realtime_finish',{p_token:token,p_summary:{},p_error:'WORKER_RETRY'});
    // Provider/DB messages and request headers/body must never be logged or echoed.
    return Response.json({error:'WORKER_RETRY'},{status:503});
  }
}
