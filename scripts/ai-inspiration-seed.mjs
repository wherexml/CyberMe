/** Create disposable local QA material over actual HTTP. Does not generate or send. */
import fs from 'node:fs/promises';
const api='http://127.0.0.1:46110',out=new URL('../output/ai-inspiration-20261002/',import.meta.url);
const originalItemId='chat-oc_146b2688ae701e3b4ddd5c7a1411e037';
async function request(path,method='GET',value){const r=await fetch(api+path,{method,headers:value?{'content-type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});if(!r.ok)throw Error(path+' '+r.status);return r.json();}
const original=await request('/api/inbox/'+originalItemId),marker='OPSADV-AI-INSPIRATION-'+Date.now(),sharedConversationId=original.conversationId;
if(!sharedConversationId)throw Error('Original legacy conversation is required');
const item=await request('/api/inbox','POST',{title:marker,sender:'AI Inspiration E2E',channel:'Internal',origin:'human',status:'pending',body:'Steve，请回复：收到，我会核对安排。只输出这句话，不调用工具。',isSelfTest:false,recipientId:'self',testMarker:marker});
async function upload(name,content){const body=new FormData();body.append('file',new Blob([content],{type:'text/plain'}),name);body.append('conversationId',sharedConversationId);const r=await fetch(api+'/api/files',{method:'POST',body});if(!r.ok)throw Error('Upload '+r.status);return r.json();}
const own=await upload(marker+'-own.txt','AI_INSPIRATION_OWN_FILE'),foreign=await upload(marker+'-unrelated.md','UNRELATED_QA_HISTORY_FILE');
await request('/api/inbox/'+item.id,'PATCH',{conversationId:sharedConversationId,attachments:[own.id],draft:Array.from({length:30},(_,n)=>'第'+(n+1)+'条：这是底部固定操作栏的本地验收草稿。').join('\n')});
await fs.mkdir(out,{recursive:true});const seed={marker,itemId:item.id,originalItemId,sharedConversationId,ownArtifactId:own.id,foreignArtifactId:foreign.id};await fs.writeFile(new URL('seed.json',out),JSON.stringify(seed,null,2));console.log(seed);
