import {useEffect,useRef,useState} from 'react';
import type {InboxItem,UIContext} from '../../../shared/types';
import {api} from '../domain/api';

export function AutonomousDispatchCard({item,ctx}:{item:InboxItem;ctx:UIContext}){
 const plan=item.autonomousDispatch;
 const zh=ctx.state.settings.identity.language==='zh-CN';
 const t=(en:string,cn:string)=>zh?cn:en;
 const [clock,setClock]=useState(Date.now());
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const selectedPlan=useRef(plan?.id);selectedPlan.current=plan?.id;
 useEffect(()=>{setError('');setBusy(false);setClock(Date.now());if(plan?.state!=='waiting')return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[plan?.id,plan?.state]);
 if(!plan||['observed','draft_ready'].includes(plan.state))return null;
 const seconds=Math.max(0,Math.ceil((Date.parse(plan.readyAt||'')-clock)/1000));
 const waitingReasons:Record<string,string>={sending_held:t('Sending is paused. Your reply is saved.','发送已暂停，回复已保留。'),outside_working_hours:t('Waiting for this connection’s working hours.','等待进入此连接设定的工作时间。'),autonomous_delivery_disabled:t('Automatic delivery is not enabled. Review the draft to continue.','自动发送尚未启用，请审核下方草稿后继续。')};
 const waitingReason=waitingReasons[plan.waitReason];
 const systemCancelled=plan.state==='cancelled'&&plan.cancelKind==='system';
 const labels:Record<string,string>={waiting:waitingReason?t('Waiting for action','等待处理'):t('Waiting to send','等待发送'),sending:t('Sending','正在发送'),delivered:t('Sent','已发送'),cancelled:systemCancelled?t('Stopped · review needed','已停止 · 请重新审核'):t('Cancelled before sending','发送前已取消'),blocked:t('Review required','需要审批'),unknown:t('Receipt needs checking','回执待确认'),failed:t('Send stopped','发送已停止')};
 async function act(action:'cancel'|'reconcile'|'retry'){const id=plan.id;setBusy(true);setError('');try{await api.post(`/api/autonomous-dispatches/${encodeURIComponent(id)}/${action}`,{});await ctx.refresh()}catch(e){if(selectedPlan.current===id)setError(e instanceof Error?e.message:String(e))}finally{if(selectedPlan.current===id)setBusy(false)}}
 return <section className="op-card" aria-label={t('Automatic reply','自主回复')}>
  <strong>{t('Automatic reply','自主回复')} · {labels[plan.state]||plan.state}</strong>
  {plan.state==='waiting'&&<p>{waitingReason||(Number.isFinite(seconds)&&seconds>0?t(`You can cancel for ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} before sending.`,`发送前还可取消 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}。`):t('The cancellation window has ended. Current permissions and sending restrictions still apply.','取消窗口已结束，执行前仍会检查当前权限与发送限制。'))}</p>}
  {systemCancelled&&<p>{t('The source, permissions or rule changed. Review the reply again before sending.','来源、权限或规则发生变化，发送前需要重新审核回复。')}</p>}
  <p className="op-footnote">{t('Uses your saved autonomy rule. Delivery is confirmed by its receipt.','按你保存的自主规则处理，发送结果以回执为准。')}</p>
  {plan.error&&!waitingReason&&<p className="op-footnote">{plan.error}</p>}{error&&<p role="alert">{error}</p>}
  <div className="op-main-actions">
   {plan.state==='waiting'&&<button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={busy} onClick={()=>void act('cancel')}>{t('Cancel scheduled reply','取消待发送回复')}</button>}
   {plan.state==='unknown'&&<button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={busy} onClick={()=>void act('reconcile')}>{t('Check receipt · no resend','查询回执 · 不重发')}</button>}
   {plan.state==='failed'&&plan.failedBeforeSend&&<button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={busy} onClick={()=>void act('retry')}>{t('Retry authorized reply','重试已授权回复')}</button>}
   <button type="button" className="op-btn op-btn-link op-btn-sm" onClick={()=>ctx.navigate('/activity?entity='+encodeURIComponent(item.id))}>{t('View activity','查看活动记录')}</button>
  </div>
 </section>
}
