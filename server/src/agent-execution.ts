import {spawn} from 'node:child_process';
import {realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineTool} from '@earendil-works/pi-coding-agent';
import {ROOT,get,put,hash,now,toolEvidence,publicValue,registerSecret,settings,updateRun} from './store';
import {ApiError} from './integrations';
import {directAuthorization} from './agent-capabilities';

const executionVerbs=/(测试|验证|检测|检查|排查|修复|查询|搜索|查找|查看|读取|下载|安装|运行|执行|调用|创建|生成|保存|整理|修改|更新|部署|构建|编译|删除|移动|复制|打开|处理|完成|\b(?:test|verify|check|debug|fix|search|find|inspect|read|download|install|run|execute|call|create|generate|save|edit|update|deploy|build|delete|move|copy|open|process)\b)/i;
export function executionRequested(prompt:string){
 const unquoted=prompt.replace(/<quoted_context>[\s\S]*?<\/quoted_context>/gi,'').replace(/```[\s\S]*?```|^\s*>.*$/gm,'');
 if(/(?:只|仅)(?:需要)?(?:讨论|解释|分析|建议|聊天)|不要(?:实际)?执行|禁止执行|do\s+not\s+execute|discussion\s+only/i.test(unquoted))return false;
 return executionVerbs.test(directAuthorization(prompt));
}

// A credential stays in server RAM. The model receives only an opaque run-local
// reference; commands obtain the value through an environment variable.
export function executionCredentials(){
 const values=new Map<string,{value:string;label:string;target?:string}>();
 const add=(value:unknown,label:string,target?:string)=>{
  if(typeof value!=='string'||value.length<8||value.length>8192)return undefined;
  if(target){try{const url=new URL(target);url.username='';url.password='';url.search='';url.hash='';target=url.toString()}catch{target=undefined}}
  label=label.slice(0,240);
  registerSecret(value);
  const reference='credential-'+hash({value,label,target}).slice(0,24);
  values.set(reference,{value,label,target});return reference;
 };
 function discover(value:any,label='本轮资料',depth=0){
  if(depth>12)return;
  if(typeof value==='string'){
   if(/^[\s]*[\[{]/.test(value)&&value.length<=65536){try{discover(JSON.parse(value),label,depth+1)}catch{}}
   for(const m of value.matchAll(/\b(?:oc_sk_|sk-(?:ant-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/g))if(values.size<64)add(m[0],label);
  }else if(Array.isArray(value))value.slice(0,300).forEach((x,i)=>discover(x,`${label}[${i}]`,depth+1));
  else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
   if(/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|app[_-]?secret|password|secret|authorization)$/i.test(key)&&typeof child==='string'&&values.size<64)add(child,label+'.'+key);
   else discover(child,label+'.'+key,depth+1);
  }
 }
 return {add,discover,list:()=>[...values].map(([reference,{label,target}])=>({reference,label,...(target?{target}:{})})),
  resolve(reference:string){const entry=values.get(reference);if(!entry)throw new ApiError(400,'credential_reference_missing','凭证引用不属于本轮，请重新读取明确来源');return entry.value;},
  clear:()=>values.clear()};
}
type Credentials=ReturnType<typeof executionCredentials>;
const result=(value:any)=>({content:[{type:'text' as const,text:JSON.stringify(publicValue(value))}],details:publicValue(value)});
const schema=(properties:any,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false}) as any;
const str={type:'string'};
const activeCommands=new Set<()=>void>();
export function stopExecutionCommands(){for(const stop of activeCommands)stop()}
process.once('exit',stopExecutionCommands);

export function executionTools(runId:string,prompt:string,credentials:Credentials,signal:AbortSignal){
 const authorize=(evidence:unknown)=>{
  signal.throwIfAborted();
  if(!executionRequested(prompt))throw new ApiError(403,'execution_not_requested','当前仅讨论或明确禁止执行，不能从来源资料获得执行授权');
  const safePrompt=publicValue(prompt),safeEvidence=typeof evidence==='string'?publicValue(evidence):'';
  const directEvidence=directAuthorization(safeEvidence).trim();
  if(!safeEvidence||!safePrompt.includes(safeEvidence)||!executionVerbs.test(directEvidence)||!directAuthorization(safePrompt).includes(directEvidence))throw new ApiError(403,'execution_evidence_mismatch','操作请求已收到，但 evidence 未逐字匹配当前用户直接要求；请引用当前请求原文修正参数，无需用户重复授权');
  if(['tasks','files','connections'].some(k=>(settings().autonomy.permissions as any)?.[k]==='read'))throw new ApiError(403,'autonomy_read_only','任务、文件或连接被设置为仅查看，通用命令不能越过该限制');
 };
 return [defineTool({name:'get_execution_context',label:'查看执行环境',description:'读取本机执行目录、运行时路径及已有凭证引用（无密钥值）。明确交办可直接使用 run_command 执行网络、命令、文件任务。当前来源未读先用业务工具精确读取，再查此工具获取新凭证引用。',parameters:schema({}),execute:async()=>result({cwd:ROOT,node:process.execPath,platform:process.platform,credentials:credentials.list(),maxTimeoutMs:60000,maxOutputBytes:65536})}),
 defineTool({name:'run_command',label:'执行任务',description:'在本机执行明确交办的命令，可联网、读取/编辑文件、复用 CLI 登录。不是沙箱。evidence逐字引用当前用户的直接操作要求；同一步重试沿用operationId，不能换ID重放未知结果。先get_execution_context；凭证用credentialBindings注入环境变量，绝不把值写入命令、文件或输出。优先用Node/Python直接从环境构造HTTP认证，不把值展开为curl等子进程命令参数。禁止通过本工具绕过业务只读、发送批准/暂停或来源限制。必须核对目标、退出码和实际结果；非零/超时不算完成。',parameters:schema({command:{type:'string',minLength:1,maxLength:24000},cwd:str,operationId:{type:'string',minLength:1,maxLength:80},evidence:str,timeoutMs:{type:'integer',minimum:100,maximum:60000},credentialBindings:{type:'array',maxItems:8,items:schema({variable:str,reference:str},['variable','reference'])}},['command','operationId','evidence']),execute:async(_callId:string,p:any)=>{
  let operationId:string|undefined;
  try{
   authorize(p.evidence);
   if(typeof p.command!=='string'||!p.command.trim()||p.command.length>24000||!/^[-\w]{1,80}$/.test(p.operationId||''))throw new ApiError(400,'invalid_execution','命令或操作 ID 无效');
   // Never put literal credentials in argv or in durable operation records.
   credentials.discover(p.command,'命令参数');
   if(publicValue(p.command)!==p.command)throw new ApiError(400,'literal_credential','命令中包含凭证值，请使用环境变量引用');
   const cwd=realpathSync(resolve(p.cwd||ROOT));if(!statSync(cwd).isDirectory())throw new ApiError(400,'invalid_cwd','工作目录不存在');
   const timeoutMs=p.timeoutMs??60000;if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new ApiError(400,'invalid_timeout','执行时限必须为 100–60000 毫秒');
   if(p.credentialBindings!==undefined&&(!Array.isArray(p.credentialBindings)||p.credentialBindings.length>8))throw new ApiError(400,'invalid_credential_binding','凭证绑定无效');
   const env:NodeJS.ProcessEnv={...process.env,PATH:process.env.PATH||'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',CYBERME_NODE:process.execPath};
   const bound=new Set<string>();
   for(const binding of p.credentialBindings||[]){
    if(!/^CYBERME_SECRET_[A-Z0-9_]{1,50}$/.test(binding.variable)||bound.has(binding.variable))throw new ApiError(400,'invalid_credential_binding','凭证变量必须使用唯一 CYBERME_SECRET_ 前缀');
    bound.add(binding.variable);env[binding.variable]=credentials.resolve(binding.reference);
   }
   for(const [key,value] of Object.entries(env))if(/key|token|secret|password|authorization/i.test(key))registerSecret(value);
   const fingerprint=hash({command:p.command,cwd,timeoutMs,credentialBindings:p.credentialBindings||[]});
   operationId='command-'+hash({runId,id:p.operationId});const prior=get('command_operations',operationId);
   if(prior){
    if(prior.fingerprint!==fingerprint)throw new ApiError(409,'execution_conflict','同一操作 ID 已绑定其他参数');
    if(prior.status==='running'||prior.status==='unknown')throw new ApiError(409,'execution_requires_readback','原命令可能已执行，请核对原结果，不能自动重放',{operationId});
    return result({...prior.result,replayed:true});
   }
   signal.throwIfAborted();
   put('command_operations',{id:operationId,runId,fingerprint,status:'running',startedAt:now()});
   toolEvidence(runId,'command_started',{operationId,commandHash:hash(p.command)},{operationId},'pending',{effect:'write',commitState:'unknown'});
   const started=Date.now();
   const output=await new Promise<{exitCode:number|null;output:string;bytes:number;reason?:string}>((resolveResult)=>{
    let bytes=0,raw=Buffer.alloc(0),reason:string|undefined,finished=false;
    const child=spawn('/bin/bash',['--noprofile','--norc','-c',p.command],{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
    const kill=()=>{try{if(child.pid)process.kill(-child.pid,'SIGKILL')}catch{}};
    const stop=(why:string)=>{if(finished)return;reason??=why;kill();};
    const onShutdown=()=>stop('server_stopping');activeCommands.add(onShutdown);
    const onAbort=()=>stop('interrupted');signal.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>stop('timeout'),timeoutMs);
    const consume=(chunk:Buffer)=>{bytes+=chunk.length;if(raw.length<65536)raw=Buffer.concat([raw,chunk.subarray(0,65536-raw.length)]);if(bytes>65536)stop('output_limit');};
    child.stdout.on('data',consume);child.stderr.on('data',consume);
    const finish=(exitCode:number|null)=>{if(finished)return;finished=true;activeCommands.delete(onShutdown);clearTimeout(timer);signal.removeEventListener('abort',onAbort);kill();const text=raw.toString('utf8');credentials.discover(text,'命令输出');resolveResult({exitCode,output:publicValue(text),bytes,...(reason?{reason}:{})});};
    child.on('error',()=>{reason='spawn_failed';finish(null)});child.on('close',code=>finish(code));
    if(signal.aborted)onAbort();
   });
   const status=output.reason?(output.reason==='spawn_failed'?'failed':'unknown'):output.exitCode===0?'succeeded':'failed';
   const receipt={operationId,status,exitCode:output.exitCode,...(output.reason?{reason:output.reason}:{}),output:output.output,outputBytes:output.bytes,truncated:output.bytes>65536,durationMs:Date.now()-started};
   // Output stays in the current model context only. Replays return metadata and
   // request explicit readback of the actual file/service, not a second execution.
   const {output:discard,...metadata}=receipt;
   put('command_operations',{id:operationId,runId,fingerprint,status,result:metadata,completedAt:now()});
   const run=get('runs',runId);if(run)updateRun(runId,{tools:(run.tools||[]).map((t:any)=>t.name==='command_started'&&t.input?.operationId===operationId?{...t,status:status==='succeeded'?'succeeded':'failed',commitState:status==='unknown'?'unknown':'settled'}:t)});
   // Nonzero commands can already have changed files or called a service.
   // Keep those possible effects in Chat's partial/recovery accounting.
   toolEvidence(runId,'run_command',{operationId,commandHash:hash(p.command)},metadata,status==='succeeded'?'succeeded':'failed',{effect:'write',commitState:status==='succeeded'?'committed':output.reason==='spawn_failed'?'settled':'unknown'});
   return result(receipt);
  }catch(e){
   const code=e instanceof ApiError?e.code:signal.aborted?'execution_interrupted':'execution_failed';
   const error={code,error:e instanceof ApiError?e.message:signal.aborted?'执行已停止':'命令未能启动，请检查工作目录或本机权限',...(operationId?{operationId}:{})};
   toolEvidence(runId,'run_command_rejected',{},error,'failed',{effect:'read'});return result(error);
  }
 }})];
}
