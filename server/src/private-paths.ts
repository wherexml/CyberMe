// Process-owned private state. HTTP/Agent inputs cannot change this boundary.
import {lstatSync, mkdirSync, realpathSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {ROOT} from './store';

const base=join(ROOT,'.local');
mkdirSync(base,{recursive:true,mode:0o700});
const realBase=realpathSync(base);
const within=(root:string,path:string)=>path===root||path.startsWith(root+sep);
if(!within(ROOT,realBase))throw new Error('Private state must stay inside this project');
const requested=process.env.OPSTWIN_PRIVATE_DIR;
const dir=requested?resolve(requested):base;
if(!within(base,dir))throw new Error('Private directory must stay inside project private state');
function existingAncestor(path:string){while(!lstatSync(path,{throwIfNoEntry:false})){const parent=dirname(path);if(parent===path)throw new Error('Invalid private path');path=parent;}return path;}
function canonical(path:string){try{return realpathSync(path);}catch{throw new Error('Invalid private path');}}
if(!within(realBase,canonical(existingAncestor(dir))))throw new Error('Private directory crosses its boundary');
mkdirSync(dir,{recursive:true,mode:0o700});
export const PRIVATE_DIR=realpathSync(dir);
if(!within(realBase,PRIVATE_DIR))throw new Error('Private directory crosses its boundary');
export function privatePath(name:string){
 const path=resolve(PRIVATE_DIR,name);
 if(!within(PRIVATE_DIR,path)||relative(PRIVATE_DIR,path)==='')throw new Error('Invalid private path');
 if(!within(PRIVATE_DIR,canonical(existingAncestor(path))))throw new Error('Private path crosses its boundary');
 return path;
}
