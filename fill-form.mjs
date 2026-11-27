import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import {root, browserPath, cliPath} from './runtime.mjs';

const exec = promisify(execFile);
const duties1 = 'Lead the kelp heatwave surveys, supervise two technicians, and publish the annual genotype panel.';
const duties2 = 'Taught field methods and maintained the teaching collection of intertidal specimens.';
const thesis1 = 'Thermal tolerance genes in Nereocystis luetkeana across the Salish Sea.';
const thesis2 = 'A teaching collection is not a thesis: undergraduate honours paper on barnacle recruitment.';
const abstract = 'This residency measures how marine heatwaves shift kelp genotypes inside two British Columbia inlets, and whether those shifts can be detected from shore-based tissue samples.';
const methods = 'Monthly tissue collection, low-coverage sequencing, and a mixed model with inlet and degree-heating-week as factors.';
const comments = 'I can move the September start by one week if opening week overlaps a prior field commitment.';

const actions = [
  ['#identity', 'fill', 'Legal first name', 'Amelia', 'first-name'],
  ['#identity', 'fill', 'Legal middle name', 'Joan', 'middle-name'],
  ['#identity', 'fill', 'Legal last name', 'Okonkwo', 'last-name'],
  ['#identity', 'fill', 'Preferred name', 'AJ', 'preferred-name'],
  ['#identity', 'fill', 'Date of birth', '1991-04-17', 'dob'],
  ['#identity', 'fill', 'National identification number', 'CA-441290', 'national-id'],
  ['#identity', 'select', 'Country of citizenship', 'Canada', 'citizenship'],
  ['#identity', 'select', 'Second citizenship', 'Nigeria', 'second-citizenship'],
  ['#identity', 'check', 'Female', 'female', 'sex'],
  ['#identity', 'check', 'She/her', 'she-her', 'pronouns'],
  ['#contact', 'fill', 'Email', 'amelia.okonkwo@example.org', 'email'],
  ['#contact', 'fill', 'Backup email', 'aj.okonkwo@example.net', 'backup-email'],
  ['#contact', 'fill', 'Mobile phone', '+1-604-555-0148', 'mobile'],
  ['#contact', 'fill', 'Home phone', '+1-604-555-0190', 'home-phone'],
  ['#contact', 'fill', 'Website', 'https://okonkwo.example.edu', 'website'],
  ['#contact', 'check', 'Email me', 'email', 'contact-method'],
  ['#home-address', 'fill', 'Street address', '418 Harbour Road', 'home-line1'],
  ['#home-address', 'fill', 'Apartment, suite, or unit', 'Apartment 12', 'home-line2'],
  ['#home-address', 'fill', 'City', 'Vancouver', 'home-city'],
  ['#home-address', 'fill', 'State or province', 'British Columbia', 'home-region'],
  ['#home-address', 'fill', 'Postal code', 'V6B 1A1', 'home-postal'],
  ['#home-address', 'select', 'Country', 'Canada', 'home-country'],
  ['#mailing-address', 'fill', 'Street address', 'PO Box 880', 'mail-line1'],
  ['#mailing-address', 'fill', 'City', 'Burnaby', 'mail-city'],
  ['#mailing-address', 'fill', 'State or province', 'British Columbia', 'mail-region'],
  ['#mailing-address', 'fill', 'Postal code', 'V5H 4N2', 'mail-postal'],
  ['#mailing-address', 'select', 'Country', 'Canada', 'mail-country'],
  ['#passport', 'fill', 'Passport number', 'AB3922117', 'passport-number'],
  ['#passport', 'select', 'Issuing country', 'Canada', 'passport-country'],
  ['#passport', 'fill', 'Issue date', '2022-06-01', 'passport-issued'],
  ['#passport', 'fill', 'Expiry date', '2032-06-01', 'passport-expires'],
  ['#passport', 'select', 'Document type', 'Ordinary', 'document-type'],
  ['#job-1', 'fill', 'Employer', 'Coastal Genome Lab', 'job1-employer'],
  ['#job-1', 'fill', 'Job title', 'Senior research associate', 'job1-title'],
  ['#job-1', 'fill', 'Start month', '2019-03', 'job1-start'],
  ['#job-1', 'check', 'I currently work here', 'yes', 'job1-current'],
  ['#job-1', 'fill', 'Duties', duties1, 'job1-duties'],
  ['#job-2', 'fill', 'Employer', 'Harbour University', 'job2-employer'],
  ['#job-2', 'fill', 'Job title', 'Laboratory instructor', 'job2-title'],
  ['#job-2', 'fill', 'Start month', '2016-09', 'job2-start'],
  ['#job-2', 'fill', 'End month', '2019-02', 'job2-end'],
  ['#job-2', 'fill', 'Duties', duties2, 'job2-duties'],
  ['#school-1', 'fill', 'Institution', 'Harbour University', 'school1-institution'],
  ['#school-1', 'select', 'Degree', 'PhD', 'school1-degree'],
  ['#school-1', 'fill', 'Field of study', 'Marine biology', 'school1-field'],
  ['#school-1', 'fill', 'Start year', '2012', 'school1-start'],
  ['#school-1', 'fill', 'End year', '2016', 'school1-end'],
  ['#school-1', 'fill', 'Thesis or dissertation title', thesis1, 'school1-thesis'],
  ['#school-2', 'fill', 'Institution', 'Lagos Coastal College', 'school2-institution'],
  ['#school-2', 'select', 'Degree', "Bachelor's", 'school2-degree'],
  ['#school-2', 'fill', 'Field of study', 'Ecology', 'school2-field'],
  ['#school-2', 'fill', 'Start year', '2008', 'school2-start'],
  ['#school-2', 'fill', 'End year', '2012', 'school2-end'],
  ['#school-2', 'fill', 'Thesis or dissertation title', thesis2, 'school2-thesis'],
  ['#languages', 'select', 'Native language', 'Igbo', 'native-language'],
  ['#languages', 'check', 'French', 'yes', 'lang-french'],
  ['#languages', 'check', 'Mandarin', 'yes', 'lang-mandarin'],
  ['#languages', 'check', 'German', 'yes', 'lang-german'],
  ['#languages', 'fill', 'Years of Mandarin study', '4', 'mandarin-years'],
  ['#residency', 'check', 'Coastal ecology', 'ecology', 'track'],
  ['#residency', 'fill', 'Residency start date', '2027-09-01', 'start-date'],
  ['#residency', 'select', 'Duration', '12 months', 'duration'],
  ['#residency', 'fill', 'Project title', 'Kelp forest genomes under marine heatwaves', 'project-title'],
  ['#residency', 'fill', 'Abstract', abstract, 'abstract'],
  ['#residency', 'fill', 'Methods', methods, 'methods'],
  ['#residency', 'fill', 'Keywords', 'kelp, genomics, heatwave, British Columbia', 'keywords'],
  ['#residency', 'fill', 'Consumables budget (CAD)', '18450', 'budget'],
  ['#residency', 'fill', 'Confidence in this timeline', '72', 'confidence'],
  ['#residency', 'select-many', 'Research areas', ['Marine ecology', 'Genomics', 'Climate'], 'areas'],
  ['#residency', 'check', 'I need laboratory access', 'yes', 'lab-access'],
  ['#residency', 'check', 'I need visa sponsorship', 'yes', 'visa-sponsorship'],
  ['#trip-1', 'select', 'Country', 'Japan', 'trip1-country'],
  ['#trip-1', 'fill', 'Purpose', 'Guest seminar at the Seto Marine Laboratory', 'trip1-purpose'],
  ['#trip-1', 'fill', 'Arrival date', '2025-05-02', 'trip1-arrive'],
  ['#trip-1', 'fill', 'Departure date', '2025-05-18', 'trip1-depart'],
  ['#trip-2', 'select', 'Country', 'Germany', 'trip2-country'],
  ['#trip-2', 'fill', 'Purpose', 'Workshop at the Helmholtz Centre for Ocean Research', 'trip2-purpose'],
  ['#trip-2', 'fill', 'Arrival date', '2024-10-09', 'trip2-arrive'],
  ['#trip-2', 'fill', 'Departure date', '2024-10-14', 'trip2-depart'],
  ['#trip-3', 'select', 'Country', 'Nigeria', 'trip3-country'],
  ['#trip-3', 'fill', 'Purpose', 'Family visit and a lecture at the University of Lagos', 'trip3-purpose'],
  ['#trip-3', 'fill', 'Arrival date', '2023-12-20', 'trip3-arrive'],
  ['#trip-3', 'fill', 'Departure date', '2024-01-08', 'trip3-depart'],
  ['#referee-1', 'fill', 'Full name', 'Priya Raman', 'ref1-name'],
  ['#referee-1', 'fill', 'Email', 'priya.raman@harbour.example.edu', 'ref1-email'],
  ['#referee-1', 'fill', 'Institution', 'Harbour University', 'ref1-institution'],
  ['#referee-1', 'fill', 'Phone', '+1-604-555-0177', 'ref1-phone'],
  ['#referee-1', 'select', 'Relationship', 'Doctoral supervisor', 'ref1-relationship'],
  ['#referee-2', 'fill', 'Full name', 'Jonas Adler', 'ref2-name'],
  ['#referee-2', 'fill', 'Email', 'jonas.adler@genome-lab.example.org', 'ref2-email'],
  ['#referee-2', 'fill', 'Institution', 'Coastal Genome Lab', 'ref2-institution'],
  ['#referee-2', 'fill', 'Phone', '+1-778-555-0164', 'ref2-phone'],
  ['#referee-2', 'select', 'Relationship', 'Line manager', 'ref2-relationship'],
  ['#q1', 'check', 'No', 'no', 'q1'],
  ['#q2', 'check', 'No', 'no', 'q2'],
  ['#q3', 'check', 'Yes', 'yes', 'q3'],
  ['#q4', 'check', 'Yes', 'yes', 'q4'],
  ['#q5', 'check', 'Yes', 'yes', 'q5'],
  ['#q6', 'check', 'No', 'no', 'q6'],
  ['#q7', 'check', 'No', 'no', 'q7'],
  ['#q8', 'check', 'Yes', 'yes', 'q8'],
  ['#declarations', 'check', 'I certify that this application is true', 'yes', 'certify'],
  ['#declarations', 'check', 'I agree to the residency code of conduct', 'yes', 'conduct'],
  ['#declarations', 'fill', 'Signature', 'Amelia Joan Okonkwo', 'signature'],
  ['#declarations', 'fill', 'Date signed', '2026-11-27', 'signed-on'],
  ['#declarations', 'select', 'How did you hear about the residency?', 'Colleague', 'heard'],
  ['#declarations', 'fill', 'Additional comments', comments, 'comments'],
];

const expected = Object.fromEntries(actions.map(action => {
  const [,, , value, field] = action;
  if (action[1] === 'select-many') return [field, [...value].sort().join('|')];
  return [field, value];
}));
Object.assign(expected, {
  'application-id': 'APP-2026-00421',
  'staff-only': 'INTERNAL',
  'mail-line2': '',
  'same-as-home': '',
  'job1-end': '',
  'job2-current': '',
  'lang-spanish': '',
  'lang-arabic': '',
  'lang-japanese': '',
  'lang-portuguese': '',
  'lang-korean': '',
  'marketing': '',
  'behalf': '',
  'instructions-read': 'yes',
});

const roles = {
  fill: ['textbox', 'searchbox', 'spinbutton', 'slider'],
  select: ['combobox', 'listbox'],
  'select-many': ['listbox', 'combobox'],
  check: ['checkbox', 'radio'],
  click: ['button'],
};

const runId = new Date().toISOString().replace(/[^0-9TZ]/g, '') + '-' + process.pid;
const outputDir = resolve(root, 'results/runs', `${runId}-long-form`);
await mkdir(outputDir, {recursive: true});
const page = readFileSync(resolve(root, 'fixture/residency-application.html'));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(page);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
const cli = cliPath();
const cliEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_BROWSER_')));
cliEnv.AGENT_BROWSER_NO_VERSION_CHECK = '1';
const config = resolve(root, 'empty-config.json');
const stamp = randomUUID().replaceAll('-', '').slice(0, 10);

function run(base, args) {
  return exec(cli, [...base, ...args], {cwd: root, env: cliEnv, timeout: 25000, maxBuffer: 4 * 1024 * 1024});
}
function findRef(snapshot, op, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const role = roles[op].join('|');
  // Lightpanda appends every option label onto the combobox name.
  return snapshot.match(new RegExp(`(?:${role}) "${escaped}(?:"| )[^\\n]*\\bref=(e\\d+)`))?.[1] ?? null;
}
function parseEval(stdout) {
  let value = JSON.parse(stdout.trim());
  if (typeof value === 'string') value = JSON.parse(value);
  return value;
}
function same(actual, wanted) {
  if (actual === wanted) return true;
  const parts = value => String(value ?? '').split('|').filter(Boolean).sort().join('|');
  return parts(actual) === parts(wanted);
}

async function fillWith(engine) {
  const executable = await browserPath(engine);
  const session = `form-${stamp}-${engine}`;
  const base = ['--config', config, '--namespace', 'startup-lab-form', '--session', session, '--engine', engine === 'lightpanda' ? 'lightpanda' : 'chrome', '--executable-path', executable];
  const snapshots = new Map();
  const attempts = [];
  const started = performance.now();
  let submitted = false;
  let submitError = null;
  let dump = null;
  let pageHeight = null;
  try {
    await run(base, ['open', url]);
    await run(base, ['set', 'viewport', '1280', '900']);
    await run(base, ['wait', '--fn', "[...document.querySelectorAll('#citizenship option')].some(option => option.value === 'Canada')"]);
    const meta = await run(base, ['eval', 'JSON.stringify({height:document.documentElement.scrollHeight, fields:document.querySelectorAll("[data-field]").length, text:document.body.innerText.length})']);
    pageHeight = parseEval(meta.stdout);
    await run(base, ['screenshot', resolve(outputDir, `${engine}-top.png`)]);
    for (const [scope, op, name, value, field] of actions) {
      const attempt = {field, op, name, scope};
      try {
        if (!snapshots.has(scope)) {
          await run(base, ['scrollintoview', scope]);
          const shot = await run(base, ['snapshot', '-i', '-s', scope]);
          snapshots.set(scope, shot.stdout);
          if (engine === 'shell') await writeFile(resolve(outputDir, `snapshot${scope.replace('#', '-')}.txt`), shot.stdout);
        }
        const temporal = op === 'fill' && /date|month/i.test(name);
        const ref = temporal ? null : findRef(snapshots.get(scope), op, name);
        if (!temporal && !ref) throw Error(`no ${roles[op].join('/')} named ${name}`);
        attempt.ref = ref;
        if (ref) await run(base, ['scrollintoview', `@${ref}`]);
        else await run(base, ['scrollintoview', `#${field}`]);
        if (temporal) await run(base, ['fill', `#${field}`, value]);
        else if (op === 'fill') await run(base, ['fill', `@${ref}`, value]);
        else if (op === 'select') await run(base, ['select', `@${ref}`, value]);
        else if (op === 'select-many') await run(base, ['select', `@${ref}`, ...value]);
        else if (op === 'check') await run(base, ['check', `@${ref}`]);
        attempt.ok = true;
      } catch (error) {
        attempt.ok = false;
        attempt.error = (error.stderr || error.message || String(error)).slice(0, 400);
      }
      attempts.push(attempt);
      console.log(`${engine} ${field} ${attempt.ok ? 'ok' : 'FAIL'} ${attempt.error ?? ''}`);
    }
    await run(base, ['scrollintoview', '#declarations']);
    await run(base, ['screenshot', resolve(outputDir, `${engine}-bottom.png`)]);
    try {
      const snap = await run(base, ['snapshot', '-i', '-s', '#declarations']);
      const ref = findRef(snap.stdout, 'click', 'Submit application');
      if (!ref) throw Error('submit button missing');
      await run(base, ['scrollintoview', `@${ref}`]);
      await run(base, ['click', `@${ref}`]);
      await run(base, ['wait', '--fn', '!document.getElementById("success").hidden']);
      submitted = true;
    } catch (error) {
      submitError = (error.stderr || error.message || String(error)).slice(0, 500);
    }
    const raw = await run(base, ['eval', 'JSON.stringify(window.dumpApplication())']);
    dump = parseEval(raw.stdout);
    await run(base, ['screenshot', resolve(outputDir, `${engine}-after.png`)]);
  } finally {
    try { await run(base, ['close']); } catch { /* session may already be closed */ }
  }
  const fields = Object.keys(expected).sort();
  const mismatches = fields.filter(field => !same(dump?.[field], expected[field])).map(field => ({field, expected: expected[field], actual: dump?.[field] ?? null}));
  const actionFailures = attempts.filter(attempt => !attempt.ok);
  return {
    engine,
    ms: Math.round(performance.now() - started),
    page: pageHeight,
    actions: attempts.length,
    action_failures: actionFailures.length,
    submitted,
    submit_error: submitError,
    compared: fields.length,
    correct: fields.length - mismatches.length,
    mismatches,
    failures: actionFailures,
  };
}

console.log(`Form: ${url}`);
console.log(`Results: ${outputDir}`);
const reports = [];
try {
  for (const engine of ['shell', 'lightpanda']) reports.push(await fillWith(engine));
} finally {
  server.close();
  const summary = Object.fromEntries(reports.map(report => [report.engine, {
    correct: `${report.correct}/${report.compared}`,
    action_failures: report.action_failures,
    submitted: report.submitted,
    ms: report.ms,
    page: report.page,
  }]));
  await writeFile(resolve(outputDir, 'results.json'), JSON.stringify({
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    node: process.version,
    url,
    answers: actions.length,
    untouched_checked: Object.keys(expected).length - actions.length,
    summary,
    reports,
  }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (reports.some(report => report.correct !== report.compared || !report.submitted)) process.exitCode = 1;
}
