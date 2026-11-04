import test from 'node:test';
import assert from 'node:assert/strict';
import{loadTs}from'./load-ts.mjs';
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function handlers({signedIn=true,origin=true}={}){
 const calls=[];
 const api=loadTs('../server/kickx/notifications.ts',{'server-only':{},'./prototype':{checkDatabase:e=>{if(e)throw Error('DB');}},'./http':{
  HttpError,authenticatedClient:async()=>{if(!signedIn)throw new HttpError(401,'AUTH');return{client:{rpc:async(name,args)=>{calls.push({name,args});return{data:{hasUnread:false,matchNotifications:true},error:null};}}};},
  requireOrigin:()=>{if(!origin)throw new HttpError(403,'ORIGIN');},readJson:r=>r.json(),json:data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}}),failure:e=>Response.json({error:e.message},{status:e.status??500})}});
 return{...api,calls};
}
const request=body=>new Request('https://kickx.test/api/kickx/notifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('notification reads use the signed-in identity and return private responses',async()=>{
 const api=handlers();const response=await api.readNotifications(new Request('https://kickx.test/api/kickx/notifications?summary=1&user=other'));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(api.calls,[{name:'kickx_notification_summary',args:undefined}]);
 await api.readNotifications(new Request('https://kickx.test/api/kickx/notifications?before=123'));
 assert.deepEqual(api.calls[1],{name:'kickx_notifications',args:{p_before:'123',p_limit:20}});
 for(const before of['-1','0','1 OR TRUE','1.5'])assert.equal((await api.readNotifications(new Request('https://kickx.test/api/kickx/notifications?before='+encodeURIComponent(before)))).status,400);
});
test('notification mutations constrain IDs and preferences without accepting a recipient',async()=>{
 const api=handlers();await api.updateNotifications(request({action:'read',ids:['4'],userId:'other'}));
 assert.deepEqual(api.calls[0],{name:'kickx_mark_notifications',args:{p_ids:['4']}});
 await api.updateNotifications(request({action:'read',all:true}));assert.deepEqual(api.calls[1].args,{p_ids:null});
 await api.updateNotifications(request({action:'preferences',matchNotifications:false}));assert.deepEqual(api.calls[2],{name:'kickx_set_match_notifications',args:{p_enabled:false}});
 for(const body of[{action:'read',ids:[]},{action:'read',ids:['bad']},{action:'read',ids:Array(101).fill('1')},{action:'preferences',matchNotifications:'false'},null])assert.equal((await api.updateNotifications(request(body))).status,400);
});
test('guests and cross-origin writes do not touch notification data',async()=>{
 const guest=handlers({signedIn:false});assert.equal((await guest.readNotifications(new Request('https://kickx.test'))).status,401);assert.equal((await guest.updateNotifications(request({action:'read',all:true}))).status,401);assert.equal(guest.calls.length,0);
 const foreign=handlers({origin:false});assert.equal((await foreign.updateNotifications(request({action:'read',all:true}))).status,403);assert.equal(foreign.calls.length,0);
});
test('comment and reply preferences are independent partial updates bound to the caller',async()=>{
 const api=handlers();
 await api.updateNotifications(request({action:'preferences',commentNotifications:false,userId:'another-user'}));
 assert.deepEqual(api.calls[0],{name:'kickx_set_community_notifications',args:{p_comments:false,p_replies:null}});
 await api.updateNotifications(request({action:'preferences',replyNotifications:false}));
 assert.deepEqual(api.calls[1].args,{p_comments:null,p_replies:false});
 for(const body of[{action:'preferences'},{action:'preferences',commentNotifications:'false'},{action:'preferences',commentNotifications:true,replyNotifications:1}])assert.equal((await api.updateNotifications(request(body))).status,400);
 assert.equal(api.calls.length,2);
});
