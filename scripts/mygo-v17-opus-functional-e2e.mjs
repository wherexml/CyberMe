// Independent Opus functional/journey acceptance for the MyGO v17 migration (public isolated 46500 only).
// Run inside ego-browser TaskSpace103/p3:
//   ego-browser nodejs -e 'await import("/Users/steve/Projects/opstwin-advance/scripts/mygo-v17-opus-functional-e2e.mjs")'
// Phases live in output/mygo-v17-opus-acceptance-20261017/functional/phases/. Each phase persists its own
// result.json; final.mjs aggregates them into report.json with fixed run ids. To recheck a new build, run the
// phases again and update RUNS in final.mjs to the new run directories.
// Safety: unique opus-acceptance-* task/folders/side conversation; knowledge paths and autonomy restored to the
// exact recorded baseline; the chat phase makes exactly one real model request and only GETs the original ID.
const P='/Users/steve/Projects/opstwin-advance/output/mygo-v17-opus-acceptance-20261017/functional/phases/';
const only=globalThis.OPUS_PHASES||['qual','task','draft','chat','selection','knowledge','autonomy','inbox-settings'];
const results={};
for(const name of only){
 const m=await import(P+name+'.mjs?'+Date.now());
 // task/draft share the task id created by the task phase.
 results[name]=name==='draft'?await m.default(results.task?.taskId):await m.default();
 console.log(name,JSON.stringify((results[name].checks||[]).map(c=>c.status)));
}
if(!globalThis.OPUS_SKIP_FINAL)console.log('final',JSON.stringify(await (await import(P+'final.mjs?'+Date.now())).default()));
