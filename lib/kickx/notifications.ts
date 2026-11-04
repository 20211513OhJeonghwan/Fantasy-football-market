import { activityHref } from './community-activity';
export type NotificationSummary={hasUnread:boolean;matchNotifications:boolean;commentNotifications:boolean;replyNotifications:boolean};
export type InboxNotification={
 id:string;kind:'price'|'match'|'comment'|'reply';playerId:string|null;playerName:string|null;teamId:string|null;
 fixtureId:string|null;homeName:string|null;awayName:string|null;startsAt:string|null;
 priceBefore:number|null;priceAfter:number|null;createdAt:string;readAt:string|null;
 postId?:string|null;commentId?:string|null;actorName?:string|null;postTitle?:string|null;body?:string|null;
};
export type NotificationPage={items:InboxNotification[];hasMore:boolean;hasUnread:boolean};
export const emptyNotificationSummary=():NotificationSummary=>({hasUnread:false,matchNotifications:true,commentNotifications:true,replyNotifications:true});
export const emptyNotificationPage=():NotificationPage=>({items:[],hasMore:false,hasUnread:false});
export function notificationHref(item:InboxNotification){
 if(item.kind==='comment'||item.kind==='reply')return item.postId?activityHref(item.postId,item.commentId):'/community/clubs';
 return item.kind==='match'&&item.teamId?`/teams/${encodeURIComponent(item.teamId)}`:`/players/${encodeURIComponent(item.playerId??'')}`;
}
