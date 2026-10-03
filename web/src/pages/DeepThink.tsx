import { useI18n, translate } from '../domain/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, BookOpen, Check, ChevronRight, Clock3, FileText, Image, LoaderCircle, Maximize2, Paperclip, Pencil, Plus, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import type { Artifact, Entity, InboxItem, Message, UIContext } from '../../../shared/types';
import { api, ApiError } from '../domain/api';
import { ArtifactTile, Avatar, canSendAttachments, dateText, ActionFooter, DraftCard, SourceAttachmentNotice, Empty, errorText, isDone, isSendLocked, ItemBadge, itemPath, MarkdownText, OperationError, OperationModal, queryItem, shortText, StatusBadge, useFullInboxItem, useInboxFlow } from './Inbox';
import './operations.css';
import { replyMessages, replyArtifacts } from '../../../shared/reply-scope';

function runSteps(run: any): any[] {
  for (const key of ['tools', 'steps', 'toolCalls', 'toolResults', 'events']) if (Array.isArray(run?.[key]) && run[key].length) return run[key];
  return [];
}
function duration(run: any, language = 'en') {
  const end = run?.completedAt || run?.finishedAt, start = run?.startedAt || run?.createdAt;
  const ms = run?.durationMs ?? (end && start ? Date.parse(end) - Date.parse(start) : undefined);
  return typeof ms === 'number' && ms >= 0 ? translate(" · {0} seconds", language, (ms / 1000).toFixed(1)) : '';
}
type DeepRequest = { id: string; fingerprint: string; message: string; conversationId?: string; error?: string; errorCode?: string; runId?: string };
function memoryText(memory: Entity) { return String(memory.content || memory.body || memory.title || ''); }

export default function Page({ ctx }: { ctx: UIContext }) { const { t, language } = useI18n();
  const detail = useFullInboxItem(ctx, ctx.state.inbox.find(candidate => candidate.id === queryItem()) || ctx.state.inbox.find(candidate => !isDone(candidate)));
  const item = detail.item;
  const flow = useInboxFlow(ctx, item);
  const [fullMessage, setFullMessage] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [editingMemory, setEditingMemory] = useState('');
  const [memoryEditText, setMemoryEditText] = useState('');
  const [forgottenMemory, setForgottenMemory] = useState<Entity>();
  const [memoryBusy, setMemoryBusy] = useState('');
  const [memoryError, setMemoryError] = useState('');
  const [run, setRun] = useState<any>();
  const [evidenceError, setEvidenceError] = useState('');
  const [conversationId, setConversationId] = useState<string>('');
  const [messageDraft, setMessageDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatErrorCode, setChatErrorCode] = useState('');
  const [chatErrorRunId, setChatErrorRunId] = useState('');
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const chatRequest = useRef<DeepRequest | null>(null);
  const chatPending = useRef(false);
  const [generatedFiles, setGeneratedFiles] = useState<Artifact[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const validContextIds = new Set([...ctx.state.inbox, ...ctx.state.tasks, ...ctx.state.memories, ...ctx.state.ideas].map(entity => entity.id));
  const contextIds = item ? [item.id, ...(item.context || []).filter(id => validContextIds.has(id))] : [];
  const sourceIds = item ? [...new Set([item.id, item.sourceId, ...(item.context || [])].filter(Boolean) as string[])] : [];
  const memories = ctx.state.memories.filter(memory => !memory.deletedAt && (memory.entityId === item?.id || memory.person === item?.sender || memory.contextIds?.includes(item?.id)));
  const conversation = conversationId || item?.conversationId || '';
  const messages = item ? replyMessages(item, conversation, ctx.state.messages, ctx.state.conversations) : [];
  const files = ctx.state.artifacts.filter(file => item?.attachments?.includes(file.id));
  const relatedTasks = ctx.state.tasks.filter(task => task.inboxId === item?.id || task.sourceInboxId === item?.id || item?.context?.includes(task.id));
  const availableArtifacts = [...new Map([...generatedFiles, ...replyArtifacts(item, conversation, ctx.state.artifacts, ctx.state.conversations, messages)].map(file => [file.id, file])).values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const activeRunId = item?.draftRunId || item?.runId || item?.lastRunId;
  useEffect(() => {
    setRun(undefined); setEvidenceError(''); setConversationId(item?.conversationId || ''); setGeneratedFiles([]); setChatError(''); setChatErrorCode(''); setChatErrorRunId(''); setMessageDraft(''); chatRequest.current = null;
    if (item) try {
      const saved: DeepRequest | null = JSON.parse(sessionStorage.getItem(`opsadv-deep-request:${item.id}`) || 'null');
      if (saved?.id && saved.message) { chatRequest.current = saved; setMessageDraft(saved.message); setChatError(saved.error || ''); setChatErrorCode(saved.errorCode || ''); setChatErrorRunId(saved.runId || ''); if (saved.conversationId) setConversationId(saved.conversationId); }
    } catch { /* Invalid local retry metadata cannot authorize a new request. */ }
  }, [item?.id]);
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    api.get<any>(`/api/runs/${encodeURIComponent(activeRunId)}`).then(value => { if (!cancelled) setRun(value); }).catch(cause => { if (!cancelled) setEvidenceError(errorText(cause)); });
    return () => { cancelled = true; };
  }, [activeRunId]);
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: chatError ? 'auto' : 'smooth' }); }, [messages.length, availableArtifacts.length, chatBusy, chatError]);
  const inspiration = new URLSearchParams(window.location.search).get('inspire');
  const startedInspiration = useRef('');
  useEffect(() => {
    if (!item || detail.loading || !inspiration || isSendLocked(item)) return;
    const key = `opsadv-inspiration:${item.id}:${inspiration}`;
    if (startedInspiration.current === key || sessionStorage.getItem(key)) return;
    startedInspiration.current = key; sessionStorage.setItem(key, 'started');
    void generate();
  }, [item?.id, detail.loading, inspiration]);
  if (!item) return <main className="op-page"><button type="button" className="op-btn op-btn-link" onClick={() => ctx.navigate('/inbox')}><ArrowLeft size={17}/>{t("Inbox")}</button><h1 className="op-empty-title">{t("Deep Think")}</h1><Empty title={t("Choose a message for Deep Think")}>{t("Open an Inbox item to preserve its source and draft context.")}</Empty></main>;
  const currentItem = item;
  async function generate(mode: 'deep' | 'chat' = 'deep') {
    const result = await flow.generate(mode);
    if (result) { setRun(result.run); if (result.item.conversationId) setConversationId(result.item.conversationId); if (result.artifacts) setGeneratedFiles(previous => [...previous, ...result.artifacts!]); }
  }
  async function changeAttachment(id: string, attach: boolean) {
    const attachments = attach ? [...new Set([...(currentItem.attachments || []), id])] : (currentItem.attachments || []).filter(candidate => candidate !== id);
    await flow.perform('attachment', () => api.patch(`/api/inbox/${encodeURIComponent(currentItem.id)}`, { attachments }));
  }
  const chatBlocked = ['request_in_progress', 'conversation_busy', 'partial_run_requires_review'].includes(chatErrorCode);
  async function followUp(mode: 'deep' | 'chat' = 'deep') {
    if (!messageDraft.trim() || chatBusy || chatPending.current || fileBusy || chatBlocked) return;
    const storageKey = `opsadv-deep-request:${currentItem.id}`;
    const payload = { conversationId: conversation || undefined, message: messageDraft.trim(), attachmentIds: currentItem.attachments || [], contextIds, mode, readOnly: true, ...(mode === 'chat' && chatErrorRunId ? { retryOfRunId: chatErrorRunId } : {}) };
    // The server binds the request to its returned conversation; a first failed
    // attempt must retain its ID after that conversation is assigned.
    const fingerprint = JSON.stringify([currentItem.id, payload.message, payload.attachmentIds, contextIds, payload.mode, payload.readOnly]);
    if (chatRequest.current?.fingerprint !== fingerprint) chatRequest.current = { id: crypto.randomUUID(), fingerprint, message: payload.message, conversationId: payload.conversationId };
    const intent = chatRequest.current;
    sessionStorage.setItem(storageKey, JSON.stringify(intent));
    chatPending.current = true; setChatBusy(true); setChatError(''); setChatErrorCode('');
    try {
      const result = await api.post<{ conversationId: string; userMessage: Message; assistantMessage: Message; run: any; artifacts?: Artifact[] }>('/api/chat', { ...payload, conversationId: intent.conversationId || payload.conversationId, requestId: intent.id });
      await api.patch(`/api/inbox/${encodeURIComponent(currentItem.id)}`, { conversationId: result.conversationId });
      setConversationId(result.conversationId); setRun(result.run); setMessageDraft(''); if (result.artifacts) setGeneratedFiles(previous => [...previous, ...result.artifacts!]);
      chatRequest.current = null; sessionStorage.removeItem(storageKey); await ctx.refresh();
    } catch (cause) {
      const data = cause instanceof ApiError ? cause.data : undefined;
      const failedConversation = data?.detail?.conversationId || data?.conversationId;
      const failedRun = data?.detail?.run || data?.run;
      const runId = failedRun?.id || data?.detail?.runId || data?.runId;
      const code = data?.error || data?.code || '';
      const message = errorText(cause);
      setChatError(message); setChatErrorCode(code); setChatErrorRunId(runId || '');
      if (failedRun) setRun(failedRun);
      if (runId && !failedRun) try { setRun(await api.get(`/api/runs/${encodeURIComponent(runId)}`)); } catch { /* Keep the original failure and its run ID. */ }
      if (failedConversation) { setConversationId(failedConversation); try { await api.patch(`/api/inbox/${encodeURIComponent(currentItem.id)}`, { conversationId: failedConversation }); } catch { /* The retained request still points to the recorded conversation. */ } }
      chatRequest.current = { ...intent, conversationId: failedConversation || intent.conversationId, error: message, errorCode: code, runId };
      sessionStorage.setItem(storageKey, JSON.stringify(chatRequest.current));
      try { await ctx.refresh(); } catch { /* Preserve the original model failure. */ }
    } finally { chatPending.current = false; setChatBusy(false); }
  }
  async function reviewChatRun() {
    const id = chatErrorRunId || run?.id;
    if (!id) return;
    setEvidenceExpanded(true); setEvidenceError('');
    try {
      const recorded = await api.get<any>(`/api/runs/${encodeURIComponent(id)}`); setRun(recorded);
      if (recorded.status !== 'running' && ['request_in_progress', 'conversation_busy'].includes(chatErrorCode)) { setChatErrorCode(''); if (chatRequest.current) { chatRequest.current.errorCode = ''; sessionStorage.setItem(`opsadv-deep-request:${currentItem.id}`, JSON.stringify(chatRequest.current)); } }
    } catch (cause) { setEvidenceError(errorText(cause)); }
  }
  async function upload(file?: File) {
    if (!file) return;
    setFileBusy(true); setUploadError('');
    try { const data = new FormData(); data.append('file', file); if (conversation) data.append('conversationId', conversation); const artifact = await api.post<Artifact>('/api/files', data); setGeneratedFiles(previous => [...previous, artifact]); await api.patch(`/api/inbox/${encodeURIComponent(currentItem.id)}`, { attachments: [...new Set([...(currentItem.attachments || []), artifact.id])] }); await ctx.refresh(); ctx.notify(t("File uploaded and attached"), 'success'); }
    catch (cause) { setUploadError(errorText(cause)); }
    finally { setFileBusy(false); if (uploadRef.current) uploadRef.current.value = ''; }
  }
  async function applyMessage(message: Message) {
    const result = await flow.perform('apply', () => api.patch(`/api/inbox/${encodeURIComponent(currentItem.id)}`, { draft: message.content, editedByUser: true, conversationId: message.conversationId }));
    if (result) ctx.notify(t("Conversation reply saved as your draft"), 'success');
  }
  async function updateMemory(action: 'add' | 'edit' | 'delete' | 'restore', memory?: Entity) {
    const text = action === 'edit' ? memoryEditText.trim() : memoryDraft.trim();
    if ((action === 'add' || action === 'edit') && !text) { setMemoryError(t("Enter a memory before saving.")); return; }
    setMemoryBusy(memory?.id || 'add'); setMemoryError('');
    try {
      if (action === 'add') await api.post('/api/memories', { title: text, content: text, body: text, entityId: currentItem.id, person: currentItem.sender, contextIds: [currentItem.id] });
      if (action === 'edit' && memory) await api.patch(`/api/memories/${encodeURIComponent(memory.id)}`, { title: text, content: text, body: text });
      if (action === 'delete' && memory) { await api.delete(`/api/memories/${encodeURIComponent(memory.id)}`); setForgottenMemory(memory); }
      if (action === 'restore' && memory) { await api.post(`/api/memories/${encodeURIComponent(memory.id)}/restore`, {}); setForgottenMemory(undefined); }
      await ctx.refresh(); setMemoryDraft(''); setEditingMemory('');
    } catch (cause) { setMemoryError(errorText(cause)); } finally { setMemoryBusy(''); }
  }
  return <main className="op-deep-layout"><div className="op-deep-content"><div className="op-detail-scroll"><button type="button" className="op-back-link" onClick={() => ctx.navigate(itemPath('inbox', item.id))}><ArrowLeft size={18}/>{t("Inbox")}</button><div className="op-person-header"><Avatar name={item.sender} large ai={item.origin === 'ai'}/><div><h1>{item.sender}</h1><span>{item.channel} · {dateText(item.createdAt, true, language)}</span></div><div className="op-person-tools"><button type="button" className="op-btn op-btn-secondary op-btn-xs" onClick={() => setMemoryOpen(true)}><BookOpen size={15}/>{t("Memory ·")} {memories.length}</button><ItemBadge item={item}/></div></div><OperationError error={detail.error}/><OperationError error={flow.error || (item.draftError ? String(item.draftError) : '')} action={<button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!flow.busy || isSendLocked(item)} onClick={() => void generate('chat')}>{t("Try with standard model")}</button>}/><OperationError error={uploadError}/>{detail.loading && <span role="status" className="op-footnote">{t("Reading the original message…")}</span>}<div className="op-card op-original-message op-deep-original"><div className="op-message-label"><span className="op-label">{t("Their message")}</span><button type="button" className="op-icon-btn" aria-label={t("Open full message")} title={t("Open full message")} onClick={() => setFullMessage(true)}><Maximize2 size={16}/></button></div><p>{item.body}</p><SourceAttachmentNotice item={item}/></div><DraftCard item={item} flow={flow} ctx={ctx} attachments={files} onRemove={id => changeAttachment(id, false)} onGenerate={() => void generate()}/><span className="op-footnote">{t("Deep Think uses this message and its connected context. The reply waits for your approval.")} <button type="button" className="op-inline-link" onClick={() => ctx.navigate('/autonomy')}>{t("Change this")}</button></span></div><ActionFooter><div className="op-main-actions op-deep-actions">{isDone(item) ? <><StatusBadge tone="green">{t(item.status)}</StatusBadge>{!isSendLocked(item) && <button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!flow.busy} onClick={() => flow.changeStatus('pending')}>{t("Reopen")}</button>}{['sent', 'delivered'].includes(item.status) && <button type="button" className="op-btn op-btn-blue op-btn-sm" onClick={() => ctx.navigate(itemPath('sent', item.id))}>{t("View receipt")}</button>}</> : <><button type="button" className="op-btn op-btn-blue op-btn-md" disabled={!!flow.busy || item.status === 'sending' || !item.draft || flow.editing || fileBusy || !item.isSelfTest || item.recipientId !== 'self' || ctx.state.settings.autonomy.holdSending || (!!item.attachments?.length && !canSendAttachments(ctx)) || (item.sensitive && !flow.sensitiveApproval)} onClick={flow.send}>{flow.busy === 'send' ? <LoaderCircle size={18} className="op-spin"/> : <Check size={18}/>} {flow.busy === 'send' || item.status === 'sending' ? t("Sending…") : item.status === 'send_unknown' ? t("Check send result") : item.status === 'send_failed' ? t("Retry failed send") : files.length ? t("Send with {0} attachments", files.length) : t("Send reply")}</button><button type="button" className="op-btn op-btn-secondary op-btn-md" disabled={!!flow.busy || isSendLocked(item)} onClick={flow.startEdit}>{t("Edit draft")}</button><button type="button" className="op-btn op-btn-purple op-btn-md" disabled={!!flow.busy || isSendLocked(item)} onClick={() => void generate()}><RotateCcw size={16}/>{flow.busy === 'generate' ? t("Thinking…") : t("Try another approach")}</button><button type="button" className="op-btn op-btn-ghost op-btn-md" disabled={!!flow.busy || isSendLocked(item)} onClick={() => flow.changeStatus('dismissed')}>{t("Dismiss")}</button></>}</div></ActionFooter></div>
    <aside aria-label={t("Chat with your twin")} className="op-deep-chat"><header><Avatar name="Your twin" ai/><div><strong>{t("Your twin")}</strong><span>{t("Deep Think · source-aware replies")}</span></div><button type="button" className="op-inline-link" onClick={() => ctx.navigate(`/chat?conversation=${encodeURIComponent(conversation)}&context=${encodeURIComponent(item.id)}`)}>{t("Open in Chat ›")}</button></header><div className="op-deep-thread" ref={threadRef}>
      <div className="op-twin-message"><Avatar name="Your twin" ai/><div><span className="op-label">{run ? `${run.status || t("Run recorded")}${duration(run, language)}` : item.draft ? t("Draft saved in your Inbox") : t("Ready to think this through")}</span>{run?.summary || run?.outputSummary ? <MarkdownText text={String(run.summary || run.outputSummary)}/> : <p>{item.draft ? t("Review the saved draft. Ask a follow-up here.") : t("Start Deep Think to review this message and save a reply for your approval.")}</p>}{!item.draft && <button type="button" className="op-btn op-btn-purple op-btn-sm" disabled={!!flow.busy || isSendLocked(item)} onClick={() => void generate()}><Sparkles size={15}/>{flow.busy === 'generate' ? t("Thinking…") : t("Start Deep Think")}</button>}<details className="op-run-evidence" open={evidenceExpanded} onToggle={event => setEvidenceExpanded(event.currentTarget.open)}><summary>{t("Steps & sources")}<ChevronRight size={14}/></summary><OperationError error={evidenceError}/><dl className="op-source-fields"><div><dt>{t("Message")}</dt><dd>{item.id}</dd></div><div><dt>{t("Source")}</dt><dd>{item.sourceId || t("Created in this workspace")}</dd></div>{run && <><div><dt>{t("Run")}</dt><dd>{run.id} · {t(run.status)}</dd></div>{run.model && <div><dt>{t("Model")}</dt><dd>{run.model}</dd></div>}{run.error && <div><dt>{t("Error")}</dt><dd>{String(run.error)}</dd></div>}</>}</dl>{runSteps(run).length ? <ol className="op-run-steps">{runSteps(run).map((step, index) => <li key={step.id || index}><strong>{step.title || step.name || step.tool || step.type || t("Step {0}", index + 1)}</strong><StatusBadge tone={/fail|error/.test(step.status || '') ? 'red' : 'grey'}>{step.status || t("Recorded")}</StatusBadge><p>{typeof step === 'string' ? step : step.summary || step.detail || step.message || shortText(JSON.stringify(step), 500)}</p></li>)}</ol> : <p className="op-footnote">{run ? t("This run did not include separate tool-step evidence.") : t("Run evidence will be available after generation.")}</p>}{relatedTasks.length > 0 && <div className="op-context-links"><strong>{t("Linked work")}</strong>{relatedTasks.map(task => <span key={task.id}>{task.title} · {t(task.status)}</span>)}</div>}<button type="button" className="op-inline-link" onClick={() => setFullMessage(true)}>{t("Open full context ›")}</button></details></div></div>
      {messages.map(message => <div key={message.id} data-message-id={message.id} className={message.role === 'user' ? 'op-user-bubble' : 'op-twin-message'}>{message.role === 'assistant' && <Avatar name="Your twin" ai/>}<div><MarkdownText text={message.content}/>{message.role === 'assistant' && <button type="button" className="op-btn op-btn-softblue op-btn-xs op-apply-draft" onClick={() => applyMessage(message)} disabled={!!flow.busy}>{t("Use in draft")}</button>}</div></div>)}
      {availableArtifacts.map(file => <div className="op-twin-message" key={file.id}><Avatar name="Your twin" ai/><div className="op-generated-result"><span className="op-generated-label">{t("Saved file from this conversation")}</span><ArtifactTile file={file} compact/><div className="op-generated-actions">{item.attachments?.includes(file.id) ? <StatusBadge tone="blue"><Check size={14}/>{t("Attached to draft")}</StatusBadge> : <button type="button" className="op-btn op-btn-blue op-btn-xs" disabled={!!flow.busy || isSendLocked(item)} onClick={() => changeAttachment(file.id, true)}><Paperclip size={14}/>{t("Attach to draft")}</button>}</div></div></div>)}
      {(chatBusy || flow.busy === 'generate' || fileBusy) && <div role="status" className="op-working"><LoaderCircle size={16} className="op-spin"/>{fileBusy ? t("Creating file…") : t("Your twin is thinking…")}</div>}
      <OperationError error={chatError} action={!chatBlocked && <button type="button" className="op-btn op-btn-secondary op-btn-sm" aria-label={t("Try this follow-up with standard model")} disabled={chatBusy || fileBusy || !messageDraft.trim()} onClick={() => void followUp('chat')}>{t("Try with standard model")}</button>}/>{chatError && <div className="op-chat-error-actions">{(chatErrorRunId || run?.id) && <button type="button" className="op-inline-link" onClick={reviewChatRun}>{t("View run")}</button>}<button type="button" className="op-inline-link" onClick={() => ctx.navigate(`/activity?entity=${encodeURIComponent(conversation || item.id)}`)}>{t("Review activity")}</button>{chatErrorCode === 'partial_run_requires_review' && <span className="op-footnote">{t("Completed writes require review. Change the request only when you are ready to continue.")}</span>}{['request_in_progress', 'conversation_busy'].includes(chatErrorCode) && <span className="op-footnote">{t("The original run is still recorded. Check its result before retrying.")}</span>}</div>}
    </div><div className="op-deep-composer"><div className="op-composer-tools"><button type="button" className="op-icon-btn" aria-label={t("Upload an attachment")} title={t("Upload an attachment")} onClick={() => uploadRef.current?.click()} disabled={fileBusy || isSendLocked(item)}><Upload size={15}/></button><input ref={uploadRef} type="file" hidden aria-label={t("Choose attachment file")} onChange={event => upload(event.target.files?.[0])}/></div><form className="op-side-input" onSubmit={event => { event.preventDefault(); void followUp(); }}><textarea rows={2} aria-label={t("Message your twin")} placeholder={t("Ask a follow-up or change the draft…")} value={messageDraft} onChange={event => { setMessageDraft(event.target.value); if (event.target.value.trim() !== chatRequest.current?.message) { setChatErrorCode(''); setChatError(''); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void followUp(); } }} disabled={chatBusy || fileBusy}/><button type="submit" className={'op-send-round'} aria-label={t("Send follow-up")} disabled={chatBusy || fileBusy || (chatBlocked || !messageDraft.trim())}>{<ArrowUp size={17}/>}</button></form></div></aside>
    {fullMessage && <OperationModal title={t("Message from {0}", item.sender)} wide onClose={() => setFullMessage(false)}><div className="op-person-header"><Avatar name={item.sender} large/><div><h1>{item.sender}</h1><span>{item.channel} · {dateText(item.createdAt, false, language)}</span></div></div><span className="op-label">{t("Subject:")} {item.title}</span><p className="op-full-body">{item.body}</p><details className="op-context-expanded" open><summary>{t("Original context & provenance")}</summary><dl className="op-source-fields"><div><dt>{t("Message ID")}</dt><dd>{item.id}</dd></div><div><dt>{t("Source ID")}</dt><dd>{item.sourceId || t("Created in this workspace")}</dd></div><div><dt>{t("Origin")}</dt><dd>{item.origin} · {item.testMarker || item.channel}</dd></div><div><dt>{t("Linked IDs")}</dt><dd>{item.context?.join(', ') || t("None recorded")}</dd></div></dl>{item.sourceContext && <pre className="op-code">{typeof item.sourceContext === 'string' ? item.sourceContext : JSON.stringify(item.sourceContext, null, 2)}</pre>}{relatedTasks.map(task => <div className="op-context-task" key={task.id}><strong>{task.title}</strong><span>{t(task.status)} · {task.id}</span>{task.notes && <p>{task.notes}</p>}</div>)}</details><div className="op-modal-actions"><button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={() => setFullMessage(false)}>{t("Close")}</button></div></OperationModal>}
    {memoryOpen && <OperationModal title={t("What your twin remembers about {0}", item.sender)} onClose={() => setMemoryOpen(false)}><p className="op-modal-intro">{t("Saved in this workspace and linked to this message. Your twin can use these facts when replying.")}</p><OperationError error={memoryError}/>{memories.map(memory => <div className="op-memory-row" key={memory.id}>{editingMemory === memory.id ? <><input aria-label={t("Edit this memory")} value={memoryEditText} onChange={event => setMemoryEditText(event.target.value)}/><button type="button" className="op-btn op-btn-blue op-btn-xs" disabled={!!memoryBusy} onClick={() => updateMemory('edit', memory)}>{t("Save")}</button><button type="button" className="op-icon-btn" aria-label={t("Cancel memory edit")} onClick={() => setEditingMemory('')}><X size={15}/></button></> : <><span>{memoryText(memory)}</span><button type="button" className="op-icon-btn" aria-label={t("Edit memory: {0}", memoryText(memory))} onClick={() => { setEditingMemory(memory.id); setMemoryEditText(memoryText(memory)); }}><Pencil size={15}/></button><button type="button" className="op-icon-btn" aria-label={t("Forget memory: {0}", memoryText(memory))} disabled={!!memoryBusy} onClick={() => updateMemory('delete', memory)}><X size={15}/></button></>}</div>)}{!memories.length && <p className="op-footnote">{t("No person-specific memories are recorded yet.")}</p>}{forgottenMemory && <div className="op-undo-memory"><span>{t("Memory removed.")}</span><button type="button" className="op-inline-link" disabled={!!memoryBusy} onClick={() => updateMemory('restore', forgottenMemory)}>{t("Undo")}</button></div>}<form className="op-new-memory" onSubmit={event => { event.preventDefault(); void updateMemory('add'); }}><input aria-label={t("Add a memory about {0}", item.sender)} placeholder={t("Add something your twin should remember")} value={memoryDraft} onChange={event => setMemoryDraft(event.target.value)}/><button type="submit" className="op-btn op-btn-secondary op-btn-sm" disabled={!!memoryBusy}>{t("Add")}</button></form><div className="op-modal-actions op-memory-footer"><button type="button" className="op-inline-link" onClick={() => { setMemoryOpen(false); ctx.navigate('/settings/identity'); }}>{t("Open memory settings ›")}</button><button type="button" className="op-btn op-btn-blue op-btn-sm" onClick={() => setMemoryOpen(false)}>{t("Done")}</button></div></OperationModal>}
  </main>;
}
