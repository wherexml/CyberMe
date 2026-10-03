import { useI18n, translate } from '../domain/i18n';
import { useState } from 'react';
import { CalendarDays, Check, ChevronRight, Clock3, Undo2 } from 'lucide-react';
import type { UIContext } from '../../../shared/types';
import { api, ApiError } from '../domain/api';
import { ArtifactTile, Avatar, dateText, errorText, isDone, itemPath, MarkdownText, operationErrorSummary, OperationError, queryItem, requestKey, StatusBadge, useFullInboxItem } from './Inbox';
import './operations.css';

export default function Page({ ctx }: { ctx: UIContext }) { const { t, language } = useI18n();
  const requestedId = queryItem();
  const detail = useFullInboxItem(ctx, requestedId ? ctx.state.inbox.find(candidate => candidate.id === requestedId) : ctx.state.inbox.find(candidate => ['sent', 'delivered', 'recalled'].includes(candidate.status)));
  const item = detail.item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [calendarConflict, setCalendarConflict] = useState(false);
  const [calendarEvidence, setCalendarEvidence] = useState<any>();
  if (!item) return <main className="op-sent-page op-sent-empty"><div className="op-sent-heading"><span className="op-success-icon pending"><Clock3 size={34}/></span><h1>{t("No sent reply selected")}</h1><span>{t("Send a reply from your own test Inbox item to see its recorded receipt here.")}</span></div><button type="button" className="op-btn op-btn-blue op-btn-md" onClick={() => ctx.navigate('/inbox')}>{t("Back to Inbox")}</button></main>;
  const current = item;
  const calendarEvent = item.calendarEvent;
  const calendarPending = item.calendarStatus && !calendarEvent?.eventId && !['cancelled', 'none'].includes(item.calendarStatus);
  const receiptActivity = ctx.state.activities.find(event => event.entityId === item.id && event.kind === 'send' && event.receipt);
  const receipt = item.receipt || receiptActivity?.receipt;
  const sentAt = item.sentAt || receipt?.sentAt || receiptActivity?.createdAt;
  const success = ['sent', 'delivered'].includes(item.status) && !!receipt;
  const sentFileIds = (item.sentAttachments || []).map((file: string | { id: string }) => typeof file === 'string' ? file : file.id);
  const files = ctx.state.artifacts.filter(file => (success ? sentFileIds : item.attachments || []).includes(file.id));
  const next = ctx.state.inbox.find(candidate => candidate.id !== item.id && !isDone(candidate));
  const relatedTasks = ctx.state.tasks.filter(task => task.inboxId === item.id || task.sourceInboxId === item.id || task.id === item.taskId);
  const relatedAutomations = ctx.state.automations.filter(automation => automation.inboxId === item.id || automation.contextIds?.includes(item.id));
  const recalled = item.status === 'recalled' || item.status === 'pending' && !!item.recalledAt;
  const recipient = item.isSelfTest ? '许茂林' : item.recipientName || receipt?.recipientName || item.sender;
  async function undo() {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.post(`/api/inbox/${encodeURIComponent(current.id)}/undo`, { idempotencyKey: requestKey('undo', current) }); await ctx.refresh(); ctx.notify(t("Message recalled. The result is recorded in Activity."), 'success'); ctx.navigate(itemPath('inbox', current.id)); }
    catch (cause) { const message = errorText(cause); setError(message); ctx.notify(operationErrorSummary(message), 'error'); }
    finally { setBusy(false); }
  }
  async function retryCalendar(allowConflict = false) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.post<any>(`/api/inbox/${encodeURIComponent(current.id)}/calendar`, allowConflict ? { allowConflict: true } : {});
      await ctx.refresh(); setCalendarConflict(false);
      if (result.calendarEvent?.eventId || result.event?.eventId || result.item?.calendarEvent?.eventId) ctx.notify(t("Calendar follow-up saved with its event receipt"), 'success'); else ctx.notify(t("Calendar result checked. Review its recorded status below."));
    } catch (cause) {
      const data = cause instanceof ApiError ? cause.data : undefined;
      setCalendarConflict(data?.error === 'calendar_conflict' || data?.code === 'calendar_conflict');
      if (data?.detail?.conflicts) setCalendarEvidence(data.detail.conflicts);
      setError(errorText(cause)); await ctx.refresh();
    } finally { setBusy(false); }
  }
  async function readCalendar() {
    if (busy || !calendarEvent?.eventId) return;
    setBusy(true); setError('');
    try { setCalendarEvidence(await api.get(`/api/calendar/events/${encodeURIComponent(calendarEvent.eventId)}`)); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function cancelCalendar() {
    if (busy || !calendarEvent?.eventId) return;
    setBusy(true); setError('');
    try { const result = await api.delete(`/api/calendar/events/${encodeURIComponent(calendarEvent.eventId)}`); setCalendarEvidence(result); await ctx.refresh(); ctx.notify(t("Calendar cancellation result recorded"), 'success'); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <main className="op-sent-page"><div className="op-sent-content"><div className="op-sent-heading"><span className={`op-success-icon${recalled ? ' recalled' : !success ? ' pending' : ''}`}>{success ? <Check size={40}/> : recalled ? <Undo2 size={34}/> : <Clock3 size={34}/>}</span><h1>{success ? t("Reply sent to {0}", recipient) : recalled ? t("Reply recalled") : t("Send receipt unavailable")}</h1><span>{success ? `${item.channel} · ${dateText(sentAt, false, language)}${files.length ? t(" · {0} attachments", files.length) : ''}` : recalled ? t("The recall is recorded. You can review the original reply in Inbox.") : t("This reply has no confirmed send receipt. Return to Inbox to review its current status.")}</span></div><OperationError error={detail.error}/><OperationError error={error}/>
    {success && <div className="op-undo-banner"><Clock3 size={18}/><span>{receipt.undoUntil ? t("Recall available until {0}.", dateText(receipt.undoUntil, false, language)) : t("You can request a recall. Availability is checked by Feishu.")}</span><button type="button" onClick={undo} disabled={busy}>{busy ? t("Recalling…") : t("Undo send")}</button></div>}
    <div className="op-card op-sent-summary"><div className="op-sent-recipient"><Avatar name={recipient}/><div><strong>{t("To")} {recipient}</strong><span>{item.title}</span></div><StatusBadge tone={success ? 'green' : recalled ? 'blue' : 'amber'}>{item.status === 'delivered' ? t("Delivered") : success ? t("Sent") : recalled ? t("Recalled") : item.status}</StatusBadge></div><div className="op-sent-text"><MarkdownText text={item.sentDraft || item.draft || ''}/></div>{files.length > 0 && <div className="op-attachment-grid">{files.map(file => <ArtifactTile key={file.id} file={file} compact/>)}</div>}{receipt && <details className="op-receipt"><summary>{t("View send receipt")}</summary><dl className="op-source-fields"><div><dt>{t("Message ID")}</dt><dd>{receipt.messageId || receipt.message_id || receipt.data?.message_id || t("Not provided by the channel")}</dd></div>{receipt.messageIds?.length > 1 && <div><dt>{t("Messages")}</dt><dd>{receipt.messageIds.length}  {t("confirmed channel messages")}</dd></div>}<div><dt>{t("Recipient")}</dt><dd>{receipt.recipientName || receipt.recipientId || recipient}</dd></div><div><dt>{t("Channel")}</dt><dd>{item.channel}</dd></div>{(item.draftRunId || item.runId) && <div><dt>{t("Run ID")}</dt><dd>{item.draftRunId || item.runId}</dd></div>}{item.conversationId && <div><dt>{t("Conversation")}</dt><dd>{item.conversationId}</dd></div>}<div><dt>{t("Timestamp")}</dt><dd>{dateText(sentAt, false, language)}</dd></div><div><dt>{t("Receipt")}</dt><dd><pre className="op-code">{JSON.stringify(receipt, null, 2)}</pre></dd></div></dl></details>}</div>
    <div className="op-card op-sent-followups"><h2>{calendarPending ? t("Follow-up status") : t("Your twin also took care of")}</h2>{calendarEvent?.eventId && <div className="op-sent-calendar"><CalendarDays size={18}/><div><strong>{item.calendarStatus === 'cancelled' ? t("Calendar follow-up cancelled") : t("Saved “{0}” to your calendar", calendarEvent.title || current.followup?.title || current.title)}</strong><span>{calendarEvent.startAt ? dateText(calendarEvent.startAt, false, language) : t("Start time is recorded in the calendar receipt")}{calendarEvent.timezone ? ` · ${calendarEvent.timezone}` : ''}</span><div className="op-calendar-actions">{calendarEvent.url && <a href={calendarEvent.url} target="_blank" rel="noreferrer" className="op-inline-link">{t("View in Calendar ↗")}</a>}<button type="button" className="op-inline-link" disabled={busy} onClick={readCalendar}>{t("Read event receipt")}</button>{item.calendarStatus !== 'cancelled' && <button type="button" className="op-inline-link" disabled={busy} onClick={cancelCalendar}>{t("Cancel calendar event")}</button>}</div></div></div>}{calendarPending && <div className="op-calendar-pending"><CalendarDays size={18}/><div><strong>{t("Calendar follow-up needs attention")}</strong>{current.calendarError ? <OperationError error={String(current.calendarError)}/> : <span>{t("Status:")} {current.calendarStatus}</span>}<span className="op-footnote">{t("Your message receipt remains recorded. This action only retries the calendar follow-up.")}</span><div className="op-calendar-actions"><button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={busy} onClick={() => retryCalendar(false)}>{busy ? t("Checking…") : current.calendarStatus === 'unknown' ? t("Check calendar result") : t("Retry calendar follow-up")}</button>{(calendarConflict || current.calendarStatus === 'conflict') && <button type="button" className="op-btn op-btn-blue op-btn-sm" disabled={busy} onClick={() => retryCalendar(true)}>{t("Create anyway")}</button>}</div></div></div>}{(calendarEvidence || calendarEvent?.receipt) && <details className="op-receipt"><summary>{t("Calendar evidence")}</summary><pre className="op-code">{JSON.stringify(calendarEvidence || calendarEvent.receipt, null, 2)}</pre></details>}{relatedTasks.map(task => <div key={task.id}><Check size={18}/><span>{t("Saved follow-up task “")}{task.title}” · {t(task.status)}{task.dueDate ? ` · ${dateText(task.dueDate, false, language)}` : ''}</span></div>)}{relatedAutomations.map(automation => <div key={automation.id}><Clock3 size={18}/><span>{automation.title} · {automation.enabled ? t("Scheduled: {0}", automation.schedule) : t("Paused")}</span></div>)}{receiptActivity && <div><Check size={18}/><span>{t("Recorded the channel receipt in Activity")}</span></div>}{item.conversationId && <div><Check size={18}/><span>{t("Kept the reply and source context in your Chat conversation")}</span></div>}{!calendarEvent?.eventId && !calendarPending && !relatedTasks.length && !relatedAutomations.length && !receiptActivity && <span className="op-footnote">{t("No additional task or scheduled follow-up was recorded for this reply.")}</span>}</div>
    <div className="op-sent-actions">{next && <button type="button" className="op-btn op-btn-blue op-btn-md" onClick={() => ctx.navigate(itemPath('inbox', next.id))}>{t("Next:")} {next.sender}<ChevronRight size={16}/></button>}<button type="button" className="op-btn op-btn-secondary op-btn-md" onClick={() => ctx.navigate(itemPath('inbox', item.id))}>{t("Back to Inbox")}</button><button type="button" className="op-btn op-btn-link op-btn-md" onClick={() => ctx.navigate(`/activity?entity=${encodeURIComponent(item.id)}`)}>{t("View in Activity")}</button><span>{ctx.state.inbox.filter(candidate => !isDone(candidate)).length}  {t("left in Inbox")}</span></div>
    </div></main>;
}
