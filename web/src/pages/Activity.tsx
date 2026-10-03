import { useI18n, translate } from '../domain/i18n';
import { useRef, useState } from 'react';
import { ArrowUpRight, Download, Search, Undo2 } from 'lucide-react';
import type { Activity, InboxItem, UIContext } from '../../../shared/types';
import { api } from '../domain/api';
import { ArtifactTile, dateText, Empty, errorText, isDone, itemPath, OperationError, OperationModal, requestKey, shortText, StatusBadge } from './Inbox';
import './operations.css';

type Branch = 'Sent' | 'Waiting for you' | 'Flagged' | 'Other';
function activityBranch(event: Activity, item?: InboxItem): Branch {
  const value = `${event.kind} ${event.status}`.toLowerCase();
  if (/flag|sensitiv|failed|error|block|partial|unknown/.test(value)) return 'Flagged';
  if (event.kind === 'send' && event.status === 'succeeded' && !!event.receipt) return 'Sent';
  if(event.kind==='notification'&&event.status==='delivered'&&event.receipt?.messageId)return 'Sent';
  if(event.kind==='notification'&&event.status==='local_digest'&&(!item||!isDone(item)))return 'Waiting for you';
  if ((/draft|pending|approval|waiting/.test(value) || event.kind === 'idea' && ['draft', 'reply'].includes(event.detail || '')) && (!item || !isDone(item))) return 'Waiting for you';
  return 'Other';
}
function groupLabel(createdAt?: string, language = 'en') {
  if (!createdAt) return 'Earlier activity';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Earlier activity';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
}
function isWorkspaceChange(event: Activity) {
  return /^(settings|connection|import|create|update|delete|restore)$/.test(event.kind) || /(?:connections|settings)[：:]/.test(event.title);
}
function activityCopy(event: Activity, ctx: UIContext) { const language = ctx.state.settings.identity.language; const t = (text: string, ...values: unknown[]) => translate(text, language, ...values);
  const directItem = ctx.state.inbox.find(entity => entity.id === event.entityId);
  const task = ctx.state.tasks.find(entity => entity.id === event.entityId);
  const idea = ctx.state.ideas.find(entity => entity.id === event.entityId);
  const item = directItem || (event.kind === 'idea' ? ctx.state.inbox.find(entity => entity.id === idea?.result?.inbox?.id) : undefined);
  const file = ctx.state.artifacts.find(entity => entity.id === event.entityId);
  const automation = ctx.state.automations.find(entity => entity.id === event.entityId);
  const branch = activityBranch(event, item);
  const recipient = item?.isSelfTest ? '许茂林' : item?.recipientName || item?.sender || t('the recipient');
  let title = event.title, detail = event.detail || '', reason = event.reason || '';
  let badge = event.status === 'succeeded' ? t("Recorded") : event.status;
  let tone = event.status === 'succeeded' ? 'blue' : 'grey';
  if(event.kind==='notification'){
    const zh=language==='zh-CN';title=event.status==='delivered'?(zh?'通知已送达':'Notification delivered'):event.status==='local_digest'?(zh?'每日汇总已生成':'Daily digest ready'):(zh?'通知需要查看':'Notification needs attention');reason=zh?'通知 · 查看来源与送达记录':'Notification · Review sources and delivery';
  } else if (event.kind === 'draft') {
    title = item ? t("Drafted a reply to {0}", item.sender) : event.title;
    detail = detail || (item && !isDone(item) ? shortText(item.draft || item.title, 190) : t("A reply draft was saved for review."));
    reason = reason || (item?.sensitive ? t("Sensitive topic · Review required") : t("Reply draft · Approval required"));
    badge = t("Draft saved"); tone = 'purple';
  } else if (event.kind === 'send') {
    title = branch === 'Sent' ? t("Replied to {0}", recipient) : t("Flagged a reply to {0}", recipient);
    detail = branch === 'Sent' ? shortText(item?.sentDraft || event.detail || '', 190) : detail;
    reason = reason || (branch === 'Sent' ? t("Reply · Channel receipt recorded") : t("Send result needs your attention"));
  } else if (/^(undo|recall)$/.test(event.kind)) {
    title = event.status === 'succeeded' ? t("Recalled a reply to {0}", recipient) : t("Recall needs attention: {0}", recipient);
    reason = reason || t("Recall result recorded"); badge = event.status === 'succeeded' ? t("Recalled") : event.status; tone = 'blue';
  } else if (event.kind === 'file') {
    title = t("Made a file: {0}", file?.name || file?.title || event.title.replace(/^保存文件[：:]/, ''));
    detail = file ? `${file.name.split('.').pop()?.toUpperCase() || t("File")} · ${file.size < 1024 ? t("{0} bytes", file.size) : `${(file.size / 1024).toFixed(1)} KB`}` : detail;
    reason = reason || (file?.sourceIds?.length ? t("{0} recorded source{1} · Ready for review", file.sourceIds.length, file.sourceIds.length === 1 ? '' : 's') : t("Saved file · Ready for review"));
    badge = t("Ready"); tone = 'purple';
  } else if (event.kind === 'calendar') {
    const cancelled = event.receipt?.proof === 'cli_calendar_delete_receipt';
    title = event.status === 'succeeded' && event.receipt?.eventId ? t("{0} a calendar follow-up{1}", cancelled ? t('Cancelled') : t('Saved'), event.detail ? `: ${event.detail}` : '') : t("Calendar follow-up needs attention");
    reason = reason || (event.receipt?.eventId ? t("Calendar · Event receipt recorded") : t("Calendar · Review the recorded result"));
    badge = cancelled ? t("Cancelled") : event.status === 'succeeded' ? t("Saved") : event.status; tone = cancelled ? 'blue' : 'green';
  } else if (event.kind === 'idea') {
    title = t("Put an idea to work: {0}", idea?.title || event.title.replace(/^执行建议[：:]/, ''));
    detail = idea?.description || detail;
    reason = reason || t("Idea · {0}", t(({ task: 'Task saved', automation: 'Automation scheduled', file: 'File saved', draft: 'Reply draft saved' } as Record<string, string>)[event.detail || idea?.action || ''] || 'Result recorded'));
    badge = t("Done"); tone = 'green';
  } else if (event.kind === 'automation') {
    title = t("{0} an automation: {1}", event.status === 'succeeded' ? t('Ran') : t('Flagged'), automation?.title || event.title.replace(/^(运行自动化|自动化失败)[：:]/, ''));
    reason = reason || (event.detail === 'manual' ? t("Automation · Run at your request") : event.detail === 'scheduled' ? t("Automation · Scheduled run") : t("Automation run"));
    detail = automation?.lastError || (automation?.lastRun ? t("Last run {0}", dateText(automation.lastRun, false, language)) : detail);
    badge = event.status === 'succeeded' ? t("Done") : event.status; tone = 'green';
  } else if (event.kind === 'chat') {
    title = t("Worked through a conversation with you"); reason = reason || t("Chat · Response saved"); badge = t("Done"); tone = 'purple';
  } else if (/^(create|update|delete|restore)$/.test(event.kind)) {
    const noun = task || /tasks[：:]/.test(event.title) ? 'task' : item || /inbox[：:]/.test(event.title) ? t("Inbox message") : idea || /ideas[：:]/.test(event.title) ? 'idea' : /memories[：:]/.test(event.title) ? 'memory' : automation ? 'automation' : '';
    if (noun) {
      const verb = ({ create: 'Saved', update: 'Updated', delete: 'Removed', restore: 'Restored' } as Record<string, string>)[event.kind];
      const entityTitle = task?.title || item?.title || idea?.title || automation?.title || event.title.split(/[：:]/).slice(1).join(':');
      title = `${t(verb)} ${t(noun)}${entityTitle ? `: ${entityTitle}` : ''}`;
      reason = reason || t("{0} · Change saved in your workspace", language === 'zh-CN' ? t(noun) : noun[0].toUpperCase() + noun.slice(1));
      badge = verb; tone = event.kind === 'delete' ? 'grey' : 'blue';
    }
  }
  if (branch !== 'Other') { badge = branch; tone = branch === 'Flagged' ? 'red' : branch === 'Waiting for you' ? 'amber' : 'green'; }
  return { item, branch, title, detail, reason: reason || t("Recorded in your workspace"), badge, tone };
}
function downloadFile(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Page({ ctx }: { ctx: UIContext }) { const { t, language } = useI18n();
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState(new URLSearchParams(window.location.search).get('entity') || '');
  const [searchOpen, setSearchOpen] = useState(!!search);
  const [includeWorkspace, setIncludeWorkspace] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Activity>();
  const [notification, setNotification] = useState<any>();
  const selectedActivityId=useRef<string|undefined>(undefined);
  function selectActivity(event?:Activity){selectedActivityId.current=event?.id;setNotification(undefined);setSelected(event);}
  const ncopy=(en:string,zh:string)=>language==='zh-CN'?zh:en;
  async function loadNotification(deliveryId:string,action?:'reconcile'|'retry'){const activityId=selectedActivityId.current;setBusy('notification');setError('');try{if(action)await api.post(`/api/notifications/${encodeURIComponent(deliveryId)}/${action}`,{});const state=await api.get<any>('/api/notifications');const event=state.events.find((e:any)=>e.id===deliveryId);const delivery=state.deliveries.find((d:any)=>d.id===(event?.deliveryId||deliveryId));if(!delivery&&!event)throw new Error(ncopy('Notification not found','未找到该通知'));if(selectedActivityId.current===activityId)setNotification(delivery||{...event,text:event.title,itemIds:[event.itemId]});if(action)await ctx.refresh();}catch(cause){if(selectedActivityId.current===activityId)setError(errorText(cause));}finally{setBusy('');}}
  const [exportFormat, setExportFormat] = useState('json');
  const events = [...ctx.state.activities].filter(event => {
    const copy = activityCopy(event, ctx);
    return (includeWorkspace || search || !isWorkspaceChange(event) || copy.branch === 'Flagged') && (filter === 'All' || copy.branch === filter) && `${event.id} ${event.title} ${copy.title} ${event.detail || ''} ${event.kind} ${event.status} ${event.runId || ''} ${event.entityId || ''}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const groups = [...new Set(events.map(event => groupLabel(event.createdAt, language)))];
  const edited = ctx.state.activities.filter(event => /edit/i.test(event.kind) || event.kind === 'update' && ctx.state.inbox.some(item => item.id === event.entityId && item.editedByUser)).length;
  const sent = ctx.state.activities.filter(event => activityBranch(event) === 'Sent').length;
  const autonomy = ctx.state.settings.autonomy;
  const meetingLevel = autonomy.levels.meet || 'draft';
  const meetingDecision = (autonomy as typeof autonomy & { suggestions?: { meetingConfirmations?: { decision?: string } } }).suggestions?.meetingConfirmations?.decision;
  const meetingEnabled = ['send_undo', 'autonomous', 'auto'].includes(meetingLevel);
  const meetingLevelLabel = ({ observe: t("Observe"), draft: t("Draft"), approval: t("Draft"), send_undo: t("Send with undo"), autonomous: t("Autonomous"), auto: t("Autonomous") } as Record<string, string>)[meetingLevel] || meetingLevel;
  const approvedMeetings = ctx.state.activities.filter(event => event.status === 'approved' && (event.category === 'meet' || event.category === 'meeting' || ctx.state.inbox.find(item => item.id === event.entityId)?.category === 'meet') && event.createdAt && Date.parse(event.createdAt) > Date.now() - 7 * 86400000).length;
  async function meetingChoice(enabled: boolean) {
    if (busy) return;
    setBusy('meeting-choice'); setError('');
    try {
      await api.patch('/api/settings', { autonomy: { ...(enabled ? { levels: { meet: 'send_undo' } } : {}), suggestions: { meetingConfirmations: { decision: enabled ? 'enabled' : 'deferred', decidedAt: new Date().toISOString() } } } });
      await ctx.refresh(); ctx.notify(enabled ? t("Meeting confirmations set to Send with undo. Approval and sending holds still apply.") : t("Suggestion saved for later. Your current autonomy level is unchanged."), 'success');
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(''); }
  }
  async function undo(item: InboxItem) {
    if (busy) return;
    setBusy(item.id); setError('');
    try { await api.post(`/api/inbox/${encodeURIComponent(item.id)}/undo`, { idempotencyKey: requestKey('undo', item) }); await ctx.refresh(); ctx.notify(t("Send recalled. The result is recorded in Activity."), 'success'); }
    catch (cause) { setError(errorText(cause)); ctx.notify(errorText(cause), 'error'); }
    finally { setBusy(''); }
  }
  async function exportLog() {
    setBusy('export'); setError('');
    try {
      const data = await api.get<any>('/api/activity/export');
      const rows: Activity[] = Array.isArray(data) ? data : data.activities || data.items || data.data || [];
      if (!Array.isArray(rows)) throw new Error(t("The export response did not contain an activity log."));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (exportFormat === 'csv') {
        const columns = ['id', 'createdAt', 'title', 'kind', 'status', 'detail', 'entityId', 'runId', 'actor'];
        const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
        downloadFile('\uFEFF' + [columns.join(','), ...rows.map(event => columns.map(column => cell(event[column])).join(','))].join('\r\n'), `opstwin-activity-${stamp}.csv`, 'text/csv;charset=utf-8');
      } else downloadFile(JSON.stringify(data, null, 2), `opstwin-activity-${stamp}.json`, 'application/json');
      ctx.notify(`Exported ${rows.length} activity records`, 'success');
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(''); }
  }
  const selectedCopy = selected && activityCopy(selected, ctx);
  const selectedArtifact = selected?.kind === 'file' ? ctx.state.artifacts.find(file => file.id === selected.entityId) : undefined;
  return <main className="op-page op-activity-page">
    <header className="op-page-header"><div><h1>{t("Activity")}</h1><p>{t("Everything your twin read, drafted and sent for you, with the reason for each. Nothing happens off the record.")}</p></div></header>
    <OperationError error={error}/>
    <div className="op-activity-layout"><div className="op-activity-main">
      <div className="op-activity-filters"><div className="op-filters">{['All', 'Sent', 'Waiting for you', 'Flagged'].map(value => <button type="button" key={value} className={`op-chip${filter === value ? ' active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(value)}</button>)}</div><button type="button" className="op-icon-btn" aria-label={t("Search Activity")} aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearch(''); }}><Search size={17}/></button></div>
      {searchOpen && <div className="op-search op-activity-search"><Search size={15}/><input aria-label={t("Search Activity records")} placeholder={t("Search activity or an item ID")} value={search} onChange={event => setSearch(event.target.value)}/></div>}
      <div className="op-audit-list">{groups.map(group => <section key={group} aria-label={t("{0} activity", group)}><h2>{t(group)}</h2>{events.filter(event => groupLabel(event.createdAt, language) === group).map(event => {
        const copy = activityCopy(event, ctx);
        const item = copy.item;
        const time = event.createdAt && !Number.isNaN(Date.parse(event.createdAt)) ? new Date(event.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
        const canUndo = copy.branch === 'Sent' && item?.isSelfTest && ['sent', 'delivered'].includes(item.status) && !!(item.receipt || event.receipt);
        const canReview = item && !isDone(item) && (copy.branch === 'Waiting for you' || copy.branch === 'Flagged');
        return <article key={event.id} className="op-audit-row" data-activity-id={event.id}><time dateTime={event.createdAt}>{time}</time><div className="op-audit-content"><button type="button" className="op-audit-title" onClick={() => selectActivity(event)}>{copy.title}</button>{copy.detail && <p>{shortText(copy.detail, 190)}</p>}<span>{copy.reason}</span></div><div className="op-audit-actions"><StatusBadge tone={copy.tone}>{t(copy.badge)}</StatusBadge>{canUndo ? <button type="button" className="op-btn op-btn-softblue op-btn-sm" disabled={!!busy} onClick={() => undo(item)}><Undo2 size={16}/>{busy === item.id ? t("Recalling…") : t("Undo")}</button> : canReview ? <button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={() => ctx.navigate(itemPath('inbox', item.id))}>{t("Review")}</button> : null}</div></article>;
      })}</section>)}{!events.length && <Empty title={search || filter !== 'All' ? t("No matching activity") : t("No Twin activity yet")}>{search || filter !== 'All' ? t("Try another search or filter.") : t("Create work, generate a draft or run an idea to build the timeline.")}</Empty>}</div>
      <button type="button" className="op-inline-link op-workspace-toggle" aria-pressed={includeWorkspace} onClick={() => setIncludeWorkspace(!includeWorkspace)}>{includeWorkspace ? t("Show Twin activity") : t("Include all workspace changes")}</button>
    </div><aside className="op-activity-aside">
      <div className="op-card op-room-card"><h2>{meetingEnabled ? t("Meeting confirmations have more room") : approvedMeetings >= 8 ? t("Your twin has earned more room") : t("Give your twin room to help")}</h2><p>{autonomy.holdSending ? t("Sending is on hold. You can still set the level for meeting confirmations; the hold remains in force.") : meetingEnabled ? t("Meeting confirmations use {0}. Approval requirements and sensitive-message rules still apply.", meetingLevelLabel) : meetingDecision === 'deferred' ? t("You saved this suggestion for later. Meeting confirmations keep their current autonomy level until you change it.") : approvedMeetings >= 8 ? t("You approved {0} meeting confirmations this week. Choose Send with undo for this category when you are ready.", approvedMeetings) : t("Meeting confirmations use {0}. Choose Send with undo for this category when you are ready.", meetingLevelLabel)}</p>{!meetingEnabled && meetingDecision !== 'deferred' ? <div className="op-room-actions"><button type="button" className="op-btn op-btn-blue op-btn-sm" disabled={!!busy} onClick={() => meetingChoice(true)}>{busy === 'meeting-choice' ? t("Saving…") : t("Turn on")}</button><button type="button" className="op-btn op-btn-link op-btn-sm" disabled={!!busy} onClick={() => meetingChoice(false)}>{t("Not yet")}</button></div> : <button type="button" className="op-inline-link" onClick={() => ctx.navigate('/autonomy')}>{t("Review autonomy settings ›")}</button>}</div>
      <div className="op-card"><h2>{t("Your edits teach your twin")}</h2><p>{edited ? t("{0} Inbox change{1} recorded. Your saved wording stays available for review.", edited, edited === 1 ? '' : 's') : t("Edit a draft to keep your preferred wording. Changes and their source stay in the audit trail.")}</p><button type="button" className="op-btn op-btn-link op-btn-sm" onClick={() => ctx.navigate('/autonomy')}>{t("Review autonomy settings")}</button></div>
      <div className="op-card"><h2>{t("Audit log")}</h2><p>{t("Every recorded action includes its status, related item and available execution evidence.")}</p><span className="op-footnote">{ctx.state.activities.length}  {t("records ·")} {sent}  {t("confirmed sends")}</span><div className="op-export-controls"><label className="op-sr-only" htmlFor="activity-export-format">{t("Export format")}</label><select id="activity-export-format" value={exportFormat} onChange={event => setExportFormat(event.target.value)}><option value="json">JSON</option><option value="csv">CSV</option></select><button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!busy} onClick={exportLog}><Download size={15}/>{busy === 'export' ? t("Exporting…") : t("Export log")}</button></div></div>
    </aside></div>
    {selected && selectedCopy && <OperationModal title={t("Activity details")} wide onClose={() => selectActivity()}><OperationError error={error}/><h3>{selectedCopy.title}</h3><div className="op-detail-metadata"><StatusBadge tone={selectedCopy.tone}>{selectedCopy.badge}</StatusBadge><span>{selectedCopy.reason}</span><time>{dateText(selected.createdAt, false, language)}</time></div>{selectedCopy.detail && <p className="op-prewrap">{selectedCopy.detail}</p>}{selectedArtifact && <ArtifactTile file={selectedArtifact} compact/>}{selected.kind==='notification'&&(selected.receipt?.deliveryId||selected.receipt?.notificationEventId)&&<section aria-label={ncopy('Notification delivery','通知送达')}><button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!busy} onClick={()=>loadNotification(selected.receipt!.deliveryId||selected.receipt!.notificationEventId)}>{ncopy('View notification','查看通知')}</button>{notification&&<><p><strong>{ncopy('Status','状态')}：</strong>{({pending:ncopy('Pending','待处理'),prepared:ncopy('Ready','准备发送'),deferred:ncopy('Deferred','已延后'),sending:ncopy('Sending','正在发送'),delivered:ncopy('Delivered','已送达'),local_digest:ncopy('In-app digest','应用内汇总'),failed:ncopy('Failed before sending','发送前失败'),unknown:ncopy('Receipt needs checking','回执待确认'),cancelled:ncopy('Cancelled','已取消')} as Record<string,string>)[notification.state]||notification.state}</p><p className="op-prewrap">{notification.text}</p>{notification.error&&<p role="alert">{notification.error}</p>}{notification.messageId&&<p>{ncopy('Receipt','回执')}：{notification.messageId}</p>}{notification.state==='unknown'&&<button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!busy} onClick={()=>loadNotification(notification.id,'reconcile')}>{ncopy('Check receipt · no resend','查询回执 · 不重发')}</button>}{notification.state==='failed'&&!notification.attemptedAt&&<button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!busy} onClick={()=>loadNotification(notification.id,'retry')}>{ncopy('Retry notification','重试通知')}</button>}{(selected.receipt.itemIds||notification.itemIds||[selected.entityId].filter(Boolean)).map((id:string)=><button key={id} type="button" className="op-inline-link" onClick={()=>ctx.navigate(itemPath('inbox',id))}>{ncopy('Review source','查看来源')}：{ctx.state.inbox.find(item=>item.id===id)?.title||id} ↗</button>)}</>}</section>}<details className="op-activity-evidence"><summary>{t("Recorded evidence")}</summary><dl className="op-source-fields"><div><dt>{t("Activity ID")}</dt><dd>{selected.id}</dd></div><div><dt>{t("Action")}</dt><dd>{selected.title}</dd></div><div><dt>{t("Status")}</dt><dd>{selected.kind} · {selected.status}</dd></div><div><dt>{t("Related item")}</dt><dd>{selected.entityId || t("Not recorded")}</dd></div>{selected.runId && <div><dt>{t("Run ID")}</dt><dd>{selected.runId}</dd></div>}</dl>{selected.detail && <p className="op-prewrap">{selected.detail}</p>}{selected.receipt && <pre className="op-code">{JSON.stringify(selected.receipt, null, 2)}</pre>}</details>{selected.runId && <button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={async () => { setError(''); try { const run = await api.get<any>(`/api/runs/${encodeURIComponent(selected.runId)}`); setSelected({ ...selected, runEvidence: run }); } catch (cause) { setError(errorText(cause)); } }}>{t("Load run evidence")}<ArrowUpRight size={12}/></button>}{selected.runEvidence && <pre className="op-code">{JSON.stringify(selected.runEvidence, null, 2)}</pre>}<div className="op-modal-actions"><button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={() => selectActivity()}>{t("Close")}</button></div></OperationModal>}
  </main>;
}
