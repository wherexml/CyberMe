// Build a synthetic reference using the approved HTML and original CSS/JS, without editing it.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve('docs/design'),out=resolve('output/native-parity-20261003/reference');await mkdir(out,{recursive:true});
const fixture=await (await fetch('http://127.0.0.1:46193/__qa/data')).json();
Object.assign(fixture,{histories:{},primaryConversationId:fixture.conversations[0].id,capturedAt:'2026-10-03T12:00:00.000Z',models:{channels:[],standard:{model:'fixture-read-only'},deep:{model:'fixture-read-only'}}});
for(const item of fixture.inbox){item.attention=true;item.triage={status:'succeeded',method:'jev',route:'quick_reply',needsReply:.92,needsOwner:.25,needsDeepThink:.4,risk:.1,missingContext:0,reason:'需要明确进度和下一步安排'};}
await writeFile(join(out,'visual-data.js'),'window.OPSTWINS_DESIGN_DATA='+JSON.stringify(fixture)+';');
const source=await readFile(join(root,'macos-ui-study.html'),'utf8');
const html=source.replace(/(?:href|src)="([^"\n]+)"/g,(m,url)=>{
 if(url==='../../.local/design/macos-study-data.js')return 'src="visual-data.js"';
 if(url==='../../.local/design/chat-capability.js')return 'src="data:text/javascript,void%200"';
 if(url.startsWith('#')||/^(https?:|data:)/.test(url))return m;
 return m.replace(url,pathToFileURL(resolve(root,url)).href);
}).replace('<body>','<body><script>const qaStorage=new Map();Object.defineProperty(window,"localStorage",{value:{getItem:key=>qaStorage.get(key)||null,setItem:(key,value)=>qaStorage.set(key,String(value)),removeItem:key=>qaStorage.delete(key)}});</script>');
await writeFile(join(out,'reference.html'),html);
await writeFile(join(out,'manifest.json'),JSON.stringify({kind:'SYNTHETIC-VISUAL-REFERENCE',source:'docs/design/macos-ui-study.html',sourceSha256:createHash('sha256').update(source).digest('hex'),data:'synthetic, read-only, no private messages',api:'http://127.0.0.1:46193'},null,2));console.log(join(out,'reference.html'));
