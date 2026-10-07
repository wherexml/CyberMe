const desktopText = (text: string): string => window.OpsTwinsDesktop?.translate?.(text) ?? text;
import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import type { ModelSettings, ModelSelection } from '../../../shared/model-settings';
import { request, persist, currentLocal, Intent, enc, PilotError, browserPreview } from './runtime';
import { ProviderEditor } from './ProviderEditor';
export default function Models({ active, embedded = false }: {
    active: boolean;
    embedded?: boolean;
}) {
    const [saved, setSaved] = useState<ModelSettings>(), [choice, setChoice] = useState<ModelSelection>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [probe, setProbe] = useState<Intent>(), [result, setResult] = useState<any>();
    const [editingProvider, setEditingProvider] = useState<string | undefined>(undefined);
    const choiceRef = useRef<ModelSelection | undefined>(undefined), loadGen = useRef(0);
    function setValue(value: ModelSelection) { choiceRef.current = value; setChoice(value); void persist(s => { s.drafts.models = JSON.stringify(value); }).catch(e => setError('本机保存失败：' + e.message)); }
    async function load() {
        const gen = ++loadGen.current;
        try {
            const model = await request<ModelSettings>('GET', '/api/settings/models');
            if (gen !== loadGen.current)
                return;
            setSaved(model);
            let next = model.standard;
            try {
                next = JSON.parse(currentLocal().drafts.models || 'null') || next;
            }
            catch { }
            choiceRef.current = next;
            setChoice(next);
            setError('');
            const old = Object.values(currentLocal().requests).filter(i => i.kind === 'model').at(-1);
            if (old) {
                setProbe(old);
                void check(old);
            }
        }
        catch (e) {
            if (gen === loadGen.current)
                setError((e as Error).message);
        }
    }
    useEffect(() => {
        if (active)
            void load();
    }, [active]);
    const dirty = !!saved && !!choice && JSON.stringify(choice) !== JSON.stringify(saved.standard);
    async function save() {
        if (!saved || !choice || busy)
            return;
        setBusy(true);
        const submitted = { ...choice };
        try {
            const model = await request<ModelSettings>('PATCH', '/api/settings/models', { version: saved.version, standard: submitted, deep: submitted });
            setSaved(model);
            if (JSON.stringify(choiceRef.current) === JSON.stringify(submitted)) {
                choiceRef.current = model.standard;
                setChoice(model.standard);
                await persist(s => { delete s.drafts.models; });
            }
            setError('');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function check(intent: Intent) {
        try {
            const value = await request('GET', '/api/settings/models/tests/' + enc(intent.id));
            setResult(value);
            if (intent.status !== value.status)
                await persist(s => {
                    if (s.requests[intent.id])
                        s.requests[intent.id].status = value.status;
                });
        }
        catch (e) {
            setResult({ status: 'unknown' });
            setError('原测试未确认，保留请求 ID：' + (e as Error).message);
        }
    }
    async function run() {
        if (browserPreview) {
            setError("这是只读布局预览，请在 MyGO App 中执行真实操作");
            return;
        }
        if (!saved || busy || dirty)
            return;
        setBusy(true);
        try {
            let intent = probe;
            if (intent) {
                try {
                    await request('GET', '/api/settings/models/tests/' + enc(intent.id));
                    await check(intent);
                    return;
                }
                catch (e) {
                    if (!(e instanceof PilotError) || e.status !== 404)
                        throw e;
                }
            }
            else {
                intent = { id: crypto.randomUUID(), kind: 'model', owner: 'models', status: 'prepared', body: { role: 'standard', version: saved.version } };
                intent.body.requestId = intent.id;
                await persist(s => { s.requests[intent!.id] = intent!; });
                setProbe(intent);
            }
            const owned = intent;
            const poll = setInterval(() => void check(owned), 1800);
            try {
                const value = await request('POST', '/api/settings/models/test', owned.body);
                setResult(value);
            }
            finally {
                clearInterval(poll);
                await check(owned);
            }
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    const provider = saved?.providers.find(p => p.id === choice?.providerId);
    if (editingProvider !== undefined && saved)
        return <div className={embedded ? "desktop-model-content" : "settings-content"}><ProviderEditor initialId={editingProvider} model={saved} onSaved={setSaved} onClose={() => setEditingProvider(undefined)}/></div>;
    return <div className={embedded ? "desktop-model-layout" : "settings-layout"}>{!embedded && <aside className="settings-nav"><h2>{desktopText("\u8BBE\u7F6E")}</h2><button aria-pressed="true"><Settings />{desktopText("\u6A21\u578B")}</button></aside>}<div className={embedded ? "desktop-model-content" : "settings-content"}><h1>{desktopText("\u6A21\u578B")}</h1><ErrorLine error={error} retry={() => void load()}/>{saved && choice ? <><div className="setting-row"><label htmlFor="provider">{desktopText("\u4F9B\u5E94\u5546")}</label><select id="provider" value={choice.providerId} onChange={e => { const p = saved.providers.find(v => v.id === e.target.value)!; setValue({ providerId: p.id, model: p.models[0] || '' }); }}>{saved.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="setting-row"><label htmlFor="model">{desktopText("\u5F53\u524D\u6A21\u578B")}</label><select id="model" value={choice.model} onChange={e => setValue({ ...choice, model: e.target.value })}>{[...new Set([choice.model, ...(provider?.models || [])])].map(m => <option key={m} value={m}>{m}</option>)}</select></div><div className="setting-row"><span>{desktopText("\u8FDE\u63A5\u6D4B\u8BD5")}</span><div><button className="subtle" disabled={busy || dirty} onClick={() => void run()}>{busy ? desktopText("\u6D4B\u8BD5\u4E2D\u2026") : probe ? '回查／原请求重试' : desktopText("\u6D4B\u8BD5\u6A21\u578B")}</button>{result && <span className="probe-result">{({ succeeded: '连接成功', failed: '连接失败', running: '测试中', unknown: desktopText("\u7ED3\u679C\u672A\u786E\u8BA4") } as Record<string, string>)[result.status] || '未确认'}</span>}</div></div>{probe && <button onClick={() => void check(probe)}>{desktopText("\u56DE\u67E5\u539F\u6D4B\u8BD5")}</button>}{result && ['succeeded', 'failed'].includes(result.status) && <button onClick={() => { setProbe(undefined); setResult(undefined); }}>{desktopText("\u51C6\u5907\u65B0\u7684\u6D4B\u8BD5")}</button>}{dirty && <div className="save-bar"><button onClick={() => { setValue(saved.standard); }}>{desktopText("\u6062\u590D\u5DF2\u4FDD\u5B58\u9009\u62E9")}</button><button className="primary" disabled={busy} onClick={() => void save()}>{desktopText("\u4FDD\u5B58")}</button></div>}<div className="providers-heading"><h2 className="providers-title">{desktopText("\u4F9B\u5E94\u5546")}</h2><button onClick={() => setEditingProvider('')}>{desktopText("\uFF0B \u6DFB\u52A0\u4F9B\u5E94\u5546")}</button></div>{saved.providers.map(p => <button className="provider-row" key={p.id} onClick={() => setEditingProvider(p.id)}><span>{p.name}</span><span aria-hidden="true">›</span></button>)}</> : <p className="empty">{desktopText("\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u914D\u7F6E")}</p>}</div></div>;
}
function ErrorLine({ error, retry }: {
    error: string;
    retry?: () => void;
}) { return error ? <div role="alert" className="error">{error}{retry && <button onClick={retry}>{desktopText("\u91CD\u8BD5")}</button>}</div> : null; }
