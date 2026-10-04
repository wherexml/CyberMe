#!/usr/bin/env node
// Recheck frozen actual GUI evidence; this does not rerun the GUI or assign a score.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'output/native-parity-20261003/task-editor-focus-v45-20261004');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let checks = 0;
function check(ok, label) { if (!ok) throw Error(label); checks++; }
for (const item of manifest.files) {
  const file = path.resolve(root, item.path);
  check(file.startsWith(dir + '/') && fs.realpathSync(file) === file, 'evidence path');
  check(hash(file) === item.sha256, item.path + ' hash');
}
for (const [file, digest] of Object.entries(manifest.source)) check(hash(path.join(dir, 'frozen-source', file)) === digest, file + ' frozen source');
check(hash(path.join(root, '.local/apps/OpsTwins-Acceptance-Resume-v45.app/Contents/MacOS/opstwin')) === manifest.binarySHA256, 'frozen binary');
const restored = JSON.parse(fs.readFileSync(path.join(dir, 'task-baseline-restored.json')));
check(Object.values(restored.fieldMatches).every(value => value === true), 'six canonical baseline fields');
check(restored.task.id === 'task-d429b285-c84c-4039-a09f-ed6458c463ce', 'exact public task');
check(manifest.normalQuit.length === 2 && manifest.normalQuit.every(value => value.exitCode === 0), 'normal quits');
for (const prefix of ['02-close-cmdk-search-open-PASS', '03-save-cmdk-search-open-PASS', '09-restarted-editor-close-cmdk-PASS']) {
  check(fs.readFileSync(path.join(dir, prefix + '.ax.txt'), 'utf8').includes('搜索对话'), prefix);
}
check(fs.readFileSync(path.join(dir, '05-conflict-replacement-title-key-input.ax.txt'), 'utf8').includes('OPSADV-QA-RESUME-f7fc13e159X'), 'replacement title receives key');
check(fs.existsSync(path.join(root, 'output/native-parity-20261003/search-keyboard-v44-20261004/05-cmdk-after-task-close-no-open-FAIL.raw.jpg')), 'original failure retained');
console.log(JSON.stringify({ status: 'FROZEN_EVIDENCE_VERIFIED', checks, full85Score: null, reranGUI: false }));
