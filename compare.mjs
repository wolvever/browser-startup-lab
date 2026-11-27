import puppeteer from 'puppeteer-core';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import os from 'node:os';
import {root, browserPath, cliPath, pandaPath, installationMetadata} from './runtime.mjs';
import {summarize, listPids, memoryOfNewPids, analyzePng, refsFromSnapshot, round1} from './metrics.mjs';
import {imageIdentity, startKitesurf} from './kitesurf.mjs';

const exec = promisify(execFile);
const {values: options} = parseArgs({options: {
  rounds: {type: 'string', default: '10'},
  paths: {type: 'string', default: 'cli-shell,cli-lightpanda,direct-shell,direct-lightpanda'},
  label: {type: 'string', default: 'agent-vs-lightpanda'},
}});
const rounds = Number(options.rounds);
const paths = options.paths.split(',').filter(Boolean);
if (!Number.isInteger(rounds) || rounds < 1 || !/^[a-z0-9-]+$/.test(options.label)) {
  throw Error('Usage: node compare.mjs [--rounds N] [--paths cli-shell,cli-lightpanda,direct-shell,direct-lightpanda,cli-kitesurf,direct-kitesurf] [--label name]');
}
const allowed = new Set(['cli-shell', 'cli-lightpanda', 'direct-shell', 'direct-lightpanda', 'cli-kitesurf', 'direct-kitesurf']);
if (paths.some(pathName => !allowed.has(pathName))) throw Error(`Unknown path. Expected ${[...allowed].join(', ')}`);

const html = `<!doctype html><title>Agent benchmark</title><style>body{margin:0;background:#123;color:white;font:20px sans-serif}canvas{border:3px solid red}</style>
<h1>Agent benchmark</h1><label>Name<input id="name"></label><button id="submit">Submit</button><p id="result">Waiting</p><canvas id="canvas" width="100" height="60"></canvas>
<script>document.querySelector('#submit').onclick=()=>{document.querySelector('#result').textContent='Hello '+document.querySelector('#name').value};document.querySelector('canvas').getContext('2d').fillRect(5,5,60,40);window.ready=true;</script>`;

const runId = new Date().toISOString().replace(/[^0-9TZ]/g, '') + '-' + process.pid;
const outputDir = resolve(root, 'results/runs', `${runId}-${options.label}`);
await mkdir(outputDir, {recursive: true});
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html'); res.end(html);});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
const cli = cliPath();
const cliEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_BROWSER_')));
cliEnv.AGENT_BROWSER_NO_VERSION_CHECK = '1';
const config = resolve(root, 'empty-config.json');
const sessionPrefix = 'c-' + randomUUID().replaceAll('-', '').slice(0, 12);
const records = [];

async function runCli(base, args, timeout = 20000) {
  return exec(cli, [...base, ...args], {cwd: root, env: cliEnv, timeout, maxBuffer: 2 * 1024 * 1024});
}

async function launchDirect(engine) {
  if (engine === 'lightpanda') {
    const portServer = createServer();
    portServer.listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    const port = portServer.address().port;
    await new Promise(resolveClose => portServer.close(resolveClose));
    const proc = spawn(pandaPath, ['serve', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'error'], {stdio: 'ignore'});
    await once(proc, 'spawn');
    let browser;
    try {
      for (let n = 0; n < 500; n++) {
        try { browser = await puppeteer.connect({browserWSEndpoint: `ws://127.0.0.1:${port}`}); break; }
        catch { if (proc.exitCode !== null) throw Error(`Lightpanda exited ${proc.exitCode}`); await new Promise(r => setTimeout(r, 10)); }
      }
      if (!browser) throw Error('Lightpanda startup timeout');
      return {browser, pid: proc.pid, stop: async () => { await browser.disconnect(); proc.kill('SIGTERM'); if (proc.exitCode === null) await once(proc, 'exit'); }};
    } catch (error) { proc.kill(); throw error; }
  }
  const profile = await mkdtemp(resolve(root, 'profile-'));
  try {
    const browser = await puppeteer.launch({
      executablePath: await browserPath('shell'),
      headless: 'shell',
      userDataDir: profile,
      timeout: 20000,
    });
    return {browser, pid: browser.process().pid, stop: async () => { await browser.close(); await rm(profile, {recursive: true, force: true}); }};
  } catch (error) {
    await rm(profile, {recursive: true, force: true});
    throw error;
  }
}

async function warmTree(page) {
  const samples = [];
  let mode = 'accessibility-tree';
  let client;
  try {
    client = await page.createCDPSession();
    await client.send('Accessibility.enable');
    const probe = await client.send('Accessibility.getFullAXTree');
    if (!JSON.stringify(probe).includes('Submit')) throw Error('accessibility tree has no Submit node');
  } catch (error) {
    mode = 'dom-text';
    client = null;
    return {mode, samples: await timeDom(page), error: String(error)};
  }
  for (let n = 0; n < 5; n++) {
    const start = performance.now();
    if (client) await client.send('Accessibility.getFullAXTree');
    else await page.evaluate(() => document.body.innerText);
    samples.push(performance.now() - start);
  }
  return {mode, samples};
}
async function timeDom(page) {
  const samples = [];
  for (let n = 0; n < 5; n++) {
    const start = performance.now();
    await page.evaluate(() => document.body.innerText);
    samples.push(performance.now() - start);
  }
  return samples;
}

console.log(`Results: ${outputDir}`);
console.log(`Fixture: ${url}`);

try {
  for (const pathName of paths) {
    const samples = {cold: [], warm: [], action: [], screenshot: [], rss: [], pss: []};
    let failures = 0;
    for (let i = 0; i < rounds; i++) {
      const row = {name: pathName, trial: i + 1, cold_start: true};
      const before = listPids();
      try {
        if (pathName.endsWith('kitesurf')) {
          const kiteName = `lab-kite-${process.pid}-${i + 1}`;
          const session = `${sessionPrefix}-k-${i + 1}`;
          const base = ['--config', config, '--namespace', 'startup-lab-compare', '--session', session];
          const fullStart = performance.now();
          const kite = await startKitesurf(kiteName);
          row.engine_start_ms = round1(kite.start_ms);
          row.session = session;
          let browser;
          try {
            if (pathName === 'cli-kitesurf') {
              await runCli(base, ['connect', kite.ws]);
              await runCli(base, ['open', url]);
              const snap = await runCli(base, ['snapshot', '-i']);
              row.ready_ms = performance.now() - fullStart;
              if (!snap.stdout.includes('Submit')) throw Error('snapshot missing Submit');
              samples.cold.push(row.ready_ms);
              await new Promise(r => setTimeout(r, 80));
              row.memory = memoryOfNewPids(before);
              if (row.memory.pss_coverage < 1) row.memory.pss_kb = null;
              if (row.memory.rss_kb) samples.rss.push(row.memory.rss_kb);
              if (row.memory.pss_kb) samples.pss.push(row.memory.pss_kb);
              const warm = [];
              for (let n = 0; n < 5; n++) {
                const w = performance.now();
                await runCli(base, ['snapshot', '-i']);
                warm.push(performance.now() - w);
              }
              row.warm_snapshot_ms = warm;
              row.warm_median_ms = summarize(warm).median;
              if (row.warm_median_ms !== undefined) samples.warm.push(row.warm_median_ms);
              const {input, button} = refsFromSnapshot(snap.stdout);
              const actionStart = performance.now();
              try {
                if (!input || !button) throw Error('missing input/button refs');
                await runCli(base, ['fill', `@${input}`, 'Agent']);
                await runCli(base, ['click', `@${button}`]);
                const result = await runCli(base, ['get', 'text', '#result']);
                row.form = result.stdout.includes('Hello Agent');
                if (!row.form) row.form_error = result.stdout.trim();
              } catch (error) {
                row.form = false;
                row.form_error = (error.stderr || error.message || String(error)).slice(0, 500);
              }
              row.action_ms = performance.now() - actionStart;
              row.action_kind = 'snapshot-ref';
              if (row.form) samples.action.push(row.action_ms);
              const shot = resolve(outputDir, `${pathName}-trial${i + 1}.png`);
              const shotStart = performance.now();
              try {
                await runCli(base, ['screenshot', shot]);
                row.screenshot_ms = performance.now() - shotStart;
                row.screenshot = analyzePng(shot);
                samples.screenshot.push(row.screenshot_ms);
              } catch (error) {
                row.screenshot_ms = performance.now() - shotStart;
                row.screenshot = {error: (error.stderr || error.message || String(error)).slice(0, 500)};
              }
              if (i === 0) await writeFile(resolve(outputDir, `${pathName}-snapshot.txt`), snap.stdout);
            } else {
              browser = await puppeteer.connect({browserWSEndpoint: kite.ws, protocolTimeout: 20000});
              const page = await browser.newPage();
              await page.setViewport({width: 1280, height: 900});
              await page.goto(url, {waitUntil: 'load', timeout: 15000});
              if (!await page.evaluate(() => window.ready)) throw Error('JS not ready');
              row.ready_ms = performance.now() - fullStart;
              samples.cold.push(row.ready_ms);
              await new Promise(r => setTimeout(r, 80));
              row.memory = memoryOfNewPids(before);
              if (row.memory.pss_coverage < 1) row.memory.pss_kb = null;
              if (row.memory.rss_kb) samples.rss.push(row.memory.rss_kb);
              if (row.memory.pss_kb) samples.pss.push(row.memory.pss_kb);
              const warm = await warmTree(page);
              row.warm_mode = warm.mode;
              row.warm_snapshot_ms = warm.samples;
              row.warm_median_ms = summarize(warm.samples).median;
              if (row.warm_median_ms !== undefined) samples.warm.push(row.warm_median_ms);
              if (warm.error) row.warm_error = warm.error;
              const actionStart = performance.now();
              await page.evaluate(() => { document.querySelector('#name').value = 'Agent'; document.querySelector('#submit').click(); });
              row.form = await page.$eval('#result', element => element.textContent) === 'Hello Agent';
              row.action_ms = performance.now() - actionStart;
              row.action_kind = 'dom-evaluate';
              if (row.form) samples.action.push(row.action_ms);
              const shot = resolve(outputDir, `${pathName}-trial${i + 1}.png`);
              const shotStart = performance.now();
              await page.screenshot({path: shot, type: 'png'});
              row.screenshot_ms = performance.now() - shotStart;
              row.screenshot = analyzePng(shot);
              samples.screenshot.push(row.screenshot_ms);
            }
          } finally {
            if (browser) await browser.disconnect().catch(() => {});
            if (pathName === 'cli-kitesurf') {
              try { await runCli(base, ['close']); row.closed = true; }
              catch (error) { row.cleanup_error = (error.stderr || error.message || String(error)).slice(0, 400); }
            }
            await kite.stop();
          }
        } else if (pathName.startsWith('cli-')) {
          const engine = pathName.slice(4);
          const session = `${sessionPrefix}-${engine[0]}-${i + 1}`;
          const executable = await browserPath(engine);
          const base = ['--config', config, '--namespace', 'startup-lab-compare', '--session', session, '--engine', engine === 'lightpanda' ? 'lightpanda' : 'chrome', '--executable-path', executable];
          row.session = session;
          let opened = false;
          try {
            const start = performance.now();
            await runCli(base, ['open', url]);
            opened = true;
            const snap = await runCli(base, ['snapshot', '-i']);
            row.ready_ms = performance.now() - start;
            if (!snap.stdout.includes('Submit')) throw Error('snapshot missing Submit');
            samples.cold.push(row.ready_ms);
            await new Promise(r => setTimeout(r, 80));
            row.memory = memoryOfNewPids(before);
            if (row.memory.rss_kb) samples.rss.push(row.memory.rss_kb);
            if (row.memory.pss_kb) samples.pss.push(row.memory.pss_kb);
            const warm = [];
            for (let n = 0; n < 5; n++) {
              const w = performance.now();
              await runCli(base, ['snapshot', '-i']);
              warm.push(performance.now() - w);
            }
            row.warm_snapshot_ms = warm;
            row.warm_median_ms = summarize(warm).median;
            if (row.warm_median_ms !== undefined) samples.warm.push(row.warm_median_ms);
            const {input, button} = refsFromSnapshot(snap.stdout);
            const actionStart = performance.now();
            try {
              if (!input || !button) throw Error('missing input/button refs');
              await runCli(base, ['fill', `@${input}`, 'Agent']);
              await runCli(base, ['click', `@${button}`]);
              const result = await runCli(base, ['get', 'text', '#result']);
              row.form = result.stdout.includes('Hello Agent');
              if (!row.form) row.form_error = result.stdout.trim();
            } catch (error) {
              row.form = false;
              row.form_error = (error.stderr || error.message || String(error)).slice(0, 500);
            }
            row.action_ms = performance.now() - actionStart;
            if (row.form) samples.action.push(row.action_ms);
            const shot = resolve(outputDir, `${pathName}-trial${i + 1}.png`);
            const shotStart = performance.now();
            try {
              await runCli(base, ['screenshot', shot]);
              row.screenshot_ms = performance.now() - shotStart;
              row.screenshot = analyzePng(shot);
              samples.screenshot.push(row.screenshot_ms);
            } catch (error) {
              row.screenshot_ms = performance.now() - shotStart;
              row.screenshot = {error: (error.stderr || error.message || String(error)).slice(0, 500)};
            }
            if (i === 0) await writeFile(resolve(outputDir, `${pathName}-snapshot.txt`), snap.stdout);
          } finally {
            if (opened) {
              try { await runCli(base, ['close']); row.closed = true; }
              catch (error) { row.cleanup_error = (error.stderr || error.message || String(error)).slice(0, 400); }
            }
          }
        } else {
          const engine = pathName.slice(7);
          const start = performance.now();
          const instance = await launchDirect(engine);
          row.browser_pid = instance.pid;
          try {
            const page = await instance.browser.newPage();
            await page.goto(url, {waitUntil: 'load', timeout: 10000});
            if (!await page.evaluate(() => window.ready)) throw Error('JS not ready');
            row.ready_ms = performance.now() - start;
            samples.cold.push(row.ready_ms);
            await new Promise(r => setTimeout(r, 80));
            row.memory = memoryOfNewPids(before);
            if (row.memory.rss_kb) samples.rss.push(row.memory.rss_kb);
            if (row.memory.pss_kb) samples.pss.push(row.memory.pss_kb);
            const warm = await warmTree(page);
            row.warm_mode = warm.mode;
            row.warm_snapshot_ms = warm.samples;
            row.warm_median_ms = summarize(warm.samples).median;
            if (row.warm_median_ms !== undefined) samples.warm.push(row.warm_median_ms);
            if (warm.error) row.warm_error = warm.error;
            const actionStart = performance.now();
            await page.evaluate(() => { document.querySelector('#name').value = 'Agent'; document.querySelector('#submit').click(); });
            row.form = await page.$eval('#result', element => element.textContent) === 'Hello Agent';
            row.action_ms = performance.now() - actionStart;
            if (row.form) samples.action.push(row.action_ms);
            row.action_kind = 'dom-evaluate';
            const shot = resolve(outputDir, `${pathName}-trial${i + 1}.png`);
            const shotStart = performance.now();
            await page.screenshot({path: shot, type: 'png'});
            row.screenshot_ms = performance.now() - shotStart;
            row.screenshot = analyzePng(shot);
            samples.screenshot.push(row.screenshot_ms);
          } finally {
            await instance.stop();
            row.closed = true;
          }
        }
        failures = 0;
      } catch (error) {
        row.error = (error.stderr || error.message || String(error)).slice(0, 800);
        failures++;
        console.log(pathName, 'trial', i + 1, row.error);
      }
      records.push(row);
      const mem = row.memory ? ` rss=${Math.round((row.memory.rss_kb || 0) / 1024)}MiB` : '';
      console.log(`${pathName} #${i + 1} cold=${row.ready_ms ? Math.round(row.ready_ms) : 'ERR'}ms warm=${row.warm_median_ms ?? '-'}ms action=${row.form === undefined ? '-' : row.form} shot=${row.screenshot?.pass ?? row.screenshot?.error ?? '-'}${mem}`);
      if (failures >= 2) { console.log(pathName, 'stopped after repeated launch failures'); break; }
    }
    console.log(pathName, 'cold', JSON.stringify(summarize(samples.cold)), 'warm', JSON.stringify(summarize(samples.warm)), 'rss', JSON.stringify(summarize(samples.rss)));
  }
} finally {
  server.close();
  const byName = name => records.filter(row => row.name === name && row.ready_ms !== undefined);
  const summary = Object.fromEntries(paths.map(name => {
    const rows = byName(name);
    const shots = rows.map(row => row.screenshot).filter(Boolean);
    return [name, {
      cold: summarize(rows.map(row => row.ready_ms)),
      warm: summarize(rows.map(row => row.warm_median_ms).filter(value => value !== undefined)),
      action: summarize(rows.filter(row => row.form).map(row => row.action_ms)),
      screenshot_time: summarize(rows.map(row => row.screenshot_ms).filter(value => value !== undefined)),
      memory_rss_kb: summarize(rows.map(row => row.memory?.rss_kb).filter(value => value)),
      memory_pss_kb: summarize(rows.map(row => row.memory?.pss_kb).filter(value => value)),
      form_pass: rows.filter(row => row.form).length,
      form_fail: rows.filter(row => row.form === false).length,
      screenshot_pass: shots.filter(shot => shot.pass).length,
      screenshot_fail: shots.filter(shot => shot && !shot.pass).length,
      launch_errors: records.filter(row => row.name === name && row.error).length,
    }];
  }));
  const decision = decide(summary);
  const dependencies = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).dependencies;
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGB: os.totalmem() / 2 ** 30,
    node: process.version,
    options: {...options, rounds, paths},
    methodology: {
      contest: 'agent-browser means the CLI driving Headless Shell. Lightpanda is scored on the CLI path an agent uses, with direct CDP reported separately.',
      cold: 'New browser process and, for the CLI, a unique daemon and session. Timer stops after local navigation plus interactive snapshot (CLI) or JS ready (direct).',
      warm: 'Median of five extra interactive snapshots on the same process. Direct engines read the accessibility tree over CDP when the domain exists.',
      memory: 'Sum of VmRSS and, when readable, proportional set size of processes that appeared during the trial, sampled 80ms after ready and before the action.',
      agentUse: 'CLI trials use snapshot refs, fill, click, and get text. Direct trials set the field and click through the DOM, which is not the agent hit-test path.',
      screenshot: 'PNG must contain the fixture navy background, a red canvas border, and a black canvas fill.',
      diskCache: 'uncontrolled; the shell binary was smoke-launched once before this run',
      advisory: 'disabled',
      kitesurf: 'cli-kitesurf and direct-kitesurf start a new container from ghcr.io/cloudflare/kitesurf for every trial, with host networking, and remove it afterwards. The timer includes container start, /health, and the same readiness check. agent-browser attaches with connect. The local engine runs page JavaScript in workerd, so this lab opens only its own fixture.',
    },
    dependencies,
    installation: await installationMetadata(),
    kitesurf: paths.some(pathName => pathName.includes('kitesurf')) ? await imageIdentity() : undefined,
    summary,
    decision,
    records,
  };
  await writeFile(resolve(outputDir, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({summary, decision}, null, 2));
  if (records.some(row => row.error)) process.exitCode = 1;
}

function decide(summary) {
  const agent = summary['cli-shell'];
  const panda = summary['cli-lightpanda'];
  if (!agent || !panda) return {contest: 'skipped', reason: 'The Shell versus Lightpanda decision needs both cli-shell and cli-lightpanda in the same run.'};
  const agentUsable = agent.form_pass > 0 && agent.form_fail === 0 && agent.screenshot_pass > 0 && agent.screenshot_fail === 0 && agent.launch_errors === 0;
  const pandaUsable = panda.form_pass > 0 && panda.form_fail === 0 && panda.screenshot_pass > 0 && panda.screenshot_fail === 0 && panda.launch_errors === 0;
  const categories = {
    cold: lower(agent.cold.median, panda.cold.median),
    warm: lower(agent.warm.median, panda.warm.median),
    memory: lower(agent.memory_pss_kb.median ?? agent.memory_rss_kb.median, panda.memory_pss_kb.median ?? panda.memory_rss_kb.median),
    agent_use: agentUsable === pandaUsable ? (agentUsable ? lower(agent.action.median, panda.action.median) : 'neither') : (agentUsable ? 'agent-browser' : 'lightpanda'),
    screenshot: agent.screenshot_pass === 0 && panda.screenshot_pass === 0
      ? 'neither'
      : agent.screenshot_pass === panda.screenshot_pass
        ? lower(agent.screenshot_time.median, panda.screenshot_time.median)
        : (agent.screenshot_pass > panda.screenshot_pass ? 'agent-browser' : 'lightpanda'),
  };
  // A path that cannot click and cannot render the fixture cannot win the agent benchmark.
  let winner;
  if (agentUsable && !pandaUsable) winner = 'agent-browser';
  else if (pandaUsable && !agentUsable) winner = 'lightpanda';
  else if (!agentUsable && !pandaUsable) winner = 'neither';
  else {
    const score = { 'agent-browser': 0, lightpanda: 0 };
    for (const value of Object.values(categories)) if (score[value] !== undefined) score[value]++;
    winner = score['agent-browser'] === score.lightpanda ? 'tie' : score['agent-browser'] > score.lightpanda ? 'agent-browser' : 'lightpanda';
  }
  return {
    agent_browser_usable: agentUsable,
    lightpanda_cli_usable: pandaUsable,
    categories,
    winner,
    rule: 'Usability (ref click plus screenshot fidelity, every trial) gates the win. If both pass, more category wins takes it. Direct CDP numbers are context, not the agent interface.',
  };
}
function lower(a, b) {
  if (a === undefined || b === undefined) return 'unknown';
  const scale = Math.max(a, b, 1);
  if (Math.abs(a - b) / scale < 0.05) return 'tie';
  return a < b ? 'agent-browser' : 'lightpanda';
}
