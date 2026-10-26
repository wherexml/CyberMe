// Read-only daily-workspace preservation; evidence contains hashes and counts only.
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('phase required');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),api=async p=>{const r=await fetch('http://127.0.0.1:46110/api/'+p);if(!r.ok)throw Error('HTTP '+r.status);return r.json()};
const [inbox,primary,models]=await Promise.all(['inbox','conversations/primary','settings/models'].map(api));
const state=JSON.parse(await readFile('/Users/steve/Library/Application Support/OpsTwins/.local/mygo-workspace/state.json'));const sessions=JSON.parse(state.drafts?.['html:opstwins-design-sessions-v1']||'{}');
const value={composerDraftsHash:hash(Object.fromEntries(Object.entries(sessions.drafts||{}).filter(([,draft])=>draft!==''))),inboxCount:inbox.length,draftsHash:hash(inbox.map(i=>[i.id,i.draft,i.draftCandidate,i.editedByUser]).sort((a,b)=>a[0].localeCompare(b[0]))),primaryHash:hash(primary.conversationId),modelsHash:hash(models)};
const dir='output/mygo-chat-position-20261019';await writeFile(dir+'/data-'+phase+'.json',JSON.stringify(value,null,2));
if(phase==='after'){const before=JSON.parse(await readFile(dir+'/data-before.json'));const checks=Object.keys(value).map(name=>({name,pass:value[name]===before[name]}));await writeFile(dir+'/data-preservation.json',JSON.stringify({checks,privateContentSaved:false},null,2));console.log(checks);if(checks.some(c=>!c.pass))process.exitCode=1}else console.log({baselineSaved:true,inboxCount:inbox.length});
