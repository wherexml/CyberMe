import { InboxMessages, inboxExcerpt } from './InboxMessages';
import {isQuietInbox,needsInboxAttention} from '../../../shared/inbox-surfacing';
import {AutonomousDispatchCard} from './AutonomousDispatchCard';
import {SemanticEvidenceCard} from './SemanticEvidenceCard';
import { useI18n, translate } from '../domain/i18n';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, CalendarDays, Check, ChevronRight, Download, FileText, Inbox as InboxIcon, LoaderCircle, Paperclip, Pencil, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { Artifact, Bootstrap, InboxItem, UIContext } from '../../../shared/types';
import { api } from '../domain/api';
import './operations.css';

export function ActionFooter({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const footer = ref.current, layout = footer?.closest<HTMLElement>('.op-inbox-layout, .op-deep-layout');
    if (!footer || !layout) return;
    const measure = () => layout.style.setProperty('--op-footer-height', `${footer.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure); observer.observe(footer); measure();
    return () => { observer.disconnect(); layout.style.removeProperty('--op-footer-height'); };
  }, []);
  return <div className="op-action-footer" ref={ref}>{children}</div>;
}
export const isSendLocked = (item: InboxItem) => ['sending', 'sent', 'delivered', 'recalled', 'send_unknown'].includes(item.status);
export const canSendAttachments = (ctx: UIContext) => ctx.state.sources?.capabilities?.sendAttachments === true || ctx.state.connections.some(connection => (/^(feishu|飞书)$/i.test(connection.provider)) && connection.status === 'connected' && connection.capabilities?.includes('files.send_self'));
export const isDone = (item: InboxItem) => ['sent', 'delivered', 'done', 'dismissed', 'recalled', 'cancelled'].includes(item.status);
export const itemPath = (page: string, id: string) => `/${page}?item=${encodeURIComponent(id)}`;
export const queryItem = () => new URLSearchParams(window.location.search).get('item') || '';
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export const shortText = (text: unknown, limit = 180) => String(text || '').length > limit ? `${String(text).slice(0, limit)}…` : String(text || '');
export function useFullInboxItem(ctx: UIContext, summary: InboxItem | undefined) {
  const [full, setFull] = useState<InboxItem>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!summary?.id) { setFull(undefined); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get<InboxItem>(`/api/inbox/${encodeURIComponent(summary.id)}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setFull(value); }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [summary?.id, summary?.updatedAt, ctx.state.revision]);
  // Bootstrap may contain a preview. Never replace a newer revision with an older read.
  const item = summary && full?.id === summary.id && full.updatedAt === summary.updatedAt ? { ...summary, ...full } : summary;
  return { item, loading, error };
}
export function dateText(value?: string, relative = false, language = 'en') {
  if (!value) return translate('Time not recorded', language);
  const date = new Date(/^\d{10,13}$/.test(value) ? Number(value) * (value.length === 10 ? 1000 : 1) : value);
  if (Number.isNaN(date.getTime())) return value;
  if (relative) {
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes >= 0 && minutes < 1) return translate('Just now', language);
    if (minutes > 0 && minutes < 60) return language === 'zh-CN' ? `${minutes} 分钟前` : `${minutes} min ago`;
    if (minutes >= 60 && minutes < 1440) return language === 'zh-CN' ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 60)} hr ago`;
  }
  return date.toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-SG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function Avatar({ name, ai = false, large = false, avatarUrl }: { name: string; ai?: boolean; large?: boolean; avatarUrl?: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  const image = avatarUrl && /^(https?:\/\/|\/(?!\/))/.test(avatarUrl) && failedUrl !== avatarUrl;
  const initials = name.match(/[A-Za-z]+/g)?.slice(0, 2).map(word => word[0]).join('') || name.slice(-2);
  return <span aria-hidden="true" className={`op-avatar${ai ? ' op-avatar-ai' : ''}${large ? ' op-avatar-lg' : ''}`}>{ai ? <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="9.5" cy="12" r="6" fill="none" stroke="white" strokeWidth="1.6"/><circle cx="14.5" cy="12" r="6" fill="none" stroke="white" strokeWidth="1.6"/><path d="M12 6.55A6 6 0 0 1 12 17.45A6 6 0 0 1 12 6.55Z" fill="white"/></svg> : image ? <img src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(avatarUrl!)}/> : initials}</span>;
}
export function StatusBadge({ children, tone = 'grey' }: { children: ReactNode; tone?: string }) {
  return <span className={`op-badge op-badge-${tone}`}>{children}</span>;
}
export function ItemBadge({ item }: { item: InboxItem }) { const { t, language } = useI18n();
  if (isDone(item)) return <StatusBadge tone={['sent', 'delivered'].includes(item.status) ? 'green' : 'grey'}>{t(item.status)}</StatusBadge>;
  if(item.triage?.status==='succeeded'&&item.triage.route==='no_reply')return <StatusBadge>{language==='zh-CN'?(item.draft?'草稿保留 · 无需回复':'仅供知悉'):(item.draft?'Draft retained · No reply needed':'For your information')}</StatusBadge>;
  return <StatusBadge tone={item.sensitive ? 'red' : item.origin === 'ai' ? 'purple' : item.category === 'vip' ? 'black' : 'amber'}>{item.sensitive ? t("Flagged as sensitive") : item.category || (item.origin === 'ai' ? t("From AI") : t("Needs your review"))}</StatusBadge>;
}
const triageLabels={no_reply:['无需回复','No reply needed'],quick_reply:['简单回复','Simple reply'],deep_reply:['建议深度思考','Deep thinking advised'],review:['待你确认','Needs your judgment']};
const triageReasons:Record<string,[string,string]>={self_test:['这是发给本人的测试记录，无需回复自己。','This is a self-test record. You do not need to reply to yourself.'],own_message:['最新消息由你发出，无需回复自己。','You sent the latest message. You do not need to reply to yourself.'],fyi:['消息以告知为主，没有需要回答的问题。','An informational message without a question to answer.'],acknowledgement:['对话已确认或结束，通常无需再次回复。','The conversation is acknowledged or resolved.'],direct_request:['对方提出了需要回应的请求或问题。','An unanswered request or question needs a response.'],decision:['涉及审批、协商或重要决定，需要你确认。','Approval, negotiation or an important decision needs your input.'],analysis:['需要比较方案、调查事实或分析后再回复。','Compare options, investigate or analyze before replying.'],missing_material:['关键材料或实际数据不足，应先补充信息。','Critical material or actual data is missing.'],other_recipient:['消息似乎面向其他收件人，通常无需你回复。','The message appears to address another recipient.'],unclear:['目前上下文不足以明确判断，请先查看原文。','The context is insufficient; review the original message.']};
function TriageBadge({item}:{item:InboxItem}){
 const {language}=useI18n(),zh=language==='zh-CN',triage=item.triage;
 const route=triage?.status==='succeeded'?triage.route:'review';
 const label=!triage?(zh?'等待判断':'Awaiting analysis'):triage.status==='running'?(zh?'正在判断…':'Analyzing…'):triage.status==='failed'?(zh?'判断失败 · 待确认':'Analysis failed · Review'):triageLabels[route as keyof typeof triageLabels]?.[zh?0:1];
 return <StatusBadge tone={route==='no_reply'?'grey':route==='deep_reply'?'purple':route==='quick_reply'?'blue':'amber'}>{label}</StatusBadge>;
}
// Attention reflects saved assessment/workflow state, never message age or unread count.
function attention(item: InboxItem, zh: boolean) {
 const a=item.triage;
 const result=(level:number,label:string,unknown=false)=>({level,label,unknown});
 if(isDone(item)) return result(0,translate(item.status,zh?'zh-CN':'en'));
 if(['failed','send_failed','send_unknown'].includes(item.status)) return result(4,zh?'需要处理：执行失败或发送结果待核实':'Action required: failure or unconfirmed delivery');
 if(item.sensitive || (a?.risk??0)>=.75) return result(4,zh?'重点关注：敏感内容或重要承诺':'High attention: sensitive content or consequential commitment');
 if(!a || a.status!=='succeeded') return result(0,!a?(zh?'待判断':'Awaiting analysis'):a.status==='running'?(zh?'正在判断':'Analyzing'):(zh?'判断失败，需要确认':'Analysis failed; review needed'),true);
 if(a.route==='review'||(a.needsOwner??0)>=.75) return result(3,zh?'需要你确认':'Your judgment needed');
 if(a.route==='deep_reply') return result(2,zh?'需要分析后回复':'Analysis needed before replying');
 if(a.route==='quick_reply') return result(1,zh?'简单回复即可':'Simple reply needed');
 if(a.route==='no_reply') return isQuietInbox(item)?result(0,zh?'安静记录 · 无需回复':'Quietly recorded · No reply needed'):result(1,zh?'保留关注 · 无需回复':'Kept for attention · No reply needed');
 return result(0,zh?'待判断':'Awaiting analysis',true);
}
function AttentionSignal({item}:{item:InboxItem}) {
 const {language,t}=useI18n(), zh=language==='zh-CN', a=attention(item,zh);
 const label=`${zh?'关注程度':'Attention'}：${a.unknown?'?':a.level+'/4'} · ${a.label}${item.draft&&!isDone(item)?' · '+t('Draft ready'):''}`;
 return <span className={`op-attention op-attention-${a.level}${a.unknown?' is-unknown':''}`} role="img" aria-label={label} data-level={a.unknown?'unknown':a.level}><span className="op-attention-bars" aria-hidden="true">{[1,2,3,4].map(n=><i key={n} className={n<=a.level?'lit':''} style={{height:4+n*3}}/>)}{a.unknown&&<b>?</b>}</span><span className="op-attention-tip" aria-hidden="true">{label}</span></span>;
}
function TriageCard({item,busy,onAnalyze}:{item:InboxItem;busy:boolean;onAnalyze:()=>void}){
 const {language}=useI18n(),zh=language==='zh-CN',a=item.triage;
 const decision=(p:number|undefined)=>p===undefined?(zh?'未知':'Unknown'):p>=.75?(zh?'是':'Yes'):p<=.25?(zh?'否':'No'):(zh?'待确认':'Uncertain');
 const [evidenceOpen,setEvidenceOpen]=useState(false),evidenceId=useId();
 useEffect(()=>setEvidenceOpen(false),[item.id]);
 const reason=triageReasons[a?.reason||'unclear'];
 return <section className="op-triage-card" aria-label={zh?'Jev回复判断':'Jev reply assessment'} data-triage-status={a?.status||'pending'}><header><strong>{zh?'Jev回复判断':'Jev reply assessment'}</strong><TriageBadge item={item}/><div className="op-triage-actions">{a?.status==='succeeded'&&<button className="op-btn op-btn-link op-btn-xs op-triage-evidence-toggle" aria-expanded={evidenceOpen} aria-controls={evidenceId} onClick={()=>setEvidenceOpen(open=>!open)}>{zh?'判断依据':'Evidence'}<ChevronRight size={14} aria-hidden="true"/></button>}<button className="op-btn op-btn-link op-btn-xs" disabled={busy||a?.status==='running'} onClick={onAnalyze}>{busy||a?.status==='running'?(zh?'正在判断…':'Analyzing…'):a?(zh?'重新判断':'Reassess'):(zh?'开始判断':'Analyze')}</button></div></header>
 {a?.status==='succeeded'?<><div className="op-triage-decisions">{[[zh?'需要回复':'Reply needed',a.needsReply],[zh?'需要你决策':'Your decision needed',a.needsOwner],[zh?'需要深度思考':'Deep thinking needed',a.needsDeepThink]].map(([label,p])=><div key={String(label)}><span>{label}</span><span className="op-triage-value"><strong>{a.method==='rule'?(zh?'否':'No'):decision(p as number)}</strong>{a.method!=='rule'&&typeof p==='number'&&<small aria-label={`${zh?'是的概率':'Probability of yes'} ${Math.round(p*100)}%`}>{Math.round(p*100)}%</small>}</span></div>)}</div>{a.missingContext>=.5&&<p className="op-triage-warning">{zh?'缺少关键材料：先补充信息，再形成完整答复。':'Critical material is missing. Gather it before completing the answer.'}</p>}{a.risk>=.75&&<p className="op-triage-warning">{zh?'涉及重要承诺或敏感内容，回复前需要你审核。':'A consequential commitment or sensitive content needs your review.'}</p>}<div className="op-triage-evidence" id={evidenceId} hidden={!evidenceOpen}>{a.reason!=='acknowledgement'&&reason&&<p>{reason[zh?0:1]}</p>}<p>{a.method==='rule'?(zh?'消息来源规则':'Message provenance rule'):<>{zh?'依据类别置信度':'Reason category confidence'} {Math.round((a.reasonConfidence||0)*100)}%</>} · {a.model} · {dateText(a.completedAt,false,language)}</p><p>{a.method==='rule'?(zh?'依据明确的消息来源判定，未调用 Jev。判断不等于发送授权。':'Determined from message provenance without calling Jev. Assessment does not authorize sending.'):(zh?'概率用于处理建议，不代表结论一定正确。判断不等于发送授权。':'Probabilities guide handling and can be wrong. Assessment does not authorize sending.')}</p><pre>{JSON.stringify(a.answers,null,2)}</pre></div></>:<p role={a?.status==='failed'?'alert':'status'}>{a?.status==='failed'?a.error:zh?'先判断是否值得回复，再决定回复方式。':'Assess whether a reply is needed before choosing how to respond.'}</p>}
 </section>;
}
export function operationErrorSummary(error: string) {
  if (/partial_run_requires_review/i.test(error)) return 'This run completed some writes. Review its recorded result before continuing.';
  if (/conversation_busy|request_in_progress/i.test(error)) return 'This conversation already has a run in progress. Check its result before retrying.';
  if (/502|bad.gateway|gateway|upstream|overloaded/i.test(error)) return 'The model service is unavailable. Try again or choose the standard model.';
  if (/outside_working_hours|当前不在连接设定的工作时间内/i.test(error)) return 'Manual sending also follows this connection’s working hours. Try again during the saved working window.';
  if (/calendar_conflict/i.test(error)) return 'The calendar follow-up overlaps an existing event. Review the conflict before continuing.';
  if (error.length > 220 || error.includes('\n') || /^\s*[\[{]/.test(error)) return 'The request could not be completed. Review the error details and retry when ready.';
  return error;
}
export function OperationError({ error, action }: { error: string; action?: ReactNode }) { const { t, language } = useI18n();
  if (!error) return null;
  const summary = t(operationErrorSummary(error));
  return <div role="alert" className="op-error"><span>{summary}</span>{action && <div className="op-error-actions">{action}</div>}{summary !== error && <details><summary>{t("Error details")}</summary><pre>{error}</pre></details>}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="op-empty"><InboxIcon size={30}/><strong>{title}</strong>{children && <span>{children}</span>}</div>;
}
export function OperationModal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const { t, language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])') || ref.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]'))?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') || []).filter(node => node.offsetParent !== null);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="op-modal-layer" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`op-modal${wide ? ' op-modal-wide' : ''}`}><header><h2 id={titleId}>{title}</h2><button type="button" className="op-icon-btn" aria-label={t("Close {0}", title)} onClick={onClose}><X size={18}/></button></header><div className="op-modal-content">{children}</div></div></div>;
}

function inlineMarkdown(line: string): ReactNode {
  const pieces = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g);
  return pieces.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && /^https?:\/\//i.test(link[2])) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
export function MarkdownText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let code: string[] | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) { if (code) { blocks.push(<pre key={index}><code>{code.join('\n')}</code></pre>); code = null; } else code = []; continue; }
    if (code) { code.push(line); continue; }
    if (!line.trim()) { blocks.push(<div key={index} className="op-md-space"/>); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { blocks.push(<div key={index} role="heading" aria-level={Number(heading[1].length) + 1} className={`op-md-heading op-md-h${heading[1].length}`}>{inlineMarkdown(heading[2])}</div>); continue; }
    if (/^\s*[-*]\s+/.test(line)) { blocks.push(<div className="op-md-li" key={index}><span aria-hidden="true">•</span><span>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ''))}</span></div>); continue; }
    if (/^>\s?/.test(line)) { blocks.push(<blockquote key={index}>{inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>); continue; }
    if (/^[-*_]{3,}$/.test(line.trim())) { blocks.push(<hr key={index}/>); continue; }
    blocks.push(<p key={index}>{inlineMarkdown(line)}</p>);
  }
  if (code) blocks.push(<pre key="unfinished"><code>{code.join('\n')}</code></pre>);
  return <div className="op-markdown">{blocks}</div>;
}

function contentHash(text: string) { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return (value >>> 0).toString(16); }
export function requestKey(operation: string, item: InboxItem, content = '', renew = false) {
  const storageKey = `opsadvance:${operation}:${item.id}:${contentHash(content)}`;
  let key = renew ? null : localStorage.getItem(storageKey);
  if (!key) { key = crypto.randomUUID(); localStorage.setItem(storageKey, key); }
  return key;
}
export function useInboxFlow(ctx: UIContext, item: InboxItem | undefined) { const { t, language } = useI18n();
  const [busy, setBusy] = useState('');
  const actionPending = useRef(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item?.draft || '');
  const [addTask, setAddTask] = useState(false);
  const [followupDestination, setFollowupDestination] = useState<'calendar' | 'task'>('calendar');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [taskTitle, setTaskTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sensitiveApproval, setSensitiveApproval] = useState(false);
  useEffect(() => { setEditing(false); setEditText(item?.draft || ''); setError(''); setAddTask(false); setFollowupDestination('calendar'); setDurationMinutes(30); setTaskTitle(item?.title || ''); setDueDate(''); setSensitiveApproval(false); }, [item?.id]);
  async function perform<T>(name: string, action: () => Promise<T>): Promise<T | undefined> {
    if (busy || actionPending.current) return;
    actionPending.current = true; setBusy(name); setError('');
    try { const result = await action(); await ctx.refresh(); return result; }
    catch (cause) { const message = errorText(cause); setError(message); ctx.notify(t(operationErrorSummary(message)), 'error'); try { await ctx.refresh(); } catch { /* Preserve the original action error. */ } }
    finally { actionPending.current = false; setBusy(''); }
  }
  useEffect(() => { setSensitiveApproval(false); }, [item?.draft]);
  function startEdit() { setEditText(item?.draft || ''); setEditing(true); }
  async function saveEdit() {
    if (!item) return;
    const result = await perform('save', () => api.patch<InboxItem>(`/api/inbox/${encodeURIComponent(item.id)}`, { draft: editText, editedByUser: true }));
    if (result) { setEditing(false); ctx.notify(t("Draft saved"), 'success'); }
  }
  async function generate(mode: 'auto' | 'chat' | 'deep' = 'auto') {
    if (!item) return;
    const retryOfRunId = mode === 'chat' && item.draftError ? item.draftRunId || item.runId : undefined;
    const fingerprint = JSON.stringify([mode, item.conversationId || null, retryOfRunId || null, item.body, item.draft || '', item.attachments || [], item.sourceAttachments || [], item.context || []]);
    const requestId = requestKey('generate-draft', item, fingerprint);
    const result = await perform('generate', () => api.post<{ item: InboxItem; run: any; artifacts?: Artifact[] }>(`/api/inbox/${encodeURIComponent(item.id)}/draft`, { mode, conversationId: item.conversationId, requestId, ...(retryOfRunId ? { retryOfRunId } : {}) }));
    if (result) { requestKey('generate-draft', item, fingerprint, true); setEditing(false); ctx.notify(t("Draft ready for your review"), 'success'); }
    return result;
  }
  async function changeStatus(status: string) {
    if (!item) return;
    const result = await perform('status', () => api.patch<InboxItem>(`/api/inbox/${encodeURIComponent(item.id)}`, { status }));
    if (result) ctx.notify(status === 'pending' ? t("Returned to Inbox") : status === 'dismissed' ? t("Dismissed. You can reopen it from Done.") : t("Marked as done"), 'success');
    return result;
  }
  async function send() {
    if (!item || busy || actionPending.current) return;
    if (editing) { setError(t("Save or cancel your edits before sending.")); return; }
    if (!item.draft?.trim()) { setError(t("Create or write a draft first.")); return; }
    if (!item.isSelfTest || item.recipientId !== 'self' || item.sourceSystem === 'opstwin') { setError(t('Imported messages can be drafted here. Create your own test item to send a reply to 许茂林.')); return; }
    if (item.sensitive && !sensitiveApproval) { setError(t("Explicitly approve this sensitive draft before sending.")); return; }
    if (item.attachments?.length && !canSendAttachments(ctx)) { setError(t("Feishu file sending is not available yet. Keep these files here or remove the attachments to send the text.")); return; }
    if (ctx.state.settings.autonomy.holdSending) { setError(t("Sending is on hold. Review Autonomy to resume sending.")); return; }
    if (addTask && followupDestination === 'calendar' && (!dueDate || !Number.isFinite(Date.parse(dueDate)))) { setError(t("Choose a start time for the calendar follow-up before sending.")); return; }
    actionPending.current = true; setBusy('send'); setError('');
    const key = requestKey('send', item, item.draft, item.status === 'send_failed');
    try {
      await api.patch<InboxItem>(`/api/inbox/${encodeURIComponent(item.id)}`, { approved: true, sensitiveApproved: item.sensitive ? sensitiveApproval : false });
      await api.post(`/api/inbox/${encodeURIComponent(item.id)}/send`, { draft: item.draft, idempotencyKey: key, addTask: addTask && followupDestination === 'task', taskTitle: taskTitle.trim(), dueDate: addTask && followupDestination === 'task' && dueDate ? dueDate.slice(0, 10) : undefined, ...(addTask ? { followup: { kind: followupDestination, title: taskTitle.trim() || item.title, startAt: dueDate || undefined, durationMinutes, timezone: 'Asia/Singapore' } } : {}) });
      await ctx.refresh();
      ctx.notify(t("Message sent. The receipt is recorded in Activity."), 'success');
      ctx.navigate(itemPath('sent', item.id));
    } catch (cause) {
      // A lost HTTP response must be reconciled before a repeated external write.
      try {
        const latest = await api.get<Bootstrap>('/api/bootstrap');
        const reconciled = latest.inbox.find(candidate => candidate.id === item.id);
        if (reconciled && ['sent', 'delivered'].includes(reconciled.status) && (reconciled.receipt || latest.activities.some(event => event.entityId === item.id && event.receipt))) {
          await ctx.refresh(); ctx.navigate(itemPath('sent', item.id)); return;
        }
      } catch { /* The original failure remains visible; the same key is retained. */ }
      const message = errorText(cause); setError(message); ctx.notify(t(operationErrorSummary(message)), 'error');
      try { await ctx.refresh(); } catch { /* The original send error remains visible. */ }
    } finally { actionPending.current = false; setBusy(''); }
  }
  return { busy, error, setError, editing, editText, setEditText, addTask, setAddTask, followupDestination, setFollowupDestination, durationMinutes, setDurationMinutes, taskTitle, setTaskTitle, dueDate, setDueDate, sensitiveApproval, setSensitiveApproval, startEdit, cancelEdit: () => setEditing(false), saveEdit, generate, changeStatus, send, perform };
}

export function SourceAttachmentNotice({ item }: { item: InboxItem }) {
  const { t } = useI18n();
  if (!item.sourceAttachments?.length) return null;
  return <div className="op-footnote" role="note"><strong>{t("Source attachments (content not read)")}</strong>: {item.sourceAttachments.map(file => file.filename || file.id || t("Attachment")).join('; ')}<br/>{t("Only attachment names were imported. Upload the file to include its contents in the reply.")}</div>;
}

export function DraftCard({ item, flow, ctx, attachments, onRemove, onGenerate }: { item: InboxItem; flow: ReturnType<typeof useInboxFlow>; ctx: UIContext; attachments?: Artifact[]; onRemove?: (id: string) => void; onGenerate?: () => void }) { const { t, language } = useI18n();
  const [format, setFormat] = useState<'preview' | 'markdown'>('preview');const [candidateOpen,setCandidateOpen]=useState(false);
  const locked = isSendLocked(item);
  return <div className="op-draft-card"><header><strong>{t("Draft")}</strong><span className="op-draft-header-tools">{item.draft && <button type="button" className="op-btn op-btn-white op-btn-xs" onClick={() => setFormat(format === 'preview' ? 'markdown' : 'preview')} aria-pressed={format === 'markdown'}>{format === 'preview' ? (language === 'zh-CN' ? '查看原文' : 'View source') : (language === 'zh-CN' ? '查看排版' : 'View formatted')}</button>}{!flow.editing && !locked && <button type="button" className="op-btn op-btn-white op-btn-xs" onClick={flow.startEdit}><Pencil size={14}/>{t("Edit")}</button>}</span></header>
    {flow.editing ? <div className="op-edit-draft"><textarea aria-label={t("Edit the draft reply")} rows={5} value={flow.editText} onChange={event => flow.setEditText(event.target.value)}/><div className="op-edit-actions"><span>{t("Save your changes before sending.")}</span><button type="button" className="op-btn op-btn-ghost op-btn-sm" onClick={flow.cancelEdit} disabled={!!flow.busy}>{t("Cancel")}</button><button type="button" className="op-btn op-btn-blue op-btn-sm" onClick={flow.saveEdit} disabled={!!flow.busy}>{flow.busy === 'save' ? t("Saving…") : t("Save")}</button></div></div> : item.draft ? <div className="op-draft-body">{format === 'markdown' ? <pre className="op-draft-source">{item.draft}</pre> : <MarkdownText text={item.draft}/>}</div> : <div className="op-draft-empty"><p>{item.triage?.route==='no_reply'?(language==='zh-CN'?'建议无需回复；如有额外背景，仍可自行起草。':'No reply is advised. You can still draft if you have additional context.'):t("Your twin hasn’t drafted a reply yet.")}</p><button type="button" className="op-btn op-btn-blue op-btn-sm" disabled={!!flow.busy} onClick={onGenerate || (() => flow.generate('auto'))}><Sparkles size={16}/>{flow.busy === 'generate' ? t("Thinking…") : onGenerate ? t("Start Deep Think") : t("Generate draft")}</button><span>{t("Uses the original message and your connected work data.")}</span></div>}
    {item.draftCandidate&&<div className="op-hold-note"><span>{t("A candidate draft finished while you were editing. Your changes are preserved.")}</span><button type="button" onClick={()=>setCandidateOpen(true)}>{t("Review candidate")}</button></div>}
    {candidateOpen&&item.draftCandidate&&<OperationModal title={t("Review candidate draft")} wide onClose={()=>setCandidateOpen(false)}><p>{t("This candidate uses the earlier source below. Applying it replaces your current draft; approval is required again.")}</p><details><summary>{t("Earlier source")}</summary><p>{item.draftCandidate.sourceBody}</p></details><h3>{t("Current draft")}</h3><MarkdownText text={item.draft||''}/><h3>{t("Candidate")}</h3><MarkdownText text={item.draftCandidate.text}/>{ctx.state.artifacts.filter(a=>item.draftCandidate.artifactIds.includes(a.id)).map(a=><ArtifactTile key={a.id} file={a}/>)}<div className="op-modal-actions"><button type="button" className="op-btn op-btn-secondary" onClick={()=>setCandidateOpen(false)}>{t("Keep my draft")}</button><button type="button" className="op-btn op-btn-blue" disabled={locked||!!flow.busy} onClick={async()=>{const result=await flow.perform('apply-candidate',()=>api.post(`/api/inbox/${encodeURIComponent(item.id)}/draft-candidate/apply`,{requestId:item.draftCandidate.requestId,baseUpdatedAt:item.updatedAt}));if(result)setCandidateOpen(false);}}>{flow.busy==='apply-candidate'?<><LoaderCircle className="spinner" size={15}/>{language==='zh-CN'?'正在采用…':'Applying…'}</>:t("Use candidate")}</button></div></OperationModal>}
    {!!attachments?.length && <div className="op-attachments"><span className="op-label">{t("Files for this reply ·")} {attachments.length}</span><div className="op-attachment-grid">{attachments.map(file => <ArtifactTile key={file.id} file={file} onRemove={locked ? undefined : onRemove}/>)}</div></div>}
    <div className="op-add-task"><label><input type="checkbox" aria-label={t("Also add a follow-up")} checked={flow.addTask} onChange={event => flow.setAddTask(event.target.checked)} disabled={!!flow.busy || isSendLocked(item)}/>{t("Also add a follow-up")}</label>{flow.addTask && <div className="op-task-fields"><label>{t("Add to")}<select aria-label={t("Follow-up destination")} value={flow.followupDestination} onChange={event => flow.setFollowupDestination(event.target.value as 'calendar' | 'task')}><option value="calendar">{t("My calendar")}</option><option value="task">{t("Tasks")}</option></select></label><label>{t("Title")}<input aria-label={t("Follow-up task title")} value={flow.taskTitle} onChange={event => flow.setTaskTitle(event.target.value)}/></label><label>{flow.followupDestination === 'calendar' ? t("Start time · Singapore") : t("Due date")}<input type="datetime-local" aria-label={t("Follow-up task due date")} value={flow.dueDate} onChange={event => flow.setDueDate(event.target.value)} onInput={event => flow.setDueDate(event.currentTarget.value)}/></label>{flow.followupDestination === 'calendar' && <label>{t("Duration")}<select aria-label={t("Follow-up calendar duration")} value={flow.durationMinutes} onChange={event => flow.setDurationMinutes(Number(event.target.value))}>{[15, 30, 45, 60, 90, 120].map(value => <option key={value} value={value}>{value}  {t("minutes")}</option>)}</select></label>}</div>}</div>
    {item.sensitive && <div className="op-add-task op-sensitive-approval"><label><input type="checkbox" checked={flow.sensitiveApproval} onChange={event => flow.setSensitiveApproval(event.target.checked)} disabled={!!flow.busy}/>{t("I reviewed and approve this sensitive reply")}</label></div>}
    {!!item.attachments?.length && !canSendAttachments(ctx) && <div className="op-hold-note"><Paperclip size={16}/><span>{t("These files are saved locally. Feishu file sending is not available yet; remove the attachments to send the text.")}</span></div>}
    {ctx.state.settings.autonomy.holdSending && <div className="op-hold-note"><ShieldCheck size={16}/>{t("Sending is on hold.")}<button type="button" onClick={() => ctx.navigate('/autonomy')}>{t("Review Autonomy")}</button></div>}
  </div>;
}
export function ArtifactTile({ file, onRemove, compact = false }: { file: Artifact; onRemove?: (id: string) => void; compact?: boolean }) {
  const { t, language } = useI18n();
  const image = file.mime.startsWith('image/');
  const extension = file.name.split('.').pop()?.toUpperCase() || 'FILE';
  return <div className={`op-artifact-tile${compact ? ' op-artifact-compact' : ''}`}>{image ? <a href={file.url} target="_blank" rel="noreferrer" className="op-file-image"><img src={file.url} alt={t("Preview of {0}", file.name)}/></a> : <span className="op-file-paper" aria-hidden="true"><i/><i/><i/><i/><b>{extension}</b></span>}<div className="op-file-info"><a href={file.url} target="_blank" rel="noreferrer">{file.name}</a><span>{file.size < 1024 ? t("{0} bytes", file.size) : `${(file.size / 1024).toFixed(1)} KB`} · {file.mime}</span></div><a href={file.url} download={file.name} className="op-icon-btn op-file-download" aria-label={t("Download {0}", file.name)} title={t("Download {0}", file.name)}><Download size={16}/></a>{onRemove && <button type="button" className="op-icon-btn" aria-label={t("Remove {0}", file.name)} onClick={() => onRemove(file.id)}><X size={16}/></button>}</div>;
}

export default function Page({ ctx }: { ctx: UIContext }) { const { t, language } = useI18n();
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [triageFilter,setTriageFilter]=useState(()=>{try{const value=sessionStorage.getItem('opstwins.inbox.triage-filter');return ['all','reply','deep_reply','no_reply','review'].includes(value||'')?value!:'all';}catch{return 'all';}});
  const [triageBusy,setTriageBusy]=useState(false);
  const [selectedId, setSelectedId] = useState(queryItem());
  const [mobileDetail, setMobileDetail] = useState(!!queryItem());
  const [fullMessage, setFullMessage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');const [relatedId,setRelatedId]=useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const requestedId = queryItem();
  const filtered = ctx.state.inbox.filter(item => {
    const branch = filter === 'Done' ? isDone(item) : filter === 'Quiet' ? !isDone(item)&&isQuietInbox(item) : needsInboxAttention(item) && (filter === 'All' || (filter === 'From Human' ? item.origin === 'human' : item.origin === 'ai'));
    return branch && (triageFilter==='all'||(triageFilter==='review'?(!item.triage||item.triage.status!=='succeeded'||item.triage.route==='review'):triageFilter==='reply'?['quick_reply','deep_reply'].includes(item.triage?.route):item.triage?.route===triageFilter)) && `${item.title} ${item.sender} ${item.body} ${item.channel}`.toLowerCase().includes(search.toLowerCase());
  });
  const requestedItem=ctx.state.inbox.find(candidate=>candidate.id===requestedId);
  useEffect(()=>{try{sessionStorage.setItem('opstwins.inbox.triage-filter',triageFilter);}catch{}},[triageFilter]);
  useEffect(() => { if (requestedItem) { setSelectedId(requestedId); setMobileDetail(true); if(!filtered.some(candidate=>candidate.id===requestedId)){setFilter(isDone(requestedItem)?'Done':isQuietInbox(requestedItem)?'Quiet':'All');setTriageFilter('all');setSearch('');} } else if (!requestedId) setMobileDetail(false); }, [requestedId,requestedItem?.id]);
  useEffect(() => { if (!ctx.state.inbox.some(item => item.id === selectedId)) setSelectedId(filtered[0]?.id || ''); }, [ctx.state.revision, selectedId, filtered[0]?.id]);
  const detail = useFullInboxItem(ctx, filtered.find(candidate => candidate.id === selectedId)  || filtered[0]);
  const item = detail.item;
  const flow = useInboxFlow(ctx, item);
  const triageRequest=useRef('');
  useEffect(()=>{if(!item||item.triage||isDone(item)||triageRequest.current===item.id)return;const id=item.id;triageRequest.current=id;api.post(`/api/inbox/${encodeURIComponent(id)}/triage`,{}).then(()=>ctx.refresh()).catch(()=>{if(triageRequest.current===id)triageRequest.current='';});},[item?.id,item?.triage,ctx.state.revision]);
  async function analyze(){if(!item)return;setTriageBusy(true);try{await api.post(`/api/inbox/${encodeURIComponent(item.id)}/triage`,{force:true});await ctx.refresh();}catch(cause){flow.setError(errorText(cause));}finally{setTriageBusy(false);}}
  const activeItemId = useRef(item?.id);
  activeItemId.current = item?.id;
  async function dismissAndAdvance() {
    if (!item) return;
    const dismissedId = item.id;
    const index = filtered.findIndex(candidate => candidate.id === dismissedId);
    const next = [...filtered.slice(index + 1), ...filtered.slice(0, Math.max(0, index))]
      .find(candidate => candidate.id !== dismissedId && !isDone(candidate));
    const result = await flow.changeStatus('dismissed');
    // Do not move a different message the user opened while saving.
    if (!result || activeItemId.current !== dismissedId) return;
    setSelectedId(next?.id || '');
    setMobileDetail(!!next);
    ctx.navigate(next ? itemPath('inbox', next.id) : '/inbox');
  }
  const files = ctx.state.artifacts.filter(file => item?.attachments?.includes(file.id));
  const relatedTasks = item ? ctx.state.tasks.filter(task => task.inboxId === item.id || task.sourceInboxId === item.id || item.context?.includes(task.id)) : [];
  function pickFilter(value: string) { setFilter(value); setSelectedId(''); setMobileDetail(false); ctx.navigate('/inbox'); }
  function pickTriageFilter(value: string) { setTriageFilter(value); setSelectedId(''); setMobileDetail(false); ctx.navigate('/inbox'); }
  async function create() {
    if (!title.trim() || !body.trim()) { setCreateError(t("Add a title and a message.")); return; }
    setCreateBusy(true); setCreateError('');
    try {
      const created = await api.post<InboxItem>('/api/inbox', { title: title.trim(), body: body.trim(),context:relatedId?[relatedId]:[], sender: '许茂林', channel: 'Feishu', origin: 'human', status: 'pending', recipientId: 'self', isSelfTest: true, testMarker: `OPSADV-QA-${crypto.randomUUID()}` });
      await ctx.refresh(); setSelectedId(created.id); setMobileDetail(true); setFilter('All'); setTriageFilter('all'); setSearch(''); setCreating(false); setTitle(''); setBody('');setRelatedId(''); ctx.notify('Created your own test message for 许茂林', 'success'); ctx.navigate(itemPath('inbox', created.id));
    } catch (cause) { setCreateError(errorText(cause)); } finally { setCreateBusy(false); }
  }
  async function sync() {
    setSyncBusy(true); flow.setError('');
    try { const result=await api.post<{ok:boolean;imported:number;unresolved?:{name:string}[];failures?:unknown[]}>('/api/sync/feishu', {}); await ctx.refresh(); if(!result.ok){flow.setError(t("Sync partially completed. {0} conversations updated; {1} unresolved scopes and {2} failed reads. Review connection settings.",result.imported,result.unresolved?.length||0,result.failures?.length||0));}else ctx.notify(t("Synced {0} conversations",result.imported), 'success'); }
    catch (cause) { flow.setError(errorText(cause)); } finally { setSyncBusy(false); }
  }
  return <div className={`op-inbox-layout${mobileDetail ? ' op-inbox-show-detail' : ''}`}><section aria-label={t("Inbox messages")} className="op-inbox-list"><header><div className="op-inbox-heading"><h1>{t("Inbox")}</h1><span>{filtered.length}  {t("items")}</span></div><div className="op-filters">{['All', 'From Human', 'From AI', 'Quiet', 'Done'].map(value => <button type="button" key={value} aria-pressed={filter === value} className={`op-chip${filter === value ? ' active' : ''}`} onClick={() => pickFilter(value)}>{value==='Quiet'?(language==='zh-CN'?'安静记录':'Quiet log'):t(value)}</button>)}</div><div className="op-list-tools"><div className="op-search"><Search size={15}/><input aria-label={t("Search Inbox")} placeholder={t("Search Inbox")} value={search} onChange={event => setSearch(event.target.value)}/></div><button type="button" className="op-icon-btn" aria-label={t("Create test message")} title={t("Create test message")} onClick={() => setCreating(true)}><Plus size={17}/></button><button type="button" className="op-btn op-btn-link op-btn-xs" onClick={sync} disabled={syncBusy}>{syncBusy ? t("Syncing…") : t("Sync")}</button></div></header><div className="op-triage-filter"><label>{language==='zh-CN'?'判断筛选':'Assessment filter'}<select aria-label={language==='zh-CN'?'判断筛选':'Assessment filter'} value={triageFilter} onChange={event=>pickTriageFilter(event.target.value)}>{[['all','全部判断','All assessments'],['reply','需要回复','Reply needed'],['deep_reply','深度思考','Deep thinking'],['no_reply','无需回复','No reply needed'],['review','待确认','Needs judgment']].map(([value,zh,en])=><option key={value} value={value}>{language==='zh-CN'?zh:en}</option>)}</select></label></div><div className="op-message-list">{filtered.map(candidate => <button type="button" key={candidate.id} className={`op-message-row${item?.id === candidate.id ? ' selected' : ''}`} aria-current={item?.id === candidate.id ? 'true' : undefined} aria-label={`${t("Open message from {0}: {1}", candidate.sender, candidate.title)} · ${attention(candidate,language==='zh-CN').label}`} onClick={() => { setSelectedId(candidate.id); setMobileDetail(true); ctx.navigate(itemPath('inbox', candidate.id)); }}><Avatar name={candidate.sender} avatarUrl={candidate.avatarUrl} ai={candidate.origin === 'ai'}/><span className="op-message-content"><span className="op-message-top"><span className="op-message-identity"><strong>{candidate.sender || t("Your twin")}</strong><span className="op-message-source">{/^feishu$/i.test(candidate.channel)?(language==='zh-CN'?'飞书':'Feishu'):candidate.channel}</span></span><time className="op-message-time">{dateText(candidate.createdAt, true, language)}</time><AttentionSignal item={candidate}/></span>{candidate.title && candidate.title !== candidate.sender && <span className="op-message-subject">{shortText(candidate.title,80)}</span>}<span className="op-message-excerpt">{shortText(inboxExcerpt(candidate), 145)}</span></span></button>)}{!filtered.length && <Empty title={search ? t("No matching messages") : filter === 'Done' ? t("Nothing completed yet") : t("Your Inbox is clear")}>{search ? t("Try another search or filter.") : t("Sync Feishu or create your own test message.")}</Empty>}</div></section>
    <main className="op-inbox-detail" aria-label={t("Message detail")}>{item ? <><div className="op-detail-scroll"><button type="button" className="op-mobile-back op-btn op-btn-link" onClick={() => { setMobileDetail(false); ctx.navigate('/inbox'); }}><ArrowLeft size={16}/>{t("Inbox")}</button><div className="op-person-header"><Avatar name={item.sender} avatarUrl={item.avatarUrl} large ai={item.origin === 'ai'}/><div><strong>{item.sender}</strong><span>{item.channel} · {dateText(item.createdAt, true, language)}</span></div><ItemBadge item={item}/></div><OperationError error={detail.error}/><OperationError error={flow.error || (item.draftError ? String(item.draftError) : '')}/>{detail.loading && <span role="status" className="op-footnote">{t("Reading the original message…")}</span>}{item.sourceRule?.active&&<div className="op-card"><p>{language==='zh-CN'?`已设置不关注来源：${item.sourceRule.name}。敏感、失败、已有草稿或尚未明确判断的事项仍会提醒。`:`Source excluded: ${item.sourceRule.name}. Sensitive, failed, drafted or uncertain items still need attention.`}</p><button type="button" className="op-btn op-btn-secondary" disabled={!!flow.busy} onClick={()=>void flow.perform('restore-source',()=>api.post('/api/inbox-source-rules',{sourceKey:item.sourceRule!.id,excluded:false}))}>{language==='zh-CN'?'恢复关注此来源':'Follow this source again'}</button></div>}{isQuietInbox(item)&&<div className="op-card"><p>{language==='zh-CN'?'此消息已安静记录，不计入收件箱待办。':'Quietly recorded; excluded from Inbox attention.'}</p><button className="op-btn op-btn-secondary" disabled={!!flow.busy} onClick={async()=>{const id=item.id;const result=await flow.perform('surface',()=>api.post(`/api/inbox/${encodeURIComponent(id)}/surface`,{}));if(result){setFilter('All');setTriageFilter('all');setSelectedId(id);ctx.navigate(itemPath('inbox',id));}}}>{language==='zh-CN'?'恢复到收件箱':'Return to Inbox'}</button></div>}{item.status==='dismissed'&&item.dismissalFeedbackActive&&<p className="op-footnote">{language==='zh-CN'?'已记录为弱偏好反馈，供同一来源的相似消息判断参考。重新打开会撤销此反馈。':'Saved as weak preference feedback for similar messages from this source. Reopen to withdraw it.'}</p>}<TriageCard item={item} busy={triageBusy} onAnalyze={analyze}/><div className="op-card op-original-message"><div className="op-message-label"><span className="op-label">{item.triage?.reason==='self_test'?(language==='zh-CN'?'本人测试消息':'Self-test message'):item.triage?.reason==='own_message'?(language==='zh-CN'?'你发出的消息':'Your outgoing message'):(language==='zh-CN'?'原始消息':'Original message')}</span><button type="button" className="op-inline-link" onClick={() => setFullMessage(true)}>{t("Read full message")}</button></div><InboxMessages key={item.id} item={item}/><SourceAttachmentNotice item={item}/></div><details key={item.id} className="op-context-disclosure"><summary>{language==='zh-CN'?'更多信息':'More information'}<ChevronRight size={14} aria-hidden="true"/></summary><div className="op-card op-context-card"><div><span className="op-context-icon amber"><ShieldCheck size={18}/></span><span><strong>{t("Why your twin paused:")}</strong> {item.sensitive ? t("This message is marked sensitive and requires your attention.") : item.triage?.route==='no_reply'?(language==='zh-CN'?'建议无需回复，消息保留供查阅。':'No reply is advised; the message remains available.'):item.triage?.route==='review'?(language==='zh-CN'?'判断或材料尚不明确，先查看分析。':'The judgment or material is uncertain; review the assessment first.'):item.pauseReason || t("Review the reply and approve it before sending.")}</span></div><div><span className="op-context-icon blue"><CalendarDays size={18}/></span><span><strong>{t("Work context:")}</strong> {relatedTasks.length ? relatedTasks.map(task => `${task.title}${task.dueDate ? ` · ${dateText(task.dueDate, false, language)}` : ''}`).join('; ') : item.context?.length ? t("{0} linked sources. Open Deep Think to review the full context.", item.context.length) : t("No linked task or calendar commitment is recorded.")}</span></div><div><span className="op-context-icon blue"><BookOpen size={18}/></span><span><strong>{t("Source:")}</strong> {item.sourceId || item.testMarker || t("Created in OpsTwin Advance")}{item.sourceId && <small>{t("Imported as a read-only source; your edits stay in this project.")}</small>}</span></div></div></details>
      {item.sourceProcessing&&<section className="op-card op-source-processing" aria-label={t("Connection processing")}><strong>{t("Connection processing")} · {t(item.sourceProcessing.status)}</strong><p className="op-footnote">{item.sourceProcessing.status==='awaiting_approval'?t("Reply prepared for approval. Nothing is sent by this processing step."):t("Saved connection mode: {0}",item.sourceProcessing.mode)}</p>{item.sourceSummary&&<MarkdownText text={item.sourceSummary.text}/>} {item.sourceSummaryCandidate&&<details><summary>{t("Review summary from previous source version")}</summary><MarkdownText text={item.sourceSummaryCandidate.text}/></details>}{item.sourceProcessing.error&&<p role="alert">{item.sourceProcessing.error}</p>}{['failed','blocked','interrupted'].includes(item.sourceProcessing.status)&&<button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!flow.busy} onClick={()=>void flow.perform('retry-source',()=>api.post(`/api/inbox/${encodeURIComponent(item.id)}/process-source/retry`,{}))}>{t("Retry processing")}</button>}{item.sourceProcessing.runId&&<span className="op-footnote">{t("Run ID:")} {item.sourceProcessing.runId}</span>}</section>}
      <AutonomousDispatchCard item={item} ctx={ctx}/><SemanticEvidenceCard item={item} ctx={ctx}/><DraftCard item={item} flow={flow} ctx={ctx} attachments={files} onRemove={id=>{void flow.perform('remove-attachment',()=>api.patch(`/api/inbox/${encodeURIComponent(item.id)}`,{attachments:(item.attachments||[]).filter(value=>value!==id)}));}}/></div><ActionFooter><div className="op-main-actions">{isDone(item) ? <><StatusBadge tone={item.status === 'sent' || item.status === 'delivered' ? 'green' : 'grey'}>{t(item.status)}</StatusBadge>{!isSendLocked(item) && <button type="button" className="op-btn op-btn-blue" disabled={!!flow.busy} onClick={() => flow.changeStatus('pending')}>{t("Reopen")}</button>}{['sent', 'delivered'].includes(item.status) && <button type="button" className="op-btn op-btn-secondary" onClick={() => ctx.navigate(itemPath('sent', item.id))}>{t("View receipt")}</button>}</> : <><button type="button" className="op-btn op-btn-blue" disabled={!!flow.busy || item.status === 'sending' || !item.draft || flow.editing || !item.isSelfTest || item.recipientId !== 'self' || ctx.state.settings.autonomy.holdSending || (!!item.attachments?.length && !canSendAttachments(ctx)) || (item.sensitive && !flow.sensitiveApproval)} onClick={flow.send}>{flow.busy === 'send' ? <LoaderCircle size={18} className="op-spin"/> : <Check size={18}/>} {flow.busy === 'send' || item.status === 'sending' ? t("Sending…") : item.status === 'send_unknown' ? t("Check send result") : item.status === 'send_failed' ? t("Retry failed send") : t("Send reply")}</button><button type="button" className="op-btn op-btn-secondary" disabled={!!flow.busy || isSendLocked(item)} onClick={flow.startEdit}><Pencil size={18}/>{t("Edit draft")}</button><button type="button" className="op-btn op-btn-purple" disabled={!!flow.busy || flow.editing || isSendLocked(item)} onClick={() => ctx.navigate(`${itemPath('deep-think', item.id)}&inspire=${crypto.randomUUID()}`)}><Sparkles size={18}/>{t("AI Inspiration")}</button><button type="button" className="op-btn op-btn-ghost" disabled={!!flow.busy || isSendLocked(item)} onClick={dismissAndAdvance}>{t("Dismiss")}</button><button type="button" className="op-btn op-btn-link op-btn-sm" disabled={!!flow.busy || isSendLocked(item)} onClick={() => flow.changeStatus('done')}>{t("Mark done")}</button></>}</div></ActionFooter></> : <Empty title={t("Select a message")}>{t("Its original context, draft and actions will appear here.")}</Empty>}</main>
    {fullMessage && item && <OperationModal title={t("Full message")} wide onClose={() => setFullMessage(false)}><div className="op-detail-metadata"><strong>{item.sender}</strong><span>{item.channel}</span><time>{dateText(item.createdAt, false, language)}</time></div><h3>{item.title}</h3><InboxMessages key={item.id} item={item} full/><span className="op-footnote">{t("Source:")} {item.sourceId || item.testMarker || item.id}</span><div className="op-modal-actions"><button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={() => setFullMessage(false)}>{t("Close")}</button></div></OperationModal>}
    {creating && <OperationModal title={t("Create a test message")} onClose={() => setCreating(false)}><p className="op-modal-intro">{t("Create an Inbox item owned by this project. Any approved test reply is addressed to 许茂林 (Steve).")}</p><OperationError error={createError}/><label className="op-field">{t("Title")}<input aria-label={t("Test message title")} value={title} onChange={event => setTitle(event.target.value)} autoComplete="off"/></label><label className="op-field">{t("Message")}<textarea aria-label={t("Test message body")} rows={5} value={body} onChange={event => setBody(event.target.value)}/></label><label className="op-field">{t("Related work (optional)")}<select aria-label={t("Related work")} value={relatedId} onChange={e=>setRelatedId(e.target.value)}><option value="">{t("No linked work")}</option><optgroup label={t("Tasks")}>{ctx.state.tasks.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</optgroup><optgroup label={t("Projects")}>{ctx.state.projects.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}</optgroup></select></label><div className="op-modal-actions"><button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={() => setCreating(false)} disabled={createBusy}>{t("Cancel")}</button><button type="button" className="op-btn op-btn-blue op-btn-sm" onClick={create} disabled={createBusy}>{createBusy ? t("Creating…") : t("Create message")}</button></div></OperationModal>}
  </div>;
}
