import type {Hono} from 'hono';
import {ROOT} from '../runtime-paths';
import {privatePath} from '../private-paths';
import {get,settings} from '../store';
import {createTaskAgentAPI} from './http';
let service:ReturnType<typeof createTaskAgentAPI>|undefined;
export function taskAgentService(){
 if(!service){
  service=createTaskAgentAPI({root:ROOT,port:Number(process.env.OPSTWIN_API_PORT||46110),ledgerDir:privatePath('task-agent-requests')});
  const close=()=>{void service?.close()};process.once('SIGTERM',close);process.once('SIGINT',close);
 }
 return service;
}
export function mountTaskAgents(app:Hono){
 const route=async(c:any)=>{
  // UI transport remains behind the existing desktop capability proxy. Raw web
  // callers must also present the bounded native-client identity/header.
  if(c.req.method==='POST'&&/^\/api\/task-agents\/requests\/[^/]+$/.test(c.req.path)){
   const body=await c.req.raw.clone().json().catch(()=>null);
   if(!body||!get('tasks',body.taskId))return c.json({error:'task_not_found',message:'原任务已不存在'},404);
   if(body.access!=='read-only'&&settings().autonomy.permissions?.tasks==='read')return c.json({error:'read_only',message:'任务操作当前为仅查看'},403);
  }
  return taskAgentService().fetch(c.req.raw);
 };
 for(const [method,path]of [['GET','status'],['GET','sessions/:engine'],['GET','sessions/:engine/:id'],['GET','requests/:id'],['POST','requests/:id'],['POST','requests/:id/stop'],['POST','requests/:id/approvals/:approval']] as const)app.on(method,'/api/task-agents/'+path,route);
}
