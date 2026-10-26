import {realpath,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {settings,patchSettings,hash} from './store';
import {ApiError} from './integrations';
export function knowledgePaths(){const paths=Array.isArray(settings().knowledgePaths)?settings().knowledgePaths:[];return {paths,version:hash(paths)}}
export async function saveKnowledgePaths(input:any){
 const current=knowledgePaths();if(input.version!==current.version)throw new ApiError(409,'edit_conflict','路径已更新，当前输入保留，请先读取最新版本');
 if(!Array.isArray(input.paths)||input.paths.length>32)throw new ApiError(400,'invalid_paths','最多配置32个文件夹');
 const paths:any[]=[],seen=new Set<string>(),ids=new Set<string>();
 for(const row of input.paths){
  if(!row||typeof row.id!=='string'||!/^[\w-]{1,128}$/.test(row.id)||typeof row.path!=='string'||row.path.length>4096||/\p{Cc}/u.test(row.path))throw new ApiError(400,'invalid_path','本机路径格式无效');
  const path=row.path.trim();if(!path.startsWith('/')&&!path.startsWith('~/'))throw new ApiError(400,'invalid_path','请输入 / 或 ~/ 开头的文件夹路径');
  let canonical:string;try{canonical=await realpath(path.startsWith('~/')?resolve(homedir(),path.slice(2)):path);if(!(await stat(canonical)).isDirectory())throw Error()}catch{throw new ApiError(400,'folder_unavailable','文件夹不存在或暂不可访问')}
  if(seen.has(canonical)||ids.has(row.id))throw new ApiError(400,'duplicate_path','这个文件夹已添加');seen.add(canonical);ids.add(row.id);paths.push({id:row.id,path:canonical});
 }
 // Filesystem checks await: compare the canonical lease again immediately before commit.
 if(knowledgePaths().version!==current.version)throw new ApiError(409,'edit_conflict','路径已更新，当前输入保留，请先读取最新版本');
 patchSettings({knowledgePaths:paths});return knowledgePaths();
}
