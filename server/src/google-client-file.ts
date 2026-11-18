import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {linkSync,lstatSync,mkdirSync,readFileSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const KEY='desktop-client.key',FILE='desktop-client.enc',AAD=Buffer.from('cyberme-google-desktop-client-v1');
const invalid=()=>new Error('Invalid private Google Desktop client configuration');
export type GoogleDesktopClient={clientId:string;clientSecret:string};

function directory(dir:string,create=false){
 if(create)mkdirSync(dir,{recursive:true,mode:0o700});
 const s=lstatSync(dir,{throwIfNoEntry:false});
 if(!s)return false;
 if(!s.isDirectory()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||realpathSync(dir)!==dir)throw invalid();
 return true;
}
function file(dir:string,name:string,max:number){
 const path=join(dir,name),s=lstatSync(path,{throwIfNoEntry:false});
 if(!s)return;
 if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||s.size>max)throw invalid();
 return readFileSync(path);
}
function validate(value:unknown):GoogleDesktopClient{
 if(!value||typeof value!=='object')throw invalid();
 const {clientId,clientSecret}=value as Record<string,unknown>;
 if(typeof clientId!=='string'||!/^[a-zA-Z0-9-]{1,160}\.apps\.googleusercontent\.com$/.test(clientId)||typeof clientSecret!=='string'||clientSecret.length>300||/[\x00-\x20]/.test(clientSecret))throw invalid();
 return {clientId,clientSecret};
}
export function loadGoogleDesktopClient(dir:string){
 if(!directory(dir))return;
 const bytes=file(dir,FILE,4096);if(!bytes)return;
 const key=file(dir,KEY,32);if(key?.length!==32||bytes.length<=28)throw invalid();
 const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
 cipher.setAAD(AAD);cipher.setAuthTag(bytes.subarray(12,28));
 return validate(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')));
}
export function saveGoogleDesktopClient(dir:string,download:unknown){
 const entry=(download as {installed?:Record<string,unknown>}|null)?.installed;
 const config=validate({clientId:entry?.client_id,clientSecret:entry?.client_secret??''});
 directory(dir,true);
 if(lstatSync(join(dir,FILE),{throwIfNoEntry:false}))throw new Error('A Google Desktop client is already configured');
 let key=file(dir,KEY,32);
 if(!key){key=randomBytes(32);writeFileSync(join(dir,KEY),key,{mode:0o600,flag:'wx'});}
 if(key.length!==32)throw invalid();
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(AAD);
 const payload=Buffer.concat([cipher.update(JSON.stringify(config)),cipher.final()]);
 const temp=join(dir,'.desktop-client-'+randomBytes(12).toString('hex'));
 writeFileSync(temp,Buffer.concat([iv,cipher.getAuthTag(),payload]),{mode:0o600,flag:'wx'});
 try{linkSync(temp,join(dir,FILE));}finally{unlinkSync(temp);}
}
