import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export function privateDirectory(root: string, directory: string) {
  root = realpathSync(root); const target = resolve(directory), base = join(root, '.local');
  if (!target.startsWith(base + sep)) throw Error('private_boundary');
  let p = root;
  for (const part of target.slice(root.length + 1).split(sep)) {
    p = join(p, part); try { mkdirSync(p, { mode: 0o700 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
    const s = lstatSync(p);
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid!() || realpathSync(p) !== p) throw Error('private_boundary');
  }
  if (lstatSync(target).mode & 0o077) throw Error('private_boundary');
  return target;
}
export function createLedger(root: string, directory: string) {
  const dir = privateDirectory(root, directory), lock = join(dir, 'owner.json'), token = randomUUID();
  const readFile = (p: string) => {
    const s = lstatSync(p); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid!() || s.mode & 0o077 || s.size > 1500000) throw Error('private_boundary');
    return JSON.parse(readFileSync(p, 'utf8'));
  };
  try { const old = readFile(lock); let alive = true; try { process.kill(old.pid, 0); } catch (e: any) { alive = e.code !== 'ESRCH'; }
    if (alive) throw Error('executor_already_running'); unlinkSync(lock);
  } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  const fd = openSync(lock, 'wx', 0o600); try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fsyncSync(fd); } finally { closeSync(fd); }
  const path = (id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('invalid_id'); return join(dir, id + '.json'); };
  function save(row: any) {
    const p = path(row.requestId), temp = p + '.' + randomUUID() + '.tmp'; let fd: number | undefined;
    try {
      fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, JSON.stringify(row)); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temp, p); const d = openSync(dir, 'r'); try { fsyncSync(d); } finally { closeSync(d); }
    } finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temp); } catch {} }
  }
  function read(id: string) { try { return readFile(path(id)); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; } }
  for (const name of readdirSync(dir)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const r = read(name.slice(0, -5));
    if (['queued', 'running', 'awaiting_approval', 'stopping'].includes(r.status)) {
      r.status = r.text ? 'partial' : 'unknown'; r.code = 'server_restarted'; r.approval = null; r.updatedAt = Date.now(); save(r);
    }
  }
  return { save, read, close() { try { if (readFile(lock).token === token) unlinkSync(lock); } catch {} } };
}
