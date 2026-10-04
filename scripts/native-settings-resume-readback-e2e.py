#!/usr/bin/env python3
"""Repeat the exact public v35 settings/ideas HTTP and local-state readback.

This only reads the existing isolated 46214 scope. It does not repeat GUI,
upstream probes, connection tests, saves, deletes, or authorization.
"""
import datetime
import hashlib
import json
import pathlib
import urllib.error
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
scope = root / 'output/native-parity-20261003/settings-v35-20261004'
base = 'http://127.0.0.1:46214'
checks = []


def get(path):
    with urllib.request.urlopen(base + path, timeout=30) as response:
        return json.load(response)


def check(name, value):
    checks.append({'name': name, 'pass': bool(value)})


baseline = json.loads((scope / 'model-baseline.json').read_text())
models = get('/api/settings/models')
check('Original standard role restored', models.get('standard') == baseline['standard'])
check('Original deep role restored', models.get('deep') == baseline['deep'])
check('Provider IDs unchanged', sorted(x['id'] for x in models['providers']) == sorted(x['id'] for x in baseline['providers']))
probe = get('/api/runs/run-d784e5b0-eb09-426d-8b08-e1348e5bda66')
check('Original model probe succeeded', probe.get('kind') == 'model_probe' and probe.get('status') == 'succeeded')
check('Original model and protocol bound', probe.get('model') == 'claude-opus-5-5' and probe.get('protocol') == 'anthropic-messages')
check('Probe is read only', probe.get('readOnly') is True)
check('Probe returned OK', str(probe.get('output', '')).strip() == 'OK')
check('Probe had no tools or artifacts', probe.get('tools') == [] and probe.get('artifactIds') == [])
connection_baseline = json.loads((scope / 'connection-baseline.json').read_text())
connections = get('/api/connections?limit=100')
check('Complete active connection list', connections.get('hasMore') is False)
check('Active connection baseline restored', sorted(x['id'] for x in connections['items']) == connection_baseline['ids'])
cid = 'connection-native-7b3bd8fd-adf1-41de-92d3-63177116f815'
deleted_status = 200
try:
    get('/api/connections/' + cid)
except urllib.error.HTTPError as error:
    deleted_status = error.code
check('Exact disposable connection no longer active', deleted_status == 404)
deleted = get('/api/connections/' + cid + '?includeDeleted=true')
check('Exact recoverable connection identity retained', deleted.get('id') == cid and deleted.get('name') == connection_baseline['marker'] + '终')
check('Failed local endpoint never became connected', deleted.get('status') == 'error' and deleted.get('endpoint') == 'http://127.0.0.1:46239')
check('Only read permission in disposable connection', deleted.get('permissions') == ['read'])
state = json.loads((root / '.local/acceptance/settings-v35-20261004/settings-drafts.json').read_text())
filesystem_baseline = json.loads((scope / 'filesystem-local-baseline.json').read_text())
check('Local folder block policy restored', state.get('local', {}).get('filesystem') == filesystem_baseline)
iid = 'OPSADV-QA-WORKSPACE-01bba21f-1f1c-4d67-9e3f-71bf6fdc31b3-ideas-ignore'
idea = get('/api/ideas/' + iid)
check('Exact public idea restored to proposed', idea.get('id') == iid and idea.get('status') == 'proposed')
check('Public idea identity preserved', idea.get('title') == '公开验收：可撤销忽略')
result = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'base': base,
    'scriptSHA256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
    'scope': 'Readback of existing real service receipts and local public QA state; no new GUI or upstream call',
    'checks': checks,
    'passed': sum(x['pass'] for x in checks),
    'total': len(checks),
    'pass': all(x['pass'] for x in checks),
    'notClaimed': ['system permissions', 'all twelve settings', 'all 85 functions', 'independent final score'],
}
artifact = scope / 'readback-e2e.json'
artifact.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ['passed', 'total', 'pass']}))
raise SystemExit(0 if result['pass'] else 1)
