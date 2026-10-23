import { useI18n, translate } from '../domain/i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Lightbulb, LoaderCircle, Pencil, Play, Plus, Sparkles } from 'lucide-react';
import type { Artifact, Automation, Idea, InboxItem, Task, UIContext } from '../../../shared/types';
import { api, ApiError } from '../domain/api';
import { ArtifactTile, Empty, errorText, itemPath, operationErrorSummary, OperationError, OperationModal, StatusBadge } from './Inbox';
import './operations.css';

type Execution = { idea: Idea; task?: Task; automation?: Automation; artifact?: Artifact; inbox?: InboxItem; run?: any };
type ThinkMemory = { prompt?: string; runId?: string; error?: string };
const thinkStorageKey = 'opsadv-ideas-last-think';
function readSavedThink(): ThinkMemory { try { return JSON.parse(sessionStorage.getItem(thinkStorageKey) || '{}'); } catch { return {}; } }
const categories = ['All', 'Automate', 'Customers', 'Meetings', 'Follow-ups'];
function categoryLabel(category: string) {
  const value = category.toLowerCase();
  if (/automat|schedule|report/.test(value)) return 'Automate';
  if (/customer|client/.test(value)) return 'Customers';
  if (/meeting|calendar/.test(value)) return 'Meetings';
  if (/follow|promise|task/.test(value)) return 'Follow-ups';
  return category || 'Work';
}
function actionLabel(idea: Idea) {
  if (idea.actionLabel) return String(idea.actionLabel);
  const text = `${idea.action} ${idea.title} ${idea.category}`.toLowerCase();
  if (/automat|schedule/.test(text)) return 'Set it up';
  if (/article|document|file/.test(text)) return 'Draft article';
  if (/meeting|suggest/.test(text)) return 'Draft suggestion';
  if (/follow|promise/.test(text)) return 'Review them';
  return 'Draft it';
}
function storedResult(idea: Idea, ctx: UIContext): Execution | undefined {
  const stored = idea.result || {};
  const task = ctx.state.tasks.find(entity => entity.id === idea.taskId || entity.id === stored.task?.id || entity.ideaId === idea.id);
  const automation = ctx.state.automations.find(entity => entity.id === idea.automationId || entity.id === stored.automation?.id || entity.ideaId === idea.id);
  const artifact = ctx.state.artifacts.find(entity => entity.id === automation?.lastResult?.artifactId || automation?.lastArtifactIds?.includes(entity.id) || entity.id === idea.artifactId || entity.id === stored.artifact?.id || entity.ideaId === idea.id);
  const inbox = ctx.state.inbox.find(entity => entity.id === automation?.lastResult?.inboxId || entity.id === automation?.lastInboxId || entity.id === idea.inboxId || entity.id === stored.inbox?.id || entity.ideaId === idea.id);
  const run = automation?.lastRunId ? { id: automation.lastRunId, status: automation.status } : stored.run;
  return task || automation || artifact || inbox || idea.result ? { idea, ...stored, task: task || stored.task, automation: automation || stored.automation, artifact: artifact || stored.artifact, inbox: inbox || stored.inbox, run } : undefined;
}

export default function Page({ ctx }: { ctx: UIContext }) { const { t, language } = useI18n();
  const [prompt, setPrompt] = useState(() => readSavedThink().prompt || '');
  const [category, setCategory] = useState('All');
  const [showDeferred, setShowDeferred] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(() => readSavedThink().error || '');
  const [failedThink, setFailedThink] = useState<{ prompt: string; runId?: string } | undefined>(() => { const saved = readSavedThink(); return saved.error && saved.prompt ? { prompt: saved.prompt, runId: saved.runId } : undefined; });
  const [thinkRun, setThinkRun] = useState<any>();
  const pending = useRef(false);
  const [results, setResults] = useState<Record<string, Execution>>({});
  const loadedRuns = useRef(new Set<string>());
  const [creating, setCreating] = useState(false);
  const [readingIdea, setReadingIdea] = useState<Idea>();
  const [editingIdea, setEditingIdea] = useState<Idea>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newCategory, setNewCategory] = useState('Automate');
  const [newAction, setNewAction] = useState('task');
  const [newSchedule, setNewSchedule] = useState('daily 09:00');
  const displayCategory = (label: string) => (categories.includes(label) || ['insight', 'productivity'].includes(label)) ? t(label) : label;
  const labels = [...new Set([...categories, ...ctx.state.ideas.map(idea => categoryLabel(idea.category))])];
  const visible = ctx.state.ideas.filter(idea => (showDeferred ? ['deferred', 'dismissed', 'archived', 'merged', 'executed', 'completed'].includes(idea.status) : !['deferred', 'dismissed', 'archived', 'merged', 'executed', 'completed'].includes(idea.status)) && (category === 'All' || categoryLabel(idea.category) === category));
  useEffect(() => {
    if (thinkRun) return;
    const runId = readSavedThink().runId || ctx.state.ideas.find(idea => idea.runId)?.runId;
    if (!runId) return;
    let cancelled = false;
    void api.get<any>(`/api/runs/${encodeURIComponent(runId)}`).then(value => { if (!cancelled) setThinkRun(value); }).catch(cause => { if (!cancelled) setError(t("Could not read the saved idea run: {0}", errorText(cause))); });
    return () => { cancelled = true; };
  }, [ctx.state.revision, thinkRun?.id]);
  useEffect(() => {
    for (const idea of ctx.state.ideas) {
      const saved = storedResult(idea, ctx);
      const automation = saved?.automation;
      const runId = automation?.lastRunId;
      if (!automation || !runId || loadedRuns.current.has(runId)) continue;
      loadedRuns.current.add(runId);
      void api.get<any>(`/api/runs/${encodeURIComponent(runId)}`).then(run => {
        const artifact = ctx.state.artifacts.find(file => run.artifactIds?.includes(file.id));
        const inbox = ctx.state.inbox.find(item => item.runId === runId && item.automationId === automation.id);
        setResults(previous => ({ ...previous, [idea.id]: { ...saved, ...previous[idea.id], idea, automation, artifact: artifact || saved?.artifact, inbox: inbox || saved?.inbox, run } }));
      }).catch(cause => { loadedRuns.current.delete(runId); setError(t("Could not load the saved automation result: {0}", errorText(cause))); });
    }
  }, [ctx.state.revision]);
  async function act<T>(id: string, operation: () => Promise<T>, message?: string) {
    if (busy || pending.current) return;
    pending.current = true; setBusy(id); setError('');
    try { const result = await operation(); await ctx.refresh(); if (message) ctx.notify(t(message), 'success'); return result; }
    catch (cause) { setError(errorText(cause)); ctx.notify(t(operationErrorSummary(errorText(cause))), 'error'); }
    finally { pending.current = false; setBusy(''); }
  }
  async function think(mode: 'deep' | 'chat' = 'deep') {
    if (busy || pending.current) return;
    const text = mode === 'chat' && failedThink ? failedThink.prompt : prompt.trim();
    if (!text) { setError(t("Tell your twin what you would like to improve.")); return; }
    pending.current = true; setBusy('think'); setError('');
    sessionStorage.setItem(thinkStorageKey, JSON.stringify({ prompt: text, ...(failedThink?.runId ? { runId: failedThink.runId } : {}) }));
    try {
      const result = await api.post<{ ideas: Idea[]; run: any }>('/api/ideas/think', { prompt: text, mode, ...(mode === 'chat' && failedThink?.runId ? { retryOfRunId: failedThink.runId } : {}) });
      sessionStorage.setItem(thinkStorageKey, JSON.stringify({ runId: result.run.id })); setThinkRun(result.run); setFailedThink(undefined); await ctx.refresh(); setPrompt(''); setShowDeferred(false); setCategory('All'); ctx.notify(t("Ideas are ready for your review"), 'success');
    } catch (cause) {
      const data = cause instanceof ApiError ? cause.data : undefined;
      const failedRun = data?.detail?.run || data?.run;
      const runId = failedRun?.id || data?.detail?.runId || data?.runId;
      sessionStorage.setItem(thinkStorageKey, JSON.stringify({ prompt: text, runId, error: errorText(cause) }));
      setFailedThink({ prompt: text, runId }); if (failedRun) setThinkRun(failedRun);
      setError(errorText(cause)); ctx.notify(t(operationErrorSummary(errorText(cause))), 'error');
      try { await ctx.refresh(); } catch { /* Preserve the original model failure. */ }
    } finally { pending.current = false; setBusy(''); }
  }
  async function execute(idea: Idea) {
    const result = await act(idea.id, () => api.post<Execution>(`/api/ideas/${encodeURIComponent(idea.id)}/execute`, { action: idea.action, ...(idea.action === 'automation' ? { enabled: true, schedule: idea.schedule || 'daily 09:00' } : {}) }), t("Idea executed. Review its saved result below."));
    if (result) setResults(previous => ({ ...previous, [idea.id]: result }));
  }
  async function defer(idea: Idea) {
    await act(`defer:${idea.id}`, () => api.patch(`/api/ideas/${encodeURIComponent(idea.id)}`, { status: showDeferred ? 'proposed' : 'deferred' }), showDeferred ? t("Idea restored") : t("Saved for later"));
  }
  function openEditor(idea?: Idea) { setEditingIdea(idea); setTitle(idea?.title || ''); setDescription(idea?.description || ''); setNewCategory(categoryLabel(idea?.category || 'Automate')); setNewAction(idea?.action || 'task'); setNewSchedule(idea?.schedule || 'daily 09:00'); setError(''); setCreating(true); }
  async function create() {
    if (!title.trim() || !description.trim()) { setError(t("Add a title and a description.")); return; }
    const payload = { title: title.trim(), description: description.trim(), category: newCategory, action: newAction, ...(newAction === 'automation' ? { schedule: newSchedule.trim() } : {}) };
    const result = await act('create', () => editingIdea ? api.patch<Idea>(`/api/ideas/${encodeURIComponent(editingIdea.id)}`, payload) : api.post<Idea>('/api/ideas', { ...payload, status: 'proposed', origin: 'human' }), editingIdea ? t("Idea updated") : t("Idea created"));
    if (result) { setCreating(false); setTitle(''); setDescription(''); setCategory('All'); setShowDeferred(false); }
  }
  return <main className="op-page op-ideas-page"><header className="op-page-header"><div><h1>{t("Ideas")}</h1><p>{t("Your twin notices patterns in your work and suggests ways to save time. Nothing happens until you say so.")}</p></div><button type="button" className="op-icon-btn op-create-idea" aria-label={t("Create an idea")} title={t("Create an idea")} onClick={() => openEditor()}><Plus size={20}/></button></header>
    <form className="op-ideas-prompt" onSubmit={event => { event.preventDefault(); void think(); }}><Sparkles size={18}/><input aria-label={t("Ask your twin for ideas")} placeholder={t("How can I spend less time on reporting?")} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy === 'think'}/><button type="submit" className="op-btn op-btn-violet" disabled={!!busy}>{busy === 'think' ? <LoaderCircle size={16} className="op-spin"/> : null}{busy === 'think' ? t("Thinking…") : t("Think")}</button></form>
    <OperationError error={!creating ? error : ''} action={failedThink && <button type="button" className="op-btn op-btn-secondary op-btn-sm" disabled={!!busy} onClick={() => void think('chat')}>{t("Try with standard model")}</button>}/>{thinkRun && <details className="op-think-evidence"><summary>{t("Idea run ·")} {t(String(thinkRun.status || ''))} · {thinkRun.model || t("Recorded model")}</summary><pre>{JSON.stringify(thinkRun, null, 2)}</pre></details>}<div className="op-filter-bar"><div className="op-filters">{labels.map(label => <button type="button" key={label} className={`op-chip${category === label ? ' active' : ''}`} aria-pressed={category === label} onClick={() => setCategory(label)}>{displayCategory(label)}</button>)}</div><button type="button" className="op-btn op-btn-link op-btn-xs" aria-pressed={showDeferred} onClick={() => setShowDeferred(!showDeferred)}>{showDeferred ? t("Show active ideas") : t("Saved for later")}<ChevronDown size={14}/></button></div>
    <div className="op-idea-grid">{visible.map(idea => {
      const label = categoryLabel(idea.category);
      const stored = storedResult(idea, ctx);
      const local = results[idea.id];
      const result = local ? { ...local, ...stored, artifact: stored?.artifact || local.artifact, inbox: stored?.inbox || local.inbox, run: local.run?.id === stored?.automation?.lastRunId ? local.run : stored?.run || local.run } : stored;
      const completed = ['executed', 'completed', 'done', 'active', 'scheduled'].includes(idea.status) || !!result;
      return <article key={idea.id} className="op-idea-card" aria-label={t("Idea: {0}", idea.title)}><div className="op-idea-card-header"><StatusBadge tone={label === 'Automate' ? 'blue' : label === 'Customers' ? 'amber' : label === 'Meetings' ? 'purple' : 'grey'}>{displayCategory(label)}</StatusBadge><button type="button" className="op-icon-btn" aria-label={t("Edit idea: {0}", idea.title)} onClick={() => openEditor(idea)}><Pencil size={14}/></button></div><h2>{idea.title}</h2><p className="op-idea-description">{idea.description}</p>{idea.description.length > 260 && <button type="button" className="op-inline-link op-idea-read-more" aria-label={t("Read full idea: {0}", idea.title)} onClick={() => setReadingIdea(idea)}>{t("Read more")}</button>}<span className="op-idea-benefit">{idea.benefit || idea.impact || (completed ? t("Status: {0}", t(idea.status)) : idea.sourceId ? t("Source: {0}", idea.sourceId) : t("Ready for your review"))}</span>
        {result && <div className="op-idea-result"><strong><Check size={14}/>{t("Saved result")}</strong>{result.automation && <div className="op-result-row"><span>{result.automation.title}<small>{result.automation.schedule} · {result.automation.enabled ? t("Scheduled") : t("Paused")}{result.automation.nextRun ? t(" · Next {0}", new Date(result.automation.nextRun).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-SG')) : ''}</small></span><button type="button" className="op-btn op-btn-link op-btn-xs" disabled={!!busy} onClick={async () => { const runResult = await act<any>(`run:${idea.id}`, () => api.post(`/api/automations/${encodeURIComponent(result.automation!.id)}/run`, {}), 'Automation run completed'); if (runResult) setResults(previous => ({ ...previous, [idea.id]: { ...result, automation: runResult.automation, artifact: runResult.artifact || result.artifact, inbox: runResult.item || result.inbox, run: runResult.run } })); }}><Play size={12}/>{busy === `run:${idea.id}` ? t("Running…") : t("Run")}</button><button type="button" className="op-btn op-btn-link op-btn-xs" disabled={!!busy} onClick={async () => { const automation = await act<Automation>(`schedule:${idea.id}`, () => api.patch(`/api/automations/${encodeURIComponent(result.automation!.id)}`, { enabled: !result.automation!.enabled }), result.automation!.enabled ? 'Automation paused' : 'Automation resumed'); if (automation) setResults(previous => ({ ...previous, [idea.id]: { ...result, automation } })); }}>{busy === `schedule:${idea.id}` ? t("Saving…") : result.automation.enabled ? t("Pause") : t("Resume")}</button></div>}{result.task && <div className="op-result-row"><span>{result.task.title}<small>{t("Task ·")} {t(result.task.status)}</small></span><button type="button" className="op-btn op-btn-link op-btn-xs" onClick={() => ctx.navigate(`/tasks?task=${encodeURIComponent(result.task!.id)}`)}>{t("Review")}<ArrowRight size={12}/></button></div>}{result.inbox && <button type="button" className="op-btn op-btn-link op-btn-xs" onClick={() => ctx.navigate(itemPath('deep-think', result.inbox!.id))}>{t("Review reply draft")}<ArrowRight size={12}/></button>}{result.artifact && <ArtifactTile file={result.artifact} compact/>}{result.run && <span className="op-footnote">{t("Run")} {result.run.id} · {t(result.run.status)}</span>}</div>}
        <div className="op-idea-actions">{showDeferred ? <button type="button" className="op-btn op-btn-blue op-btn-sm" disabled={!!busy} onClick={() => defer(idea)}>{t("Restore idea")}</button> : <><button type="button" className="op-btn op-btn-blue op-btn-sm" disabled={!!busy || completed} onClick={() => execute(idea)}>{busy === idea.id ? t("Working…") : completed ? t("Done") : idea.actionLabel ? String(idea.actionLabel) : t(actionLabel(idea))}</button><button type="button" className="op-btn op-btn-ghost op-btn-sm" disabled={!!busy} onClick={() => defer(idea)}>{t("Not now")}</button></>}</div></article>;
    })}</div>{!visible.length && <Empty title={showDeferred ? t("No ideas saved for later") : category === 'All' ? t("No ideas yet") : t("No {0} ideas", language === 'zh-CN' ? displayCategory(category) : category.toLowerCase())}>{showDeferred ? t("Deferred ideas can be restored here.") : t("Ask your twin a question or create an idea using your own work context.")}</Empty>}
    {readingIdea && <OperationModal title={t("Idea details")} wide onClose={() => setReadingIdea(undefined)}><h3>{readingIdea.title}</h3><p className="op-prewrap">{readingIdea.description}</p><span className="op-footnote">{readingIdea.runId ? t("Generated by recorded run {0}", readingIdea.runId) : t("Created in this workspace")}</span><div className="op-modal-actions"><button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={() => setReadingIdea(undefined)}>{t("Close")}</button></div></OperationModal>}
    {creating && <OperationModal title={editingIdea ? t("Edit idea") : t("Create an idea")} onClose={() => setCreating(false)}><OperationError error={error}/><label className="op-field">{t("Title")}<input aria-label={t("Idea title")} value={title} onChange={event => setTitle(event.target.value)}/></label><label className="op-field">{t("Description")}<textarea aria-label={t("Idea description")} rows={4} value={description} onChange={event => setDescription(event.target.value)}/></label><div className="op-two-fields"><label className="op-field">{t("Category")}<select aria-label={t("Idea category")} value={newCategory} onChange={event => setNewCategory(event.target.value)}>{categories.slice(1).map(label => <option key={label} value={label}>{displayCategory(label)}</option>)}</select></label><label className="op-field">{t("Action")}<select aria-label={t("Idea action")} disabled={!!editingIdea?.result} value={newAction} onChange={event => setNewAction(event.target.value)}><option value="task">{t("Create task")}</option><option value="automation">{t("Set up automation")}</option><option value="draft">{t("Create reply draft")}</option><option value="file">{t("Draft article")}</option></select></label></div>{newAction === 'automation' && <label className="op-field">{t("Schedule")}<input aria-label={t("Idea automation schedule")} value={newSchedule} onChange={event => setNewSchedule(event.target.value)}/><span className="op-footnote">{t("Examples: daily 09:00, weekly monday 09:00, every 30 minutes")}</span></label>}<p className="op-footnote">{t("Execution saves a task, a scheduled automation, a file or a draft for approval. Drafts do not send messages.")}</p><div className="op-modal-actions"><button type="button" className="op-btn op-btn-secondary op-btn-sm" onClick={() => setCreating(false)} disabled={!!busy}>{t("Cancel")}</button><button type="button" className="op-btn op-btn-blue op-btn-sm" onClick={create} disabled={!!busy}>{busy === 'create' ? t("Saving…") : editingIdea ? t("Save changes") : t("Create idea")}</button></div></OperationModal>}
  </main>;
}
