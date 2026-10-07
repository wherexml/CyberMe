import Models from './Models';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageCircle, Inbox as InboxIcon, Settings, ArrowUp, Copy, Check, PanelLeft, RefreshCw, ChevronLeft, Sun, Moon, FileText } from 'lucide-react';
import { marked } from 'marked';
import { request, loadLocal, persist, currentLocal, listItems, enc, Intent, PilotError, browserPreview } from './runtime';
import type { ModelSettings, ModelSelection } from '../../../shared/model-settings';
import './pilot.css';
import { ProviderEditor } from './ProviderEditor';
import { needsInboxAttention } from '../../../shared/inbox-surfacing';
function SafeMarkdown({ text }: {
    text: string;
}) {
    const parsed = marked.parse(text, { async: false }) as string;
    const doc = new DOMParser().parseFromString(parsed, 'text/html');
    const allowed = new Set(['P', 'BR', 'STRONG', 'EM', 'DEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'HR', 'A']);
    for (const node of [...doc.body.querySelectorAll('*')]) {
        if (!allowed.has(node.tagName)) {
            node.replaceWith(document.createTextNode(node.textContent || ''));
            continue;
        }
        for (const a of [...node.attributes])
            node.removeAttribute(a.name);
    }
    // Links remain readable text until explicit safe external-opening support is qualified.
    return <div className="markdown" dangerouslySetInnerHTML={{ __html: doc.body.innerHTML }}/>;
}
function ErrorLine({ error, retry }: {
    error: string;
    retry?: () => void;
}) { return error ? <div role="alert" className="error">{error}{retry && <button onClick={retry}>重试</button>}</div> : null; }
function App() {
    const [page, setPage] = useState('chat'), [ready, setReady] = useState(false), [error, setError] = useState(''), [theme, setTheme] = useState('light');
    async function init() { try {
        const state = await loadLocal();
        setTheme(state.theme);
        setReady(true);
        setError('');
    }
    catch (e) {
        setError(String((e as Error).message));
    } }
    useEffect(() => { void init(); }, []);
    async function toggleTheme() { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); try {
        await persist(s => { s.theme = next; });
    }
    catch (e) {
        setError('本机偏好保存失败：' + (e as Error).message);
    } }
    return <div className={'desktop ' + theme}><aside className="rail"><div className="window-drag"/><nav>{[["chat", "对话", MessageCircle], ["inbox", "收件箱", InboxIcon]].map(([id, label, Icon]: any) => <button key={id} title={label} aria-label={label} aria-pressed={page === id} onClick={() => setPage(id)}><Icon /></button>)}</nav><footer><button aria-label="切换主题" onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</button><button aria-label="模型设置" aria-pressed={page === 'models'} onClick={() => setPage('models')}><Settings /></button></footer></aside><main>{browserPreview && <div className="preview-notice">公开布局预览 · 与 MyGO 共用组件和样式 · 真实操作请在 App 内执行</div>}<ErrorLine error={error} retry={() => void init()}/>{ready ? <><section hidden={page !== 'chat'}><Chat active={page === 'chat'}/></section><section hidden={page !== 'inbox'}><Inbox active={page === 'inbox'}/></section><section hidden={page !== 'models'}><Models active={page === 'models'}/></section></> : <p className="empty">正在读取本机状态…</p>}</main></div>;
}
function Chat({ active }: {
    active: boolean;
}) {
    const [convs, setConvs] = useState<any[]>([]), [cid, setCid] = useState(''), [messages, setMessages] = useState<any[]>([]), [draft, setDraft] = useState(''), [error, setError] = useState(''), [side, setSide] = useState(false), [pending, setPending] = useState<Intent[]>([]), [copy, setCopy] = useState(''), [record, setRecord] = useState<any>(null), [preparing, setPreparing] = useState(false);
    const owner = useRef(''), draftRef = useRef(''), generation = useRef(0), mounted = useRef(true), copyGeneration = useRef(0);
    const ramDrafts = useRef<Record<string, string>>({});
    const syncing = useRef(false);
    const runningPosts = useRef(new Set<string>());
    useEffect(() => () => { mounted.current = false; }, []);
    function updateDraft(value: string) { draftRef.current = value; setDraft(value); if (owner.current) {
        const key = 'chat:' + owner.current;
        ramDrafts.current[owner.current] = value;
        void persist(s => { s.drafts[key] = value; }).catch(e => setError('草稿尚未保存：' + e.message));
    } }
    async function select(id: string) { const gen = ++generation.current; owner.current = id; setCid(id); setMessages([]); const text = ramDrafts.current[id] ?? currentLocal().drafts['chat:' + id] ?? ''; draftRef.current = text; setDraft(text); setError(''); try {
        const rows = await request('GET', `/api/conversations/${enc(id)}/messages?limit=100`);
        if (gen === generation.current)
            setMessages(listItems(rows));
    }
    catch (e) {
        if (gen === generation.current)
            setError((e as Error).message);
    } }
    async function init() { try {
        const [primary, list] = await Promise.all([request('GET', '/api/conversations/primary'), request('GET', '/api/conversations?limit=200')]);
        setConvs(listItems(list));
        if (!owner.current && primary.conversationId)
            await select(primary.conversationId);
        else if (!owner.current)
            setError('此工作区没有主会话');
    }
    catch (e) {
        setError((e as Error).message);
    } }
    async function sync() {
        if (!owner.current || syncing.current)
            return;
        syncing.current = true;
        const id = owner.current, gen = generation.current;
        try {
            const [rows, unresolved] = await Promise.all([request('GET', `/api/conversations/${enc(id)}/messages?limit=100`), request('GET', `/api/chat/conversations/${enc(id)}/unresolved?limit=100`)]);
            if (!Array.isArray(unresolved.items) || unresolved.conversationId !== id)
                throw Error('运行回查响应不匹配');
            const local = Object.values(currentLocal().requests).filter(v => v.kind === 'chat' && v.owner === id);
            const found: Intent[] = [];
            for (const intent of local) {
                try {
                    const state = await request('GET', '/api/chat/requests/' + enc(intent.id));
                    if (state.status !== intent.status)
                        await persist(s => { if (s.requests[intent.id])
                            s.requests[intent.id].status = state.status; });
                    if (!['succeeded', 'cancelled'].includes(state.status))
                        found.push({ ...intent, status: state.status });
                }
                catch {
                    found.push({ ...intent, status: 'unknown' });
                }
            }
            for (const r of unresolved.items)
                if (!found.some(x => x.id === r.requestId))
                    found.push({ id: r.requestId, kind: 'chat', owner: id, status: r.status, body: {} });
            if (gen === generation.current && mounted.current) {
                setMessages(listItems(rows));
                setPending(found);
                setError(unresolved.hasMore ? '还有未加载的未确认运行，完整分页恢复尚未接入' : '');
            }
        }
        catch (e) {
            if (gen === generation.current) {
                setError((e as Error).message);
                setPending(p => p.map(v => ({ ...v, status: 'unknown' })));
            }
        }
        finally {
            syncing.current = false;
        }
    }
    useEffect(() => { if (active) {
        void init();
        void sync();
        const timer = setInterval(() => void sync(), 1800);
        return () => clearInterval(timer);
    } }, [active]);
    async function post(intent: Intent) { if (runningPosts.current.has(intent.id))
        return; runningPosts.current.add(intent.id); try {
        await request('POST', '/api/chat', intent.body);
    }
    catch (e) {
        if (owner.current === intent.owner)
            setError('结果未确认，请回查原请求：' + (e as Error).message);
    }
    finally {
        runningPosts.current.delete(intent.id);
        void sync();
    } }
    async function send() {
        if(browserPreview){setError("这是只读布局预览，请在 MyGO App 中执行真实操作");return;}
        if (!cid || !draft.trim() || preparing)
            return;
        setPreparing(true);
        const id = cid, text = draftRef.current;
        const intent: Intent = { id: crypto.randomUUID(), kind: 'chat', owner: id, status: 'prepared', body: { requestId: '', conversationId: id, message: text, mode: 'chat', contextIds: [], preservePrimary: true, interruptCurrent: true, readOnly: true } };
        intent.body.requestId = intent.id;
        try {
            await persist(s => { s.requests[intent.id] = intent; s.drafts['chat:' + id] = text; });
            if (owner.current === id && draftRef.current === text) {
                draftRef.current = '';
                ramDrafts.current[id] = '';
                setDraft('');
                await persist(s => { if (s.drafts['chat:' + id] === text)
                    s.drafts['chat:' + id] = ''; });
            }
            setPending(p => [...p, intent]);
            void post(intent);
        }
        catch (e) {
            if (owner.current === id && !draftRef.current) {
                draftRef.current = text;
                ramDrafts.current[id] = text;
                setDraft(text);
            }
            setError('本机保存失败，未发送：' + (e as Error).message);
        }
        finally {
            setPreparing(false);
        }
    }
    async function retry(intent: Intent) { try {
        await request('GET', '/api/chat/requests/' + enc(intent.id));
        await sync();
    }
    catch (e) {
        if (e instanceof PilotError && e.status === 404 && intent.body.requestId) {
            void post(intent);
        }
        else
            setError('无法确认原请求，未重发');
    } }
    async function create() { const id = currentLocal().drafts['side-create-id'] || 'ui-side-' + crypto.randomUUID(); try {
        await persist(s => { s.drafts['side-create-id'] = id; });
        const c = await request('POST', '/api/conversations/side', { id, title: '新会话' });
        await persist(s => { delete s.drafts['side-create-id']; });
        await init();
        await select(c.conversation?.id || c.conversationId || c.id);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    async function showRecord(message: any) { try {
        const m = await request('GET', '/api/messages/' + enc(message.id));
        setRecord(m.runId ? await request('GET', '/api/runs/' + enc(m.runId)) : m);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    return <div className="chat-layout">{side && <aside className="sessions"><button onClick={() => void create()}>新会话</button>{convs.map(c => <button key={c.id} aria-pressed={c.id === cid} onClick={() => void select(c.id)}>{c.title || '会话'}</button>)}</aside>}<div className="chat-column"><header className="chat-head"><button aria-label="会话" onClick={() => setSide(!side)}><PanelLeft /> 会话</button><button aria-label="刷新对话" onClick={() => void init().then(sync)}><RefreshCw /></button></header><div className="timeline"><div className="reading">{messages.map(m => <article key={m.id} className={'message ' + m.role}><div className="bubble"><SafeMarkdown text={m.content || ''}/><div className="message-actions"><button aria-label="复制消息" onClick={async () => { try {
        await navigator.clipboard.writeText(m.content || '');
        const gen = ++copyGeneration.current;
        setCopy(m.id);
        setTimeout(() => { if (gen === copyGeneration.current)
            setCopy(''); }, 2000);
    }
    catch {
        setError('复制失败');
    } }}>{copy === m.id ? <Check className="copied"/> : <Copy />}</button><button aria-label="执行记录" onClick={() => void showRecord(m)}><FileText /></button></div></div></article>)}{!messages.length && <p className="empty">没有已保存消息</p>}</div></div><div className="composer-wrap"><ErrorLine error={error} retry={() => void sync()}/>{pending.map(p => <div className="recovery" key={p.id}>{p.status === 'running' ? <span className="running" aria-label="正在回复">● ● ●</span> : p.status === 'partial' ? '部分完成，请查看记录；不能重试' : p.status === 'failed' ? '请求失败' : '请求未确认'} <button onClick={() => void request('GET', '/api/chat/requests/' + enc(p.id)).then(setRecord).catch(e => setError(e.message))}>记录</button>{p.status === 'unknown' && !!p.body.requestId && <button onClick={() => void retry(p)}>回查／原请求重试</button>}</div>)}<div className="composer"><textarea aria-label="消息" value={draft} rows={Math.min(6, Math.max(1, draft.split('\n').length))} placeholder="输入消息…" onChange={e => updateDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        void send();
    } }}/><button aria-label="发送消息" disabled={preparing || !draft.trim() || !cid} onClick={() => void send()}><ArrowUp /></button></div></div></div>{record && <div className="record" role="dialog" aria-label="执行记录"><button onClick={() => setRecord(null)}>关闭</button><h2>执行记录</h2><p>状态：{record.status || '未记录'}</p><p>{record.error || record.result?.assistantMessage?.content || record.summary || '原请求记录已回查'}</p></div>}</div>;
}
function Inbox({ active }: {
    active: boolean;
}) {
    const [items, setItems] = useState<any[]>([]), [selected, setSelected] = useState(''), [rows, setRows] = useState<Record<string, any>>({}), [drafts, setDrafts] = useState<Record<string, string>>({}), [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState<Record<string, boolean>>({}), [filter, setFilter] = useState('pending');
    const values = useRef<Record<string, string>>({}), canonical = useRef<Record<string, any>>({}), timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({}), locks = useRef(new Set<string>()), selection = useRef(''), readGeneration = useRef(0);
    function fail(id: string, e: any) { setErrors(v => ({ ...v, [id]: e.message || String(e) })); }
    async function load() { try {
        const data = listItems(await request('GET', '/api/inbox?limit=200'));
        setItems(data);
        if (!selection.current && data[0])
            void select(data[0].id);
    }
    catch (e) {
        fail('list', e);
    } }
    async function select(id: string) { selection.current = id; setSelected(id); const gen = ++readGeneration.current; try {
        const row = await request('GET', '/api/inbox/' + enc(id));
        if (gen !== readGeneration.current)
            return;
        if (values.current[id] === undefined || values.current[id] === canonical.current[id]?.draft)
            canonical.current[id] = row;
        setRows(v => ({ ...v, [id]: row }));
        const local = currentLocal().drafts['inbox:' + id];
        if (values.current[id] === undefined) {
            values.current[id] = local ?? row.draft ?? '';
            setDrafts(v => ({ ...v, [id]: values.current[id] }));
        }
    }
    catch (e) {
        if (gen === readGeneration.current)
            fail(id, e);
    } }
    useEffect(() => { if (active)
        void load(); }, [active]);
    async function save(id: string) { if (locks.current.has(id) || !canonical.current[id])
        return; locks.current.add(id); setBusy(v => ({ ...v, [id]: true })); const text = values.current[id]; let success = false; try {
        await persist(s => { s.drafts['inbox:' + id] = text; });
        const row = await request('PATCH', '/api/inbox/' + enc(id), { draft: text, editedByUser: true, baseUpdatedAt: canonical.current[id].updatedAt });
        canonical.current[id] = row;
        setRows(v => ({ ...v, [id]: row }));
        if (values.current[id] === text)
            await persist(s => { delete s.drafts['inbox:' + id]; });
        setErrors(v => ({ ...v, [id]: '' }));
        success = true;
    }
    catch (e) {
        fail(id, e);
    }
    finally {
        locks.current.delete(id);
        setBusy(v => ({ ...v, [id]: false }));
        if (success && values.current[id] !== text)
            void save(id);
    } }
    function edit(id: string, text: string) { values.current[id] = text; setDrafts(v => ({ ...v, [id]: text })); void persist(s => { s.drafts['inbox:' + id] = text; }).catch(e => fail(id, e)); clearTimeout(timers.current[id]); timers.current[id] = setTimeout(() => void save(id), 700); }
    async function rebase(id: string) { try {
        const row = await request('GET', '/api/inbox/' + enc(id));
        canonical.current[id] = row;
        setRows(v => ({ ...v, [id]: row }));
        setErrors(v => ({ ...v, [id]: '已读取最新版本；本机草稿保留，点击重试保存' }));
    }
    catch (e) {
        fail(id, e);
    } }
    async function recoverDraft(id: string) { const requestId = currentLocal().drafts['draft-request:' + id]; if (!requestId)
        return; try {
        const result = await request('GET', '/api/pilot/drafts/' + enc(requestId));
        canonical.current[id] = result.item;
        setRows(v => ({ ...v, [id]: result.item }));
        setErrors(v => ({ ...v, [id]: result.status === 'running' ? '仍在生成，请稍后回查' : result.status === 'succeeded' || result.status === 'review' ? '生成结果已回查，请检查草稿或候选' : '生成失败，原稿保留' }));
        if (['succeeded', 'review', 'failed'].includes(result.status))
            await persist(s => { delete s.drafts['draft-request:' + id]; });
    }
    catch (e) {
        fail(id, e);
    } }
    async function regenerate(id: string) { if (locks.current.has(id))
        return; if (currentLocal().drafts['draft-request:' + id]) {
        await recoverDraft(id);
        return;
    } await save(id); if (values.current[id] !== canonical.current[id]?.draft) {
        fail(id, Error('先保存或恢复当前草稿，再重新生成'));
        return;
    } locks.current.add(id); setBusy(v => ({ ...v, [id]: true })); const requestId = crypto.randomUUID(), submitted = values.current[id]; try {
        await persist(s => { s.drafts['draft-request:' + id] = requestId; });
        let result;
        try {
            result = await request('POST', `/api/inbox/${enc(id)}/draft`, { requestId, mode: 'auto', baseUpdatedAt: canonical.current[id].updatedAt });
        }
        catch (e) {
            if (e instanceof PilotError && e.data?.detail?.item)
                result = e.data.detail;
            else
                throw e;
        }
        canonical.current[id] = result.item;
        setRows(v => ({ ...v, [id]: result.item }));
        if (values.current[id] === submitted && !result.item.draftCandidate) {
            values.current[id] = result.item.draft;
            setDrafts(v => ({ ...v, [id]: result.item.draft }));
            await persist(s => { delete s.drafts['inbox:' + id]; });
        }
        await persist(s => { delete s.drafts['draft-request:' + id]; });
        setErrors(v => ({ ...v, [id]: '' }));
    }
    catch (e) {
        fail(id, e);
    }
    finally {
        locks.current.delete(id);
        setBusy(v => ({ ...v, [id]: false }));
        if (values.current[id] !== canonical.current[id]?.draft)
            void save(id);
    } }
    async function adopt(id: string) { if (locks.current.has(id))
        return; locks.current.add(id); setBusy(v => ({ ...v, [id]: true })); const submitted = values.current[id]; try {
        const row = canonical.current[id], result = await request('POST', `/api/inbox/${enc(id)}/draft-candidate/apply`, { requestId: row.draftCandidate.requestId, baseUpdatedAt: row.updatedAt });
        canonical.current[id] = result.item;
        setRows(v => ({ ...v, [id]: result.item }));
        if (values.current[id] === submitted) {
            values.current[id] = result.item.draft;
            setDrafts(v => ({ ...v, [id]: result.item.draft }));
            await persist(s => { delete s.drafts['inbox:' + id]; });
        }
        setErrors(v => ({ ...v, [id]: '' }));
    }
    catch (e) {
        fail(id, e);
    }
    finally {
        locks.current.delete(id);
        setBusy(v => ({ ...v, [id]: false }));
        if (values.current[id] !== canonical.current[id]?.draft)
            void save(id);
    } }
    async function analyze(id: string) { try {
        await request('POST', `/api/inbox/${enc(id)}/triage`, { force: true });
        if (selection.current === id)
            await select(id);
    }
    catch (e) {
        fail(id, e);
    } }
    const item = rows[selected];
    return <div className="inbox-layout"><aside className="inbox-list"><header><h1>收件箱</h1><button aria-label="刷新收件箱" onClick={() => void load()}><RefreshCw /></button></header><div className="filters">{['pending', 'all'].map(v => <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{v === 'pending' ? '待处理' : '全部'}</button>)}</div><ErrorLine error={errors.list} retry={() => void load()}/>{items.filter(v => filter === 'all' || needsInboxAttention(v)).map(v => <button className="inbox-item" key={v.id} aria-pressed={selected === v.id} onClick={() => void select(v.id)}><span className="avatar">{v.sender?.slice(-2) || '?'}</span><span><strong>{v.sender || v.title}</strong><p>{v.body}</p></span></button>)}</aside><div className="inbox-detail">{item ? <><div className="inbox-scroll"><h2>{item.sender || item.title}</h2><InboxMessages item={item}/><details><summary>Jev 判断：{item.triage?.status === 'succeeded' ? (item.triage.method === 'rule' ? '规则判断' : '已分析') : '未确认'}</summary><p>{item.triage?.reason || item.triage?.summary || '尚无可用判断，不展示推测概率'}</p><button onClick={() => void analyze(selected)}>分析</button></details><h3>草稿</h3><textarea aria-label="回复草稿" value={drafts[selected] ?? item.draft ?? ''} onChange={e => edit(selected, e.target.value)}/><ErrorLine error={errors[selected]} retry={() => void save(selected)}/>{errors[selected] && <button onClick={() => void rebase(selected)}>读取最新版本，保留草稿</button>}{item.draftCandidate && <div><h3>生成候选</h3><SafeMarkdown text={item.draftCandidate.text}/><button disabled={!!busy[selected]} onClick={() => void adopt(selected)}>采用候选，替换当前草稿</button></div>}</div><footer className="inbox-actions">{currentLocal().drafts['draft-request:' + selected] && <button onClick={() => void recoverDraft(selected)}>回查原生成</button>}<span>{busy[selected] ? '处理中…' : ''}</span><button disabled={!!busy[selected]} onClick={() => void regenerate(selected)}><RefreshCw />重新生成</button></footer></> : <p className="empty">选择一条消息</p>}</div></div>;
}
import { InboxMessages } from '../pages/InboxMessages';
createRoot(document.getElementById('root')!).render(<App />);
