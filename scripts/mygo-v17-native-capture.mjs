// Invoke only inside cua_repl with the public QA App. Never replace prior evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function captureNative(app, directory, name, requiredText) {
  const root = '/Users/steve/Projects/opstwin-advance/output/mygo-v17-opus-acceptance-20261017/';
  const dir = path.resolve(directory);
  if (!dir.startsWith(root) || !/^[a-z0-9-]+$/.test(name)) throw Error('Invalid evidence destination');
  const realRoot = await fs.realpath(root), parent = await fs.realpath(path.dirname(dir));
  if (parent !== realRoot && !parent.startsWith(realRoot + path.sep)) throw Error('Evidence parent escapes project output');
  await fs.mkdir(dir, {recursive: true});
  const realDir = await fs.realpath(dir);
  if (!realDir.startsWith(realRoot + path.sep)) throw Error('Evidence directory escapes project output');
  const before = await app.getAXState({disableDiffing: true, emit: false});
  if (requiredText && !before.includes(requiredText)) return {ready: false, name};
  const bytes = Buffer.from(await app.getScreenshot({emit: false}));
  const ext = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 ? 'jpg' : null;
  if (!ext) throw Error('Unknown screenshot bytes; no format was invented');
  const after = await app.getAXState({disableDiffing: true, emit: false});
  if (requiredText && !after.includes(requiredText)) return {ready: false, name};
  const file = path.join(dir, name + '.' + ext), ax = path.join(dir, name + '.ax.txt');
  await fs.writeFile(file, bytes, {flag: 'wx'});
  await fs.writeFile(ax, after, {flag: 'wx'});
  return {ready: true, name, file, ax, format: ext,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
}
