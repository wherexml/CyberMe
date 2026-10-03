// Exact attachment adapter. Never project CLI envelopes, paths or stderr to callers.
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,mkdirSync,mkdtempSync,openSync,readdirSync,readFileSync,readSync,realpathSync,rmSync} from 'node:fs';
import {dirname,isAbsolute,join,parse,resolve,sep} from 'node:path';
import sharp from 'sharp';
import {ApiError,command} from './integrations';
import {PRIVATE_DIR,privatePath} from './private-paths';
import {ROOT} from './store';
import {wechatRuntimeSelection} from './wechat-runtime-selector';

export type WechatAttachmentKind='image'|'voice'|'video'|'document';
const maxBytes=25000000;
const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const failure=(code:string,status=409)=>new ApiError(status,code,'微信附件验证失败，请重新读取原消息。');
export function exactAttachmentEnabled(){return wechatRuntimeSelection().mode==='exact';}

function noLinks(path:string){
  const root=parse(path).root;let current=root;
  for(const part of path.slice(root.length).split(sep).filter(Boolean)){
    current=join(current,part);const stat=lstatSync(current);
    if(stat.isSymbolicLink()||realpathSync(current)!==current)throw Error();
  }
}
// Rehash on every invocation, including ordinary queries when this mode is selected.
export function verifyWechatAttachmentCli(){
  const selected=wechatRuntimeSelection();
  if(selected.mode!=='exact')return false;
  try{
    const path=selected.binary,configuredHash=selected.sha256;
    if(!path||!isAbsolute(path)||resolve(path)!==path||!configuredHash||!/^[a-f0-9]{64}$/.test(configuredHash))throw Error();
    const archive=join(ROOT,'.local','greenbubbles-attachment-candidate','bin',configuredHash);
    if(path!==join(archive,'greenbubbles'))throw Error();
    noLinks(path);
    for(const dir of [join(ROOT,'.local'),dirname(dirname(archive)),dirname(archive),archive]){
      const s=lstatSync(dir);if(!s.isDirectory()||s.uid!==process.getuid?.()||(s.mode&0o022)!==0)throw Error();
    }
    const before=lstatSync(path);
    if(!before.isFile()||before.uid!==process.getuid?.()||(before.mode&0o222)!==0||(before.mode&0o100)===0||before.size<1||before.size>200000000)throw Error();
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');
    try{const buffer=Buffer.alloc(131072);let count;while((count=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));}finally{closeSync(fd);}
    if(hash.digest('hex')!==configuredHash)throw Error();
    const after=lstatSync(path);
    if(after.ino!==before.ino||after.dev!==before.dev||after.size!==before.size||after.ctimeMs!==before.ctimeMs||after.mode!==before.mode)throw Error();
    return true;
  }catch{throw failure('wechat_attachment_cli_unverified',503);}
}

export function attachmentKind(message:any):WechatAttachmentKind{
  const type=message?.messageType,subtype=message?.messageSubtype;
  if(type===3||type===49&&[2,8].includes(subtype))return 'image';
  if(type===34||type===49&&subtype===3)return 'voice';
  if(type===43||type===49&&[4,51,63].includes(subtype))return 'video';
  if(type===49&&[6,74].includes(subtype))return 'document';
  throw failure('wechat_attachment_kind_unsupported',501);
}
async function invoke(args:string[],operation:string,kind:WechatAttachmentKind,guard:()=>void){
  guard();
  verifyWechatAttachmentCli();
  guard();
  let result;try{result=await command(wechatRuntimeSelection().binary,args,20000);}catch{throw failure('wechat_attachment_unavailable');}
  guard();
  verifyWechatAttachmentCli();
  if(result.timedOut)throw failure('wechat_attachment_timeout',504);
  let value:any;try{if(Buffer.byteLength(result.stdout)>32768)throw Error();value=JSON.parse(result.stdout);}catch{throw failure('wechat_attachment_invalid_response',502);}
  if(result.exitCode!==0||value?.ok!==true){
    // Fixed allowlist; arbitrary CLI error strings/messages are never public.
    const code=value?.error?.code;
    throw failure(code==='sourceChanged'?'wechat_attachment_changed':code==='unsafeSource'?'wechat_attachment_source_unsafe':'wechat_attachment_unavailable');
  }
  if(value.schema!=='greenbubbles.attachment.v1'||value.formatVersion!==1||value.operation!==operation||value.kind!==kind||value.sourcePathReleased!==false)throw failure('wechat_attachment_invalid_response',502);
  return value;
}
export async function inspectWechatAttachment(conversation:string,message:string,kind:WechatAttachmentKind,guard:()=>void){
  const value=await invoke(['attachment','inspect','--conversation',conversation,'--message',message,'--kind',kind],'attachment.inspect',kind,guard);
  guard();
  if(value.availability!=='downloaded'||!Number.isSafeInteger(value.candidateCount)||value.candidateCount<1||kind!=='image'&&value.candidateCount!==1||typeof value.preferredAttachmentId!=='string'||!/^[a-f0-9]{64}$/.test(value.preferredAttachmentId))throw failure('wechat_attachment_ambiguous');
  if(!Number.isSafeInteger(value.preferredSourceByteCount)||value.preferredSourceByteCount<1||value.preferredSourceByteCount>maxBytes)throw failure('wechat_attachment_too_large',413);
  return {candidate:value.preferredAttachmentId as string,sourceBytes:value.preferredSourceByteCount as number};
}

function ownedDirectory(path:string){noLinks(path);const s=lstatSync(path);if(!s.isDirectory()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error();}
function readOwnOutput(path:string,dir:string){
  let fd:number|undefined;
  try{
    ownedDirectory(dir);noLinks(path);
    if(dirname(path)!==dir||realpathSync(path)!==path)throw Error();
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=fstatSync(fd),named=lstatSync(path);
    if(!before.isFile()||before.nlink!==1||before.uid!==process.getuid?.()||(before.mode&0o077)!==0||before.size<1||before.size>maxBytes||before.ino!==named.ino||before.dev!==named.dev)throw Error();
    const bytes=readFileSync(fd),after=fstatSync(fd);
    if(bytes.length!==before.size||after.size!==before.size||after.ctimeMs!==before.ctimeMs||after.ino!==before.ino)throw Error();
    return bytes;
  }catch{throw failure('wechat_attachment_output_unsafe');}finally{if(fd!==undefined)closeSync(fd);}
}
async function validateFormat(bytes:Buffer,kind:WechatAttachmentKind,format:string){
  if(!/^[a-z0-9_-]{1,32}$/.test(format))throw failure('wechat_attachment_invalid_bytes');
  if(kind==='image'){
    let m;try{m=await sharp(bytes,{limitInputPixels:16000000}).metadata();}catch{throw failure('wechat_attachment_invalid_bytes');}
    const actual=m.format==='jpeg'?'jpg':m.format;
    if(actual!==format||!['jpg','png','webp','gif'].includes(actual||'')||!m.width||!m.height||m.width*m.height>16000000)throw failure('wechat_attachment_invalid_bytes');
    return {mime:actual==='jpg'?'image/jpeg':'image/'+actual,width:m.width,height:m.height,formatValidation:'image-metadata'};
  }
  const starts=(v:string)=>bytes.subarray(0,Buffer.byteLength(v)).equals(Buffer.from(v,'binary'));
  let mime='application/octet-stream',matches=false;
  if(kind==='voice'){
    if(format==='silk'&&(starts('\x02#!SILK_V3')||starts('#!SILK_V3'))){mime='audio/silk';matches=true;}
    if(format==='ogg'&&starts('OggS')){mime='audio/ogg';matches=true;}
  }else if(kind==='video'){
    if(['mp4','mov','m4v'].includes(format)&&bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp'){mime=format==='mov'?'video/quicktime':'video/mp4';matches=true;}
    if(format==='avi'&&starts('RIFF')&&bytes.subarray(8,12).toString('ascii')==='AVI '){mime='video/x-msvideo';matches=true;}
    if(format==='mkv'&&bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))){mime='video/x-matroska';matches=true;}
  }else{
    if(format==='pdf'&&starts('%PDF-')){mime='application/pdf';matches=true;}
    else if(format==='zip'&&starts('PK\x03\x04')){mime='application/zip';matches=true;}
    else if(format==='ole-compound-document'&&bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))){matches=true;}
    else if(!['pdf','zip','ole-compound-document','jpg','png','gif','webp','mp4','silk','ogg','wechat-dat-v1','wechat-dat-v2'].includes(format)){matches=true;}
  }
  if(!matches)throw failure('wechat_attachment_invalid_bytes');
  return {mime,formatValidation:mime==='application/octet-stream'?'opaque-bytes':'header-only'};
}

let temporaryRootChecked=false;
// Remove only verified service operation directories from dead prior processes.
// A live second API process using this private directory keeps its own operations.
function prepareTemporaryRoot(){
  noLinks(PRIVATE_DIR);const root=privatePath('wechat-attachment-temp');
  mkdirSync(root,{mode:0o700,recursive:true});ownedDirectory(root);
  if(!temporaryRootChecked){
    for(const name of readdirSync(root)){
      const match=/^operation-([0-9]+)-[a-zA-Z0-9]+$/.exec(name);if(!match)continue;
      const pid=Number(match[1]);let dead=false;
      try{process.kill(pid,0);}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH';}
      if(dead){const path=join(root,name);ownedDirectory(path);rmSync(path,{recursive:true,force:true});}
    }
    temporaryRootChecked=true;
  }
  return root;
}
export async function materializeWechatAttachment(conversation:string,message:string,kind:WechatAttachmentKind,candidate:string,guard:()=>void){
  let temp:string|undefined;
  try{
    guard();const root=prepareTemporaryRoot();
    temp=mkdtempSync(join(root,`operation-${process.pid}-`));ownedDirectory(temp);
    const path=join(temp,'output');
    const v=await invoke(['attachment','materialize','--conversation',conversation,'--message',message,'--kind',kind,'--attachment',candidate,'--output',path],'attachment.materialize',kind,guard);
    guard();
    if(v.attachmentId!==candidate||v.outputPathReleased!==false||!Number.isSafeInteger(v.decodedByteCount)||v.decodedByteCount<1||v.decodedByteCount>maxBytes||typeof v.decodedSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.decodedSha256)||typeof v.decodedFormat!=='string')throw failure('wechat_attachment_invalid_response',502);
    const bytes=readOwnOutput(path,temp),sha256=sha(bytes);
    if(v.decodedByteCount!==bytes.length||v.decodedSha256!==sha256)throw failure('wechat_attachment_changed');
    const meta=await validateFormat(bytes,kind,v.decodedFormat);
    guard();
    return {bytes,sha256,format:v.decodedFormat as string,...meta};
  }catch(e){if(e instanceof ApiError)throw e;throw failure('wechat_attachment_output_unsafe');}
  finally{if(temp){try{ownedDirectory(temp);rmSync(temp,{recursive:true,force:true});}catch{/* Never follow a changed directory or remove anything outside our operation. */}}}
}
