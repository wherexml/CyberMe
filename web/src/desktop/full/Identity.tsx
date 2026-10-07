const desktopText = (text: string): string => window.OpsTwinsDesktop?.translate?.(text) ?? text;
import React, { useEffect, useRef, useState } from 'react';
import type { UIContext } from '../../../../shared/types';
const KEY = 'opstwins-full-identity', D = () => window.OpsTwinsDesktop, api = (method: string, path: string, body?: any) => D().api(method, '/api' + path, body);
const copy = (v: any) => structuredClone(v), text = (m: any) => m.content || m.body || m.description || m.title || '';
function Markdown({value}:{value:string}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{if(ref.current)(window as any).OpsTwinsMarkdown.render(ref.current,value)},[value]);return <div className="settings-markdown" ref={ref}/>}
function MemoryDocument({memory,onEdit,busy}:{memory:any;onEdit:()=>void;busy:boolean}){const [value,setValue]=useState<string>(),[error,setError]=useState('');const sequence=useRef(0);useEffect(()=>()=>{sequence.current++},[]);async function read(){const gen=++sequence.current;try{const full=await api('GET','/memories/'+encodeURIComponent(memory.id));if(gen===sequence.current){setValue(text(full));setError('')}}catch(e:any){if(gen===sequence.current)setError(e.message)}}return <details className="memory-document" onToggle={e=>{if(e.currentTarget.open&&value===undefined)void read()}}><summary>{(memory.title||'记忆').replace(/^#{1,6}\s+/, '')}</summary>{error?<p role="alert">{error}<button onClick={read}>重试</button></p>:value===undefined?<p>正在读取全文…</p>:<Markdown value={value}/>}<button disabled={busy} onClick={onEdit}>编辑</button></details>}
export default function Identity({ ctx }: {
    ctx: UIContext;
}) {
    const busyRef = useRef(false), editorRef=useRef<HTMLElement>(null);
    const [drafts, setDrafts] = useState<any>(() => {
        try {
            return JSON.parse(localStorage.getItem(KEY) || '{}');
        }
        catch {
            return {};
        }
    }), ref = useRef(drafts), [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(''), [history, setHistory] = useState<any>(), [notice, setNotice] = useState('');
    useEffect(()=>{editorRef.current?.scrollIntoView({block:'start'})},[selected]);
    function persist(next: any) { ref.current = next; setDrafts(next); localStorage.setItem(KEY, JSON.stringify(next)); }
    function edit(id: string, change: any) { persist({ ...ref.current, [id]: { ...ref.current[id], ...change } }); }
    async function work(id: string, fn: () => Promise<void>) {
        if (busyRef.current)
            return;
        busyRef.current = true;
        setBusy(id);
        setError('');
        setNotice('');
        try {
            await fn();
        }
        catch (e: any) {
            setError(e.message);
        }
        finally {
            busyRef.current = false;
            setBusy('');
        }
    }
    async function open(id: string) {
        await work(id, async () => {
            if (!ref.current[id]) {
                if (id === 'identity') {
                    const settings = await api('GET', '/settings');
                    edit(id, { value: copy(settings.identity), baseline: copy(settings.identity) });
                }
                else {
                    const m = await api('GET', '/memories/' + encodeURIComponent(id));
                    edit(id, { value: text(m), category: m.category || 'Learned', baseline: m.updatedAt });
                }
            }
            setSelected(id);
        });
    }
    function create() { const id = 'memory-' + crypto.randomUUID(); edit(id, { value: '', category: 'Learned', isNew: true }); setSelected(id); }
    async function rebase(id: string, discard = false) {
        await work(id, async () => {
            if (id === 'identity') {
                const v = (await api('GET', '/settings')).identity;
                edit(id, { baseline: copy(v), ...(discard ? { value: copy(v) } : {}) });
            }
            else {
                const v = await api('GET', '/memories/' + encodeURIComponent(id));
                edit(id, { baseline: v.updatedAt, isNew: false, intent: undefined, ...(discard ? { value: text(v), category: v.category || 'Learned' } : {}) });
            }
            setNotice(discard ? '已读取最新版本' : '已读取最新版本，当前输入保留；请核对后保存');
        });
    }
    async function save(id: string) {
        await work(id, async () => {
            const submitted = copy(ref.current[id]);
            await D().durable();
            if (id === 'identity') {
                const settings = await api('GET', '/settings');
                if (JSON.stringify(settings.identity) !== JSON.stringify(submitted.baseline))
                    throw Error('身份已在其他位置更新，请读取最新版本后保存');
                const saved = await api('PATCH', '/settings', { identity: submitted.value,baseSettings:{identity:submitted.baseline} });
                if (JSON.stringify(ref.current[id]?.value) === JSON.stringify(submitted.value)) {
                    const next = { ...ref.current };
                    delete next[id];
                    persist(next);
                    setSelected(v => v === id ? '' : v);
                }
                else
                    edit(id, { baseline: saved.identity });
            }
            else {
                if (!submitted.value.trim())
                    throw Error(desktopText("\u8BB0\u5FC6\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A"));
                let saved;
                if (submitted.isNew) {
                    try {
                        const found = await api('GET', '/memories/' + encodeURIComponent(id));
                        if (found.id !== id)
                            throw Error('原创建结果不一致');
                        edit(id, { isNew: false, baseline: found.updatedAt, intent: undefined });
                        await ctx.refresh();
                        setNotice('已发现原创建结果，输入保留；再次保存将更新同一条记忆');
                        return;
                    }
                    catch (e: any) {
                        if (e.status !== 404)
                            throw e;
                    }
                    const intent = submitted.intent || { id, title: submitted.value.trim().split('\n')[0].slice(0, 100), body: submitted.value.trim(), content: submitted.value.trim(), category: submitted.category };
                    edit(id, { intent });
                    await D().durable();
                    saved = await api('POST', '/memories', intent);
                }
                else {
                    await api('POST', '/memories/snapshot', {});
                    saved = await api('PATCH', '/memories/' + encodeURIComponent(id), { title: submitted.value.trim().split('\n')[0].slice(0, 100), body: submitted.value.trim(), content: submitted.value.trim(), category: submitted.category, baseUpdatedAt: submitted.baseline });
                }
                if (saved.id !== id || !saved.updatedAt)
                    throw Error('保存结果不能确认，请回查原记录');
                const latest = ref.current[id];
                if (latest?.value === submitted.value && latest?.category === submitted.category && text(saved) === submitted.value.trim()) {
                    const next = { ...ref.current };
                    delete next[id];
                    persist(next);
                    setSelected(v => v === id ? '' : v);
                }
                else
                    edit(id, { isNew: false, baseline: saved.updatedAt, intent: undefined });
            }
            await ctx.refresh();
            setNotice('已保存；后来输入会保留');
        });
    }
    async function remove(id: string) { await work(id, async () => { await api('POST', '/memories/snapshot', {}); await api('DELETE', '/memories/' + encodeURIComponent(id)); await ctx.refresh(); const next = { ...ref.current }; delete next[id]; persist(next); setSelected(v => v === id ? '' : v); setNotice('已删除，可在记忆历史中恢复'); }); }
    async function histories(kind: string) { await work('history', async () => { const value = await api('GET', kind === 'identity' ? '/settings/history' : '/memories/history'); const baseline=kind==='identity'?(await api('GET','/settings')).identity:undefined;setHistory({ kind,baseline,version:value.version, items: Array.isArray(value) ? value : value.items || value.history || [] }); }); }
    async function restore(row: any) {
        await work('restore', async () => {
            if (history.kind === 'identity') {
                const value = (row.settings || row.snapshot || row.value || row.before || row.data)?.identity || row.identity;
                if (!value)
                    throw Error('此版本没有身份内容');
                await api('PATCH', '/settings', { identity: value,baseSettings:{identity:history.baseline} });
            }
            else
                await api('POST', '/memories/history/' + encodeURIComponent(row.id) + '/restore', {baseMemoryVersion:history.version});
            await ctx.refresh();
            setHistory(undefined);
            setNotice('历史已恢复，未提交输入仍保留');
        });
    }
    const id = selected, d = drafts[id];
    return <section className="desktop-identity"><h1>{desktopText("\u8EAB\u4EFD\u4E0E\u8BB0\u5FC6")}</h1>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
 <section className="settings-document"><header className="settings-document-header"><strong>soul.md</strong><button disabled={!!busy} onClick={() => histories('identity')}>{desktopText("\u5386\u53F2")}</button><button disabled={!!busy} onClick={() => open('identity')}>{desktopText("\u7F16\u8F91")}</button></header><details open><summary>{desktopText("\u8EAB\u4EFD\u4E0E\u6307\u4EE4")}{drafts.identity ? ' · 未保存' : ''}</summary><p>{ctx.state.settings.identity.name}</p><p>{ctx.state.settings.identity.role}</p><Markdown value={ctx.state.settings.identity.about||''}/><Markdown value={ctx.state.settings.identity.instructions||'尚未填写指令。'}/></details></section>
 <section className="settings-document"><header className="settings-document-header"><strong>memory.md</strong><button disabled={!!busy} onClick={() => histories('memory')}>{desktopText("\u5386\u53F2")}</button><button disabled={!!busy} onClick={create}>{desktopText("\u6DFB\u52A0\u8BB0\u5FC6")}</button></header>{ctx.state.memories.map(m => <MemoryDocument key={m.id+':'+m.updatedAt} memory={m} busy={!!busy} onEdit={()=>void open(m.id)}/>)}{Object.entries(drafts).filter(([key, v]: any) => key !== 'identity' && v.isNew).map(([key, v]: any) => <button key={key} onClick={() => setSelected(key)}>{desktopText("\u7EE7\u7EED\u65B0\u8BB0\u5FC6\u8349\u7A3F\uFF1A")}{v.value.slice(0, 30) || '未填写'}</button>)}</section>
 {d && <section ref={editorRef} className="settings-card"><h2>{id === 'identity' ? '编辑身份' : d.isNew ? '新建记忆' : '编辑记忆'}</h2>{id === 'identity' ? ['name', 'role', 'about', 'instructions'].map((key, i) => <label key={key} className="settings-field">{[desktopText("\u59D3\u540D"), desktopText("\u89D2\u8272"), desktopText("\u5173\u4E8E\u4F60"), '指令'][i]}<textarea aria-label={[desktopText("\u59D3\u540D"), desktopText("\u89D2\u8272"), desktopText("\u5173\u4E8E\u4F60"), '指令'][i]} value={d.value[key] || ''} rows={key === 'instructions' ? 8 : 2} onChange={e => edit(id, { value: { ...ref.current[id].value, [key]: e.target.value } })}/></label>) : <><label className="settings-field">{desktopText("\u5206\u7C7B")}<input aria-label={desktopText("\u8BB0\u5FC6\u5206\u7C7B")} value={d.category} onChange={e => edit(id, { category: e.target.value })}/></label><label className="settings-field">{desktopText("\u5185\u5BB9")}<textarea aria-label={desktopText("\u8BB0\u5FC6\u5185\u5BB9")} rows={10} value={d.value} onChange={e => edit(id, { value: e.target.value })}/></label></>}
 <div className="settings-card-actions"><button disabled={!!busy} onClick={() => save(id)}>{busy === id ? '保存中…' : desktopText("\u4FDD\u5B58")}</button><button onClick={() => setSelected('')}>{desktopText("\u5173\u95ED\uFF0C\u4FDD\u7559\u8349\u7A3F")}</button>{!d.isNew && <><button disabled={!!busy} onClick={() => rebase(id)}>{desktopText("\u8BFB\u53D6\u6700\u65B0\u7248\u672C\uFF0C\u4FDD\u7559\u8F93\u5165")}</button><button disabled={!!busy} onClick={() => rebase(id, true)}>{desktopText("\u653E\u5F03\u8F93\u5165\uFF0C\u8BFB\u53D6\u6700\u65B0")}</button>{id !== 'identity' && <button disabled={!!busy} onClick={() => remove(id)}>{desktopText("\u5220\u9664\u8BB0\u5FC6")}</button>}</>}</div></section>}
 {history && <section className="settings-card"><h2>{history.kind === 'identity' ? desktopText("\u8EAB\u4EFD\u5386\u53F2") : desktopText("\u8BB0\u5FC6\u5386\u53F2")}</h2><button onClick={() => setHistory(undefined)}>{desktopText("\u5173\u95ED\u5386\u53F2")}</button>{history.items.map((row: any) => <details key={row.id}><summary>{new Date(row.createdAt).toLocaleString()}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{row.preview || row.identity?.instructions || row.settings?.identity?.instructions || '已保存快照'}</pre><button disabled={!!busy} onClick={() => restore(row)}>{desktopText("\u6062\u590D\u6B64\u7248\u672C")}</button></details>)}</section>}
 </section>;
}
