// User-selected automatic attention scope. Raw source history remains readable.
export const WECHAT_GROUP_POLICY='latest-mentions-24h-v1';
import {storedWechatCategory} from './wechat-categories';
export function isWechatGroup(item:any){return item.sourceSystem==='wechat-sync'&&(item.sourceScope?.chatMode==='group'||String(item.sourceId||'').endsWith('@chatroom'));}
export function wechatGroupAttentionExcluded(item:any,at=Date.now()){
 if(item.sourceSystem!=='wechat-sync')return false;
 const category=storedWechatCategory(item);
 if(!category||category==='other')return true;
 if(category!=='group')return false;
 const scope=item.groupAttention;
 return scope?.policy!==WECHAT_GROUP_POLICY||!scope.mentionMessageId||!Number.isFinite(Date.parse(scope.expiresAt))||Date.parse(scope.expiresAt)<=at||!(item.messages||[]).some((m:any)=>m.id===scope.mentionMessageId&&m.mentionsOwner===true&&m.isMine===false);
}
