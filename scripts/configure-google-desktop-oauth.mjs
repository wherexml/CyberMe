// Store an official Desktop OAuth client JSON locally without printing its contents.
// node --import tsx scripts/configure-google-desktop-oauth.mjs --client-json /absolute/download.json [--private-dir /absolute/project/.local/...]
import {lstatSync,mkdirSync,readFileSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {saveGoogleDesktopClient} from '../server/src/google-client-file.ts';
try{
 const args=process.argv.slice(2);
 const index=args.indexOf('--client-json'),localIndex=args.indexOf('--private-dir');
 const input=index>=0?args[index+1]:undefined;
 if(!input||!isAbsolute(input)||args.length!==(localIndex<0?2:4))throw new Error();
 const s=lstatSync(input);
 if(!s.isFile()||s.size>32768||s.uid!==process.getuid())throw new Error();
 const defaultRoot=join(homedir(),'Library/Application Support/OpsTwins/.local');
 const root=localIndex<0?defaultRoot:resolve(args[localIndex+1]);
 const workspace=resolve(import.meta.dirname,'../.local');
 if(localIndex>=0&&!root.startsWith(workspace+sep))throw new Error();
 const scope=lstatSync(dirname(root),{throwIfNoEntry:false});
 if(!scope?.isDirectory()||scope.uid!==process.getuid()||realpathSync(dirname(root))!==dirname(root))throw new Error();
 mkdirSync(root,{recursive:true,mode:0o700});
 if(realpathSync(root)!==root)throw new Error();
 saveGoogleDesktopClient(join(root,'google-oauth'),JSON.parse(readFileSync(input,'utf8')));
 console.log('Saved Google Desktop OAuth client in private encrypted storage.');
}catch{
 console.error('Google Desktop OAuth client could not be saved. Check the Desktop JSON, private directory, and whether a client is already configured.');
 process.exitCode=1;
}
