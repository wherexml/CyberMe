#!/usr/bin/env node
// Snapshot public A/B-only state around real GUI actions. Never drives UI or proxy.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=process.env.OPSTWIN_GUI_MANIFEST||root+'.local/acceptance/native-chat-state/2026-10-03T14-02-52.651Z/result.json';
const label=process.argv[2]||'prepared';
if(!/^[a-zA-Z0-9_-]{1,64}$/.test(label))throw new Error('Use a public evidence label');
const fixture=JSON.parse(await readFile(manifest,'utf8'));
if(!fixture.passed||fixture.sessionIds?.length!==2||!fixture.guiDataDir.startsWith(root+'.local/acceptance/native-chat-state/'))throw new Error('Refuse non-isolated fixture');
const ids=fixture.sessionIds,api='http://127.0.0.1:46110',proxy='http://127.0.0.1:46191',hash=value=>createHash('sha256').update(String(value||'')).digest('hex');
async function get(base,path){try{const r=await fetch(base+path,{signal:AbortSignal.timeout(12000)});return{status:r.status,value:await r.json()}}catch{return{status:0,value:{unavailable:true}}}}
let state={};try{state=JSON.parse(await readFile(fixture.guiDataDir+'/chat.json','utf8'))}catch{}
const draft=text=>({characters:String(text||'').length,hash:hash(text),publicMarker:String(text||'').includes('OPSADV-QA')});
const local={selectedConversation:ids.includes(state.selectedConversation)?state.selectedConversation:'outside-public-fixture',keepPanelVisible:!!state.keepPanelVisible,draft:ids.includes(state.selectedConversation)?draft(state.draft):{withheld:true},drafts:Object.fromEntries(ids.map(id=>[id,{...draft(state.drafts?.[id]?.text),attachmentIds:(state.drafts?.[id]?.attachments||[]).map(x=>x.id)}])),outgoing:(state.outgoing||[]).filter(x=>ids.includes(x.conversationId)).map(x=>({requestId:x.requestId,conversationId:x.conversationId,state:x.state,retryable:x.retryable,generation:x.generation,text:draft(x.text),attachmentIds:(x.attachments||[]).map(a=>a.id)}))};
const sessions=[];
for(const id of ids){const r=await get(api,'/api/conversations/'+id+'/messages?limit=200');const q=await get(api,'/api/chat/continuation/'+id);sessions.push({id,messagesStatus:r.status,messages:(r.value.items||[]).map(x=>({id:x.id,role:x.role,requestId:x.requestId,runId:x.runId,contentHash:hash(x.content),publicMarker:String(x.content||'').includes('OPSADV-QA')})),queueStatus:q.status,queue:(q.value.items||[]).map(x=>({id:x.id,status:x.status,fingerprint:x.fingerprint,updatedAt:x.updatedAt,readOnly:x.readOnly===true}))});}
const p=await get(proxy,'/__qa/status'),accepted=new Set(local.outgoing.map(x=>x.requestId));for(const s of sessions){for(const m of s.messages)if(m.requestId)accepted.add(m.requestId);for(const q of s.queue)accepted.add(q.id)}
const requests=[];for(const id of accepted){const r=await get(api,'/api/chat/requests/'+encodeURIComponent(id));if(r.status===404||ids.includes(r.value.conversationId))requests.push({id,status:r.status,state:r.value.status,conversationId:r.value.conversationId,runId:r.value.runId,completedWriteCount:(r.value.completedWrites||[]).length});}
const primary=await get(api,'/api/conversations/primary'),states=await get(api,'/api/chat/conversations/state?ids='+encodeURIComponent(ids.join(',')));
const evidence={schema:1,label,createdAt:new Date().toISOString(),manifest,local,sessions,requests,states:{status:states.status,items:states.value.items||[]},primaryUnchanged:primary.status===200&&hash(primary.value.conversationId)===fixture.primaryPointerHash,proxy:{status:p.status,offline:p.value.offline,dropChatResponse:p.value.dropChatResponse,attempts:(p.value.attempts||[]).filter(x=>accepted.has(x.requestId)&&x.path==='/api/chat'),readbacks:(p.value.readbacks||[]).filter(x=>accepted.has(x.requestId)&&x.path.startsWith('/api/chat/requests/'))},guiVerdict:'NOT_RUN: snapshot alone does not prove UI action'};
const out=root+'.local/acceptance/native-chat-gui-v10';await mkdir(out,{recursive:true});const path=out+'/'+label+'.json';await writeFile(path,JSON.stringify(evidence,null,2));console.log(JSON.stringify({path,selectedConversation:local.selectedConversation,primaryUnchanged:evidence.primaryUnchanged,proxyAvailable:p.status===200}));
