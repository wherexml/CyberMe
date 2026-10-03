// Fault injection: restore the persisted client request key after a lost acknowledgment.
// Run with the goal's existing ego TaskSpace 52.
const fs=await import('node:fs/promises');const p=(await taskSpace(52)).page('p1');
const base='http://localhost:46110/api';const req=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;};
const before=(await req('/bootstrap')).sources.primaryConversationId;
const c=await req('/conversations',{title:`OPSADV-REPLAY-${Date.now()}`,mode:'chat',status:'active'});
await p.goto(`http://localhost:46100/chat?conversation=${c.id}`);await p.waitForSelector('textarea');await p.fill('textarea','请解释软件工程的60个要点，每个两句话，不要调用工具。');await p.click('button[aria-label="发送"]');
const text='OPSADV-CANCEL-REPLAY 不应发送的消息',id=`cancel-replay-${Date.now()}`;
await req('/chat/continuation',{conversationId:c.id,message:text,delivery:'queue',requestId:id});await req(`/chat/continuation/${id}`,undefined,'DELETE');
await p.evaluate(({id,conversationId,text})=>{sessionStorage.setItem('opsadv-continuation-request',JSON.stringify({id,fingerprint:JSON.stringify([conversationId,text,'queue',[],[]])}));sessionStorage.setItem('opsadv-chat-draft',text);},{id,conversationId:c.id,text});
await p.reload();await p.waitForSelector('text="等待完成后发送"');await p.click('text="等待完成后发送"');await p.waitForSelector('.error-inline');
const result=await p.evaluate(()=>({draft:document.querySelector('textarea').value,error:document.querySelector('.error-inline')?.innerText,key:sessionStorage.getItem('opsadv-continuation-request')}));
if(result.draft!==text||result.key!==null)throw Error(JSON.stringify(result));
await fs.writeFile('/Users/steve/Projects/opstwin-advance/output/chat-continuation/cancelled-replay.json',JSON.stringify({result:'PASS',before,conversationId:c.id,...result},null,2));await p.fill('textarea','');console.log(result);
