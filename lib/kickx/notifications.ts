export type NotificationSummary={hasUnread:boolean;matchNotifications:boolean};
export type InboxNotification={
 id:string;kind:'price'|'match';playerId:string;playerName:string;teamId:string|null;
 fixtureId:string|null;homeName:string|null;awayName:string|null;startsAt:string|null;
 priceBefore:number|null;priceAfter:number|null;createdAt:string;readAt:string|null;
};
export type NotificationPage={items:InboxNotification[];hasMore:boolean;hasUnread:boolean};
export const emptyNotificationSummary=():NotificationSummary=>({hasUnread:false,matchNotifications:true});
export const emptyNotificationPage=():NotificationPage=>({items:[],hasMore:false,hasUnread:false});
