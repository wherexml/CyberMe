import {CODE_ROOT} from './runtime-paths';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {hash} from './store';
import {ApiError} from './integrations';
export function agentPolicy(){
 const path=join(CODE_ROOT,'server/agent/agents.md');
 let text:string;try{text=readFileSync(path,'utf8');}catch{throw new ApiError(503,'agent_policy_missing','产品 Agent 的 server/agent/agents.md 无法读取');}
 if(!text.trim())throw new ApiError(503,'agent_policy_missing','产品 Agent 的 agents.md 内容为空');
 return {text,path,hash:hash(text)};
}
