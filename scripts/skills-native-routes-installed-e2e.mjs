// Installed HTTP acceptance for the read-only Skills routes through the desktop workspace gateway.
// Uses the existing private connection.json pilot token without printing it. Read-only: only GET
// reaches the service; every mutation/descendant/traversal probe must be denied (403) by the gateway
// before forwarding. Reports booleans, counts, status codes and source hashes only — never the token,
// manifest bodies, paths or skill descriptions. The native Go path (native/mygo/proxy.go) is verified
// separately through the installed Settings → Skills UI; this script does not cover it.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {request} from 'node:http';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const connFile=process.env.CYBERME_GATEWAY_CONNECTION||resolve(homedir(),'Library/Application Support/OpsTwins/.local/mygo-desktop/connection.json');
const outDir=resolve(repo,process.env.CYBERME_EVIDENCE_DIR||'output/insight-action-recovery-20261112');
const sha=b=>createHash('sha256').update(b).digest('hex');

const conn=JSON.parse(await readFile(connFile,'utf8'));
if(!Number.isInteger(conn.port)||typeof conn.token!=='string'||conn.token.length!==64)throw Error('connection_invalid');

// Raw request so the exact path (including encoded traversal) reaches the gateway unnormalized.
function send(method,path,{auth=true}={}){
 return new Promise((ok,fail)=>{
  const headers={'x-opstwins-client':'skills-native-routes-e2e'};
  if(auth)headers['x-opstwins-pilot']=conn.token;
  if(method!=='GET'){headers['content-type']='application/json';headers['content-length']='0'}
  const req=request({host:'127.0.0.1',port:conn.port,method,path,headers,timeout:20000},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const body=Buffer.concat(chunks);let json=null;try{json=JSON.parse(body.toString('utf8'))}catch{}ok({status:res.statusCode,json,routeDenied:json?.error==='route_denied',cacheNoStore:res.headers['cache-control']==='no-store'})});
  });
  req.on('timeout',()=>req.destroy(Error('timeout')));req.on('error',fail);req.end();
 });
}

const checks=[];const check=(name,pass,detail={})=>checks.push({name,pass:!!pass,...detail});

// 1. Auth still required.
const noAuth=await send('GET','/api/skills',{auth:false});
check('list_requires_pilot_token',noAuth.status===403,{status:noAuth.status});

// 2. List succeeds through the gateway.
const list=await send('GET','/api/skills');
const items=Array.isArray(list.json?.items)?list.json.items:[];
const idsWellFormed=items.every(s=>/^skill-[0-9a-f]{24}$/.test(String(s?.id)));
check('list_ok',list.status===200&&Array.isArray(list.json?.items),{status:list.status,count:items.length,totalMatches:list.json?.total===items.length,hasCatalogHash:typeof list.json?.catalogHash==='string',noStore:list.cacheNoStore});
check('list_ids_well_formed',idsWellFormed,{count:items.length});

// 3. Detail succeeds for a real id; a well-formed unknown id is forwarded and yields 404 (not 403).
const realId=items[0]?.id;
if(realId){
 const d=await send('GET','/api/skills/'+realId);
 check('detail_ok',d.status===200&&d.json?.id===realId&&typeof d.json?.hash==='string'&&!('body' in (d.json||{})),{status:d.status,idMatches:d.json?.id===realId,noBody:!('body' in (d.json||{}))});
}else check('detail_ok',false,{status:null,reason:'catalog_empty'});
const unknownId='skill-'+'0'.repeat(24);
const unk=await send('GET','/api/skills/'+unknownId);
check('detail_unknown_forwarded_404',unk.status===404&&!unk.routeDenied,{status:unk.status});

// 4. Mutations on list/detail are denied before forwarding (no request bodies sent).
const detailPath='/api/skills/'+(realId||unknownId);
for(const method of ['POST','PATCH','PUT','DELETE'])for(const [label,path] of [['list','/api/skills'],['detail',detailPath]]){
 const r=await send(method,path);check(`deny_${method}_${label}`,r.status===403&&r.routeDenied,{status:r.status});
}

// 5. Unknown descendants, malformed ids and traversal are denied.
const denyPaths={
 descendant_file:detailPath+'/file',
 descendant_body:detailPath+'/body',
 trailing_slash:'/api/skills/',
 id_uppercase:'/api/skills/skill-'+'A'.repeat(24),
 id_short:'/api/skills/skill-'+'0'.repeat(23),
 id_long:'/api/skills/skill-'+'0'.repeat(25),
 id_no_prefix:'/api/skills/'+'0'.repeat(24),
 id_arbitrary:'/api/skills/etc',
 sibling_prefix:'/api/skillsx',
 encoded_dot_traversal:'/api/skills/%2e%2e/%2e%2e/etc/passwd',
 encoded_slash_traversal:'/api/skills/..%2f..%2fetc%2fpasswd',
 encoded_id_slash:'/api/skills/skill-'+'0'.repeat(24)+'%2f..',
 backslash:'/api/skills/skill-'+'0'.repeat(24)+'%5c..',
 nul:'/api/skills/skill-'+'0'.repeat(24)+'%00',
};
for(const [label,path] of Object.entries(denyPaths)){
 const r=await send('GET',path);check(`deny_get_${label}`,r.status===403&&r.routeDenied,{status:r.status});
}

// 6. Source hashes of the two route layers under test (identifies which source was installed).
const sourceHashes={};
for(const f of ['scripts/mygo-workspace-gateway.mjs','native/mygo/proxy.go'])sourceHashes[f]=sha(await readFile(resolve(repo,f)));

const passed=checks.filter(c=>c.pass).length;
const report={script:'skills-native-routes-installed-e2e',at:new Date().toISOString(),layer:'installed_workspace_gateway',nativeGoCovered:false,gatewayPort:conn.port,passed,total:checks.length,ok:passed===checks.length,skillCount:items.length,sourceHashes,checks};
await mkdir(outDir,{recursive:true,mode:0o700});
const outFile=resolve(outDir,'skills-native-routes-installed-e2e.json');
await writeFile(outFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
for(const c of checks)console.log(`${c.pass?'PASS':'FAIL'} ${c.name} status=${c.status??'-'}`);
console.log(`${passed}/${checks.length} passed; skills=${items.length}; evidence=${outFile}`);
process.exitCode=report.ok?0:1;
