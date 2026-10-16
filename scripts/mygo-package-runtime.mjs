// Build-only public runtime packaging. Explicit inputs exclude all user data and credentials.
import {cp,mkdir,rm,writeFile,readdir,lstat,readlink,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),app=resolve(process.argv[2]||'');
if(app!==join(root,'.local/apps/OpsTwins Standalone.app'))throw Error('Unexpected build destination');
const dest=join(app,'Contents/Resources/runtime');await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});
for(const name of ['server/src','server/agent','server/assets','shared','node_modules'])await cp(join(root,name),join(dest,name),{recursive:true,verbatimSymlinks:true});
await mkdir(join(dest,'scripts'),{recursive:true});await cp(join(root,'scripts/mygo-workspace-gateway.mjs'),join(dest,'scripts/mygo-workspace-gateway.mjs'));
await mkdir(join(dest,'bin'),{recursive:true});await cp(await realpath(process.execPath),join(dest,'bin/node'));
await cp(join(dirname(dirname(await realpath(process.execPath))),'LICENSE'),join(dest,'NODE-LICENSE'));
await writeFile(join(dest,'package.json'),JSON.stringify({name:'opstwins-runtime',private:true,type:'module'}));
// Reject any symlink that escapes the package, including absolute links into the workspace.
async function check(dir){for(const name of await readdir(dir)){const path=join(dir,name),s=await lstat(path);if(s.isSymbolicLink()){const target=await readlink(path);if(isAbsolute(target)||relative(dest,resolve(dirname(path),target)).startsWith('..'))throw Error('Nonportable runtime symlink: '+relative(dest,path));}else if(s.isDirectory())await check(path)}}
await check(dest);
await writeFile(join(dest,'runtime-manifest.json'),JSON.stringify({schema:1,node:process.version,sourceCommit:(await import('node:child_process')).execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dataIncluded:false},null,2));
console.log('Packaged immutable runtime; no workspace data or private configuration');
