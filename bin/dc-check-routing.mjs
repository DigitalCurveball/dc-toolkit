#!/usr/bin/env node
// Which requests reach the Worker script?
//
//   pnpm check:routing                     the main build
//   pnpm check:routing --branch preview    a branch preview build (as Workers Builds makes it)
//
// Only the paths in assets.run_worker_first (wrangler.jsonc) should invoke the
// Worker. Every page, file and made-up URL should be answered by Cloudflare's
// static asset layer, which costs nothing and counts against no limit. This checks
// that, locally, for the built site:
//
//   1. builds it, and asks `wrangler deploy --dry-run` whether the deploy config is
//      acceptable (Wrangler refuses run_worker_first in a build with no Worker);
//   2. wraps the built Worker so every call to it is logged, and runs it under
//      `wrangler dev`;
//   3. requests each page listed in package.json's `qa` script, a made-up URL, the
//      CMS paths and anything else in run_worker_first, twice: as a browser page
//      load and as a bot (no navigation headers), because Cloudflare routes the two
//      differently;
//   4. fails if the Worker ran where it shouldn't, didn't run where it should, a
//      page isn't a 200, the made-up URL isn't a 404, or the CMS doesn't load on
//      main.
//
// Run it after any change to wrangler.jsonc's assets block, to server routes, or to
// the Cloudflare adapter. It refuses to start while any workerd process is running:
// a stale `wrangler dev` answering against a rebuilt folder is what produced a false
// "not_found_handling breaks asset serving" on the first client. See the README,
// "The routing check".
//
// Leaves dist/ holding the build it checked.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';

const args = process.argv.slice(2);
const branchIndex = args.indexOf('--branch');
const branch = branchIndex === -1 ? undefined : args[branchIndex + 1];

const SERVER_CONFIG = 'dist/server/wrangler.json';
const STATIC_CONFIG = 'dist/client/wrangler.json';
const PROBE = 'dist/server/routing-probe.mjs';
const PROBE_CONFIG = 'dist/server/wrangler.routing-probe.json';
const MADE_UP = '/routing-check-no-such-page/';

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const workerdRunning = () => spawnSync('pgrep', ['-x', 'workerd']).status === 0;
const failures = [];

function check(ok, message) {
  console.log(`${ok ? '✅' : '❌'} ${message}`);
  if (!ok) failures.push(message);
}

if (workerdRunning()) {
  console.error(
    'A workerd process is already running, so any result could come from a stale server.\n' +
      'List it with `pgrep -x workerd -a`, stop its parent `wrangler` process, then retry.'
  );
  process.exit(2);
}

// 1. Build, exactly as Workers Builds would for this branch.
const env = { ...process.env };
if (branch) env.WORKERS_CI_BRANCH = branch;
else delete env.WORKERS_CI_BRANCH;
console.log(branch ? `Building as branch "${branch}"…` : 'Building as main…');
const build = spawnSync('pnpm', ['build'], { env, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}

const config = existsSync(SERVER_CONFIG) ? SERVER_CONFIG : STATIC_CONFIG;
const dryRun = spawnSync('npx', ['wrangler', 'deploy', '--dry-run', '--config', config], { encoding: 'utf8' });
check(dryRun.status === 0, `wrangler deploy --dry-run accepts ${config}`);
if (dryRun.status !== 0) {
  console.error(`${dryRun.stdout}${dryRun.stderr}`.split('\n').filter((line) => /ERROR|Please/.test(line)).join('\n'));
  process.exit(1);
}
if (config === STATIC_CONFIG) {
  console.log('Static-only build: there is no Worker script, so nothing can invoke one.');
  process.exit(failures.length ? 1 : 0);
}

// 2. Wrap the Worker so every call is logged with the request's path and query.
// A separate config beside the real one, so relative paths still resolve and the
// real deploy config is never touched.
const deployConfig = JSON.parse(readFileSync(SERVER_CONFIG, 'utf8'));
writeFileSync(
  PROBE,
  `import worker from './entry.mjs';
export * from './entry.mjs';
export default { ...worker, async fetch(request, env, ctx) {
  const url = new URL(request.url);
  console.log('WORKER-INVOKED ' + url.pathname + url.search);
  return worker.fetch(request, env, ctx);
} };
`
);
writeFileSync(PROBE_CONFIG, JSON.stringify({ ...deployConfig, main: 'routing-probe.mjs' }));

// What to request, and what should happen. The expectations are the design's
// intent, not read from the config, so a config that drifts from it fails:
//
// - every page in package.json's `qa` script: a 200, without the Worker;
// - a made-up URL: a 404, without the Worker;
// - the CMS: always the Worker, and on main it must load (on a branch preview
//   dc-toolkit's stand-in, src/routes/cms-unavailable.ts, answers instead);
// - any other path in run_worker_first: the Worker.
const qaScript = JSON.parse(readFileSync('package.json', 'utf8')).scripts?.qa ?? '';
const pages = (qaScript.match(/--path\s+(\S+)/)?.[1] ?? '/').split(',');
const workerFirst = deployConfig.assets?.run_worker_first;
const listedWorkerPaths = Array.isArray(workerFirst)
  ? workerFirst.filter((glob) => !glob.startsWith('!')).map((glob) => glob.replace(/\*.*$/, '') || '/')
  : [];
const cmsPaths = ['/keystatic', '/api/keystatic'];
const targets = [
  ...pages.map((path) => ({ path, status: 200, worker: false })),
  { path: MADE_UP, status: 404, worker: false },
  { path: '/keystatic', status: branch ? undefined : 200, worker: true },
  { path: '/api/keystatic', worker: true },
  ...listedWorkerPaths.filter((path) => !cmsPaths.includes(path)).map((path) => ({ path, worker: true })),
];

// 3. Run it and ask.
const port = await new Promise((done) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});
const server = spawn(
  'npx',
  ['wrangler', 'dev', '--config', PROBE_CONFIG, '--ip', '127.0.0.1', '--port', String(port)],
  // Its own process group, so stopping it stops wrangler and workerd too, not just npx.
  { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
);
let log = '';
server.stdout.on('data', (chunk) => (log += chunk));
server.stderr.on('data', (chunk) => (log += chunk));

function get(path, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] ?? '', body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function describe({ type, body }) {
  const title = body.match(/<title>([^<]*)<\/title>/i)?.[1];
  if (title) return `"${title.trim()}"`;
  if (type.includes('html')) return 'HTML without a <title>';
  if (type.startsWith('text/')) return `"${body.trim().split('\n')[0].slice(0, 50)}"`;
  return type || '(no content type)';
}

async function stop() {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  for (let i = 0; i < 40 && workerdRunning(); i++) await wait(250);
  if (workerdRunning()) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    await wait(500);
  }
  rmSync(PROBE, { force: true });
  rmSync(PROBE_CONFIG, { force: true });
  if (workerdRunning()) console.error('⚠️  workerd is still running: `pgrep -x workerd -a`, and stop its parent.');
}
process.on('SIGINT', async () => {
  await stop();
  process.exit(130);
});

try {
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    if (/Address already in use/.test(log)) break;
    ready = await get('/', {}).then(() => true, () => false);
    if (!ready) await wait(500);
  }
  if (!ready) throw new Error(`wrangler dev did not start:\n${log.slice(-2000)}`);

  const MODES = {
    browser: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', Accept: 'text/html' },
    bot: {},
  };
  let n = 0;
  for (const target of targets) {
    for (const [mode, headers] of Object.entries(MODES)) {
      // A unique query per request, so the log line can be matched to it.
      const token = `routing-check=r${++n}x`;
      const response = await get(`${target.path}?${token}`, headers);
      await wait(300); // let the Worker's log line arrive
      const invoked = log.includes(token);
      const shouldInvoke = target.worker;
      const statusOk = target.status === undefined || response.status === target.status;
      const expectation = [
        target.status && `expected ${target.status}`,
        `Worker ${shouldInvoke ? 'expected' : 'not expected'}`,
      ].filter(Boolean);
      check(
        invoked === shouldInvoke && statusOk,
        `${target.path.padEnd(30)} ${mode.padEnd(7)} ${response.status} ${describe(response).padEnd(34)} ` +
          `Worker ${invoked ? 'ran' : 'did not run'} (${expectation.join(', ')})`
      );
    }
  }
} catch (error) {
  failures.push(error.message);
  console.error(error.message);
} finally {
  await stop();
}

console.log(
  failures.length
    ? `\n${failures.length} problem(s).`
    : '\nAll checks passed: pages and made-up URLs never reach the Worker, and the CMS always does.'
);
process.exit(failures.length ? 1 : 0);
