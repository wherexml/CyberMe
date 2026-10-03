import type {Hono} from 'hono';
import {get,put,publicValue} from './store';
import {ApiError} from './integrations';

// Stable client ID makes a lost create response safe to recover and retry.
export function installSideChats(app:Hono){
 app.post('/api/conversations/side',async c=>{
  const input=await c.req.json();
  if(!input||typeof input.id!=='string'||!/^ui-side-[a-f0-9-]{36}$/.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>120||Object.keys(input).some(k=>!['id','title'].includes(k)))throw new ApiError(400,'invalid_side_chat','侧会话参数无效');
  const old=get('conversations',input.id,true);
  if(old){if(!old.sideChat||!get('conversations',input.id))throw new ApiError(409,'side_chat_conflict','会话 ID 已占用');return c.json(publicValue(old));}
  return c.json(publicValue(put('conversations',{id:input.id,title:input.title.trim(),mode:'chat',status:'active',sideChat:true})),201);
 });
}
