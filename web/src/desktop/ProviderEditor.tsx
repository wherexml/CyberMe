const desktopText = (text: string): string => window.OpsTwinsDesktop?.translate?.(text) ?? text;
import {ChevronLeft} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ModelSettings, ModelDefinition } from '../../../shared/model-settings';
import { request,currentLocal,persist } from './runtime';
type Provider = ModelSettings['providers'][number];
export function ProviderEditor({ model, onSaved, onClose, initialId }: {
    model: ModelSettings;
    initialId?: string;
    onSaved: (value: ModelSettings) => void;
    onClose: () => void;
}) {
    const [selected, setSelected] = useState(''), [form, setForm] = useState<Provider>(), [key, setKey] = useState(''), [version, setVersion] = useState(model.version), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const generation = useRef(0),formRef=useRef<Provider|undefined>(undefined),draftOwner=useRef('provider:new');
    async function keepDraft(value:Provider,base=version){
        let baseUrl=value.baseUrl;try{const u=new URL(baseUrl);if(u.username||u.password||u.search||u.hash)baseUrl=''}catch{}
        const safe={id:value.id,name:value.name,baseUrl,api:value.api,enabled:value.enabled,configured:value.configured,models:value.models,definitions:value.definitions,compatibility:value.compatibility};
        const owner=draftOwner.current;await persist(s=>{s.drafts[owner]=JSON.stringify({form:safe,version:base})});
    }
    function edit(p?: Provider) { generation.current++;draftOwner.current='provider:'+(p?.id||'new');let restored;try{restored=JSON.parse(currentLocal().drafts[draftOwner.current]||'null')}catch{}const next=restored?.form||(p ? structuredClone(p) : { id: 'provider-' + crypto.randomUUID(), name: '', baseUrl: '', api: 'openai-responses', enabled: true, configured: false, models: [], definitions: [] });formRef.current=next;setVersion(restored?.version||model.version);setSelected(p?.id || ''); setForm(next); setKey(''); setError(''); }
    useEffect(() => {
        if (initialId !== undefined)
            edit(model.providers.find(p => p.id === initialId));
    }, []);
    function change(patch: Partial<Provider>) {if(!formRef.current)return;generation.current++;const next={...formRef.current,...patch};formRef.current=next;setForm(next);void keepDraft(next).catch(e=>setError('本机保存失败：'+e.message));}
    async function save() {
        if (!form)
            return;
        const gen = generation.current;
        setBusy(true);
        try {
            const owner=draftOwner.current;await keepDraft(form);
            const { configured, models, ...provider } = form;
            const value = await request<ModelSettings>('PATCH', '/api/settings/models/providers', { version, provider: { ...provider, ...(key ? { apiKey: key } : {}) } });
            setVersion(value.version);
            onSaved(value);
            if (gen === generation.current) {
                setKey('');
                const canonical=value.providers.find(p => p.id === form.id);formRef.current=canonical;setForm(canonical);await persist(s=>{delete s.drafts[owner]});
                setError(desktopText("\u5DF2\u4FDD\u5B58"));
            }
            else {
                if(formRef.current&&draftOwner.current===owner)await keepDraft(formRef.current,value.version);
                setError('已保存提交版本；后续输入仍保留');
            }
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function rebase() {
        try {
            const fresh = await request<ModelSettings>('GET', '/api/settings/models');
            setVersion(fresh.version);
            if(formRef.current)await keepDraft(formRef.current,fresh.version);
            onSaved(fresh);
            setError('已读取最新版本，当前输入保留；请检查后重新保存');
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    function definition(index: number, patch: Partial<ModelDefinition>) { change({ definitions: form!.definitions.map((v, i) => i === index ? { ...v, ...patch } : v) }); }
    return <div className="provider-editor"><button className="settings-back-link" onClick={onClose}><ChevronLeft aria-hidden="true"/>{desktopText("\u8FD4\u56DE\u6A21\u578B")}</button><h2>{desktopText("\u4F9B\u5E94\u5546\u7F16\u8F91")}</h2><select aria-label="编辑供应商" value={selected} disabled={busy} onChange={e => edit(model.providers.find(p => p.id === e.target.value))}><option value="">{desktopText("\u9009\u62E9\u4F9B\u5E94\u5546")}</option>{model.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={busy} onClick={() => edit()}>{desktopText("\u65B0\u589E\u4F9B\u5E94\u5546")}</button>{form && <><label>{desktopText("\u540D\u79F0")}<input value={form.name} onChange={e => change({ name: e.target.value })}/></label><label>{desktopText("\u670D\u52A1\u5730\u5740")}<input value={form.baseUrl} onChange={e => change({ baseUrl: e.target.value })}/></label><label>{desktopText("\u534F\u8BAE")}<select value={form.api} onChange={e => change({ api: e.target.value })}>{['openai-responses', 'openai-completions', 'anthropic-messages'].map(p => <option key={p}>{p}</option>)}</select></label><label>{desktopText("\u517C\u5BB9\u6A21\u5F0F")}<select value={form.compatibility || ''} onChange={e => change({ compatibility: e.target.value })}><option value="">{desktopText("\u9ED8\u8BA4")}</option><option value="claude-code">Claude Code</option></select></label><label>API Key<input type="password" autoComplete="off" value={key} onChange={e => { generation.current++; setKey(e.target.value); }} placeholder="留空仅复用原地址和协议的凭据"/></label><label><input type="checkbox" checked={form.enabled} onChange={e => change({ enabled: e.target.checked })}/>{desktopText("\u542F\u7528")}</label><h3>{desktopText("\u6A21\u578B\u76EE\u5F55")}</h3>{form.definitions.map((d, i) => <fieldset key={i}><label>{desktopText("\u6A21\u578B ID")}<input value={d.id} onChange={e => definition(i, { id: e.target.value })}/></label><label>{desktopText("\u4E0A\u4E0B\u6587 Token")}<input type="number" value={d.contextWindow} onChange={e => definition(i, { contextWindow: Number(e.target.value) })}/></label><label>{desktopText("\u8F93\u51FA Token")}<input type="number" value={d.maxTokens} onChange={e => definition(i, { maxTokens: Number(e.target.value) })}/></label>{(['smart', 'reasoning', 'vision'] as const).map((k) => <label key={k}><input type="checkbox" checked={d[k]} onChange={e => definition(i, { [k]: e.target.checked })}/>{{ smart: '智能', reasoning: '推理', vision: '图片' }[k]}</label>)}<button onClick={() => change({ definitions: form.definitions.filter((_, n) => n !== i) })}>{desktopText("\u79FB\u9664\u6B64\u6A21\u578B")}</button></fieldset>)}<button onClick={() => change({ definitions: [...form.definitions, { id: '', smart: true, contextWindow: 200000, maxTokens: 7000, reasoning: false, vision: true }] })}>{desktopText("\u6DFB\u52A0\u6A21\u578B")}</button><button disabled={busy} onClick={() => void save()}>{desktopText("\u4FDD\u5B58\u4F9B\u5E94\u5546")}</button></>}{error && <p role="status">{error} <button disabled={busy} onClick={() => void rebase()}>{desktopText("\u8BFB\u53D6\u6700\u65B0\u7248\u672C\uFF0C\u4FDD\u7559\u8F93\u5165")}</button></p>}<p className="empty">{desktopText("\u5BC6\u94A5\u4EC5\u5728\u672C\u6B21\u7F16\u8F91\u5185\u5B58\u4E2D\uFF1B\u5173\u95ED\u7F16\u8F91\u5668\u5373\u6E05\u9664\uFF0C\u4E0D\u5199\u5165\u672C\u673A\u8349\u7A3F\u3002")}</p></div>;
}
