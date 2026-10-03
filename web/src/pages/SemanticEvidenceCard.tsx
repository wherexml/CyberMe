import {useEffect,useRef,useState} from 'react';
import {BookOpen,LoaderCircle,ShieldCheck} from 'lucide-react';
import type {InboxItem,UIContext} from '../../../shared/types';
import {api} from '../domain/api';

export function SemanticEvidenceCard({item,ctx}:{item:InboxItem;ctx:UIContext}){
 const zh=ctx.state.settings.identity.language==='zh-CN';
 const t=(en:string,cn:string)=>zh?cn:en;
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const selection=useRef(item.id);selection.current=item.id;
 useEffect(()=>{setBusy(false);setError('')},[item.id]);
 const result=item.semanticAuthorization;
 const ready=['succeeded','awaiting_approval'].includes(item.sourceProcessing?.status||'')&&item.sourceProcessing?.mode!=='summary';
 if(!result&&!ready)return null;
 const verified=result?.state==='verified';
 async function check(){const id=item.id;setBusy(true);setError('');try{await api.post(`/api/inbox/${encodeURIComponent(id)}/semantic-check`,{});await ctx.refresh()}catch(e){if(selection.current===id)setError(e instanceof Error?e.message:String(e))}finally{if(selection.current===id)setBusy(false)}}
 return <section className="op-card" aria-label={t('Reply evidence','回复依据')}>
  <strong style={{display:'flex',alignItems:'center',gap:8}}>{verified?<ShieldCheck size={17}/>:<BookOpen size={17}/>} {t('Reply evidence','回复依据')}</strong>
  <p className="op-footnote">{t('Check the request against your linked notes, files or calendar. Your original draft stays available below.','结合关联笔记、文件或日历核对请求，下方保留原草稿。')}</p>
  {verified&&<>
   <span className="op-badge op-badge-green">{t('Evidence checked','依据已核对')}</span>
   <p className="op-footnote">{result.previewOnly?t('Preview only · automatic sending is not enabled by this check','仅供预览 · 此次核验不会开启自动发送'):t('Suggested reply from the checked sources','根据已核对来源生成的建议回复')}</p>
   <blockquote style={{margin:'8px 0 12px',padding:'8px 14px',borderLeft:'2px solid var(--border, #dedee5)',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.authorizedText}</blockquote>
  </>}
  {result&&!verified&&<p>{result.state==='invalidated'?t('The source changed. Check the evidence again before using this suggestion.','资料已变化，使用建议回复前请重新核对依据。'):t('This request needs your review. The original draft has been kept.','此请求需要你审核，原草稿已保留。')}</p>}
  {result?.reason&&<details className="op-footnote"><summary>{t('Why review is needed','查看核验说明')}</summary><p style={{overflowWrap:'anywhere'}}>{result.reason}</p></details>}
  {error&&<p role="alert">{error}</p>}
  <div className="op-main-actions">
   <button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={busy||!ready||['sending','sent','delivered','recalled','send_unknown'].includes(item.status)} onClick={()=>void check()}>{busy?<><LoaderCircle size={15}/>{t('Checking sources…','正在核对来源…')}</>:result?t('Check again','重新核对'):t('Check reply evidence','核对回复依据')}</button>
   <span className="op-footnote">{t('Checking evidence does not send a message.','核对依据不会发送消息。')}</span>
  </div>
 </section>;
}
