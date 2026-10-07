const desktopText = (text: string): string => window.OpsTwinsDesktop?.translate?.(text) ?? text;
import React, { useEffect, useRef, useState } from 'react';
import type { UIContext } from '../../../../shared/types';
const D = () => window.OpsTwinsDesktop, api = (m: string, p: string, b?: unknown) => D().api(m, '/api' + p, b);
type Page = {
    items: any[];
    hasMore: boolean;
    nextCursor?: string;
    coverageComplete?: boolean;
    hasWarnings?: boolean;
};
export default function WechatReader({ ctx }: {
    ctx: UIContext;
}) {
    const connection = ctx.state.connections.find(c => c.id === 'wechat-sync-local'), connected = connection?.status === 'connected';
    const [chats, setChats] = useState<Page>(), [messages, setMessages] = useState<Page>(), [selected, setSelected] = useState<any>(), [query, setQuery] = useState(''), [messageQuery, setMessageQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [media, setMedia] = useState<any>();
    const generation = useRef(0), owner = useRef(''), blob = useRef(''), abort = useRef<AbortController | undefined>(undefined), search = useRef({ contacts: false, query: '' }), messageSearch = useRef(''), mediaGeneration = useRef(0);
    function clearMedia() {
        mediaGeneration.current++;
        abort.current?.abort();
        if (blob.current)
            URL.revokeObjectURL(blob.current);
        blob.current = '';
        setMedia(undefined);
    }
    function clear() { generation.current++; owner.current = ''; clearMedia(); setChats(undefined); setMessages(undefined); setSelected(undefined); setBusy(false); }
    useEffect(() => {
        clear();
        const hide = () => clear();
        window.addEventListener('desktop-owner-hidden', hide);
        return () => {
            generation.current++;
            mediaGeneration.current++;
            abort.current?.abort();
            if (blob.current)
                URL.revokeObjectURL(blob.current);
            window.removeEventListener('desktop-owner-hidden', hide);
        };
    }, [connection?.updatedAt]);
    async function work(fn: (g: number) => Promise<void>) {
        const g = ++generation.current;
        setBusy(true);
        setError('');
        try {
            await fn(g);
        }
        catch (e: any) {
            if (g === generation.current)
                setError(e.message);
        }
        finally {
            if (g === generation.current)
                setBusy(false);
        }
    }
    const valid = (g: number, id?: string) => g === generation.current && connected && (!id || id === owner.current);
    async function loadChats(more = false, contacts = false) {
        await work(async (g) => {
            clearMedia();
            const q = more ? search.current.query : query;
            if (!more)
                search.current = { contacts, query: q };
            const mode = more ? search.current.contacts : contacts;
            const page = mode ? await api('POST', '/wechat/contacts', { query: q, searchAll: true, ...(more ? { cursor: chats?.nextCursor } : {}) }) : await api('GET', '/wechat/chats' + (more ? '?cursor=' + encodeURIComponent(chats?.nextCursor || '') : ''));
            if (valid(g)) {
                setChats({ ...page, items: more ? [...(chats?.items || []), ...page.items] : page.items });
                if (!more) {
                    setSelected(undefined);
                    setMessages(undefined);
                    owner.current = '';
                }
            }
        });
    }
    async function loadMessages(chat: any, more = false, searching = false) {
        clearMedia();
        owner.current = chat.id;
        setSelected(chat);
        if (!more)
            setMessages(undefined);
        await work(async (g) => {
            const q = more ? messageSearch.current : searching ? messageQuery : '';
            if (!more)
                messageSearch.current = q;
            const page = q ? await api('POST', '/wechat/messages/search', { conversation: chat.id, query: q, ...(more ? { cursor: messages?.nextCursor } : {}) }) : await api('GET', '/wechat/messages?conversation=' + encodeURIComponent(chat.id) + (more ? '&cursor=' + encodeURIComponent(messages?.nextCursor || '') : ''));
            if (valid(g, chat.id))
                setMessages({ ...page, items: more ? [...(messages?.items || []), ...page.items] : page.items });
        });
    }
    async function exact(message: any) {
        await work(async (g) => {
            const result = await api('POST', '/wechat/message', { conversation: owner.current, message: message.id });
            if (valid(g, message.conversationId))
                setMessages(old => old && ({ ...old, items: old.items.map(m => m.id === message.id ? result.item : m) }));
        });
    }
    async function readMedia(message: any) {
        clearMedia();
        const mg = mediaGeneration.current, id = owner.current, g = generation.current;
        abort.current = new AbortController();
        setError('');
        try {
            const meta = await api('POST', '/wechat/attachment', { conversation: id, message: message.id });
            if (!valid(g, id) || mg !== mediaGeneration.current)
                return;
            const response = await fetch(meta.url, { signal: abort.current.signal });
            if (!response.ok)
                throw Error('附件已失效，请重新读取');
            const bytes = await response.arrayBuffer();
            if (!valid(g, id) || mg !== mediaGeneration.current)
                return;
            const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
            if (!valid(g, id) || mg !== mediaGeneration.current)
                return;
            if (digest !== meta.sha256 || bytes.byteLength !== meta.bytes)
                throw Error('附件内容校验失败');
            blob.current = URL.createObjectURL(new Blob([bytes], { type: meta.mime }));
            setMedia({ ...meta, src: blob.current, messageId: message.id, conversation: id, owner: g, generation: mg });
        }
        catch (e: any) {
            if (mg === mediaGeneration.current && e.name !== 'AbortError')
                setError(e.message);
        }
    }
    function coverage(page?: Page) { return page && (!page.coverageComplete || page.hasWarnings) ? <p role="status">{desktopText("\u5F53\u524D\u8BFB\u53D6\u8303\u56F4\u53EF\u80FD\u4E0D\u5B8C\u6574\uFF1B\u53EF\u7EE7\u7EED\u8BFB\u53D6\uFF0C\u6765\u6E90\u63D0\u9192\u4E0D\u4F1A\u88AB\u9690\u85CF\u3002")}</p> : null; }
    const expires = media && Date.parse(media.expiresAt) <= Date.now();
    useEffect(() => {
        if (!media)
            return;
        const timer = setTimeout(() => { clearMedia(); setError('附件已到期，请重新读取原消息'); }, Math.max(0, Date.parse(media.expiresAt) - Date.now()));
        return () => clearTimeout(timer);
    }, [media]);
    async function saveMedia() {
        const value = media;
        if (!value || expires || !valid(value.owner, value.conversation))
            return;
        try {
            if (window.mygo)
                await window.mygo.call('DesktopFiles.SaveVerified', value.url, '微信附件.' + (value.format || 'bin'), value.sha256);
            else {
                const a = document.createElement('a');
                a.href = value.src;
                a.download = '微信附件.' + (value.format || 'bin');
                a.click();
            }
        }
        catch (e: any) {
            if (valid(value.owner, value.conversation))
                setError(e.message);
        }
    }
    return <main className="settings-page"><button onClick={() => ctx.navigate('/settings/connections')}>{desktopText("\u2039 \u8FD4\u56DE\u8FDE\u63A5")}</button><h1>{desktopText("\u4E2A\u4EBA\u5FAE\u4FE1")}</h1><p>{connected ? desktopText("\u5DF2\u8FDE\u63A5 \u00B7 \u53EA\u8BFB") : desktopText("\u672A\u8FDE\u63A5")}{desktopText("\u00B7 \u901A\u8FC7\u8FD9\u53F0 Mac \u4E0A\u7684 GreenBubbles \u8BFB\u53D6")}</p>{error && <p role="alert">{error}</p>}
 <section className="settings-card"><div className="settings-card-actions"><button disabled={busy} onClick={() => work(async () => {
            const value = await api('POST', '/wechat/connect', {});
            await ctx.refresh();
            if (!value.ok)
                throw Error(value.message);
        })}>{connected ? desktopText("\u91CD\u65B0\u68C0\u6D4B") : desktopText("\u8FDE\u63A5\u672C\u673A\u5FAE\u4FE1")}</button>{connected && <><button disabled={busy} onClick={() => loadChats()}>{desktopText("\u67E5\u770B\u4F1A\u8BDD")}</button><button disabled={busy} onClick={() => work(async () => { await api('POST', '/connections/wechat-sync-local/disconnect', {}); clear(); await ctx.refresh(); })}>{desktopText("\u65AD\u5F00\u8FDE\u63A5")}</button></>}</div>
 {connected && <form onSubmit={e => { e.preventDefault(); void loadChats(false, true); }}><input aria-label="微信联系人搜索" placeholder={desktopText("\u641C\u7D22\u8054\u7CFB\u4EBA")} value={query} onChange={e => setQuery(e.target.value)}/><button disabled={busy || !query.trim()}>{desktopText("\u641C\u7D22")}</button></form>}</section>
 {chats && <div className="desktop-wechat-reader"><section>{coverage(chats)}{chats.items.map(c => <button className="wechat-chat-row" key={c.id} disabled={busy} onClick={() => loadMessages(c)} aria-pressed={selected?.id === c.id}>{c.name}</button>)}{!chats.items.length && <p>{desktopText("\u672C\u6B21\u8303\u56F4\u6CA1\u6709\u5339\u914D\u7ED3\u679C")}</p>}{chats.hasMore && <button disabled={busy} onClick={() => loadChats(true)}>{desktopText("\u7EE7\u7EED\u67E5\u627E")}</button>}</section>
 {selected && <section><h2>{selected.name}</h2><form onSubmit={e => { e.preventDefault(); void loadMessages(selected, false, true); }}><input aria-label="微信消息搜索" placeholder={desktopText("\u5728\u6B64\u4F1A\u8BDD\u4E2D\u641C\u7D22")} value={messageQuery} onChange={e => setMessageQuery(e.target.value)}/><button disabled={busy || !messageQuery.trim()}>{desktopText("\u641C\u7D22\u6D88\u606F")}</button><button type="button" disabled={busy} onClick={() => loadMessages(selected)}>{desktopText("\u5168\u90E8\u6D88\u606F")}</button></form>{coverage(messages)}{messages?.items.map(m => <article className="wechat-message" key={m.id}><small>{m.sender} · {new Date(m.at * 1000).toLocaleString()}</small><p style={{ whiteSpace: 'pre-wrap' }}>{m.text}</p><button disabled={busy} onClick={() => exact(m)}>{desktopText("\u8BFB\u53D6\u7CBE\u786E\u6D88\u606F")}</button>{m.messageType !== 1 && <button onClick={() => readMedia(m)}>{desktopText("\u8BFB\u53D6\u9644\u4EF6")}</button>}</article>)}{messages?.hasMore && <button disabled={busy} onClick={() => loadMessages(selected, true)}>{desktopText("\u66F4\u65E9\u6D88\u606F")}</button>}</section>}</div>}
 {media && <section className="settings-card"><h2>{desktopText("\u9644\u4EF6")}</h2>{media.mime.startsWith('image/') ? <img src={media.src} style={{ maxWidth: '100%' }} alt="微信附件"/> : media.mime.startsWith('audio/') ? <audio controls src={media.src}/> : media.mime.startsWith('video/') ? <video controls src={media.src} style={{ maxWidth: '100%' }}/> : media.mime === 'application/pdf' ? <iframe sandbox="" src={media.src} title="微信文档" style={{ width: '100%', height: 400 }}/> : <p>{desktopText("\u6B64\u683C\u5F0F\u53EF\u4EE5\u4FDD\u5B58\u540E\u67E5\u770B")}</p>}<button disabled={expires} onClick={saveMedia}>{desktopText("\u4FDD\u5B58\u9644\u4EF6")}</button><button onClick={clearMedia}>{desktopText("\u79FB\u9664")}</button></section>}
 </main>;
}
