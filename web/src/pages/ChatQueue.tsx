import {useState} from 'react';
import {Check,Clock3,CornerDownRight,LoaderCircle,Pencil,X,TriangleAlert} from 'lucide-react';
import {api,ApiError} from '../domain/api';

type Item={id:string;message:string;status:string;updatedAt:string;error?:string;attachmentIds?:string[];contextIds?:string[]};
type Edit={id:string;text:string;updatedAt:string};
export function ChatQueue({items,conversationId,zh,onRefresh,onRetry}:{items:Item[];conversationId:string;zh:boolean;onRefresh:()=>Promise<void>;onRetry:(item:Item)=>Promise<void>}){
 const storageKey=`opsadv-queue-edit:${conversationId}`;
 const [edit,setEdit]=useState<Edit|null>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'null')}catch{return null}});
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[expanded,setExpanded]=useState('');
 function changeEdit(value:Edit|null){setEdit(value);if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey)}
 async function act(item:Item,action:'edit'|'insert'|'remove'|'retry'){
  if(busy)return;setBusy(item.id);setError('');
  try{
   if(action==='retry')await onRetry(item);
   else if(action==='remove')await api.delete(`/chat/continuation/${item.id}`);
   else {const result=await api.patch<Item>(`/chat/continuation/${item.id}`,{action,updatedAt:action==='edit'?edit?.updatedAt:item.updatedAt,...(action==='edit'?{message:edit?.text}:{})});if(['failed','interrupted'].includes(result.status))throw new Error(result.error||'Insert failed');}
   if(action==='edit'||(action==='remove'&&edit?.id===item.id))changeEdit(null);
  }catch(e){
   setError((e as Error).message);
   if(action==='edit'&&edit&&e instanceof ApiError&&e.data?.error==='queue_changed'){
    try{const state=await api.get<{items:Item[]}>(`/chat/continuation/${conversationId}`);const latest=state.items.find(row=>row.id===item.id);
     if(latest?.status==='queued'){changeEdit({...edit,updatedAt:latest.updatedAt});setError(zh?`消息已更新，编辑已保留。当前内容：${latest.message}。请确认后再次保存。`:`Message changed; your edit is preserved. Current content: ${latest.message}. Review and save again.`)}
    }catch{}
   }
  }finally{await onRefresh().catch(()=>{});setBusy('')}
 }
 const visibleItems=items.filter(item=>item.status!=='running');
 if(!visibleItems.length&&!edit&&!error)return null;
 const current=items.find(item=>item.id===edit?.id);
 return <div className="composer-queue" aria-label={zh?'待处理消息':'Pending messages'}>
  {visibleItems.map(item=><div className="composer-queue-row" key={item.id} data-queue-id={item.id}>
   <span className="queue-state" role="img" aria-label={item.status==='queued'?(zh?'完成后继续':'Follow-up'):item.status==='inserting'?(zh?'正在处理':'Running'):(zh?'需要处理':'Needs attention')} title={item.status==='queued'?(zh?'完成后继续':'Follow-up'):item.status==='inserting'?(zh?'正在处理':'Running'):(zh?'需要处理':'Needs attention')}>
    {item.status==='inserting'?<LoaderCircle size={14} className="spinner"/>:item.status==='queued'?<Clock3 size={14}/>:<TriangleAlert size={14}/>}
   </span>
   <button type="button" className={`queue-copy ${expanded===item.id?'expanded':''}`} aria-expanded={expanded===item.id} title={item.message} onClick={()=>setExpanded(expanded===item.id?'':item.id)}>{item.message}{!!item.attachmentIds?.length&&<small> · {item.attachmentIds.length} {zh?'个附件':'files'}</small>}</button>
   <div className="queue-actions">
    {item.status==='queued'&&<>
     {!item.attachmentIds?.length&&!item.contextIds?.length&&<button type="button" disabled={!!busy||edit?.id===item.id} aria-label={zh?'插入当前任务':'Insert into current task'} title={zh?'插入当前任务':'Insert into current task'} onClick={()=>void act(item,'insert')}><CornerDownRight size={15}/></button>}
     <button type="button" disabled={!!busy} aria-label={zh?'编辑消息':'Edit message'} title={zh?'编辑消息':'Edit message'} onClick={()=>{setError('');changeEdit({id:item.id,text:item.message,updatedAt:item.updatedAt})}}><Pencil size={14}/></button>
    </>}
    {['failed','interrupted'].includes(item.status)&&<button type="button" disabled={!!busy} aria-label={zh?'编辑后重试':'Edit and retry'} title={zh?'编辑后重试':'Edit and retry'} onClick={()=>void act(item,'retry')}><Pencil size={14}/></button>}
    {!['running','inserting'].includes(item.status)&&<button type="button" disabled={!!busy} aria-label={zh?'移除消息':'Remove message'} title={zh?'移除消息':'Remove message'} onClick={()=>void act(item,'remove')}><X size={15}/></button>}
   </div>
   {item.error&&<small className="queue-error" role="alert">{item.error}</small>}
  </div>)}
  {edit&&<div className="queue-editor">
   <textarea autoFocus disabled={!!busy} rows={2} aria-label={zh?'编辑待处理消息':'Edit pending message'} value={edit.text} onChange={e=>changeEdit({...edit,text:e.target.value})} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();changeEdit(null)}if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();if(current&&edit.text.trim()&&!busy)void act(current,'edit')}}}/>
   {current?.status!=='queued'&&<small role="alert">{zh?'这条消息已开始处理或已移除，编辑内容已保留，可复制。':'This message started or was removed. Your edit is preserved for copying.'}</small>}
   <div className="queue-editor-actions"><button type="button" className="btn btn-small btn-ghost" disabled={!!busy} onClick={()=>changeEdit(null)}>{zh?'取消':'Cancel'}</button><button type="button" className="btn btn-small btn-primary" disabled={!!busy||!edit.text.trim()||current?.status!=='queued'} onClick={()=>current&&void act(current,'edit')}><Check size={14}/>{zh?'保存':'Save'}</button></div>
  </div>}
  {error&&<div className="queue-error queue-operation-error" role="alert"><span>{error}</span><button type="button" className="icon-button" aria-label={zh?'关闭消息操作错误':'Dismiss message action error'} onClick={()=>setError('')}><X size={14}/></button></div>}
 </div>
}
