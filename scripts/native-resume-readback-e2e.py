#!/usr/bin/env python3
"""Read-only real HTTP evidence for the 2026-10-04 public native QA journey."""
import argparse, datetime, hashlib, json, pathlib, urllib.request

p = argparse.ArgumentParser()
p.add_argument('--base', default='http://127.0.0.1:46214')
p.add_argument('--output', default='output/native-parity-20261003/settings-resume-20261004/readback-e2e.json')
a = p.parse_args()
if a.base.rstrip('/') != 'http://127.0.0.1:46214':
    p.error('This evidence batch is bound to the existing isolated 46214 scope.')

def get(path):
    with urllib.request.urlopen(a.base.rstrip('/') + path, timeout=30) as response:
        return json.load(response)

checks = []
def check(name, value):
    checks.append({'name': name, 'pass': bool(value)})

marker = 'OPSADV-QA-RESUME-f7fc13e159'
tid = 'task-d429b285-c84c-4039-a09f-ed6458c463ce'
rid = 'native-a69e8334-5f36-41bf-b687-ee77d403b817'
runid = 'run-00332ba7-bb68-41b1-9f23-6c97594bed33'
mid = 'memory-2c5a26e7-ab3e-4fd3-83e9-1f335bc1c370'
saveid = 'run-5ebb6a96-24c7-4047-83d8-b1735465f4f1'
consumeid = 'run-093b829a-caf4-4f01-9864-7dc975087083'
task, receipt, run = get('/api/tasks/' + tid), get('/api/chat/requests/' + rid), get('/api/runs/' + runid)
check('Exact task title', task.get('title') == marker)
check('Exact public notes', task.get('notes') == '公开验收：自然语言创建任务后核对同一记录')
check('Receipt and run terminal success', receipt.get('status') == run.get('status') == 'succeeded')
check('Receipt binds original run', receipt.get('runId') == runid)
check('Run binds original native request', run.get('requestId') == rid)
create = [t for t in run.get('tools', []) if t.get('name') == 'create_task']
check('Exactly one create_task tool', len(create) == 1)
check('Created task ID matches native visible unique title', len(create) == 1 and create[0].get('output', {}).get('id') == tid)
check('Only task-related durable operation tools', all(t.get('name') in ['load_user_context', 'application_operation_started', 'application_operation_committed', 'create_task'] for t in run.get('tools', [])))
tasks = get('/api/tasks?limit=200')
check('One exact-title task in complete bounded list', not tasks.get('hasMore') and sum(t.get('title') == marker for t in tasks.get('items', [])) == 1)
saved, consumed = get('/api/runs/' + saveid), get('/api/runs/' + consumeid)
check('Preference save succeeded', saved.get('status') == 'succeeded')
commit = [t for t in saved.get('tools', []) if t.get('name') == 'preference_committed']
check('Preference durable commit binds exact memory', len(commit) == 1 and commit[0].get('output', {}).get('memoryId') == mid)
check('Next run succeeded', consumed.get('status') == 'succeeded')
context = [t for t in consumed.get('tools', []) if t.get('name') == 'load_user_context']
check('Next run consumes exact preference ID', len(context) == 1 and mid in context[0].get('output', {}).get('preferenceIds', []))
check('Next explanation run has no writes', all(t.get('effect') != 'write' for t in consumed.get('tools', [])))
probes = []
for probeid, model, protocol in [
    ('run-0f41a522-f2ad-49ea-bcc8-a298fb3d7a79', 'deepseek-v4.1-flash', 'openai-completions'),
    ('run-3577661b-dddc-434e-8ce1-a0cf2245f5a4', 'claude-opus-5-5', 'anthropic-messages'),
]:
    q = get('/api/runs/' + probeid)
    check('Real model probe ' + model, q.get('status') == 'succeeded' and q.get('model') == model and q.get('protocol') == protocol and q.get('output') == 'OK' and q.get('readOnly') is True)
    probes.append({k: q.get(k) for k in ['id', 'status', 'model', 'protocol', 'readOnly', 'usageVerified', 'costVerified']})
batch_run_id = 'run-1738c052-0832-4780-81e3-1e868dd5db1d'
batch_request_id = 'qa-batch-b1a0b3a0-87c3-4b27-8d3d-330dfd39c36e'
batch_ids = ['inbox-f74ad9dc-7faf-45ad-b4e8-bfe1fe387725', 'inbox-a60dc3dc-b820-4607-b998-644d44e57da6']
batch, batch_receipt = get('/api/runs/' + batch_run_id), get('/api/chat/requests/' + batch_request_id)
check('Batch original receipt binds succeeded run', batch_receipt.get('runId') == batch_run_id and batch_receipt.get('status') == batch.get('status') == 'succeeded')
commits = [t for t in batch.get('tools', []) if t.get('name') == 'inbox_batch_item_committed']
check('Batch committed exactly the two requested IDs', len(commits) == 2 and {t.get('output', {}).get('id') for t in commits} == set(batch_ids))
check('Batch commits each done with readback', all(t.get('output', {}).get('to') == 'done' and t.get('output', {}).get('readback') is True for t in commits))
check('Batch performs no external send or file creation', all(t.get('name') in ['load_user_context', 'bulk_set_inbox_status', 'inbox_batch_started', 'inbox_batch_item_committed', 'inbox_batch_committed', 'query_inbox'] for t in batch.get('tools', [])))
reopened, completed = [get('/api/inbox/' + i) for i in batch_ids]
check('Native reopen and ignore undo leave first pending', reopened.get('status') == 'pending' and reopened.get('dismissalFeedbackActive') is False)
check('Untouched second batch item remains done', completed.get('status') == 'done')
check('Real Jev judgment persisted', reopened.get('triage', {}).get('status') == 'succeeded' and reopened.get('triage', {}).get('method') == 'jev' and reopened.get('triage', {}).get('model') == 'jev-1.13.0')
draft_runs = []
for draft_id, request_id in [
    ('run-98c22135-d421-41c4-ae80-c8a539c621ec', 'native-draft-370a1517b2c6489b8372df4965ab9a25'),
    ('run-94ec3420-cc9f-4d57-80aa-1dee18d3eb54', 'native-draft-3e8e146ab843462d86c1530032a81b08'),
]:
    draft = get('/api/runs/' + draft_id)
    check('Real draft request succeeded ' + draft_id, draft.get('status') == 'succeeded' and draft.get('requestId') == request_id and draft.get('model') == 'deepseek-v4.1-flash')
    check('Draft run has no business write or external tool ' + draft_id, all(t.get('effect') != 'write' and t.get('name') in ['draft_source_scope', 'load_context', 'load_user_context', 'list_tasks', 'get_entity'] for t in draft.get('tools', [])))
    draft_runs.append(draft_id)
check('Regenerated text persists without automatic attachments', reopened.get('draftRunId') == draft_runs[-1] and bool(reopened.get('draft')) and reopened.get('artifactIds') == [] and not reopened.get('draftError'))
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'base': a.base, 'mode': 'READ_ONLY_REAL_HTTP_RECHECK', 'checks': checks, 'pass': all(c['pass'] for c in checks), 'bindings': {'taskId': tid, 'requestId': rid, 'runId': runid, 'preferenceMemoryId': mid, 'preferenceSaveRunId': saveid, 'preferenceConsumeRunId': consumeid}, 'taskContentSha256': hashlib.sha256(json.dumps(task, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), 'modelProbes': probes, 'limits': ['Readback of prior actual native actions, not a new GUI run.', 'Two-role model probes used the prior frozen client; latest single-current-model save/test delta remains separate.', 'No all85 or final Part1/Part2 score certification.']}
result['bindings'].update({'batchRunId': batch_run_id, 'batchRequestId': batch_request_id, 'batchInboxIds': batch_ids, 'draftRunIds': draft_runs})
out = pathlib.Path(a.output).resolve(); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({'artifact': str(out), 'passed': sum(c['pass'] for c in checks), 'total': len(checks), 'pass': result['pass']}))
raise SystemExit(0 if result['pass'] else 1)
