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
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'base': a.base, 'mode': 'READ_ONLY_REAL_HTTP_RECHECK', 'checks': checks, 'pass': all(c['pass'] for c in checks), 'bindings': {'taskId': tid, 'requestId': rid, 'runId': runid, 'preferenceMemoryId': mid, 'preferenceSaveRunId': saveid, 'preferenceConsumeRunId': consumeid}, 'taskContentSha256': hashlib.sha256(json.dumps(task, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), 'modelProbes': probes, 'limits': ['Readback of prior actual native actions, not a new GUI run.', 'Two-role model probes used the prior frozen client; latest single-current-model save/test delta remains separate.', 'No all85 or final Part1/Part2 score certification.']}
out = pathlib.Path(a.output).resolve(); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps({'artifact': str(out), 'passed': sum(c['pass'] for c in checks), 'total': len(checks), 'pass': result['pass']}))
raise SystemExit(0 if result['pass'] else 1)
