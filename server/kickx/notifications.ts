import 'server-only';
import {authenticatedClient,failure,HttpError,json,readJson,requireOrigin}from './http';
import {checkDatabase}from './prototype';
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9][0-9]{0,17}$/.test(value);
export async function readNotifications(request:Request){try{
 const {client}=await authenticatedClient();
 const params=new URL(request.url).searchParams,before=params.get('before');
 if(before!==null&&!validId(before))throw new HttpError(400,'알림 페이지를 확인해 주세요.');
 const {data,error}=params.get('summary')==='1'?await client.rpc('kickx_notification_summary'):
  await client.rpc('kickx_notifications',{p_before:before,p_limit:20});
 checkDatabase(error);return json({status:'ready',data});
}catch(error){return failure(error);}}
export async function updateNotifications(request:Request){try{
 requireOrigin(request);const {client}=await authenticatedClient();
 const value=await readJson(request);
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'알림 설정을 확인해 주세요.');
 const body=value as Record<string,unknown>;
 let result;
 if(body.action==='preferences'&&typeof body.matchNotifications==='boolean')
  result=await client.rpc('kickx_set_match_notifications',{p_enabled:body.matchNotifications});
 else if(body.action==='read'&&(body.all===true||Array.isArray(body.ids)&&body.ids.length>0&&body.ids.length<=100&&body.ids.every(validId)))
  result=await client.rpc('kickx_mark_notifications',{p_ids:body.all===true?null:body.ids});
 else throw new HttpError(400,'알림 설정을 확인해 주세요.');
 checkDatabase(result.error);return json(result.data);
}catch(error){return failure(error);}}
