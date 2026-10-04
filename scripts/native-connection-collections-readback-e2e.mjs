// Read-only verification of the actual native collections journey; no simulated GUI.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir='output/native-parity-20261003/connections-collections-20261004';
const read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
const sha=b=>createHash('sha256').update(b).digest('hex');
const scope=read('scope'), full=read('expected-full-config'), reduced=read('expected-remove-config');
const checks=[];
const check=(name,fn)=>{fn();checks.push({name,status:'PASS'});};
check('Cancel performs no PATCH',()=>assert.equal(read('cancel-no-patch').stats.patchAttempts,0));
check('503 retains complete draft without forwarding',()=>{const x=read('save503-kept-full-draft');assert.deepEqual(x.draftConfig,full);assert.equal(x.stats.forwarded,0);assert.equal(x.stats.rejected,1);});
check('Native retry saves both scopes, roles, words and hours',()=>assert.deepEqual(read('saved-full-canonical').config,full));
check('409 preserves draft and refuses stale canonical overwrite',()=>{const x=read('real409-preserved');assert.deepEqual(x.draftConfig,reduced);assert.notEqual(x.draftVersion,x.canonicalVersion);assert.equal(x.canonicalConfig.scopes.length,2);assert.ok(x.canonicalConfig.filter.endsWith('另一端更新终'));assert.equal(x.stats.conflicts,1);});
check('Exact GET rebases lease without replacing draft',()=>{const x=read('exact-read-rebased-full-draft');assert.equal(x.draftVersion,x.canonicalVersion);assert.deepEqual(x.draftConfig,reduced);});
check('Explicit resave publishes exact reduced configuration',()=>{const x=read('conflict-save-recovered');assert.deepEqual(x.config,reduced);assert.equal(x.draftCleared,true);assert.equal(x.stats.successes,2);});
check('Removals Cancel restores original two-entry GUI',()=>{const ax=fs.readFileSync(dir+'/12-v41-cancel-removals-restores-all.ax.txt','utf8');assert.equal((ax.match(/button 移除/g)||[]).length,6);});
check('Restart GUI reloads one entry per collection',()=>{const ax=fs.readFileSync(dir+'/17-v41-saved-restart-collections.ax.txt','utf8');assert.equal((ax.match(/button 移除/g)||[]).length,3);assert.ok(ax.includes('深度思考草稿'));assert.ok(ax.includes('switch (settable, boolean) off'));});
check('Restart retains working hours and full filter',()=>{const ax=fs.readFileSync(dir+'/18-v41-saved-restart-times.ax.txt','utf8');for(const v of ['09:15','18:45','Asia/Singapore',reduced.filter])assert.ok(ax.includes(v));});
const binding=read('source-binding-v41-signed');
check('Source and signed binary match actual GUI build',()=>{assert.equal(sha(fs.readFileSync('native/macos/app/src/settings.rs')),binding.sourceSha256);assert.equal(sha(fs.readFileSync(binding.app+'/Contents/MacOS/opstwin')),binding.signedBinarySha256);});
const live=process.argv.includes('--live');
let snapshot=read('restart-canonical-snapshot');
if(live){
 const response=await fetch(`http://127.0.0.1:${scope.upstream}/api/connections/${scope.id}`,{redirect:'error',signal:AbortSignal.timeout(5000)});
 snapshot={status:response.status,canonical:await response.json(),draftCleared:!fs.readFileSync(scope.state+'/settings-drafts.json','utf8').includes(scope.id)};
}
check(live?'Live canonical matches native recovered save':'Archived restart canonical matches recovered save',()=>{assert.equal(snapshot.status,200);assert.equal(snapshot.canonical.id,scope.id);assert.deepEqual(snapshot.canonical.config,reduced);});
check('Saved connection had no remaining local draft',()=>assert.equal(snapshot.draftCleared,true));
const stats=read('conflict-save-recovered').stats;
check('Exact native PATCH accounting',()=>{assert.equal(stats.patchAttempts,4);assert.equal(stats.forwarded,3);assert.equal(stats.rejected,1);assert.equal(stats.conflicts,1);assert.equal(stats.successes,2);});
const frames=fs.readdirSync(dir).filter(n=>/^(?:0[1-9]|1[0-9]|20)-.*\.(png|ax\.txt)$/.test(n)).map(name=>({name,sha256:sha(fs.readFileSync(dir+'/'+name))}));
check('Original failure and recovery frames retained',()=>{assert.equal(frames.length,40);for(const n of ['03-v39-long-scope-controls-overflow.png','06-v40-empty-editor-width-fail.png','18-v41-saved-restart-times.png'])assert.ok(frames.some(f=>f.name===n));});
const result={mode:live?'LIVE':'ARCHIVED_EVIDENCE',status:'PASS',checkedAt:new Date().toISOString(),checks,scopeId:scope.id,sourceSha256:binding.sourceSha256,signedBinarySha256:binding.signedBinarySha256,frames,boundary:'Actual native public isolated connection journey only; not all settings, not bilingual acceptance, not final UI/function grading.'};
fs.writeFileSync(dir+(live?'/readback-live-result.json':'/readback-result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,checks:checks.length,frames:frames.length}));
