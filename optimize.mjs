import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import {root, browserPath, cliPath} from './runtime.mjs';
import {listPids, memoryOfNewPids, analyzePng, refsFromSnapshot, round1} from './metrics.mjs';

const exec = promisify(execFile);
const loops = 5;
const reps = 2;
const html = `<!doctype html><title>Agent benchmark</title><style>body{margin:0;background:#123;color:white;font:20px sans-serif}canvas{border:3px solid red}</style>
<h1>Agent benchmark</h1><label>Name<input id="name"></label><button id="submit">Submit</button><p id="result">Waiting</p><canvas id="canvas" width="100" height="60"></canvas>
<script>document.querySelector('#submit').onclick=()=>{document.querySelector('#result').textContent='Hello '+document.querySelector('#name').value};document.querySelector('canvas').getContext('2d').fillRect(5,5,60,40);window.ready=true;</script>`;
const shellArgs = [
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--disable-domain-reliability',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-pings',
  '--disable-gpu',
  '--renderer-process-limit=1',
  '--disable-features=Translate,MediaRouter,OptimizationHints,AudioServiceOutOfProcess,PaintHolding',
].join('\n');

const runId = new Date().toISOString().replace(/[^0-9TZ]/g, '') + '-' + process.pid;
const outputDir = resolve(root, 'results/runs', `${runId}-optimize`);
await mkdir(outputDir, {recursive: true});
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html'); res.end(html);});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
const cli = cliPath();
const executable = await browserPath('shell');
const cliEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_BROWSER_')));
cliEnv.AGENT_BROWSER_NO_VERSION_CHECK = '1';
const configPath = resolve(root, 'empty-config.json');
const stamp = randomUUID().replaceAll('-', '').slice(0, 10);

function flags(config, session) {
  const base = ['--config', configPath, '--namespace', 'startup-lab-opt', '--session', session, '--engine', 'chrome', '--executable-path', executable];
  if (config.noWebmcp) base.push('--no-webmcp');
  if (config.tuned) base.push('--args', shellArgs);
  return base;
}
function run(base, args) {
  return exec(cli, [...base, ...args], {cwd: root, env: cliEnv, timeout: 20000, maxBuffer: 2 * 1024 * 1024});
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
  return round1(mid);
}

async function measure(config) {
  const repetitions = [];
  for (let rep = 1; rep <= reps; rep++) {
    const memorySamples = [];
    const loopRows = [];
    let formPass = 0; let shotPass = 0; let error = null;
    const totalStart = performance.now();
    const openSessions = [];
    const closed = new Set();
    let origin = null;
    try {
      for (let i = 1; i <= loops; i++) {
        const session = config.reuse ? `opt-${stamp}-${config.id}` : `opt-${stamp}-${config.id}-r${rep}-l${i}`;
        const base = flags(config, session);
        if (!openSessions.includes(session)) openSessions.push(session);
        if (!origin || !config.reuse) origin = listPids();
        const start = performance.now();
        const shot = resolve(outputDir, `${config.id}-r${rep}-l${i}.png`);
        await run(base, ['open', url]);
        const snap = await run(base, ['snapshot', ...(config.compact ? ['-i', '-c'] : ['-i'])]);
        const {input, button} = refsFromSnapshot(snap.stdout);
        if (!input || !button) throw Error(`missing refs in ${snap.stdout.slice(0, 240)}`);
        let sawHello = false;
        if (config.batch) {
          const batched = await run(base, ['batch', `fill @${input} Agent`, `click @${button}`, 'get text #result', `screenshot ${shot}`]);
          sawHello = batched.stdout.includes('Hello Agent');
          if (!sawHello) throw Error(batched.stdout.slice(0, 400));
        } else {
          await run(base, ['fill', `@${input}`, 'Agent']);
          await run(base, ['click', `@${button}`]);
          const result = await run(base, ['get', 'text', '#result']);
          sawHello = result.stdout.includes('Hello Agent');
          if (!sawHello) throw Error(result.stdout.slice(0, 400));
          await run(base, ['screenshot', shot]);
        }
        const image = analyzePng(shot);
        const memory = memoryOfNewPids(origin);
        if (memory.pss_kb) memorySamples.push(memory.pss_kb);
        if (sawHello) formPass++;
        if (image.pass) shotPass++;
        else throw Error(`screenshot fidelity failed ${JSON.stringify(image)}`);
        loopRows.push({
          loop: i,
          ms: round1(performance.now() - start),
          pss_kb: memory.pss_kb,
          rss_kb: memory.rss_kb,
          processes: memory.processes,
          names: memory.names,
          screenshot_bytes: image.bytes,
        });
        if (!config.reuse) { await run(base, ['close']); closed.add(session); }
      }
    } catch (caught) {
      error = (caught.stderr || caught.message || String(caught)).slice(0, 600);
    } finally {
      for (const session of openSessions) {
        if (closed.has(session)) continue;
        try { await run(flags(config, session), ['close']); } catch { /* session never finished launching */ }
      }
    }
    repetitions.push({
      rep,
      error,
      form_pass: formPass,
      screenshot_pass: shotPass,
      total_ms: round1(performance.now() - totalStart),
      loops: loopRows,
      pss_kb: memorySamples.length ? median(memorySamples) : null,
      first_ms: loopRows[0]?.ms ?? null,
    });
    console.log(`${config.id} rep ${rep} total=${repetitions.at(-1).total_ms}ms loops=${loopRows.map(row => row.ms).join(',')} pss=${repetitions.at(-1).pss_kb} form=${formPass}/5 shot=${shotPass}/5${error ? ' ERR ' + error : ''}`);
    if (error) break;
  }
  const ok = repetitions.length === reps && repetitions.every(rep => !rep.error && rep.form_pass === loops && rep.screenshot_pass === loops);
  return {
    id: config.id,
    config: {reuse: !!config.reuse, batch: !!config.batch, noWebmcp: !!config.noWebmcp, tuned: !!config.tuned, compact: !!config.compact},
    ok,
    total_ms: ok ? median(repetitions.map(rep => rep.total_ms)) : null,
    first_ms: ok ? median(repetitions.map(rep => rep.first_ms)) : null,
    pss_kb: ok ? median(repetitions.map(rep => rep.pss_kb).filter(Boolean)) : null,
    repetitions,
  };
}

function judge(previous, next) {
  if (!next.ok) return {accept: false, reason: next.repetitions.find(rep => rep.error)?.error || 'functional regression'};
  const timeGain = (previous.total_ms - next.total_ms) / previous.total_ms;
  const memGain = (previous.pss_kb - next.pss_kb) / previous.pss_kb;
  const firstGain = (previous.first_ms - next.first_ms) / previous.first_ms;
  const timeRegression = (next.total_ms - previous.total_ms) / previous.total_ms;
  const detail = `total ${previous.total_ms}→${next.total_ms} ms (${(timeGain * 100).toFixed(1)}%), first ${previous.first_ms}→${next.first_ms} ms (${(firstGain * 100).toFixed(1)}%), pss ${Math.round(previous.pss_kb / 1024)}→${Math.round(next.pss_kb / 1024)} MiB (${(memGain * 100).toFixed(1)}%)`;
  if (timeGain >= 0.05) return {accept: true, reason: `faster 5-loop total. ${detail}`};
  if (memGain >= 0.10 && timeRegression <= 0.03) return {accept: true, reason: `lower memory without a meaningful slowdown. ${detail}`};
  if (firstGain >= 0.08 && timeRegression <= 0.03) return {accept: true, reason: `faster first loop without a meaningful slowdown. ${detail}`};
  return {accept: false, reason: `below the keep threshold. ${detail}`};
}

const levers = [
  {id: 'reuse-daemon', patch: {reuse: true}, hypothesis: 'Keep one daemon and browser open across the five task loops.'},
  {id: 'batch-tail', patch: {batch: true}, hypothesis: 'After the snapshot, run fill, click, read, and screenshot in one CLI process.'},
  {id: 'no-webmcp', patch: {noWebmcp: true}, hypothesis: 'Skip the default WebMCP init script on the Chrome launch path.'},
  {id: 'tuned-args', patch: {tuned: true}, hypothesis: 'Launch Headless Shell with background features, GPU, and extra renderers disabled.'},
  {id: 'compact-snapshot', patch: {compact: true}, hypothesis: 'Ask for a compact interactive snapshot so the agent reads less tree output.'},
];

console.log(`Optimizing ${loops} agent loops, ${reps} reps. Fixture ${url}`);
console.log(`Results: ${outputDir}`);
let current = {id: 'baseline', reuse: false, batch: false, noWebmcp: false, tuned: false, compact: false};
const history = [];
try {
  let accepted = await measure(current);
  if (!accepted.ok) throw Error('baseline failed: ' + (accepted.repetitions.find(rep => rep.error)?.error || 'unknown'));
  history.push({step: 0, lever: 'baseline', hypothesis: 'Cold daemon per loop, separate CLI calls, default Shell launch.', accepted: true, reason: 'starting point', result: accepted});
  let step = 1;
  for (const lever of levers) {
    const candidate = {...current, ...lever.patch, id: `${step}-${lever.id}`};
    const result = await measure(candidate);
    const verdict = judge(accepted, result);
    history.push({step, lever: lever.id, hypothesis: lever.hypothesis, accepted: verdict.accept, reason: verdict.reason, result});
    console.log(`${verdict.accept ? 'KEEP' : 'DROP'} ${lever.id}: ${verdict.reason}`);
    if (verdict.accept) {
      current = {...candidate, id: current.id};
      accepted = {...result, id: current.id};
    }
    step++;
  }
  const kept = history.filter(item => item.accepted && item.lever !== 'baseline').map(item => item.lever);
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGB: os.totalmem() / 2 ** 30,
    node: process.version,
    workload: 'Five loops of open, interactive snapshot, ref fill, ref click, text read, and screenshot on a local fixture. Each configuration is repeated twice; reported totals are medians.',
    keep: 'Keep a lever when every loop still passes the click and the screenshot fidelity check, and median total time drops at least 5%, or memory drops at least 10% or the first loop drops at least 8% without the total slowing more than 3%.',
    shellArgs: shellArgs.split('\n'),
    kept,
    final: history.filter(item => item.accepted).at(-1)?.result,
    history: history.map(item => ({
      step: item.step,
      lever: item.lever,
      hypothesis: item.hypothesis,
      accepted: item.accepted,
      reason: item.reason,
      total_ms: item.result.total_ms,
      first_ms: item.result.first_ms,
      pss_kb: item.result.pss_kb,
      config: item.result.config,
      repetitions: item.result.repetitions,
    })),
  };
  await writeFile(resolve(outputDir, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({kept, baseline: history[0].result.total_ms, final: report.final?.total_ms, pss: report.final?.pss_kb}, null, 2));
} finally {
  server.close();
}
