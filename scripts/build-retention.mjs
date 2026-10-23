import {existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, realpathSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const names=['CyberMe.app','CyberMe Workspace.app','CyberMe QA.app','OpsTwins V17 QA.app','OpsTwins Standalone.app','OpsTwins MyGO.app','OpsTwins MyGO QA.app'];
function safe(path) {
  if (existsSync(path) || (()=>{try {lstatSync(path);return true;}catch{return false;}})()) {
    if(lstatSync(path).isSymbolicLink()) throw Error(`Symlink rejected: ${path}`);
  }
}
export function retainedBuild(root, name, command, args, verify = path => {
  const result=spawnSync('codesign',['--verify','--deep','--strict',path],{stdio:'inherit'});
  if(result.status!==0) throw Error('Bundle signature verification failed');
}) {
  if(!names.includes(name)) throw Error('Unknown build target');
  root=realpathSync(root);
  const apps=resolve(root,'.local/apps'), lock=resolve(apps,'.build-lock'), tx=resolve(apps,'.build-transaction'), previous=resolve(apps,'previous');
  for(const path of [resolve(root,'.local'),apps,previous,lock,tx]) safe(path);
  mkdirSync(apps,{recursive:true});
  if(existsSync(lock)) {
    const pid=Number(readFileSync(resolve(lock,'pid'),'utf8'));
    if(!Number.isSafeInteger(pid)||pid<=0) throw Error('Invalid build lock; inspect before removing');
    try {process.kill(pid,0);throw Error(`Build already running: ${pid}`);} catch(error) {if(error.code!=='ESRCH') throw error;}
    rmSync(lock,{recursive:true});
  }
  mkdirSync(lock);writeFileSync(resolve(lock,'pid'),String(process.pid));
  function recover() {
    if(!existsSync(tx)) return;
    const saved=JSON.parse(readFileSync(resolve(tx,'transaction.json'),'utf8'));
    if(!names.includes(saved.name)) throw Error('Invalid retained build transaction');
    const current=resolve(apps,saved.name), prior=resolve(tx,'prior.app'), staged=resolve(tx,'staged.app'), rollback=resolve(previous,saved.name), older=resolve(tx,'older.app');
    for(const path of [current,prior,staged,rollback,older]) safe(path);
    if(existsSync(prior)) {
      if(!existsSync(current)) renameSync(prior,current); // publish never completed: restore original
      else {
        if(existsSync(staged)) throw Error('Ambiguous build transaction');
        mkdirSync(previous,{recursive:true});
        if(existsSync(rollback)) {
          if(existsSync(older)) throw Error('Ambiguous rollback transaction');
          renameSync(rollback,older);
        }
        renameSync(prior,rollback);
      }
    }
    rmSync(tx,{recursive:true});
  }
  try {
    recover();
    const current=resolve(apps,name);safe(current);safe(resolve(previous,name));
    mkdirSync(tx);writeFileSync(resolve(tx,'transaction.json'),JSON.stringify({name}));
    const staged=resolve(tx,'staged.app');
    const build=spawnSync(command,args,{cwd:root,stdio:'inherit',env:{...process.env,OPSTWIN_BUILD_OUTPUT:staged}});
    if(build.status!==0) {recover();throw Error(`Build failed (${build.status ?? build.error ?? build.signal})`);}
    safe(staged);
    try {if(!existsSync(resolve(staged,'Contents/Info.plist'))) throw Error('Missing bundle plist');verify(staged);} catch(error) {recover();throw error;}
    if(existsSync(current)) renameSync(current,resolve(tx,'prior.app'));
    renameSync(staged,current);
    recover();
    console.log(`Current: ${current}\nRollback: ${resolve(previous,name)}`);
    return current;
  } finally {rmSync(lock,{recursive:true});}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const [kind,...args]=process.argv.slice(2);
  if(kind==='mygo') {
    if(args.some(arg=>arg.startsWith('--acceptance'))) throw Error('Acceptance targets require the pending V17 build changes');
    const name=args.includes('--standalone')?'CyberMe.app':args.includes('--workspace')?'CyberMe Workspace.app':'CyberMe QA.app';
    retainedBuild(root,name,process.execPath,[resolve(root,'scripts/mygo-build.mjs'),...args]);
  } else throw Error('Expected mygo');
}
