import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import ts from 'typescript';
// package.json is the single product version source for About and Info.plist.
export async function appVersion(root){const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('Invalid package.json version');return version}
export async function retireClassicEntry(assets){
 // Keep old bookmarks valid without booting the retired application or its API waits.
 await writeFile(resolve(assets,'desktop.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>CyberMe</title><meta http-equiv="refresh" content="0;url=cyberme.html"><script>location.replace("cyberme.html")</script></head><body><a href="cyberme.html">CyberMe</a></body></html>');
}

export async function fullAssets(root,assets){
 const source=resolve(root,'docs/design');
 await cp(resolve(source,'assets/idea-icons'),resolve(assets,'assets/idea-icons'),{recursive:true});
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
  [
    "const drafts=new Map();",
    "const drafts=new Map(),policySaves=new Set(),policyErrors=new Map();let policyWrites=Promise.resolve();"
  ],
  [
    "function refresh(){const dirty=JSON.stringify(value)!==JSON.stringify(policies[name]);save.disabled=!dirty;status.textContent=dirty?'未保存':'';}",
    "function refresh(){const dirty=JSON.stringify(value)!==JSON.stringify(policies[name]),busy=policySaves.has(name),error=policyErrors.get(name);save.disabled=busy||!dirty;cancel.disabled=busy;footer.hidden=!dirty&&!busy&&!error;status.textContent=busy?'保存中…':error||(dirty?'未保存':'');}"
  ],
  [
    "footer.append(status,c.actions(c.button('取消',()=>{drafts.delete(name);c.navigate(name);}),save));",
    "const cancel=c.button('取消',()=>{if(policySaves.has(name))return;drafts.delete(name);policyErrors.delete(name);c.navigate(name);});footer.append(status,c.actions(cancel,save));"
  ],
  [
    "function commit(name,value){\n    const next={...policies,[name]:structuredClone(value)};\n    try{localStorage.setItem(key,JSON.stringify(next));policies=next;c.toast('已保存');return true;}catch{c.toast('保存失败，请重试');return false;}\n  }",
    "function commit(name,value,owner){\n    const submitted=structuredClone(value);\n    const work=async()=>{const next={...policies,[name]:submitted},encoded=JSON.stringify(next);let previous;\n      try{previous=localStorage.getItem(key);localStorage.setItem(key,encoded);await window.OpsTwinsDesktop.durable();policies=next;policyErrors.delete(name);owner.toast('已保存');return true;}\n      catch(error){try{if(previous!==undefined&&localStorage.getItem(key)===encoded){if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);}}catch{}policyErrors.set(name,error?.message||'保存失败，请重试');owner.toast('保存失败，请重试');return false;}\n    };\n    const result=policyWrites.then(work,work);policyWrites=result.then(()=>{},()=>{});return result;\n  }"
  ],
  [
    "form.onsubmit=e=>{e.preventDefault();if(form.reportValidity()&&commit(name,value)){drafts.delete(name);c.navigate(name);}};",
    "form.onsubmit=async e=>{e.preventDefault();if(policySaves.has(name)||save.disabled||!form.reportValidity())return;const submitted=structuredClone(value),owner=c;policySaves.add(name);policyErrors.delete(name);refresh();try{if(await commit(name,submitted,owner)&&drafts.get(name)===value&&JSON.stringify(value)===JSON.stringify(submitted))drafts.delete(name)}finally{policySaves.delete(name);refresh();if(owner.root.isConnected&&owner.root.dataset.v17Section===name&&owner.root.closest('#settings-window')?.open)owner.navigate(name)}};"
  ]
]);
 await patch('macos-settings-controls.js',[["function select(node, value, options, onchange, label) {","function select(node, value, options, onchange, label) {options=options.map(([key,name,disabled])=>[key,window.OpsTwinsDesktop.translate(name),disabled]);label=window.OpsTwinsDesktop.translate(label);"]]);
 await patch('macos-dictation.js',[
 ["const config=window.OPSTWINS_CHAT_CAPABILITY;if(!config?.token)throw Error('本机语音连接未启动');","await window.OpsTwinsDesktop.durable();"],
 ["fetch(config.url+'/voice/transcribe',{method:'POST',headers:{'X-OpsTwins-Chat':config.token},body,","fetch('/api/voice/transcribe',{method:'POST',body,"],
 ["const submit=sendIntent;", "let autoSend=false;try{autoSend=JSON.parse(localStorage.getItem('opstwins-device-study-v1')||'{}').dictation?.autoSend===true}catch{}const submit=sendIntent||autoSend;"],
 ]);
 await patch('macos-chat-sessions.js',[
 ["state.selected=selected();", "const oldMain=state.mainId;if(data.primaryConversationId&&data.conversations?.some(c=>c.id===data.primaryConversationId&&!c.sideChat)){state.mainId=data.primaryConversationId;if(state.selected===oldMain||!data.conversations.some(c=>c.id===state.selected))state.selected=state.mainId;}state.selected=selected();"],
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
 ["window.OpsTwinsMarkdown.render(body,m.content)","window.OpsTwinsMarkdown.render(body,m.content,{reflow:m.role!=='user'})"],
 ["window.OpsTwinsMarkdown.render(body,r.result.assistantMessage.content)","window.OpsTwinsMarkdown.render(body,r.result.assistantMessage.content,{reflow:true})"],
 ["function renderChat(targetId){const root=$('#messages');", "function renderChat(targetId){const scrollState=window.OpsTwinsChatTimeline.capture(chatConversation,targetId);const root=$('#messages');"],
 ["requestAnimationFrame(()=>{const timeline=$('#timeline'),target=$$('#messages .message').find(a=>a.dataset.messageId===targetId);if(target)timeline.scrollTop+=target.getBoundingClientRect().top-timeline.getBoundingClientRect().top-35;else timeline.scrollTop=timeline.scrollHeight})", "window.OpsTwinsChatTimeline.commit(scrollState)"],
 ["const timeline=$('#timeline'),top=timeline.scrollTop,follow=timeline.scrollHeight-top-timeline.clientHeight<48,opened=", "const opened="],
 ["if(!follow)requestAnimationFrame(()=>timeline.scrollTop=top)", ""],
["b.setAttribute('aria-pressed',ideaCategory===c);root.append(b)","b.dataset.interfaceCategory=String(c==='all'||!!categoryNames[c]);b.setAttribute('aria-pressed',ideaCategory===c);root.append(b)"],["Object.assign(categoryNames,{meetings:'会议',customers:'客户',followups:'后续事项'});","Object.assign(categoryNames,{meetings:'会议',customers:'客户',followups:'后续事项',workflow:'工作流'});"],
 ["renderChatRuns(root);", "renderChatRuns(root);window.OpsTwinsChatTimeline.arrange(root,messages,window.OpsTwinsDesignChat.entries().filter(r=>r.conversationId===chatConversation||!r.conversationId&&chatConversation===window.OpsTwinsChatSessions.main()),appendTime);"],
 ["const details=node('details');details.append(node('summary','',r.title||r.message.slice(0,70)),node('pre','',r.message));context.append(details);", "if(r.ideaId){const details=node('details');details.append(node('summary','',r.title||r.message.slice(0,70)),node('pre','',r.message));context.append(details)}else{context.classList.remove('chat-task-context');context.classList.add('chat-real-text');context.textContent=r.message;}"],
 ["}else{\n   const state=node('div','chat-run-status',r.status==='running'?'正在处理…':r.error||'等待处理');", "}else if(['prepared','running'].includes(r.status)){body.classList.add('chat-thinking');const state=node('span','chat-thinking-dots');state.setAttribute('role','status');state.setAttribute('aria-label',window.OpsTwinsDesktop.translate('正在思考'));for(let i=0;i<3;i++){const dot=node('i');dot.setAttribute('aria-hidden','true');state.append(dot)}body.append(state);}else{\n   const label=r.status==='partial'?'部分操作已完成':r.status==='cancelled'?'已停止':r.status==='failed'?(String(r.error||'').includes('额度')?'模型额度不足':'暂时无法完成'):'暂未收到完整结果';const state=node('div','chat-run-status',label);if(r.error&&r.error!==label){const detail=node('details');detail.append(node('summary','','查看详情'),node('p','',r.error));state.append(detail)}"],
 ["filter==='quiet'?x.quiet:filter==='all'?true:x.attention&&!local.ignored.includes(x.id)&&!local.done.includes(x.id)", "window.OpsTwinsBusinessUI.matchesInboxFilter(x,filter)"],

 ["function node(tag,cls,text){", "prefs.language=data.settings.identity.language||prefs.language;prefs.font=15;prefs.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;function node(tag,cls,text){"],
 ["function apply(){", "function apply(){window.OpsTwinsDesktop.localizeStatic?.();"],
 ["else messages=messages.slice(-30);", ""],["if(r.status==='unknown')body.append", "if(r.status==='unknown'&&r.missing)body.append(btn('重试原请求',()=>void window.OpsTwinsDesignChat.retry(r),'chat-retry'));if(r.status==='unknown')body.append"],["appendCards(real,false);appendCards(samples,true);", "appendCards(real,false);if(!real.length)list.append(node('div','data-empty','还没有建议，点击生成建议'));"],
 ["$('#attachment-info').onclick=()=>toast('附件入口预览，设计稿不会上传文件');",""],
 ]);
 const standard=resolve(assets,'full/components');await mkdir(standard,{recursive:true});
 await cp(resolve(root,'mock/opstwins/components/select.css'),resolve(standard,'select.css'));
 const strictReplace=(source,from,to)=>{if(!source.includes(from))throw Error('Shared component source drift: '+from);return source.replace(from,to)};
 let core=await readFile(resolve(root,'mock/opstwins/components/select.js'),'utf8');
 core=strictReplace(core,'document.body.append(menu);',"(button.closest('dialog[open]')||document.body).append(menu);if(typeof menu.showPopover==='function'){menu.setAttribute('popover','manual');menu.showPopover()}");
 core=strictReplace(core,'tabindex="-1" data-vm-option=',"${o.disabled?'disabled aria-disabled=\"true\"':''} tabindex=\"-1\" data-vm-option=");
 core=strictReplace(core,"menu.querySelector('[aria-selected=\"true\"]')","menu.querySelector('[aria-selected=\"true\"]:not(:disabled)')");
 core=strictReplace(core,"menu.querySelector('[role=\"option\"]')","menu.querySelector('[role=\"option\"]:not(:disabled)')");
 core=strictReplace(core,'close();document.dispatchEvent',"if(o.disabled)return;close();document.dispatchEvent");
 core=strictReplace(core,`[...menu.querySelectorAll('[role="option"]')]`,`[...menu.querySelectorAll('[role="option"]:not(:disabled)')]`);
 core=strictReplace(core,"menu.style.width=Math.min(r.width,innerWidth-16)+'px';menu.style.left=Math.max(8,Math.min(r.left,innerWidth-r.width-8))+'px';","menu.style.width='max-content';menu.style.minWidth=Math.min(r.width,innerWidth-16)+'px';menu.style.maxWidth=(innerWidth-16)+'px';const menuWidth=menu.getBoundingClientRect().width;menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menuWidth-8))+'px';");
 await writeFile(resolve(standard,'select.js'),core);
 const reused=resolve(assets,'full/v17');await mkdir(resolve(reused,'assets'),{recursive:true});
 for(const name of ['ui.js','markdown.js','message-actions.js','message-actions.css','task-agents.js','task-agents.css'])await cp(resolve(root,'mock/opstwins',name),resolve(reused,name));
 await cp(resolve(root,'mock/opstwins/assets/product-icons.js'),resolve(reused,'assets/product-icons.js'));
 await cp(resolve(root,'mock/opstwins/vendor'),resolve(reused,'vendor'),{recursive:true});
 const messagePath=resolve(reused,'message-actions.js');let messageSource=await readFile(messagePath,'utf8');messageSource=strictReplace(messageSource,"document.querySelector('#app'),{childList:true", "document.querySelector('#app')||document.body,{childList:true");messageSource=strictReplace(messageSource,"await navigator.clipboard.writeText(String(text));", "if(window.mygo)await window.mygo.call('DesktopFiles.Copy',String(text));else await navigator.clipboard.writeText(String(text));");await writeFile(messagePath,messageSource);
 const markdownPath=resolve(reused,'markdown.js'),unsafeHref="if(!/^(https?:\\/\\/|mailto:)/i.test(href))el.removeAttribute('href');",markdownSource=await readFile(markdownPath,'utf8');if(!markdownSource.includes(unsafeHref))throw Error('Reference changed: markdown.js unsafe href');await writeFile(markdownPath,markdownSource.replace(unsafeHref,"if(!/^(https?:\\/\\/|mailto:)/i.test(href)){el.replaceWith(...el.childNodes);continue}"));
 const agentPath=resolve(reused,'task-agents.js');let agentSource=await readFile(agentPath,'utf8');
 // Production adapter uses the same shared VMSelect for task controls.
 agentSource=strictReplace(agentSource,"import {upgradeSelects} from './components/adapter.js';",'const upgradeSelects=()=>window.OpsTwinsSelects.scan();');
 await writeFile(agentPath,strictReplace(agentSource,"async function api(path,body){","async function api(path,body){if(body!==undefined)await window.OpsTwinsDesktop.durable();"));
 await cp(resolve(root,'web/src/desktop/full/v17.css'),resolve(assets,'full/v17.css'));
 const bundle=await readFile(resolve(assets,'desktop-islands.html'),'utf8');
 const island=bundle.match(/<script[^>]*src="([^"]+)"/)[1];
 let html=await readFile(resolve(source,'macos-ui-study.html'),'utf8');
 const scripts=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]).filter(p=>!p.startsWith('../../'));
 const sequence=[];for(const s of scripts){if(s==='macos-ui-study.js')sequence.push('full/chat-timeline.js','full/autonomy.js','full/support.js','full/general.js');if(s==='macos-dictation.js'){sequence.push('full/no-dictation.js');continue;}if(s==='macos-ui-study.js')sequence.push('full/chat-timeline.js');if(s==='macos-design-chat.js')sequence.push('full/chat.js');else if(s==='macos-inbox-preview.js')sequence.push('full/inbox-preview.js');else sequence.push(s);if(s==='macos-settings-study.js')sequence.push('full/settings.js')}
 sequence.push('full/update.js','full/ideas-console.js','full/ideas-console-entry.js','full/records.js','full/workspace.js','full/ideas.js','full/inbox.js','full/window-chrome.js','full/memory.js','full/refinement.js','full/inbox-chat.js','full/interface-labels.js','full/work-cards.js','full/v6-return.js');
 html=html.replace(/<script src="[^"]+"><\/script>/g,'');
 const css=[...bundle.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>`<link rel="stylesheet" href="${m[1]}">`).join('');
 html=strictReplace(html,'<body>','<link rel="stylesheet" href="full/components/select.css">'+css+'<link rel="stylesheet" href="full/ideas-console.css"><link rel="stylesheet" href="full/product.css"><link rel="stylesheet" href="full/v17/message-actions.css"><link rel="stylesheet" href="full/v17/task-agents.css"><link rel="stylesheet" href="full/v17.css"><link rel="stylesheet" href="full/inbox-policy.css"><link rel="stylesheet" href="full/work-cards.css"><body>');
 html+=`<script>window.OPSTWINS_DESKTOP_MODE=true;window.OPSTWINS_APP_VERSION=${JSON.stringify(await appVersion(root))};window.OPSTWINS_DESKTOP_MANIFEST=${JSON.stringify({islands:island,scripts:sequence})}</script><script src="full/runtime.js"></script><script src="full/bootstrap.js"></script>`;
 await writeFile(resolve(assets,'desktop.html'),html.replaceAll('OpsTwins macOS 设计原型','CyberMe').replace('OpsTwins · macOS UI study','CyberMe').replace('<title>CyberMe</title>','<title>CyberMe</title><link rel="icon" href="icon.svg" type="image/svg+xml">'));
 await cp(resolve(root,'web/src/desktop/full/ideas-console.css'),resolve(assets,'full/ideas-console.css'));
 await cp(resolve(root,'web/src/desktop/full/product.css'),resolve(assets,'full/product.css'));
 await cp(resolve(root,'web/src/desktop/full/update-refresh.png'),resolve(assets,'full/update-refresh.png'));
 await cp(resolve(root,'web/src/desktop/full/inbox-policy.css'),resolve(assets,'full/inbox-policy.css'));
 // Chat work cards reuse the compact Mock card styles unchanged.
 await writeFile(resolve(assets,'full/work-cards.css'),await readFile(resolve(root,'mock/opstwins/work-cards.css'),'utf8')+'\n'+await readFile(resolve(root,'web/src/desktop/full/work-cards.css'),'utf8'));
 // One SVG source for the embedded mark, favicon and macOS icon build.
 for(const target of ['icon.svg','assets/opstwins.svg'])await cp(resolve(root,'native/mygo/brand/cyberme.svg'),resolve(assets,target));
 const brandText=text=>text.replace(/\bOpsTwins\b/g,'CyberMe');
 const strings=JSON.parse(await readFile(resolve(root,'web/src/desktop/full/interface-strings.json'),'utf8'));
 for(const [key,value] of Object.entries(strings)){strings[key]=brandText(value);strings[brandText(key)]=brandText(value)}
 await writeFile(resolve(assets,'full/interface-strings.js'),'window.OPSTWINS_INTERFACE_STRINGS='+JSON.stringify(strings)+';');
 // Translate literal interface arguments, never runtime business content.
 for(const name of [...sequence,'macos-device-settings.js']){
  const path=resolve(assets,name),source=ts.createSourceFile(name,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const translate=text=>ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('window'),'OpsTwinsDesktop'),'translate'),undefined,[ts.factory.createStringLiteral(text)]);
  let quoteTitleCount=0;
  const result=ts.transform(source,[ctx=>root=>{
   function visit(n){
    // Static source literals only: preserve namespaces, storage keys and runtime user content.
    if(ts.isStringLiteral(n)&&brandText(n.text)!==n.text)return ts.factory.createStringLiteral(brandText(n.text));
    if(name==='full/refinement.js'&&ts.isConditionalExpression(n)&&ts.isStringLiteral(n.whenTrue)&&ts.isStringLiteral(n.whenFalse)&&n.whenTrue.text==='你的消息'&&n.whenFalse.text==='分身回复'){quoteTitleCount++;return ts.factory.updateConditionalExpression(n,n.condition,n.questionToken,translate(n.whenTrue.text),n.colonToken,translate(n.whenFalse.text));}
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
  if(name==='full/refinement.js'&&quoteTitleCount!==2)throw Error('Quote title source drift: '+quoteTitleCount);
  await writeFile(path,ts.createPrinter().printFile(result.transformed[0]));result.dispose();
 }
 const entry=resolve(assets,'desktop.html');await writeFile(entry,strictReplace(await readFile(entry,'utf8'),'<script src="full/bootstrap.js">','<script src="full/interface-strings.js"></script><script src="full/localization.js"></script><script src="full/components/select.js"></script><script src="full/standard-selects.js"></script><script src="full/bootstrap.js">'));
}
