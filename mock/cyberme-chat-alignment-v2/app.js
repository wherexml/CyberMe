const input=document.querySelector('#input'),form=document.querySelector('#composer'),send=document.querySelector('#send'),timeline=document.querySelector('.timeline'),messages=document.querySelector('#messages');
const defaults=/*EDITMODE-BEGIN*/{height:46,inset:28}/*EDITMODE-END*/;
function resize(){input.style.height='24px';input.style.height=Math.min(132,input.scrollHeight)+'px';input.style.overflowY=input.scrollHeight>132?'auto':'hidden';form.classList.toggle('multiline',input.scrollHeight>24);send.disabled=!input.value.trim()}
input.addEventListener('input',resize);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();form.requestSubmit()}});
form.addEventListener('submit',e=>{e.preventDefault();const text=input.value.trim();if(!text)return;const row=document.createElement('article');row.className='message user';const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;row.append(bubble);messages.append(row);input.value='';resize();timeline.scrollTop=timeline.scrollHeight;input.focus()});
document.querySelector('#guides').onclick=e=>{const on=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',String(on));document.body.classList.toggle('show-guides',on)};
const files=document.querySelector('#file'),attachments=document.querySelector('#attachments');
document.querySelector('.attach').onclick=()=>files.click();
files.onchange=()=>{for(const f of files.files){const chip=document.createElement('div');chip.className='attachment';const name=document.createElement('span');name.textContent=f.name;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除附件 '+f.name);remove.onclick=()=>{chip.remove();attachments.hidden=!attachments.children.length};chip.append(name,remove);attachments.append(chip)}attachments.hidden=!attachments.children.length;files.value=''};
function scale(){const s=Math.min(1,(innerWidth-24)/1000,(innerHeight-90)/700);const k=Math.max(.2,s);document.querySelector('.window').style.transform=`scale(${k})`;document.querySelector('.frame').style.width=1000*k+'px';document.querySelector('.frame').style.height=700*k+'px'}
addEventListener('resize',scale);scale();resize();
const tweaks=document.querySelector('#tweaks');
addEventListener('message',e=>{if(e.source!==parent)return;if(e.data?.type==='__activate_edit_mode')tweaks.hidden=false;if(e.data?.type==='__deactivate_edit_mode')tweaks.hidden=true});
for(const key of ['height','inset'])document.querySelector('#'+key).oninput=e=>{defaults[key]=Number(e.target.value);document.documentElement.style.setProperty(key==='height'?'--composer-height':'--lane-inset',defaults[key]+'px');parent.postMessage({type:'__edit_mode_set_keys',keys:defaults},location.origin)};
parent.postMessage({type:'__edit_mode_available'},location.origin);
