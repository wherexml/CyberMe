import {esc,icon,button,ib,markdown} from './ui.js';
import {sourceAttrs,sourceLinks,quoteButton} from './chat-quotes.js';
import {Marked} from './vendor/marked.js';
import {taskMarkers} from './vendor/task-markdown.js';
import {sanitizeMarkdownHTML} from './markdown.js';

export function renderTaskNote(note,id){
 const source=String(note||''),markers=taskMarkers(source);
 const parser=new Marked({async:false,gfm:true,breaks:true,renderer:{html:t=>esc(t.text),image:t=>esc(t.text||''),checkbox:({checked})=>`<input type="checkbox" disabled ${checked?'checked':''}>`}});
 const template=document.createElement('template');template.innerHTML=sanitizeMarkdownHTML(parser.parse(source),{taskInputs:true});
 const inputs=[...template.content.querySelectorAll('input')];
 inputs.forEach((input,i)=>{const marker=markers[i];input.type='checkbox';
  if(inputs.length===markers.length&&marker&&marker.checked===input.checked){input.disabled=false;input.dataset.taskNoteCheck=String(marker.offset);input.dataset.taskId=id}
  const li=input.closest('li'),parent=input.parentElement;
  if(li){li.classList.add('markdown-task-item');const label=document.createElement('label');label.className='markdown-task-label';input.replaceWith(label);label.append(input);const text=document.createElement('span');text.className='markdown-task-text';while(label.nextSibling&&!['UL','OL'].includes(label.nextSibling.nodeName))text.append(label.nextSibling);label.append(text);input.setAttribute('aria-label',text.textContent.trim()||'待办事项')}
 });return template.innerHTML;
}

export function taskDocument(s,u){
 const t=s.tasks.find(x=>x.id===u.task),editing=!t||u.taskEditing;
 const tools=`<div class="task-document-tools">${t?quoteButton('task',t.id):''}${t&&!editing?ib('编辑任务','edit-task','edit'):''}${ib('关闭详情','close','close')}</div>`;
 const header=`<header class="modal-heading task-document-heading"><span>${editing?(t?'编辑任务':'新建任务'):'任务'}</span>${tools}</header>`;
 if(editing)return header+`<form id="task-form" class="task-edit-form"><label class="field">标题<input name="title" aria-label="任务标题" required value="${esc(t?.title)}" placeholder="要做什么？"></label><label class="field">内容<textarea name="note" aria-label="任务内容 Markdown" rows="13" placeholder="写下内容，支持 Markdown…">${esc(t?.note)}</textarea></label><label class="field">日期<input type="date" name="date" aria-label="任务日期" value="${esc(t?.date||'')}"></label><div class="form-feedback" role="status"></div><footer class="form-actions">${t?button('删除','delete-task:'+t.id,'danger','trash'):''}<span class="spacer"></span>${button('取消',t?'cancel-task-edit':'close','subtle')}<button class="primary">保存</button></footer></form>`;
 return header+`<article class="task-document" data-task-document="${esc(t.id)}"><div class="task-title-line"><input type="checkbox" data-task-toggle="${esc(t.id)}" aria-label="${t.done?'重新打开任务':'完成任务'}" ${t.done?'checked':''}><h1 class="${t.done?'completed':''}">${esc(t.title)}</h1></div><div class="task-properties"><label class="task-date" title="修改任务日期">${icon('clock')}<input type="date" data-task-date="${esc(t.id)}" aria-label="任务日期" value="${esc(t.date||'')}"></label>${t.owner?`<span>${icon('person')}${esc(t.owner)}</span>`:''}</div><div class="task-document-body quotable-content" ${sourceAttrs('task',t.id)}>${renderTaskNote(t.note,t.id)}${t.goal?markdown('## 目标\n\n'+t.goal):''}${t.deliverable?markdown('## 交付物\n\n'+t.deliverable):''}</div>${t.checklist?.length?`<div class="task-document-checks">${t.checklist.map(c=>`<label><input type="checkbox" data-task-check="${esc(c.id)}" data-task-id="${esc(t.id)}" aria-label="${esc(c.text)}" ${c.done?'checked':''}><span>${markdown(c.text)}</span></label>`).join('')}</div>`:''}${sourceLinks(t.refs)}<div class="task-document-error" role="status">${esc(u.taskError||'')}</div></article>`;
}

export function taskNoteExcerpt(note){const template=document.createElement('template');template.innerHTML=markdown(note||'');return template.content.textContent.replace(/\s+/g,' ').trim()}
