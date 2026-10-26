import {esc,icon,ib,button} from './ui.js';

export function knowledgePathsMarkup(s,u){
 const paths=s.knowledgePaths||[],editing=paths.find(x=>x.id===u.knowledgePathEdit);
 return `<section class="settings-section knowledge-paths"><h3>本机文件夹</h3><div class="knowledge-path-list">${paths.map(x=>`<div class="knowledge-path-row" data-knowledge-path="${esc(x.id)}">${icon('folder')}<span title="${esc(x.path)}">${esc(x.path)}</span>${ib('修改路径','edit-knowledge-path:'+x.id,'edit')}${ib('移除路径','remove-knowledge-path:'+x.id,'close')}</div>`).join('')}</div><form id="knowledge-path-form" data-path-id="${esc(editing?.id||'')}"><div class="knowledge-path-entry"><input name="path" aria-label="知识资料文件夹路径" placeholder="~/Documents/知识资料" value="${esc(editing?.path||'')}" maxlength="4096" autocomplete="off" spellcheck="false" required><button class="secondary">${editing?'保存':'添加'}</button>${editing?button('取消','cancel-knowledge-path','subtle'):''}</div><div class="form-feedback" role="status">${esc(u.knowledgePathError||'')}</div></form></section>`;
}

export function createKnowledgePathsController({getState,getUI,save,render,clearDraft}){
 const form=()=>document.querySelector('#knowledge-path-form');
 const error=text=>{getUI().knowledgePathError=text;const el=form()?.querySelector('.form-feedback');if(el)el.textContent=text};
 function validate(raw){
  const trimmed=raw.trim(),path=['/','~/'].includes(trimmed)?trimmed:trimmed.replace(/\/+$/,'');
  if(!path||path.length>4096||/\p{Cc}/u.test(raw)||!(path.startsWith('/')||path.startsWith('~/')))return {error:'请输入 / 或 ~/ 开头的本机文件夹路径'};
  return {path};
 }
 function submit(f){
  const checked=validate(f.elements.path.value);if(checked.error){error(checked.error);return}
  const s=getState(),paths=s.knowledgePaths||[],id=f.dataset.pathId;
  if(id&&!paths.some(x=>x.id===id)){error('原路径已不存在，请重新添加');return}
  if(paths.some(x=>x.id!==id&&x.path===checked.path)){error('这个路径已添加');return}
  const row={id:id||crypto.randomUUID(),path:checked.path};
  s.knowledgePaths=id?paths.map(x=>x.id===id?row:x):[...paths,row];
  if(!save()){s.knowledgePaths=paths;error('保存失败，路径已保留，请重试');return}
  clearDraft(f);getUI().knowledgePathEdit=null;getUI().knowledgePathError='';render();
 }
 const actions={
  'edit-knowledge-path':id=>{if(!(getState().knowledgePaths||[]).some(x=>x.id===id))return;getUI().knowledgePathEdit=id;getUI().knowledgePathError='';render();form()?.elements.path.focus()},
  'cancel-knowledge-path':()=>{clearDraft(form());getUI().knowledgePathEdit=null;getUI().knowledgePathError='';render()},
  'remove-knowledge-path':id=>{const s=getState(),paths=s.knowledgePaths||[];if(!paths.some(x=>x.id===id))return;s.knowledgePaths=paths.filter(x=>x.id!==id);if(!save()){s.knowledgePaths=paths;error('移除失败，原路径已保留，请重试');return}if(getUI().knowledgePathEdit===id){clearDraft(form());getUI().knowledgePathEdit=null}getUI().knowledgePathError='';render()}
 };
 return {submit,actions};
}
