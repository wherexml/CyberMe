import { useRef, useState } from 'react';
import type { ModelSettings, ModelDefinition } from '../../../shared/model-settings';
import { request } from './runtime';
type Provider = ModelSettings['providers'][number];
export function ProviderEditor({ model, onSaved, onClose }: {
    model: ModelSettings;
    onSaved: (value: ModelSettings) => void;
    onClose: () => void;
}) {
    const [selected, setSelected] = useState(''), [form, setForm] = useState<Provider>(), [key, setKey] = useState(''), [version, setVersion] = useState(model.version), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const generation = useRef(0);
    function edit(p?: Provider) { generation.current++; setSelected(p?.id || ''); setForm(p ? structuredClone(p) : { id: 'provider-' + crypto.randomUUID(), name: '', baseUrl: '', api: 'openai-responses', enabled: true, configured: false, models: [], definitions: [] }); setKey(''); setError(''); }
    function change(patch: Partial<Provider>) { generation.current++; setForm(v => v && ({ ...v, ...patch })); }
    async function save() { if (!form)
        return; const gen = generation.current; setBusy(true); try {
        const { configured, models, ...provider } = form;
        const value = await request<ModelSettings>('PATCH', '/api/settings/models/providers', { version, provider: { ...provider, ...(key ? { apiKey: key } : {}) } });
        setVersion(value.version);
        onSaved(value);
        if (gen === generation.current) {
            setKey('');
            setForm(value.providers.find(p => p.id === form.id));
            setError('已保存');
        }
        else
            setError('已保存提交版本；后续输入仍保留');
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    async function rebase() { try {
        const fresh = await request<ModelSettings>('GET', '/api/settings/models');
        setVersion(fresh.version);
        onSaved(fresh);
        setError('已读取最新版本，当前输入保留；请检查后重新保存');
    }
    catch (e) {
        setError((e as Error).message);
    } }
    function definition(index: number, patch: Partial<ModelDefinition>) { change({ definitions: form!.definitions.map((v, i) => i === index ? { ...v, ...patch } : v) }); }
    return <div className="provider-editor"><button onClick={onClose}>返回模型</button><h2>供应商编辑</h2><select aria-label="编辑供应商" value={selected} disabled={busy} onChange={e => edit(model.providers.find(p => p.id === e.target.value))}><option value="">选择供应商</option>{model.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={busy} onClick={() => edit()}>新增供应商</button>{form && <><label>名称<input value={form.name} onChange={e => change({ name: e.target.value })}/></label><label>服务地址<input value={form.baseUrl} onChange={e => change({ baseUrl: e.target.value })}/></label><label>协议<select value={form.api} onChange={e => change({ api: e.target.value })}>{['openai-responses', 'openai-completions', 'anthropic-messages'].map(p => <option key={p}>{p}</option>)}</select></label><label>兼容模式<select value={form.compatibility || ''} onChange={e => change({ compatibility: e.target.value })}><option value="">默认</option><option value="claude-code">Claude Code</option></select></label><label>API Key<input type="password" autoComplete="off" value={key} onChange={e => { generation.current++; setKey(e.target.value); }} placeholder="留空仅复用原地址和协议的凭据"/></label><label><input type="checkbox" checked={form.enabled} onChange={e => change({ enabled: e.target.checked })}/>启用</label><h3>模型目录</h3>{form.definitions.map((d, i) => <fieldset key={i}><label>模型 ID<input value={d.id} onChange={e => definition(i, { id: e.target.value })}/></label><label>上下文 Token<input type="number" value={d.contextWindow} onChange={e => definition(i, { contextWindow: Number(e.target.value) })}/></label><label>输出 Token<input type="number" value={d.maxTokens} onChange={e => definition(i, { maxTokens: Number(e.target.value) })}/></label>{(['smart', 'reasoning', 'vision'] as const).map((k) => <label key={k}><input type="checkbox" checked={d[k]} onChange={e => definition(i, { [k]: e.target.checked })}/>{{ smart: '智能', reasoning: '推理', vision: '图片' }[k]}</label>)}<button onClick={() => change({ definitions: form.definitions.filter((_, n) => n !== i) })}>移除此模型</button></fieldset>)}<button onClick={() => change({ definitions: [...form.definitions, { id: '', smart: true, contextWindow: 200000, maxTokens: 7000, reasoning: false, vision: true }] })}>添加模型</button><button disabled={busy} onClick={() => void save()}>保存供应商</button></>}{error && <p role="status">{error} <button disabled={busy} onClick={() => void rebase()}>读取最新版本，保留输入</button></p>}<p className="empty">密钥仅在本次编辑内存中；关闭编辑器即清除，不写入本机草稿。</p></div>;
}
