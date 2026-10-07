import { previewRequest } from './preview';
export const browserPreview = !window.mygo;
export type Intent = {
    id: string;
    kind: 'chat' | 'model';
    owner: string;
    body: Record<string, unknown>;
    status: string;
};
export type LocalState = {
    revision: number;
    drafts: Record<string, string>;
    requests: Record<string, Intent>;
    theme: string;
};
declare global {
    interface Window {
        mygo?: {
            call: (method: string, ...args: unknown[]) => Promise<any>;
            on: (event: string, listener: (value: unknown) => void) => () => void;
        };
    }
}
export class PilotError extends Error {
    constructor(public status: number, public data: any) { super(data?.message || data?.error || `请求失败 ${status}`); }
}
export async function request<T = any>(method: string, path: string, body: unknown = null): Promise<T> {
    if (browserPreview)
        return await previewRequest(method, path) as T;
    const r = await window.mygo!.call('Bridge.Request', method, path, body);
    if (r.status < 200 || r.status >= 300)
        throw new PilotError(r.status, r.data);
    return r.data;
}
let local: LocalState;
let queue = Promise.resolve();
export async function loadLocal() { if (browserPreview) {
    local = { revision: 0, drafts: {}, requests: {}, theme: 'light' };
    return local;
} local = await window.mygo!.call('Bridge.ReadState'); return local; }
export function currentLocal() { return local; }
export function persist(change: (state: LocalState) => void): Promise<LocalState> {
    const job = queue.catch(() => { }).then(async () => { const next = structuredClone(local); change(next); const saved = browserPreview ? { ...next, revision: next.revision + 1 } : await window.mygo!.call('Bridge.SaveState', next); local = saved; return saved; });
    queue = job.then(() => { }, () => { });
    return job;
}
export const listItems = (v: any): any[] => Array.isArray(v) ? v : v?.items || v?.messages || [];
export const enc = encodeURIComponent;
