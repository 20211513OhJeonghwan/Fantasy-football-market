"use client";
import Link from 'next/link';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode}from 'react';
import {CalendarClock,CheckCheck,CornerDownRight,Mail,MessageCircle,TrendingDown,TrendingUp,X}from 'lucide-react';
import {apiRequest}from '@/lib/kickx/client';
import {dateText,money}from '@/lib/kickx/data';
import {emptyNotificationPage,emptyNotificationSummary,notificationHref,type InboxNotification,type NotificationSummary}from '@/lib/kickx/notifications';
import {usePlatform,useResource}from './provider';

type CommunityPreference='commentNotifications'|'replyNotifications';
type ContextValue={summary:NotificationSummary;ready:boolean;busy:boolean;markRead:(ids?:string[])=>Promise<boolean>;setEnabled:(enabled:boolean)=>Promise<void>;setCommunityEnabled:(kind:CommunityPreference,enabled:boolean)=>Promise<void>};
const Context=createContext<ContextValue|null>(null);
export function NotificationProvider({children}:{children:ReactNode}){
 const {data,mock,notify}=usePlatform();
 const resource=useResource(data.session?.profile&&!mock?'/api/kickx/notifications?summary=1':null,emptyNotificationSummary,60000);
 const [busy,setBusy]=useState(false);
 const lock=useRef(false);
 async function markRead(ids?:string[]){
  if(mock)return true;
  try{const result=await apiRequest<NotificationSummary>('/api/kickx/notifications','PUT',{action:'read',...(ids?{ids}:{all:true})});resource.setData(result);return true;}
  catch{notify('알림을 읽음 처리하지 못했습니다. 다시 시도해 주세요.','error');return false;}
 }
 async function setEnabled(enabled:boolean){
  if(lock.current)return;
  if(mock){notify('예시 모드에서는 알림 설정을 저장하지 않습니다.');return;}
  lock.current=true;setBusy(true);
  try{const result=await apiRequest<NotificationSummary>('/api/kickx/notifications','PUT',{action:'preferences',matchNotifications:enabled});resource.setData(result);notify(enabled?'경기 알림을 켰습니다.':'경기 알림을 껐습니다.');}
  catch{notify('경기 알림 설정을 저장하지 못했습니다.','error');}
  finally{lock.current=false;setBusy(false);}
 }
 async function setCommunityEnabled(kind:CommunityPreference,enabled:boolean){
  if(lock.current)return;
  if(mock){notify('예시 모드에서는 알림 설정을 저장하지 않습니다.');return;}
  lock.current=true;setBusy(true);
  try{const result=await apiRequest<NotificationSummary>('/api/kickx/notifications','PUT',{action:'preferences',[kind]:enabled});resource.setData(result);notify('커뮤니티 알림 설정을 저장했습니다.');}
  catch{notify('커뮤니티 알림 설정을 저장하지 못했습니다. 다시 시도해 주세요.','error');}
  finally{lock.current=false;setBusy(false);}
 }
 return <Context.Provider value={{summary:resource.data,ready:resource.status==='ready'||mock,busy,markRead,setEnabled,setCommunityEnabled}}>{children}</Context.Provider>;
}
function useNotifications(){const context=useContext(Context);if(!context)throw Error('NotificationProvider required');return context;}
export function MatchNotificationToggle(){
 const {data}=usePlatform();const context=useNotifications();
 if(!data.session?.profile)return null;
 return <section className="match-notification-setting" aria-label="경기 알림 설정"><div><strong>보유 선수 경기 알림</strong><p>경기 시작 90분 전 알림함으로 알려드려요.</p></div><label><input type="checkbox" role="switch" aria-label="보유 선수 경기 알림" checked={context.summary.matchNotifications} disabled={!context.ready||context.busy} onChange={e=>void context.setEnabled(e.target.checked)}/><span>{context.summary.matchNotifications?'켜짐':'꺼짐'}</span></label></section>;
}
export function CommunityNotificationSettings(){
 const {data}=usePlatform();const context=useNotifications();
 if(!data.session?.profile)return null;
 const options=[{kind:'commentNotifications' as const,label:'내 글의 댓글 알림',description:'내가 쓴 게시글에 새 댓글이 달리면 알려드려요.'},{kind:'replyNotifications' as const,label:'내 댓글의 답글 알림',description:'내 댓글에 답글이 달리면 알려드려요.'}];
 return <section className="panel community-notification-settings" aria-label="커뮤니티 알림 설정"><h2>커뮤니티 알림</h2><p>알림함에서 확인할 수 있고, 최근 2주 동안 보관됩니다.</p>{options.map(option=><label className="community-notification-row" key={option.kind}><span><strong>{option.label}</strong><small>{option.description}</small></span><span className="notification-switch"><input type="checkbox" role="switch" aria-label={option.label} checked={context.summary[option.kind]??true} disabled={!context.ready||context.busy} onChange={event=>void context.setCommunityEnabled(option.kind,event.target.checked)}/><span>{(context.summary[option.kind]??true)?'켜짐':'꺼짐'}</span></span></label>)}</section>;
}
/** Kind marker: a small tinted icon so price, match, comment and reply rows scan apart. */
function NotificationIcon({item}:{item:InboxNotification}){
 const down=item.kind==='price'&&(item.priceAfter??0)<(item.priceBefore??0);
 const Icon=item.kind==='comment'?MessageCircle:item.kind==='reply'?CornerDownRight:item.kind==='match'?CalendarClock:down?TrendingDown:TrendingUp;
 return <span className={`notification-icon ${item.kind}${down?' down':''}`} aria-hidden="true"><Icon size={16}/></span>;
}
function NotificationContents({item}:{item:InboxNotification}){
 if(item.kind==='comment'||item.kind==='reply')return <><strong>{item.actorName??'사용자'}님이 {item.kind==='reply'?'답글':'댓글'}을 남겼습니다</strong><span className="notification-post-title">{item.postTitle}</span><span className="notification-comment-body">{item.body}</span><time dateTime={item.createdAt}>{dateText(item.createdAt)}</time></>;
 return <><strong>{item.playerName} · {item.kind==='price'?'가격 변동':'경기 예정'}</strong><span>{item.kind==='price'?`${money(item.priceBefore)} P → ${money(item.priceAfter)} P`:`${item.homeName??'홈 구단'} vs ${item.awayName??'원정 구단'}`}</span>{item.kind==='match'&&item.startsAt&&<span>경기 시작 {dateText(item.startsAt)}</span>}<time dateTime={item.createdAt}>{dateText(item.createdAt)}</time></>;
}
export function NotificationBell(){
 const {data,mock}=usePlatform();const context=useNotifications();
 const [open,setOpen]=useState(false),[cursor,setCursor]=useState<string|null>(null),[older,setOlder]=useState<InboxNotification[]>([]),[reading,setReading]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 const url=open&&data.session?.profile&&!mock?`/api/kickx/notifications${cursor?`?before=${cursor}`:''}`:null;
 const resource=useResource(url,emptyNotificationPage);
 const page=resource.data;
 const rows=[...new Map([...older,...page.items].map(item=>[item.id,item])).values()];
 useEffect(()=>{
  if(!open)return;
  closeButton.current?.focus();
  const close=(event:MouseEvent|KeyboardEvent)=>{if(event instanceof KeyboardEvent?event.key==='Escape':!root.current?.contains(event.target as Node)){setOpen(false);if(event instanceof KeyboardEvent)trigger.current?.focus();}};
  document.addEventListener('mousedown',close);document.addEventListener('keydown',close);
  return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',close);};
 },[open]);
 if(!data.session?.profile)return null;
 async function markAll(){setReading(true);if(await context.markRead()){setOlder(current=>current.map(n=>({...n,readAt:new Date().toISOString()})));resource.setData(current=>({...current,hasUnread:false,items:current.items.map(n=>({...n,readAt:new Date().toISOString()}))}));}setReading(false);}
 function follow(item:InboxNotification){if(!item.readAt)void context.markRead([item.id]);setOpen(false);}
 return <div className="notification-bell" ref={root}>
  <button ref={trigger} type="button" className="notification-trigger" aria-label={context.summary.hasUnread?'알림함 · 읽지 않은 알림 있음':'알림함'} aria-expanded={open} aria-controls="notification-inbox" onClick={()=>{if(!open){setCursor(null);setOlder([]);}setOpen(!open);}}><Mail size={23}/>{context.summary.hasUnread&&<i className="notification-unread-dot" aria-hidden="true"/>}</button>
  {open&&<section id="notification-inbox" className="notification-inbox" role="dialog" aria-label="알림함"><header><h2>알림함</h2><button type="button" ref={closeButton} aria-label="알림함 닫기" onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={19}/></button></header>
   <div className="notification-tools"><span>최근 2주 알림</span><button type="button" disabled={!context.summary.hasUnread||reading} onClick={()=>void markAll()}><CheckCheck size={15}/>모두 읽음</button></div>
   <div className="notification-scroll">{resource.status==='error'?<p className="notification-empty">알림을 불러오지 못했습니다.<button className="text-link" onClick={resource.reload}>다시 확인</button></p>:!rows.length?(resource.status==='loading'&&!mock?<div className="notification-loading" role="status" aria-label="알림을 불러오는 중입니다."><i/><i/><i/></div>:<p className="notification-empty"><Mail size={22} aria-hidden="true"/>새로운 알림이 없습니다.<small>가격·경기·댓글 알림이 최근 2주 동안 여기에 모입니다.</small></p>):<ul>{rows.map(item=><li key={item.id} className={item.readAt?'':'unread'}><Link href={notificationHref(item)} onClick={()=>follow(item)}><NotificationIcon item={item}/><span className="notification-text"><NotificationContents item={item}/></span></Link></li>)}</ul>}
   {page.hasMore&&<button className="notification-more" disabled={resource.status!=='ready'} onClick={()=>{setOlder(rows);setCursor(page.items.at(-1)?.id??null);}}>이전 알림 더 보기</button>}</div>
  </section>}
 </div>;
}
