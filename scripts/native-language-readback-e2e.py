#!/usr/bin/env python3
"""Read-only replay of archived public native language GUI evidence, not a GUI driver."""
import hashlib, json, pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parents[1]
d = root / 'output/native-parity-20261003/language-resume-20261004'
checks = []
def read(name): return (d / name).read_text()
def data(name): return json.loads(read(name))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def check(name, ok):
    if not ok: raise AssertionError(name)
    checks.append({'name': name, 'status': 'PASS'})

scope = data('scope.json')
en, zh = data('en-before-restart.json'), data('zh-restored-canonical.json')
check('Archived canonical EN then original ZH and unchanged identity',
      en['language'] == 'en' and zh['language'] == scope['originalLanguage'] == 'zh-CN'
      and en['nonLanguageIdentitySha256'] == zh['nonLanguageIdentitySha256'] == scope['nonLanguageIdentitySha256'])
stats = zh['stats']
check('Exactly two native language PATCH receipts, both 200',
      stats['patchAttempts'] == stats['forwarded'] == stats['successes'] == 2
      and [(r['language'], r['status']) for r in stats['receipts']] == [('en', 200), ('zh-CN', 200)])
gates = data('negative-http-gates.json')
check('Eight negative HTTP gates forwarded no additional write',
      len(gates['results']) == 8 and all(r['status'] == 403 for r in gates['results'])
      and gates['beforeForwarded'] == gates['afterForwarded'] == 2 and gates['zeroForwardedMutation'])
labels_en = ['General', 'Models', 'Connections', 'File Access', 'Dictation', 'Identity & Memory',
             'Autonomy', 'Channels', 'Devices', 'Help', 'Privacy & Terms', 'About']
labels_zh = ['通用', '模型', '连接', '文件访问', '听写', '身份与记忆', '自主权限', '消息渠道', '设备', '帮助', '隐私与条款', '关于']
ocr = {r['name']: r for r in data('ocr-evidence.json')['records']}
names = ['general', 'models', 'connections', 'file-access', 'dictation', 'identity-memory',
         'autonomy', 'channels', 'devices', 'help', 'privacy-terms', 'about']
for lang, start, labels, title in [('en', 4, labels_en, 'Settings'), ('zh', 24, labels_zh, '设置')]:
    for i, name in enumerate(names):
        stem = f'{start+i:02d}-{name}-v41-{lang}'
        ax = read(stem + '.ax.txt')
        body = ' '.join(l['text'] for l in ocr[stem+'.png']['lines'] if l['bounds'][0] > .24)
        check(f'{lang} actual {name} window and twelve navigation controls',
              f'Window: "{title}"' in ax and all('button '+label in ax for label in labels))
        # OCR is a fallible secondary check; only use clear fixed headings, never user content.
        if lang == 'en': check(f'{name} English heading visible in original pixels', labels[i] in body)
check('Already open window title updates before restart', 'Window: "Settings"' in read('02-v41-en-same-window.ax.txt'))
for n, title, selected in [('23-v41-en-restart-settings.ax.txt', 'Settings', 'English'),
                            ('45-v41-zh-restart-settings.ax.txt', '设置', '简体中文')]:
    ax = read(n)
    check(n+' canonical language selected after normal restart',
          f'Window: "{title}"' in ax and f'radio button (selected, settable, boolean) {selected}' in ax)
draft = 'OPSADV-QA-LANGUAGE-20261004 未提交草稿\n末字终'
for n, placeholder in [('22-v41-en-restart-chat.ax.txt', 'Message…'),
                        ('43-v41-zh-chat-preserved.ax.txt', '输入消息…'),
                        ('44-v41-zh-restart-chat.ax.txt', '输入消息…')]:
    check(n+' exact multiline draft and localized placeholder', draft in read(n) and placeholder in read(n))
for n, labels in [('03-v41-en-go-menu.ax.txt', ['Go', 'Chat', 'Inbox', 'Ideas', 'Tasks', 'Search', 'Settings…']),
                  ('42-v41-zh-go-menu.ax.txt', ['前往', '对话', '收件箱', '灵感', '任务', '全局搜索', '设置…'])]:
    check(n+' actual system menu AX only', all(label in read(n) for label in labels))
binding = data('source-binding.json')
check('Frozen actual source and signed binary still match',
      sha(root/'native/macos/app/src/settings.rs') == binding['sourceSha256']
      and sha(pathlib.Path(binding['app'])/'Contents/MacOS/opstwin') == binding['signedBinarySha256'])
frames = []
for p in sorted(d.glob('*')):
    if p.suffix != '.png' and not p.name.endswith('.ax.txt'): continue
    item = {'name': p.name, 'sha256': sha(p)}
    if p.suffix == '.png':
        with Image.open(p) as im:
            im.load()
            item.update(actualFormat=im.format, width=im.width, height=im.height,
                        embeddedIccBytes=len(im.info.get('icc_profile', b'')))
    frames.append(item)
check('43 original screenshot byte streams and 45 AX retained',
      len([f for f in frames if 'actualFormat' in f]) == 43 and len(frames) == 88)
result = {'status': 'PASS', 'mode': 'ARCHIVED_ACTUAL_GUI_EVIDENCE', 'checks': checks,
          'frames': frames, 'scope': scope,
          'formatNotice': 'Historical .png names contain original CUA JPEG bytes; no conversion or invented ICC. Menus 03/42 are AX-only.',
          'notClaimed': ['current live service state', 'hidden settings dialogs', 'all fixed-text exhaustive translation',
                         'permissions or OAuth', 'model test', 'language failure recovery', 'main Chat message history',
                         'system menu pixels', 'independent score', 'all 85 functions']}
(d/'readback-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'status': result['status'], 'checks': len(checks), 'screenshots': 43, 'AX': 45}))
