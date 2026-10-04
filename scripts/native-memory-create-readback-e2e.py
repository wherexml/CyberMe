#!/usr/bin/env python3
"""Repeatable, read-only audit of actual native Memory creation evidence.

Does not operate a GUI, issue HTTP, or assign a product score.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'output/native-parity-20261003'
ORIGINAL = BASE / 'memory-create-late-v47-20261004'
checks = []


def check(name, value):
    checks.append({'name': name, 'pass': bool(value)})


def read(directory, name):
    return json.loads((directory / name).read_text())


manifest = read(ORIGINAL, 'evidence-manifest.json')
for item in manifest['files']:
    path = Path(item['path'])
    check('manifest ' + path.name,
          path.is_relative_to(BASE) and path.is_file()
          and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'])

check('original FAIL retained', read(ORIGINAL, 'v47-fail-readonly.json')['status'] == 'FAIL_NEW_CREATE_LATE_INPUT_NOT_MIGRATED')
migration = read(ORIGINAL, '05-v48-migration-readonly.json')
key = 'memory:' + migration['proxy']['id']
check('original recovery GET only', migration['proxy']['createPosts'] == 1
      and migration['proxy']['patches'] == 0)
check('original recovery migrated exact ID', list(migration['drafts']) == [key]
      and migration['drafts'][key]['createId'] is None
      and migration['drafts'][key]['fullRead'] is True
      and bool(migration['drafts'][key]['baseUpdatedAt']))
final = read(ORIGINAL, '06-v48-explicit-save-readonly.json')
check('original recovery explicit PATCH same ID', final['proxy']['patches'] == 1
      and final['proxy']['createPosts'] == 1
      and final['canonicalId'] == migration['proxy']['id']
      and final['laterInputSaved'] and final['memoryDraftKeys'] == []
      and final['bodySha256'] == migration['drafts'][key]['contentSha256'])
restart = read(ORIGINAL, '08-v48-restart-and-whitespace-readonly.json')
check('normal restarts and whitespace', restart['normalQuitOriginal'] == 0
      and restart['normalQuitRestart'] == 0 and restart['memoryDraftKeys'] == []
      and restart['proxy']['patches'] == 1 and restart['proxy']['createPosts'] == 1)

frozen_proxy = (ORIGINAL / 'proxy-frozen-v47.mjs').read_text()
for label in ['visible', 'section']:
    directory = BASE / ('memory-create-late-v48-20261004-' + label)
    inflight = read(directory, '01-inflight-readonly.json')
    receipt = next(r for r in inflight['proxy']['receipts'] if r['path'] == '/api/memories')
    frame_time = inflight.get('capturedFrameMs', inflight.get('frameMs'))
    check(label + ' actual frame before original 15s delivery',
          0 <= frame_time - receipt['receivedAt'] < 15000
          and receipt['status'] == 201 and inflight['proxy']['patches'] == 0)
    snapshot_name = '02-migrated-readonly.json' if label == 'visible' else '04-migrated-readonly.json'
    migrated = read(directory, snapshot_name)
    exact_key = 'memory:' + migrated['proxy']['id']
    check(label + ' exact ID migration preserves input',
          list(migrated['drafts']) == [exact_key]
          and migrated['drafts'][exact_key]['createId'] is None
          and migrated['drafts'][exact_key]['contentSha256']
          == inflight['drafts']['memory:new']['contentSha256']
          and migrated['proxy']['createPosts'] == 1 and migrated['proxy']['patches'] == 0)
    result = read(directory, 'final-readonly.json')
    check(label + ' explicit update no duplicate and cleared draft',
          result['normalQuit'] == 0 and result['proxy']['createPosts'] == 1
          and result['proxy']['patches'] == 1 and result['laterInputSaved']
          and result['memoryDraftKeys'] == [] and result['canonicalId'] == migrated['proxy']['id']
          and result['bodySha256'] == migrated['drafts'][exact_key]['contentSha256'])
    expected = frozen_proxy.replace(
        "const dir='output/native-parity-20261003/memory-create-late-v47-20261004';",
        'const dir=' + json.dumps(str(directory.relative_to(ROOT))) + ';')
    check(label + ' proxy only scope directory differs',
          (directory / 'proxy-frozen.mjs').read_text() == expected)
    for image in directory.glob('*.raw.jpg'):
        check(label + ' JPEG ' + image.name, image.read_bytes().startswith(b'\xff\xd8\xff'))

section = BASE / 'memory-create-late-v48-20261004-section'
before = read(section, '01-inflight-readonly.json')
after = read(section, '02-nonowner-retained-readonly.json')
check('nonowner late acknowledgement keeps original draft', after['drafts'] == before['drafts']
      and after['frameMs'] - before['proxy']['receipts'][-1]['receivedAt'] > 15000)
ax = (section / '02-late-create-no-section-switch.ax.txt').read_text()
check('nonowner stays General', 'button English' in ax and '记忆内容' not in ax)
release = read(ORIGINAL, 'release-and-baseline.json')
check('owned processes released', all(x == 0 for x in release['ownedAppsNormalExit'])
      and all(x == 0 for x in release['ownedProxiesNormalExit'])
      and all(v['released'] for v in release['ports'].values()))
check('original public memory baseline unchanged', all(x['bodyUnchanged'] and x['titleUnchanged']
      for x in release['baseline']) and len(release['baseline']) == 3)
result = {'status': 'PASS' if all(x['pass'] for x in checks) else 'FAIL',
          'scope': 'Frozen actual E2E evidence only; no new GUI/HTTP or full product score',
          'checks': checks, 'passed': sum(x['pass'] for x in checks), 'total': len(checks)}
(ORIGINAL / 'repeatable-readback-result.json').write_text(json.dumps(result, indent=2))
print(json.dumps({k: v for k, v in result.items() if k != 'checks'}, indent=2))
raise SystemExit(0 if result['status'] == 'PASS' else 1)
