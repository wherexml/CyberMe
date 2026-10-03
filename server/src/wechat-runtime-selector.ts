// Noncredential server program selection. Read once; never update environment or files.
import {constants,closeSync,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,parse,resolve,sep} from 'node:path';
import {TextDecoder} from 'node:util';
import {ApiError} from './integrations';
import {PRIVATE_DIR,privatePath} from './private-paths';
import {ROOT} from './store';

type Selection=Readonly<{mode:'legacy';binary:string}|{mode:'exact';binary:string;sha256:string}>;
type Snapshot=Selection|Readonly<{mode:'invalid'}>;
const schema='opstwins.wechat-attachment-runtime.v1';
function exact(binary:unknown,sha256:unknown):Selection{
  if(typeof binary!=='string'||typeof sha256!=='string'||!isAbsolute(binary)||resolve(binary)!==binary||!/^[a-f0-9]{64}$/.test(sha256)||binary!==join(ROOT,'.local','greenbubbles-attachment-candidate','bin',sha256,'greenbubbles'))throw Error();
  return Object.freeze({mode:'exact',binary,sha256});
}
function noLinks(path:string){
  let current=parse(path).root;
  for(const part of path.slice(current.length).split(sep).filter(Boolean)){
    current=join(current,part);const s=lstatSync(current);
    if(s.isSymbolicLink()||realpathSync(current)!==current)throw Error();
    if(current===join(ROOT,'.local')||current.startsWith(join(ROOT,'.local')+sep)){
      if(s.uid!==process.getuid?.()||(s.mode&0o022)!==0)throw Error();
    }
  }
}
function privateBinding():Selection{
  const path=privatePath('wechat-attachment-runtime.json');
  noLinks(PRIVATE_DIR);
  // lstat distinguishes absent entries from dangling symlinks. Never follow either.
  const named=lstatSync(path,{throwIfNoEntry:false});
  if(!named)return Object.freeze({mode:'legacy',binary:'/opt/homebrew/bin/greenbubbles'});
  noLinks(path);
  if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1||named.uid!==process.getuid?.()||(named.mode&0o7777)!==0o600||named.size<1||named.size>8192||dirname(path)!==PRIVATE_DIR)throw Error();
  let fd:number|undefined;
  try{
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const before=fstatSync(fd);
    if(before.ino!==named.ino||before.dev!==named.dev||before.ctimeMs!==named.ctimeMs||before.size!==named.size||before.mode!==named.mode||before.uid!==named.uid||before.nlink!==1)throw Error();
    const buffer=Buffer.alloc(8193);let length=0,count;
    while(length<buffer.length&&(count=readSync(fd,buffer,length,buffer.length-length,null))>0)length+=count;
    const bytes=buffer.subarray(0,length),after=fstatSync(fd),current=lstatSync(path);
    if(bytes.length!==before.size||after.ino!==before.ino||after.dev!==before.dev||after.ctimeMs!==before.ctimeMs||after.size!==before.size||after.mode!==before.mode||current.isSymbolicLink()||current.ino!==before.ino||current.dev!==before.dev||current.ctimeMs!==before.ctimeMs||current.nlink!==1)throw Error();
    noLinks(path);
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join(',')!=='cliPath,schema,sha256'||value.schema!==schema)throw Error();
    return exact(value.cliPath,value.sha256);
  }finally{if(fd!==undefined)closeSync(fd);}
}
function startupSnapshot():Snapshot{
  try{
    const binary=process.env.OPSTWIN_WECHAT_CLI,sha256=process.env.OPSTWIN_WECHAT_ATTACHMENT_SHA256;
    // Overrides do not consult a binding, including damaged bindings in the default root.
    if(binary!==undefined){
      if(!binary.trim()||binary.includes('\0'))throw Error();
      return sha256===undefined?Object.freeze({mode:'legacy',binary}):exact(binary,sha256);
    }
    if(sha256!==undefined)throw Error();
    return privateBinding();
  }catch{return Object.freeze({mode:'invalid'});}
}
const selected=startupSnapshot();
export function wechatRuntimeSelection():Selection{
  if(selected.mode==='invalid')throw new ApiError(503,'wechat_runtime_selection_invalid','微信本机程序配置无效，请检查服务端私有配置后重启。');
  return selected;
}
