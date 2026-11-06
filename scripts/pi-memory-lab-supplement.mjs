// Supplemental E2E failures preregistered in pi-memory-lab-supplement-cases.json.
// Uses the same real SDK / isolated qmd as the main lab, never production stores.
import {readFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';

export async function runSupplement(d) {
  const {newAdapter, S, CANARY, refreshIndex, record, check, spawnWorker, memoryMarkdown} = d;
  // A successful empty result echoes the query; only result bodies count as recalled content.
  const judgeSearch = (result, spec) => {
    if (!result.isError && result.details?.count === 0) {
      return {status: (spec.want || []).length ? 'FAIL' : 'PASS', observed: {hits: 0, seen: [], isError: false, text: result.text, queryEchoExcluded: true}};
    }
    return d.judgeSearch(result, spec);
  };
  const {adapter, stores} = newAdapter('supplement-forget');
  let scope = await adapter.project('project-a');
  const store = stores.get('project-a');
  await scope.write({content: S.OLD});
  await refreshIndex(store);
  const baseline = judgeSearch(await scope.session.search(CANARY.OLD), {want: [CANARY.OLD]});
  if (baseline.status !== 'PASS') throw new Error(`Supplement baseline not searchable: ${JSON.stringify(baseline)}`);
  await scope.forget({match: CANARY.OLD});
  await refreshIndex(store);
  const capture = async (id, session, query, spec) => {
    const result = await session.search(query);
    const verdict = judgeSearch(result, spec);
    record(id, verdict.status, {...verdict.observed, fullText: result.text, details: result.details}, 'qmd');
  };
  await capture('SUP-01', scope.session, CANARY.OLD, {forbid: [CANARY.OLD]});
  await scope.session.worker.stop();
  adapter.forgetHandles();
  scope = await adapter.project('project-a');
  await capture('SUP-02', scope.session, CANARY.OLD, {forbid: [CANARY.OLD]});

  const perTurn = await spawnWorker('supplement-perturn', store, {extra: {PI_MEMORY_SNAPSHOT: 'per-turn'}});
  const perTurnSession = await perTurn.open();
  const injected = await perTurnSession.injected(CANARY.OLD);
  check('SUP-03', !injected.system.includes(CANARY.OLD), {oldInSystem: injected.system.includes(CANARY.OLD), fullSystem: injected.system, mode: 'per-turn'}, 'sdk-turn');
  await perTurn.stop();

  await scope.write({content: S.UNRELATED});
  await refreshIndex(store);
  const old = judgeSearch(await scope.session.search(CANARY.OLD), {forbid: [CANARY.OLD]});
  const keep = judgeSearch(await scope.session.search(CANARY.UNRELATED), {want: [CANARY.UNRELATED]});
  record('SUP-04', old.status === 'PASS' && keep.status === 'PASS' ? 'PASS' : 'FAIL', {old, keep}, 'qmd');

  await scope.forget({match: CANARY.UNRELATED});
  await refreshIndex(store);
  const beforeDelete = judgeSearch(await scope.session.search(CANARY.UNRELATED), {want: [CANARY.UNRELATED]});
  const source = join(store.memory, 'MEMORY.md');
  const bytes = readFileSync(source).length;
  if (bytes !== 0 || beforeDelete.status !== 'PASS') throw new Error('Delete-vs-empty baseline was not reproduced.');
  unlinkSync(source); // Only the synthetic isolated file, never the installed app.
  await refreshIndex(store);
  const afterDelete = judgeSearch(await scope.session.search(CANARY.UNRELATED), {forbid: [CANARY.UNRELATED]});
  record('SUP-05', afterDelete.status, {beforeDelete, sourceBytesBeforeDelete: bytes, afterDelete}, 'qmd');
  await scope.session.worker.stop();

  const correction = newAdapter('supplement-correction');
  const corrected = await correction.adapter.project('project-a');
  const correctionStore = correction.stores.get('project-a');
  const {today, yesterday} = await corrected.session.worker.rpc('dates');
  await corrected.write({content: S.OLD});
  await corrected.write({target: 'daily', content: S.OLD});
  await refreshIndex(correctionStore);
  const correctionBaseline = judgeSearch(await corrected.session.search(CANARY.OLD), {want: [CANARY.OLD]});
  if (correctionBaseline.status !== 'PASS') throw new Error('Correction baseline not searchable.');
  const staleEpoch = corrected.epoch;
  await corrected.correct({operationId: 'supplement-correct', oldMatch: CANARY.OLD, content: S.NEW, today, yesterday});
  await refreshIndex(correctionStore);
  const oldSearch = judgeSearch(await corrected.session.search(CANARY.OLD), {forbid: [CANARY.OLD]});
  const newSearch = judgeSearch(await corrected.session.search(CANARY.NEW), {want: [CANARY.NEW]});
  record('SUP-06', oldSearch.status === 'PASS' && newSearch.status === 'PASS' ? 'PASS' : 'FAIL', {oldSearch, newSearch, oldInMarkdown: memoryMarkdown(correctionStore).includes(CANARY.OLD)}, 'qmd');

  let staleRejected = false;
  try { await corrected.write({epoch: staleEpoch, content: S.OLD}); }
  catch (error) { staleRejected = error.code === 'memory_changed'; }
  const direct = await corrected.session.write('long_term', S.OLD);
  const resurrected = memoryMarkdown(correctionStore).includes(CANARY.OLD);
  check('SUP-07', staleRejected && !resurrected, {staleRejected, directToolError: direct.isError, oldResurrected: resurrected}, 'sdk-turn');
}
