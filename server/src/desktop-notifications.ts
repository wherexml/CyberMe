import type {Hono} from 'hono';
import {get,list,meta,setMeta,now,uid} from './store';
import {ApiError} from './integrations';
import {currentIdeaReminder} from './ideas-chat';
import {notificationPreview} from './notifications';

const KEY='desktop-notifications-v1';
type Receipt={status:'submitted'|'accepted'|'denied'|'failed'|'suppressed';at:string};
type State={enabled:boolean;enabledAt?:string;version:string;receipts:Record<string,Receipt>};
const state=()=>meta<State>(KEY,{enabled:false,version:'initial',receipts:{}});
// Native routing and copy only cover idea reminders, so requests and send recovery stay in-app until that is verified.
// Quiet hours block everything here, including what the settings logic would call urgent.
function eligible(s:State,claimedId?:string){
 if(!s.enabled||!s.enabledAt)return [];
 const policy:any=notificationPreview();if(policy.action==='blocked'||policy.quiet||policy.action!=='immediate')return [];
 const primary=get('conversations',meta('primaryConversationId',''));if(!primary||primary.sideChat||primary.archived)return [];
 return list('messages').filter(m=>m.conversationId===primary.id&&Date.parse(m.createdAt)>Date.parse(s.enabledAt!)&&Date.now()-Date.parse(m.createdAt)<86400000&&(!s.receipts[m.id]||m.id===claimedId)&&currentIdeaReminder(m)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(0,25);
}
/** A restored reminder was already seen: it must not become eligible just because it has no receipt. */
export function suppressDesktopNotification(id:string){const s=state();if(!s.receipts[id])setMeta(KEY,{...s,receipts:{...s.receipts,[id]:{status:'suppressed',at:now()}}});}
function overview(){const s=state();return {enabled:s.enabled,enabledAt:s.enabledAt,version:s.version,pending:eligible(s).map(m=>({id:m.id})),lastReceipt:Object.values(s.receipts).filter(r=>r.status!=='suppressed').sort((a,b)=>b.at.localeCompare(a.at))[0]||null};}
export function mountDesktopNotifications(app:Hono){
 app.get('/api/native/notifications',c=>{c.header('Cache-Control','no-store');return c.json(overview());});
 app.patch('/api/native/notifications',async c=>{
  const b=await c.req.json(),s=state();if(typeof b.enabled!=='boolean')throw new ApiError(400,'invalid_enabled','通知开关无效');
  if(b.baseVersion!==s.version)throw new ApiError(409,'edit_conflict','通知设置已更新，请重新读取');
  if(b.enabled!==s.enabled)setMeta(KEY,{...s,enabled:b.enabled,enabledAt:b.enabled?now():s.enabledAt,version:uid('desktop-notice')});
  return c.json(overview());
 });
 app.post('/api/native/notifications/:id/claim',c=>{
  const id=c.req.param('id'),s=state();if(s.receipts[id])return c.json({claimed:false,status:s.receipts[id].status});
  if(!eligible(s).some(m=>m.id===id))throw new ApiError(409,'notification_stale','提醒已失效或当前不可投递');
  setMeta(KEY,{...s,receipts:{...s.receipts,[id]:{status:'submitted',at:now()}}});return c.json({claimed:true});
 });
 app.post('/api/native/notifications/:id/receipt',async c=>{
  const id=c.req.param('id'),b=await c.req.json(),s=state(),old=s.receipts[id];
  if(!old)throw new ApiError(404,'notification_not_found','没有已提交的通知');
  if(!['accepted','denied','failed'].includes(b.status))throw new ApiError(400,'invalid_receipt','通知回执无效');
  if(old.status!=='submitted')return c.json(old);
  const receipt={status:b.status,at:now()};setMeta(KEY,{...s,receipts:{...s.receipts,[id]:receipt}});return c.json(receipt);
 });
 app.get('/api/native/notifications/:id/validate',c=>{const id=c.req.param('id'),s=state();return c.json({valid:s.receipts[id]?.status==='submitted'&&eligible(s,id).some(m=>m.id===id)});});
}
