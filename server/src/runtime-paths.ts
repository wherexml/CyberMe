// Separate immutable installed code from private per-user state; no HTTP-selected paths.
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {mkdirSync,lstatSync,realpathSync} from 'node:fs';
export const CODE_ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const STANDALONE=process.env.OPSTWIN_STANDALONE==='1';
export const ROOT=STANDALONE?join(homedir(),'Library','Application Support','OpsTwins'):CODE_ROOT;
if(STANDALONE){
 let path=ROOT;
 while(path!==dirname(path)) {const s=lstatSync(path,{throwIfNoEntry:false});if(s?.isSymbolicLink())throw Error('Unsafe standalone state ancestor');path=dirname(path);}
 mkdirSync(ROOT,{recursive:true,mode:0o700});
 const s=lstatSync(ROOT);if(realpathSync(ROOT)!==ROOT||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw Error('Invalid standalone state root');
}
export const SOURCE_DATA=STANDALONE?join(ROOT,'data','source-cache'):resolve(CODE_ROOT,'../opstwin/server/data');
