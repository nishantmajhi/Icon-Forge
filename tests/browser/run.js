#!/usr/bin/env node
/*
 * Run the real pipeline in a real browser.
 *
 * `tests/*.test.js` covers the writers, the presets, the plan and the palette,
 * all of which are arithmetic. It cannot touch `resize.ts` or `pipeline.ts`:
 * those need a canvas, `pica` and JSZip's browser build, and that is the half
 * where a defect reaches the file the user downloads. So this builds
 * `harness.ts` with the project's own Vite, serves it over loopback, and reads
 * the assertions back out of the page.
 *
 *   node tests/browser/run.js              the working copy
 *   node tests/browser/run.js --original    the code at the first commit
 *   node tests/browser/run.js --keep        leave the built harness in place
 *
 * `--original` is what makes the suite evidence rather than description. It
 * extracts `src/` at the repository's first commit into a temporary directory
 * inside the project -- inside, so that `node_modules` still resolves -- and
 * points the harness's imports there. Nine checks are expected to fail against
 * it, and the run prints which. If a check named "regression:" passes in
 * original mode, it is testing nothing.
 *
 * No dependency beyond what the project already has: Vite is a devDependency,
 * the static server below is thirty lines, and Chrome is driven over the
 * DevTools protocol using Node's own `WebSocket` and `fetch`. It exits 0 and
 * says SKIP if no Chrome is found, so it is safe to run anywhere -- which is
 * also why it is deliberately not in the main `npm test`: a skip there would
 * read as a pass.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const ORIGINAL = process.argv.includes('--original');
const KEEP = process.argv.includes('--keep');

/* The number of checks in harness.ts that are expected to fail at the first
 * commit. Asserted so that a harness change which quietly stops exercising a
 * defect is noticed here rather than never. */
const EXPECTED_ORIGINAL_FAILURES = 9;

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/* ------------------------------------------------------------- the source --- */

/*
 * In original mode, extract `src/` at the first commit into `.tmp-original/`.
 *
 * It has to live inside the project: the original files import `jszip`, `pica`
 * and `file-saver` by bare specifier, and Node's and Vite's resolution walk up
 * from the importing file looking for `node_modules`. A directory in the system
 * temp folder would find none.
 */
function extractOriginalSrc() {
  const firstCommit = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (firstCommit.status !== 0) {
    throw new Error(`could not find the first commit: ${firstCommit.stderr || firstCommit.error}`);
  }
  const rev = firstCommit.stdout.trim().split('\n')[0];

  const listing = spawnSync('git', ['ls-tree', '-r', '--name-only', rev, '--', 'src'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (listing.status !== 0) throw new Error(`git ls-tree failed: ${listing.stderr}`);

  const dest = path.join(ROOT, '.tmp-original');
  rmSync(dest, { recursive: true, force: true });

  const files = listing.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (files.length === 0) throw new Error(`commit ${rev} has no src/ directory`);

  for (const file of files) {
    const content = spawnSync('git', ['show', `${rev}:${file}`], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (content.status !== 0) throw new Error(`git show ${rev}:${file} failed`);
    const target = path.join(dest, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content.stdout);
  }

  return { rev, dir: dest, files: files.length };
}

/* --------------------------------------------------------------- building --- */

function buildHarness(srcPrefix) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'iconforge-browser-'));
  const stageDir = path.join(ROOT, '.tmp-harness');
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  /*
   * The harness imports from `SRC/...`, which Vite is told to resolve. Writing
   * it as an alias rather than a relative path is what lets the same file be
   * built twice, once against `src/` and once against the extracted original.
   */
  const harness = readFileSync(path.join(HERE, 'harness.ts'), 'utf8');
  writeFileSync(path.join(stageDir, 'harness.ts'), harness);
  writeFileSync(
    path.join(stageDir, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8"><title>Icon Forge browser checks</title></head>',
      '<body><pre id="out">running</pre>',
      /*
       * A classic inline script, deliberately before the module.
       *
       * Module scripts are deferred, so this runs first and its handlers are in
       * place while the module graph is still evaluating. That matters: the
       * harness installs handlers of its own, but only after its imports have
       * run, so anything that throws while a module is being evaluated -- which
       * is where `new Pica()` happens -- would otherwise leave the page saying
       * "running" and the driver reporting no results at all.
       */
      '<script>',
      '(function () {',
      '  function bail(what, detail) {',
      '    var out = document.getElementById("out");',
      '    if (!out || out.textContent.indexOf("RESULTS_BEGIN") !== -1) return;',
      '    out.textContent = "RESULTS_BEGIN" + JSON.stringify({',
      '      fatal: what + ": " + detail, results: []',
      '    }) + "RESULTS_END";',
      '  }',
      '  window.addEventListener("error", function (e) {',
      '    bail("load-time error", (e.error && (e.error.message + "\\n" + e.error.stack)) || e.message);',
      '  });',
      '  window.addEventListener("unhandledrejection", function (e) {',
      '    bail("load-time rejection", (e.reason && (e.reason.message + "\\n" + e.reason.stack)) || String(e.reason));',
      '  });',
      '})();',
      '</script>',
      '<script type="module" src="./harness.ts"></script>',
      '</body></html>',
      '',
    ].join('\n'),
  );

  const config = `
import { defineConfig } from 'vite';
export default defineConfig({
  root: ${JSON.stringify(stageDir)},
  logLevel: 'warn',
  define: { __ORIGINAL__: ${ORIGINAL ? 'true' : 'false'} },
  resolve: {
    alias: [
      // SRC is the tree under test: src/ normally, the extracted first commit in
      // --original mode. WORKING and TESTS are always the working copy, because
      // the plan and the container parsers are the expectation, not the subject.
      { find: /^SRC\\//, replacement: ${JSON.stringify(srcPrefix.replace(/\\/g, '/') + '/')} },
      { find: /^WORKING\\//, replacement: ${JSON.stringify(path.join(ROOT, 'src').replace(/\\/g, '/') + '/')} },
      { find: /^TESTS\\//, replacement: ${JSON.stringify(path.join(ROOT, 'tests').replace(/\\/g, '/') + '/')} },
    ],
  },
  build: {
    outDir: ${JSON.stringify(outDir)},
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
  },
});
`;
  const configPath = path.join(stageDir, 'vite.harness.config.mjs');
  writeFileSync(configPath, config);

  /*
   * Vite's own entry script, run by this Node, rather than `npx vite`. On
   * Windows `npx` needs a shell, and a shell needs every path quoted -- this
   * project's directory has a space in its name, so the unquoted config path
   * arrived as two arguments and the build failed with "Could not resolve
   * E:\Backups\code\Web\Svelte\Icon". No shell, no quoting to get wrong.
   */
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) {
    throw new Error(`vite is not installed at ${viteBin}. Run \`npm install\` first.`);
  }
  const vite = spawnSync(process.execPath, [viteBin, 'build', '--config', configPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (vite.status !== 0) {
    throw new Error(`vite build failed:\n${vite.stdout}\n${vite.stderr}`);
  }

  if (!KEEP) rmSync(stageDir, { recursive: true, force: true });
  return outDir;
}

/* ---------------------------------------------------------------- serving --- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serve(dir) {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    // The harness is built into a temp directory of our own making, but resolve
    // anyway so a request cannot reach outside it.
    if (!path.resolve(file).startsWith(path.resolve(dir))) {
      res.writeHead(403).end('no');
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ---------------------------------------------------------------- driving --- */

/*
 * Drive the page over the DevTools protocol rather than with `--dump-dom`.
 *
 * `--dump-dom` prints the page once and exits, so it needs `--virtual-time-budget`
 * to let the harness's asynchronous work finish first -- and that is what does
 * not work here. `pica` does its resampling in a Web Worker, and Chrome's
 * virtual clock advances only the renderer's own task queues: a `postMessage` to
 * a worker is sent and its reply never arrives, because the worker's thread is
 * running on a real clock that the renderer has stopped waiting for. The first
 * `pica.resize` therefore never settled, the dump happened, and the page still
 * said "running" with no error anywhere -- which is a long way from looking like
 * a threading problem.
 *
 * So: real time, and poll the page until it says it is done. This needs no
 * dependency either -- Node has had a global `WebSocket` since v22 -- and it
 * gives console output and uncaught exceptions as a bonus, which `--dump-dom`
 * cannot.
 */
async function runChrome(chrome, url, timeoutMs = 180000) {
  const profile = mkdtempSync(path.join(tmpdir(), 'iconforge-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-update',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    url,
  ];

  const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrText = '';
  child.stderr.on('data', (d) => (stderrText += d));

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* a locked profile directory is not a failure */
    }
  };

  try {
    const port = await waitForDevToolsPort(profile, child);
    const target = await waitForPageTarget(port);
    const { text, console: consoleLines } = await pollPage(target, timeoutMs);
    return { text, consoleLines, stderrText };
  } finally {
    cleanup();
  }
}

/*
 * Chrome writes the port it chose into `DevToolsActivePort` in the profile
 * directory, first line the port and second the browser's websocket path. It
 * appears a beat after launch, so this waits for it rather than assuming.
 */
async function waitForDevToolsPort(profile, child, timeoutMs = 30000) {
  const file = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${child.exitCode} before listening`);
    try {
      const lines = readFileSync(file, 'utf8').split('\n');
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Chrome never wrote ${file}`);
}

async function waitForPageTarget(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('no debuggable page target appeared');
}

/*
 * Poll `#out` until the harness says `done`, then return its text.
 *
 * Polling rather than waiting for an event because the harness republishes after
 * every check: whatever is there when the deadline passes is still the most
 * complete picture available, and naming the check it stopped on is the whole
 * point of publishing as it goes.
 */
function pollPage(wsUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const consoleLines = [];
    let nextId = 1;
    const pending = new Map();
    let latest = '';
    let settled = false;

    const send = (method, params) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(deadline);
      try {
        ws.close();
      } catch {
        /* closing a closed socket is fine */
      }
      fn(arg);
    };

    const deadline = setTimeout(
      () => finish(resolve, { text: latest, console: consoleLines }),
      timeoutMs,
    );

    let poller;
    ws.addEventListener('open', async () => {
      try {
        await send('Runtime.enable', {});
        poller = setInterval(async () => {
          try {
            const result = await send('Runtime.evaluate', {
              expression: "document.getElementById('out') ? document.getElementById('out').textContent : ''",
              returnByValue: true,
            });
            const text = result?.result?.value ?? '';
            if (text) latest = text;
            if (text.includes('"done":true') || text.includes('"fatal"')) {
              finish(resolve, { text, console: consoleLines });
            }
          } catch (e) {
            finish(reject, e);
          }
        }, 250);
      } catch (e) {
        finish(reject, e);
      }
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.method ?? 'CDP'}: ${msg.error.message}`));
        else res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        consoleLines.push(`[${msg.params.type}] ${args}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleLines.push(`[exception] ${d.text} ${d.exception?.description ?? ''}`);
      }
    });

    ws.addEventListener('error', () => finish(reject, new Error('the DevTools websocket errored')));
    ws.addEventListener('close', () => {
      if (!settled) finish(resolve, { text: latest, console: consoleLines });
    });
  });
}

/*
 * Delimited at both ends, because --dump-dom prints the whole page and the
 * results are one element in it.
 */
/*
 * Delimited at both ends, because the page republishes as it goes and the text
 * read out mid-write would otherwise be indistinguishable from a finished one.
 */
function parseResults(text) {
  const begin = text.indexOf('RESULTS_BEGIN');
  const end = text.indexOf('RESULTS_END');
  if (begin === -1 || end === -1) return null;
  const json = text.slice(begin + 'RESULTS_BEGIN'.length, end);
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error(`could not parse the results block: ${e.message}\n${json.slice(0, 600)}`);
  }
}

/* ------------------------------------------------------------------- main --- */

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log('SKIP: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run these checks.');
    process.exit(0);
  }

  let srcPrefix = path.join(ROOT, 'src');
  let original = null;
  if (ORIGINAL) {
    original = extractOriginalSrc();
    srcPrefix = path.join(original.dir, 'src');
    console.log(`Building against the first commit ${original.rev.slice(0, 7)} (${original.files} files)`);
  }

  let outDir;
  try {
    outDir = buildHarness(srcPrefix);
  } finally {
    if (original && !KEEP) rmSync(original.dir, { recursive: true, force: true });
  }

  const { server, port } = await serve(outDir);
  let pageText = '';
  let consoleLines = [];
  try {
    const result = await runChrome(chrome, `http://127.0.0.1:${port}/index.html`);
    pageText = result.text;
    consoleLines = result.consoleLines;
  } finally {
    server.close();
    if (!KEEP) rmSync(outDir, { recursive: true, force: true });
    else console.log(`Harness left at ${outDir}`);
  }

  const parsed = parseResults(pageText);
  if (!parsed) {
    console.error('The harness page produced no results block. What the page said:');
    console.error(`  #out: ${(pageText || '(nothing)').slice(0, 2000)}`);
    if (consoleLines.length) console.error(`  console:\n    ${consoleLines.join('\n    ')}`);
    process.exit(1);
  }
  if (parsed.fatal) {
    console.error(`The harness threw before finishing:\n${parsed.fatal}`);
  }
  if (!parsed.done && !parsed.fatal) {
    console.error(`The harness did not finish. It stopped in: ${parsed.stage}`);
    if (consoleLines.length) console.error(`  console:\n    ${consoleLines.join('\n    ')}`);
  }

  const passed = parsed.results.filter((r) => r.ok);
  const failed = parsed.results.filter((r) => !r.ok);

  for (const r of parsed.results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.detail.replace(/\n/g, '\n        ')}`}`);
  }
  console.log(`\n${passed.length} passed, ${failed.length} failed, ${parsed.results.length} checks`);

  if (ORIGINAL) {
    /*
     * In original mode failures are the point. What is asserted is the count and
     * that every check named "regression:" is among them -- a regression check
     * that passes here is a check that is not testing the defect it names.
     */
    const regressions = parsed.results.filter((r) => r.name.startsWith('regression:'));
    const passingRegressions = regressions.filter((r) => r.ok);
    console.log(`\nAgainst the first commit: ${failed.length} failing, ${EXPECTED_ORIGINAL_FAILURES} expected.`);
    let bad = false;
    if (passingRegressions.length > 0) {
      console.error('These regression checks PASSED against the original, so they test nothing:');
      for (const r of passingRegressions) console.error(`  - ${r.name}`);
      bad = true;
    }
    if (failed.length !== EXPECTED_ORIGINAL_FAILURES) {
      console.error(
        `Expected exactly ${EXPECTED_ORIGINAL_FAILURES} failures against the original; got ${failed.length}. ` +
          'Update EXPECTED_ORIGINAL_FAILURES in this file if a check was added or removed.',
      );
      bad = true;
    }
    if (parsed.fatal) bad = true;
    process.exit(bad ? 1 : 0);
  }

  process.exit(failed.length === 0 && !parsed.fatal && parsed.done ? 0 : 1);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
