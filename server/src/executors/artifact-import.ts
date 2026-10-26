// A bounded, explicit output manifest is the only native-to-artifact import surface.
import {constants,closeSync,fstatSync,lstatSync,mkdirSync,openSync,readSync,realpathSync} from 'node:fs';
import {join,resolve,relative,sep,extname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,get,list} from '../store';
import {saveArtifact,FILES} from '../artifacts';
const MAX_FILE=8*1024*1024,MAX_TOTAL=25*1024*1024;
const types:Record<string,string>={'.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json','.csv':'text/csv; charset=utf-8','.js':'text/plain; charset=utf-8','.ts':'text/plain; charset=utf-8','.tsx':'text/plain; charset=utf-8','.jsx':'text/plain; charset=utf-8','.css':'text/plain; charset=utf-8','.html':'text/plain; charset=utf-8','.py':'text/plain; charset=utf-8','.yaml':'text/plain; charset=utf-8','.yml':'text/plain; charset=utf-8','.sql':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf'};
const validId=(s:string)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(s);
function fail(code:string):never{throw Error(code)}
function pathParts(workId:string,requestId:string){if(!validId(workId)||!validId(requestId))fail('invalid_owner');return ['output','chat-native',workId,requestId];}
function directory(parts:string[],create=false){
 if(realpathSync(ROOT)!==ROOT)fail('root_changed');let path=ROOT;const snapshots:any[]=[];
 for(const part of parts){path=join(path,part);if(create)try{mkdirSync(path,{mode:0o700});}catch(e:any){if(e.code!=='EEXIST')throw e;}const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid!()||realpathSync(path)!==path)fail('directory_boundary');snapshots.push({path,dev:s.dev,ino:s.ino});}
 return {path,snapshots};
}
function unchanged(snapshots:any[]){for(const expected of snapshots){const s=lstatSync(expected.path);if(!s.isDirectory()||s.isSymbolicLink()||s.dev!==expected.dev||s.ino!==expected.ino||s.uid!==process.getuid!()||realpathSync(expected.path)!==expected.path)fail('directory_changed');}}
export function prepareNativeOutput(workId:string,requestId:string){return directory(pathParts(workId,requestId),true).path;}
function cleanRelative(value:unknown){if(typeof value!=='string'||value.length>240||value.includes('\\')||/[\x00-\x1f:]/.test(value)||value.startsWith('/')||value.split('/').some(x=>!x||x==='.'||x==='..'))fail('invalid_path');return value;}
function bytesAt(parts:string[],name:string,max:number){
 const names=cleanRelative(name).split('/'),parents=directory([...parts,...names.slice(0,-1)]),path=join(parents.path,names.at(-1)!);
 const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.uid!==process.getuid!())fail('file_boundary');if(before.size===0)fail('file_empty');if(before.size>max)fail('file_too_large');if(before.mode&0o111)fail('executable_file');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const started=fstatSync(fd);if(!started.isFile()||started.dev!==before.dev||started.ino!==before.ino||started.nlink!==1||started.size!==before.size)fail('file_changed');
  const buffer=Buffer.alloc(before.size+1);let n=0;while(n<buffer.length){const read=readSync(fd,buffer,n,buffer.length-n,null);if(!read)break;n+=read;}const bytes=buffer.subarray(0,n),after=fstatSync(fd),atPath=lstatSync(path);
  if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.nlink!==1||atPath.dev!==before.dev||atPath.ino!==before.ino||atPath.isSymbolicLink()||realpathSync(path)!==path)fail('file_changed');unchanged(parents.snapshots);
  return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),check:()=>{unchanged(parents.snapshots);const s=lstatSync(path);if(!s.isFile()||s.dev!==before.dev||s.ino!==before.ino||s.nlink!==1||s.size!==before.size||s.mtimeMs!==before.mtimeMs||s.ctimeMs!==before.ctimeMs||realpathSync(path)!==path)fail('file_changed');}};
 }finally{closeSync(fd);}
}
function validBytes(ext:string,b:Buffer){
 if(ext==='.pdf')return b.subarray(0,5).toString()==='%PDF-';
 if(ext==='.png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(ext==='.jpg'||ext==='.jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 if(ext==='.webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(b);if(text.includes('\u0000'))return false;if(ext==='.json')JSON.parse(text);return true;}catch{return false;}
}
export function importNativeArtifacts(input:{workId:string;requestId:string;runId:string;conversationId:string;taskId:string;sourceIds?:string[]}):{artifactIds:string[];errors:{path?:string;code:string}[];manifestStatus:'missing'|'invalid'|'valid'}{
 const result:{artifactIds:string[];errors:{path?:string;code:string}[];manifestStatus:'missing'|'invalid'|'valid'}={artifactIds:[],errors:[],manifestStatus:'invalid'};
 const parts=pathParts(input.workId,input.requestId);let manifest:any,manifestRead:ReturnType<typeof bytesAt>;
 try{
  if(!get('runs',input.runId)||!get('tasks',input.taskId)||!get('conversations',input.conversationId))fail('invalid_lineage');
  manifestRead=bytesAt(parts,'manifest.json',65536);manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestRead.bytes));
  if(manifest?.version!==1||manifest.requestId!==input.requestId||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>16||Object.keys(manifest).some(k=>!['version','requestId','files'].includes(k)))fail('invalid_manifest');
 }catch(e:any){result.manifestStatus=e.code==='ENOENT'?'missing':'invalid';result.errors.push({code:e.code==='ENOENT'?'manifest_missing':/^[a-z_]+$/.test(e.message)?e.message:'invalid_manifest'});return result;}
 const candidates:{path:string;ext:string;row:any}[]=[],seen=new Set();let total=0;
 try{for(const row of manifest.files){const path=cleanRelative(row?.path),ext=extname(path).toLowerCase();if(path==='manifest.json'||seen.has(path)||!types[ext]||!Number.isSafeInteger(row.size)||row.size<1||row.size>MAX_FILE||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||Object.keys(row).some(k=>!['path','sha256','size'].includes(k)))fail('invalid_entry');seen.add(path);total+=row.size;if(total>MAX_TOTAL)fail('total_too_large');candidates.push({path,ext,row});}}catch(e:any){result.errors.push({code:e.message});return result;}
 result.manifestStatus='valid';
 for(const {path,ext,row}of candidates){try{
  const opened=bytesAt(parts,path,MAX_FILE);if(opened.bytes.length!==row.size||opened.sha256!==row.sha256)fail('digest_mismatch');if(!validBytes(ext,opened.bytes))fail('invalid_file_type');manifestRead.check();opened.check();
  const existing=list('artifacts').find(a=>a.nativeRequestId===input.requestId&&a.nativeRelativePath===path&&a.sha256===opened.sha256);
  if(existing){if(existing.chatWorkId!==input.workId||existing.taskId!==input.taskId)fail('artifact_owner_mismatch');result.artifactIds.push(existing.id);continue;}
  const a=saveArtifact(basename(path),types[ext],opened.bytes,{title:basename(path),kind:'native',nativeRequestId:input.requestId,nativeRelativePath:path,chatWorkId:input.workId,taskId:input.taskId,runId:input.runId,conversationId:input.conversationId,sourceIds:input.sourceIds||[]});result.artifactIds.push(a.id);
 }catch(e:any){result.errors.push({path,code:e.code==='ENOENT'?'file_missing':/^[a-z_]+$/.test(e.message)?e.message:'file_unavailable'});}}
 return result;
}

export function registeredNativeArtifactValid(id:string,workId:string,requestId:string){
 try{const a=get('artifacts',id);if(!a||a.chatWorkId!==workId||a.nativeRequestId!==requestId||a.diskPath!==join(FILES,basename(a.diskPath)))return false;const parts=cleanRelative(relative(ROOT,FILES)).split('/');const file=bytesAt(parts,basename(a.diskPath),MAX_FILE);return file.bytes.length===a.size&&file.sha256===a.sha256;}catch{return false;}
}
