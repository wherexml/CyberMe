// Read-only before/after hashes. No private content is written to evidence.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
const root=path.join(os.homedir(),'Library/Application Support/OpsTwins'),out=path.resolve('output/memory-artwork-20261106'),h=v=>crypto.createHash('sha256').update(JSON.stringify(v??null)).digest('hex');
const db=new DatabaseSync(root+'/data/opstwin-advance.db',{readOnly:true});
const rows=t=>db.prepare('SELECT id,data,deleted FROM entities WHERE type=?').all(t).map(r=>({...JSON.parse(r.data),deleted:r.deleted}));
const byId=(items,select)=>Object.fromEntries(items.map(r=>[h(r.id),h(select(r))]));
const state=JSON.parse(fs.readFileSync(root+'/.local/mygo-workspace/state.json','utf8')),ui=JSON.parse(state.drafts?.['html:cyberme-v6-ui']||'{}');
const settings=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get()?.value||'{}');
const current={inbox:byId(rows('inbox'),r=>[r.draft,r.draftCandidate,r.manualDraft,r.editedByUser,r.receipt]),messages:byId(rows('messages').filter(r=>!r.ideaAnalysis&&!r.inboxAnalysis),r=>[r.content,r.role,r.deleted]),memories:byId(rows('memories'),r=>r),tasks:byId(rows('tasks'),r=>r),sendLedger:h(db.prepare('SELECT * FROM send_intents ORDER BY key').all()),identity:h(settings.identity),knowledgePaths:h(settings.knowledgePaths),composerDrafts:h(ui.drafts),memoryDraft:h(ui.memDraft)};db.close();
if(process.argv[2]==='before'){fs.writeFileSync(out+'/preservation-before.json',JSON.stringify(current));console.log({saved:true,inbox:Object.keys(current.inbox).length,messages:Object.keys(current.messages).length});}
else{const before=JSON.parse(fs.readFileSync(out+'/preservation-before.json'));const checks=Object.fromEntries(Object.keys(current).map(k=>[k,typeof current[k]==='string'?current[k]===before[k]:Object.entries(before[k]).every(([id,v])=>current[k][id]===v)]));fs.writeFileSync(out+'/preservation-after.json',JSON.stringify({checks},null,2));console.log(checks);if(Object.values(checks).some(v=>!v))process.exitCode=1;}
