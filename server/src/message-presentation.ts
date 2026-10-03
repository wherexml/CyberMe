/** Presentation-only adaptation of opstwin's sqlite-feishu-store profile resolution.
 * Never writes to the sibling database or changes inbox assessment/workflow state. */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { InboxItem } from '../../shared/types';
const sourcePath = fileURLToPath(new URL('../../../opstwin/server/data/dev.db', import.meta.url));
const parse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v || {}; } catch { return {}; } };
export function profileAvatar(p: any = {}): string {
 const value = p.avatar_url || p.avatar_thumb || p.avatarUrl || p.avatar?.avatar_72 || p.avatar?.avatar_240 || p.avatar?.avatar_640 || p.avatar?.avatar_origin || '';
 return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
}
type Directory = { owner: string; people: Map<string, any>; chats: Map<string, any> };
let cached: Directory | undefined, expires = 0;
export function messageDirectory(): Directory {
 if (cached && Date.now() < expires) return cached;
 const result: Directory = { owner: '', people: new Map(), chats: new Map() };
 let source: DatabaseSync | undefined;
 try {
  source = new DatabaseSync(sourcePath, { readOnly: true });
  source.exec('PRAGMA query_only=ON; BEGIN;');
  const meta = new Map((source.prepare('SELECT key,value FROM feishu_meta').all() as any[]).map(r => [r.key,r.value]));
  result.owner = String(meta.get('owner_open_id') || '');
  const register = (p: any, fallback = '') => { const id = p.open_id || p.user_id || p.id || fallback; if (id) result.people.set(id, {...result.people.get(id), ...p}); };
  register(parse(meta.get('owner_profile')), result.owner);
  for (const row of source.prepare('SELECT id,payload FROM feishu_chats').all() as any[]) {
   const p = parse(row.payload); result.chats.set(row.id, p);
   register(p.p2p_target_profile || {}, p.p2p_target_id);
   for (const member of p.member_profiles || []) register(member);
  }
  cached = result; expires = Date.now() + 60_000;
 } catch { return cached || result; }
 finally { if (source) { try { source.exec('ROLLBACK'); } finally { source.close(); } } }
 return result;
}
export function presentMessage(m: any, directory = messageDirectory()) {
 const p = directory.people.get(m.senderId) || {};
 return {...m, senderName: p.name || p.en_name || m.senderName || m.senderId || '', avatarUrl: profileAvatar(p) || profileAvatar(m), isMine: m.isMine ?? Boolean(directory.owner && m.senderId === directory.owner)};
}
export function presentInbox(item: InboxItem): InboxItem {
 if (!/^feishu$/i.test(item.channel)) return item;
 const directory = messageDirectory(), chat = directory.chats.get(item.sourceId || '') || {};
 const messages = (item.messages || []).map((m: any) => presentMessage(m, directory));
 return {...item, avatarUrl: profileAvatar(item) || profileAvatar(chat.p2p_target_profile) || profileAvatar(chat), chatMode: chat.chat_mode || item.chatMode, messages};
}
