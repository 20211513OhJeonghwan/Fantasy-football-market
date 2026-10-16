export async function configureMinuteWorker(db,bsdKey,serviceKey) {
  const result=await db.rpc('kickx_configure_minute_worker',{p_bsd_key:bsdKey,p_service_key:serviceKey});
  if(['PGRST202','42883'].includes(result.error?.code))return {configured:false,reason:'MINUTE_WORKER_SQL_REQUIRED'};
  if(result.error)throw new Error('MINUTE_WORKER_CONFIGURATION_FAILED');
  return result.data;
}
