import {execFileSync} from 'node:child_process';
import {realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const services=new Set('blogapp brandsessionholder brandservicesessionholder facebookapp feedsapp filehelper floatbottle fmessage lbsapp masssendapp medianote newsapp notification_messages notifymessage qmessage qqfriend qqmail readerapp recommendhelper shakeapp tmessage voiceinputapp weixin opencustomerservicemsg'.split(' '));
export function baseWechatCategory(id:string,official=false):string|undefined{
 if(id.endsWith('@chatroom'))return 'group';
 if(id.startsWith('@placeholder')||id==='chatroom_session_box')return;
 if(official||id.startsWith('gh_')||services.has(id))return 'other';
 return id.startsWith('@')?undefined:'personal';
}
let cached:{until:number;path:string;overrides:Record<string,string>;sourceHashes:string[];valid:boolean} | undefined;
function preferences(){
 if(cached&&cached.until>Date.now())return cached;
 let path='',overrides:Record<string,string>={},sourceHashes:string[]=[],valid=false;
 try{
  const options={encoding:'utf8' as const,stdio:['ignore','pipe','pipe'] as ['ignore','pipe','pipe'],timeout:2000,maxBuffer:1024*1024};
  path=resolve(execFileSync('defaults',['read','me.greenbubbles.GreenBubbles','history.direct.sourcePath'],options).trim());
  const canonical=realpathSync(path),s=statSync(canonical,{bigint:true});
  if(!s.isDirectory()||s.uid!==BigInt(process.getuid?.()??-1))throw Error('Invalid preference source');
  const bytes=Buffer.alloc(16);bytes.writeBigUInt64LE(s.dev,0);bytes.writeBigUInt64LE(s.ino,8);
  sourceHashes=['liveEncrypted','snapshotEncrypted','decrypted'].map(mode=>{
   const identity='sha256:'+createHash('sha256').update('greenbubbles-live-source-v1\0').update(mode).update('\0').update(canonical).update(bytes).digest('hex').slice(0,32);
   return hash(JSON.stringify(identity));
  });
  let raw:string;try{raw=execFileSync('defaults',['read','me.greenbubbles.GreenBubbles','history.direct.categoryOverrides.v1'],options);}catch(error:any){if(String(error.stderr||'').includes('does not exist'))raw='{}';else throw error;}
  const parsed=JSON.parse(execFileSync('plutil',['-convert','json','-o','-','--','-'],{...options,stdio:['pipe','pipe','pipe'],input:raw}));
  overrides=Object.fromEntries(Object.entries(parsed).filter(([k,v])=>/^[a-f0-9]{64}$/.test(k)&&['personal','group','other'].includes(String(v)))) as Record<string,string>;valid=true;
 }catch{/* Never read other preferences or credentials as a fallback. */}
 cached={until:Date.now()+2000,path,overrides,sourceHashes,valid};return cached;
}
export function wechatCategory(id:string,official:boolean|undefined,sourceHash?:string){
 const base=baseWechatCategory(id,official),p=preferences();
 if(!base||!p.valid)return;
 const override=sourceHash&&p.sourceHashes.includes(sourceHash)?p.overrides[hash(p.path+'\0'+id)]:undefined;
 return override||base;
}
export function storedWechatCategory(item:any){return wechatCategory(String(item.sourceId||''),item.wechatOfficialAccount,item.sourceAccountHash);}
