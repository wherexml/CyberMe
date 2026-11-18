// Real standalone HTTP route with a private temporary HOME; no production data or model configuration.
import fs from'node:fs/promises';import path from'node:path';import{spawnSync}from'node:child_process';
const root=process.cwd(),home=await fs.mkdtemp(path.resolve('.local/acceptance/visual-default-')),base=home+'/Library/Application Support/OpsTwins';await fs.mkdir(base,{recursive:true,mode:0o700});await fs.chmod(base,0o700);
const env={...process.env,HOME:home,OPSTWIN_STANDALONE:'1',OPSTWIN_DATA_DIR:base+'/data',OPSTWIN_PRIVATE_DIR:base+'/.local',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46972',OPSTWIN_WEB_PORT:'46972'};for(const key of ['CYBERME_INSIGHT_VISUALS','OPSTWIN_INBOX_BACKGROUND','OPSTWIN_IDEAS_BACKGROUND','OPSTWIN_MEMORY_BACKGROUND','OPSTWIN_CONNECTION_BACKGROUND','CYBERME_FOLLOWUP_WORKER'])delete env[key];
const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`
const S=await import('./server/src/store.ts');S.setMeta('initialized',true);const {app}=await import('./server/src/index.ts');const checks=[];
for(const [value,expected]of[[undefined,true],['0',false],['1',true]]){if(value===undefined)delete process.env.CYBERME_INSIGHT_VISUALS;else process.env.CYBERME_INSIGHT_VISUALS=value;const r=await app.fetch(new Request('http://127.0.0.1:46972/api/ideas/visuals/status'));const d=await r.json();checks.push({name:'standalone '+(value??'default'),pass:r.ok&&d.backgroundEnabled===expected&&!d.configured})}
console.log(JSON.stringify({checks,pass:checks.every(x=>x.pass)}));process.exit(checks.every(x=>x.pass)?0:1);
`],{cwd:root,env,encoding:'utf8',timeout:30000});
try{if(result.status!==0)throw Error(result.stderr||result.stdout);const report=JSON.parse(result.stdout.trim());await fs.writeFile('output/insight-delivery-recovery-20261108/desktop-default.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}finally{await fs.rm(home,{recursive:true,force:true})}
