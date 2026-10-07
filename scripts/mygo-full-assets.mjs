import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import ts from 'typescript';
export async function fullAssets(root,assets){
 const source=resolve(root,'docs/design');
 const patch=async(name,changes)=>{let text=await readFile(resolve(source,name),'utf8');for(const [from,to] of changes){if(!text.includes(from))throw Error('Reference changed: '+name+' '+from.slice(0,50));text=text.replace(from,to)}await writeFile(resolve(assets,name),text)};
 await cp(resolve(root,'web/src/desktop/full'),resolve(assets,'full'),{recursive:true,filter:p=>!p.endsWith('.tsx')&&!p.endsWith('.css')});
 await patch('macos-settings-study.js',[
 [",row('正文大小','',select(ctx.prefs.font,[['14','14 pt'],['15','15 pt'],['16','16 pt']],v=>update('font',Number(v)),'正文大小')),row('减少动态效果','',toggle(ctx.prefs.reduced,v=>update('reduced',v),'减少动态效果'))",""],
 ["const button=(text,fn,cls='ss-button')=>ctx.btn(text,fn,cls);", "const button=(text,fn,cls='ss-button')=>ctx.btn(window.OpsTwinsDesktop.translate(text),fn,cls);"],
 ["function card(title,sub){", "function card(title,sub){title=window.OpsTwinsDesktop.translate(title);sub=window.OpsTwinsDesktop.translate(sub);"],
 ["function field(title,control,sub){", "function field(title,control,sub){title=window.OpsTwinsDesktop.translate(title);sub=window.OpsTwinsDesktop.translate(sub);"],
 ["function header(title){", "function header(title){title=window.OpsTwinsDesktop.translate(title);"],
 ["function row(title,sub,control){", "function row(title,sub,control){title=window.OpsTwinsDesktop.translate(title);sub=window.OpsTwinsDesktop.translate(sub);"],
 ["element.onsubmit=e=>{e.preventDefault();if(!element.reportValidity())return;const previous=state.saved[key];state.saved[key]=clone(draft);delete state.drafts[key];if(!stash()){if(previous===undefined)delete state.saved[key];else state.saved[key]=previous;state.drafts[key]=draft;return;}ctx.toast('已保存');refresh();updateDraftSummary();render();};",`element.onsubmit=async e=>{e.preventDefault();if(!element.reportValidity()||save.disabled)return;const submitted=clone(draft),owner=ctx.setting;save.disabled=true;try{const canonical=await window.OpsTwinsDesktop.saveSetting(key,submitted,state.saved[key]??real);state.saved[key]=clone(canonical);if(JSON.stringify(draft)===JSON.stringify(submitted))delete state.drafts[key];stash();await window.OpsTwinsDesktop.durable();if(ctx.setting===owner){ctx.toast('已保存');refresh();updateDraftSummary();render()}}catch(error){status.textContent=error.message;save.disabled=false;if(error.status===409){const rebase=document.createElement('button');rebase.type='button';rebase.textContent='读取最新版本，保留输入';rebase.onclick=async()=>{try{const latest=await window.OpsTwinsDesktop.api('GET','/api/settings');state.saved[key]=clone(latest[key]);stash();await window.OpsTwinsDesktop.durable();status.textContent='已读取最新版本，当前输入保留，请检查后保存'}catch(e){status.textContent=e.message}};status.append(rebase)}}};`],
 ["if(state.revision!==ctx.data.revision||state.modelVersion!==ctx.data.models?.version)","if(state.revision===undefined)"],
 ["stored?.revision===ctx.data.revision&&stored.modelVersion===ctx.data.models?.version&&stored.drafts&&stored.saved","stored?.drafts&&stored.saved"],
 ["未保存的预览 · ","未保存 · "],["业务配置取自 Web","配置已连接工作区"],
 ["function update(key,value){ctx.prefs[key]=value;ctx.apply();preferenceError=!ctx.save();render();}","async function update(key,value){try{if(key==='language'){const saved=await window.OpsTwinsDesktop.api('PATCH','/api/settings',{identity:{language:value}});ctx.data.settings=saved}ctx.prefs[key]=value;ctx.apply();preferenceError=!ctx.save();await window.OpsTwinsDesktop.durable();render()}catch(e){preferenceError=true;ctx.toast(e.message);render()}}"]]);
 await patch('macos-device-settings.js',[
 ["function commit(name,value){","async function commit(name,value){"],
 ["policies=next;c.toast('已保存');","await window.OpsTwinsDesktop.durable();policies=next;c.toast('已保存');"],
 ["form.onsubmit=e=>{e.preventDefault();if(form.reportValidity()&&commit(name,value)){drafts.delete(name);c.navigate(name);}};", "form.onsubmit=async e=>{e.preventDefault();if(save.disabled||!form.reportValidity())return;const submitted=structuredClone(value);save.disabled=true;if(await commit(name,submitted)){if(JSON.stringify(value)===JSON.stringify(submitted)){drafts.delete(name);if(c.setting===name)c.navigate(name)}else refresh()}else refresh()};"],
 ]);
 await patch('macos-settings-controls.js',[["function select(node, value, options, onchange, label) {","function select(node, value, options, onchange, label) {options=options.map(([key,name,disabled])=>[key,window.OpsTwinsDesktop.translate(name),disabled]);label=window.OpsTwinsDesktop.translate(label);"]]);
 await patch('macos-dictation.js',[
 ["const config=window.OPSTWINS_CHAT_CAPABILITY;if(!config?.token)throw Error('本机语音连接未启动');","await window.OpsTwinsDesktop.durable();"],
 ["fetch(config.url+'/voice/transcribe',{method:'POST',headers:{'X-OpsTwins-Chat':config.token},body,","fetch('/api/voice/transcribe',{method:'POST',body,"],
 ["const submit=sendIntent;", "let autoSend=false;try{autoSend=JSON.parse(localStorage.getItem('opstwins-device-study-v1')||'{}').dictation?.autoSend===true}catch{}const submit=sendIntent||autoSend;"],
 ]);
 await patch('macos-chat-sessions.js',[
 ["function patch(id,fields){","async function patch(id,fields){try{await window.OpsTwinsDesktop.manageSession(id,fields)}catch(e){hooks.notify(e.message);return false}"],
 ["form.onsubmit=e=>","form.onsubmit=async e=>"],
 ["if(!patch(item.id,kind===","if(!await patch(item.id,kind==="],
 ["undo.onclick=()=>{if(patch(undoId,{deleted:false}))","undo.onclick=async()=>{if(await patch(undoId,{deleted:false}))"],
 ["const add=button('',()=>{","const add=button('',async()=>{"],
 ["const id='ui-side-'+crypto.randomUUID();if(mutate", "const id='ui-side-'+crypto.randomUUID();try{await window.OpsTwinsDesktop.createSession(id,'新会话')}catch(e){hooks.notify(e.message);return}if(mutate"],
 ["将从此设计稿隐藏，可以撤销。","将被删除，可以撤销。"],
 ["q('.chat-layout').classList.toggle('sessions-docked',opened&&state.keepVisible)","q('.chat-layout').classList.toggle('sessions-docked',opened)"],
 ["hooks.select(id,state.drafts[id]||'',target);","hooks.select(id,state.drafts[id]||'',target);window.dispatchEvent(new CustomEvent('desktop-session-selected',{detail:{id,target}}));"]]);
 await patch('macos-ui-study.js',[
 ["function node(tag,cls,text){", "prefs.language=data.settings.identity.language||prefs.language;prefs.font=15;prefs.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;function node(tag,cls,text){"],
 ["function apply(){", "function apply(){window.OpsTwinsDesktop.localizeStatic?.();"],
 ["else messages=messages.slice(-30);", ""],["if(r.status==='unknown')body.append", "if(r.status==='unknown'&&r.missing)body.append(btn('重试原请求',()=>void window.OpsTwinsDesignChat.retry(r),'chat-retry'));if(['unknown','running'].includes(r.status))body.append"],["appendCards(real,false);appendCards(samples,true);", "appendCards(real,false);if(!real.length)list.append(node('div','data-empty','还没有建议，点击生成建议'));"],
 ["$('#attachment-info').onclick=()=>toast('附件入口预览，设计稿不会上传文件');",""],
 ]);
 const bundle=await readFile(resolve(assets,'desktop-islands.html'),'utf8');
 const island=bundle.match(/<script[^>]*src="([^"]+)"/)[1];
 let html=await readFile(resolve(source,'macos-ui-study.html'),'utf8');
 const scripts=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]).filter(p=>!p.startsWith('../../'));
 const sequence=[];for(const s of scripts){if(s==='macos-design-chat.js')sequence.push('full/chat.js');else if(s==='macos-inbox-preview.js')sequence.push('full/inbox-preview.js');else sequence.push(s);if(s==='macos-settings-study.js')sequence.push('full/settings.js')}
 sequence.push('full/records.js','full/workspace.js','full/inbox.js');
 html=html.replace(/<script src="[^"]+"><\/script>/g,'');
 const css=[...bundle.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>`<link rel="stylesheet" href="${m[1]}">`).join('');
 html=html.replace('<body>',css+'<link rel="stylesheet" href="full/product.css"><body>');
 html+=`<script>window.OPSTWINS_DESKTOP_MODE=true;window.OPSTWINS_DESKTOP_MANIFEST=${JSON.stringify({islands:island,scripts:sequence})}</script><script src="full/runtime.js"></script><script src="full/bootstrap.js"></script>`;
 await writeFile(resolve(assets,'desktop.html'),html.replaceAll('OpsTwins macOS 设计原型','OpsTwins').replace('OpsTwins · macOS UI study','OpsTwins'));
 await cp(resolve(root,'web/src/desktop/full/product.css'),resolve(assets,'full/product.css'));
 const strings=JSON.parse(await readFile(resolve(root,'web/src/desktop/full/interface-strings.json'),'utf8'));
 await writeFile(resolve(assets,'full/interface-strings.js'),'window.OPSTWINS_INTERFACE_STRINGS='+JSON.stringify(strings)+';');
 // Translate literal interface arguments, never runtime business content.
 for(const name of [...sequence,'macos-device-settings.js']){
  const path=resolve(assets,name),source=ts.createSourceFile(name,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const translate=text=>ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('window'),'OpsTwinsDesktop'),'translate'),undefined,[ts.factory.createStringLiteral(text)]);
  const result=ts.transform(source,[ctx=>root=>{
   function visit(n){
    if(ts.isCallExpression(n)){
     const name=ts.isIdentifier(n.expression)?n.expression.text:ts.isPropertyAccessExpression(n.expression)?n.expression.name.text:'';
     const index=['btn','button','toast','notify'].includes(name)?0:['node','n'].includes(name)?2:name==='setAttribute'&&['aria-label','placeholder','title'].includes(n.arguments[0]?.text)?1:-1;
     if(index>=0&&n.arguments[index]&&ts.isStringLiteral(n.arguments[index])&&strings[n.arguments[index].text])return ts.factory.updateCallExpression(n,n.expression,n.typeArguments,n.arguments.map((a,i)=>i===index?translate(a.text):ts.visitNode(a,visit)));
    }
    if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(n.left)&&n.left.name.text==='textContent'&&ts.isStringLiteral(n.right)&&strings[n.right.text])return ts.factory.updateBinaryExpression(n,n.left,n.operatorToken,translate(n.right.text));
    return ts.visitEachChild(n,visit,ctx);
   }
   return ts.visitNode(root,visit);
  }]);
  await writeFile(path,ts.createPrinter().printFile(result.transformed[0]));result.dispose();
 }
 const entry=resolve(assets,'desktop.html');await writeFile(entry,(await readFile(entry,'utf8')).replace('<script src="full/bootstrap.js">','<script src="full/interface-strings.js"></script><script src="full/localization.js"></script><script src="full/bootstrap.js">'));
}
