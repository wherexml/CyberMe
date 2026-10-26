// Real local CLI protocol check; no model turn, native history import or user auth.
// Run: node_modules/.bin/tsx scripts/cindy-codex-handshake-e2e.mts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppServerClient } from '../vendor/cindy-reference/packages/maker-core/src/agents/codex/app-server/client.js';
import { createStdioTransport } from '../vendor/cindy-reference/packages/maker-core/src/agents/codex/app-server/stdioTransport.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = join(root, '.local', 'cindy-protocol-e2e');
mkdirSync(base, { recursive: true, mode: 0o700 });
const scope = mkdtempSync(join(base, 'run-'));
const home = join(scope, 'codex-home');
mkdirSync(home, { mode: 0o700 });
const output = join(root, 'output', 'cindy-research-20261017');
mkdirSync(output, { recursive: true });
const resultPath = join(output, `protocol-${Date.now()}.json`);
const result: Record<string, unknown> = {
  status: 'FAIL', startedAt: new Date().toISOString(),
  protocol: 'real Codex app-server over stdio using unmodified Cindy transport/client',
  isolatedCodexHome: true, modelTurnsSubmitted: 0, userCredentialsSupplied: false,
  nativeHistoryImported: false, productE2E: 'NOT_RUN',
  upstreamCommit: 'd3173a55c8dd4bc42cc85b69130a49c8dd34229e',
  clientSha256: createHash('sha256').update(readFileSync(join(root,
    'vendor/cindy-reference/packages/maker-core/src/agents/codex/app-server/client.ts'))).digest('hex'),
};
let pid: number | undefined;
let closed = false;
let watchdog: ReturnType<typeof setTimeout> | undefined;
const counters = { diagnosticMessages: 0, transportErrors: 0 };
const noLog = () => { counters.diagnosticMessages += 1; };
const logger = { trace: noLog, debug: noLog, info: noLog, warn: noLog, error: noLog,
  fatal: noLog, child: () => logger };
let client: AppServerClient | undefined;
try {
  const binaryPath = realpathSync(process.env.OPSTWIN_CODEX_BIN || '/opt/homebrew/bin/codex');
  const version = execFileSync(binaryPath, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  if (!/^codex-cli [\w.+-]+$/.test(version)) throw new Error('UnexpectedVersionFormat');
  result.cliVersion = version;
  // Keep provider tokens, shell startup settings and current user's CODEX_HOME out of the child.
  const env: NodeJS.ProcessEnv = { CODEX_HOME: home };
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  client = new AppServerClient({ logger,
    createTransport: () => createStdioTransport({ binaryPath, cwd: scope, env,
      onProcessSpawned: value => { pid = value; } }),
    onTransportError: () => { counters.transportErrors += 1; },
  });
  client.start();
  const timeout = new Promise<never>((_, reject) => {
    watchdog = setTimeout(() => reject(new Error('ProtocolDeadlineExceeded')), 15000);
  });
  const response = await Promise.race([
    client.initialize({ name: 'opstwins_research', title: 'OpsTwins protocol research', version: '0.1.0' }), timeout,
  ]);
  if (typeof response.userAgent !== 'string' || !response.userAgent) throw new Error('MissingHandshakeIdentity');
  result.initialize = 'PASS';
  // Inspect public model IDs only in memory; retain no provider configuration or account fields.
  const catalog = await client.request<{ data?: Array<{ id?: string }> }>('model/list', {}, { timeoutMs: 10000 });
  if (!Array.isArray(catalog.data)) throw new Error('UnexpectedModelListShape');
  result.modelList = 'PASS';
  result.catalogEntryCount = catalog.data.length;
  result.status = 'PASS';
} catch (error) {
  result.errorType = error instanceof Error ? error.name : 'UnknownError';
  // Keep diagnostic content private; raw errors can echo environment/configuration.
  process.exitCode = 1;
} finally {
  if (watchdog) clearTimeout(watchdog);
  try {
    await client?.close({ reason: 'research handshake finished', throwOnTransportError: true });
    closed = true;
  } catch { result.close = 'FAIL'; process.exitCode = 1; result.status = 'FAIL'; }
  let childExited = pid === undefined;
  if (pid !== undefined) {
    try { process.kill(pid, 0); } catch (error) {
      childExited = (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }
  result.close = closed && childExited ? 'PASS' : 'FAIL';
  if (!childExited) { result.status = 'FAIL'; process.exitCode = 1; }
  result.finishedAt = new Date().toISOString();
  result.counters = counters;
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, artifact: resultPath }));
}
