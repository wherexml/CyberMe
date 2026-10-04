"""Recheck saved, public native GUI evidence (never manufactures screenshots).
Run after the documented CUA journey: python3 scripts/native-chat-progress-evidence.py
"""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[1]
scope = root / '.local/acceptance/chat-progress'
metadata = json.loads((scope / 'http-metadata.json').read_text())
original = json.loads((scope / 'report.json').read_text())
for name, digest in original['files'].items():
    assert hashlib.sha256((scope / name).read_bytes()).hexdigest() == digest, name

def ax(name):
    return (scope / (name + '.ax.txt')).read_text()

a = Image.open(scope / 'running-1.png').convert('RGB')
b = Image.open(scope / 'running-2.png').convert('RGB')
assert a.size == b.size == (2200, 1640)
# Measured dot bounds in these original 2x captures; no image resizing/profile changes.
changed = sum(pixel != (0, 0, 0) for pixel in ImageChops.difference(a, b).crop((525, 445, 605, 470)).getdata())
checks = {
    'three_dot_animation_changes_pixels': changed > 0,
    'running_accessible': 'AI 正在处理' in ax('running'),
    'read_failure_stops_animation': 'AI 正在处理' not in ax('read-failed'),
    'read_recovery_resumes': 'AI 正在处理' in ax('recovered'),
    'other_conversation_isolated': 'AI 正在处理' not in ax('other-conversation'),
    'return_to_original': 'AI 正在处理' in ax('returned'),
    'held_post_terminal_stops': 'AI 正在处理' not in ax('completed-held-post'),
    'partial_stops': 'AI 正在处理' not in ax('partial'),
    'partial_no_retry': 'button 重试' not in ax('partial'),
    'no_repeated_post': all(sum(c['method'] == 'POST' and c['requestId'] == r['requestId']
        for c in metadata['calls']) == 1 for r in metadata['requests']),
}
result = {'scope': 'Frozen public native GUI evidence, not a fresh GUI run or real model',
          'checks': checks, 'changedDotPixels': changed,
          'sourceSha256': original['sourceSha256'], 'signedAppSha256': original['signedAppSha256']}
(scope / 'recheck.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, ensure_ascii=False))
assert all(checks.values())
