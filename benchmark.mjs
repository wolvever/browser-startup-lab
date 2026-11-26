import puppeteer from 'puppeteer-core';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm, writeFile, mkdir, readFile, access} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {root, browserPath, cliPath, pandaPath, tunedArgs, installationMetadata} from './runtime.mjs';

const exec = promisify(execFile);
const {values: options} = parseArgs({options: {
  mode: {type:'string', default:process.env.CLI_ONLY?'cli':process.env.DIRECT_ONLY?'direct':'all'},
  engine: {type:'string', default:process.env.ENGINE || 'all'},
  rounds: {type:'string', default:process.env.ROUNDS || '10'},
  fast: {type:'boolean', default:process.env.AGENT_BROWSER_NO_VERSION_CHECK === '1'},
  label: {type:'string', default:'process-cold'},
}});
const rounds = Number(options.rounds);
if (!['all','direct','cli'].includes(options.mode) || !['all','chrome','chrome-tuned','shell','lightpanda'].includes(options.engine) || !Number.isInteger(rounds) || rounds < 1 || !/^[a-z0-9-]+$/.test(options.label)) throw Error('Usage: node benchmark.mjs --mode all|direct|cli --engine all|chrome|chrome-tuned|shell|lightpanda --rounds N [--fast] [--label process-cold]');
const runId = new Date().toISOString().replace(/[^0-9TZ]/g,'') + '-' + process.pid;
const sessionPrefix = 'b-' + randomUUID().replaceAll('-','').slice(0,16);
const outputDir = resolve(root, 'results/runs', `${runId}-${options.label}`);
await mkdir(outputDir, {recursive:true});
console.log(`Results: ${outputDir}`);
const cli = cliPath();
// Explicit CLI flags and a clean agent-browser environment prevent attachment
// to an inherited Chrome session, provider, persistent profile, or daemon.
const cliEnv = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AGENT_BROWSER_')));
if (options.fast) cliEnv.AGENT_BROWSER_NO_VERSION_CHECK = '1';
const extra = ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--disable-sync'];
const html = `<!doctype html><title>Agent benchmark</title><style>body{background:#123;color:white}canvas{border:3px solid red}</style>
<h1>Agent benchmark</h1><label>Name<input id="name"></label><button id="submit">Submit</button><p id="result">Waiting</p><canvas id="canvas" width="100" height="60"></canvas>
<script>document.querySelector('#submit').onclick=()=>{document.querySelector('#result').textContent='Hello '+document.querySelector('#name').value};document.querySelector('canvas').getContext('2d').fillRect(5,5,60,40);window.ready=true;</script>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html'); res.end(html);});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/`;
const records = [];
const config = resolve(root, 'empty-config.json');
function summarize(samples) {
  if(!samples.length)return {n:0};
  const sorted = [...samples].sort((a,b)=>a-b);
  return {n:samples.length, median_ms: Math.round((sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.ceil((sorted.length-1)/2)])/2), p95_ms: Math.round(sorted[Math.ceil(sorted.length*.95)-1]), max_ms: Math.round(sorted.at(-1)), under_1500:samples.filter(x=>x<1500).length};
}
async function launch(engine, optimized) {
  if (engine !== 'lightpanda') {
    const profile = await mkdtemp(resolve(root, 'profile-'));
    try {
      const browser = await puppeteer.launch({executablePath:await browserPath(engine), headless:engine==='shell'?'shell':true, userDataDir:profile, args:optimized?extra:[], timeout:15000});
      return {browser, pid:browser.process().pid, stop: async()=>{await browser.close();await rm(profile,{recursive:true,force:true});}};
    } catch(e) {await rm(profile,{recursive:true,force:true});throw e;}
  }
  // A dynamically allocated port avoids existing browser sessions.
  const portServer = createServer(); portServer.listen(0,'127.0.0.1'); await once(portServer,'listening');
  const port = portServer.address().port; await new Promise(r=>portServer.close(r));
  const proc = spawn(pandaPath,['serve','--host','127.0.0.1','--port',String(port),'--log-level','error'],{stdio:'ignore'});
  await once(proc,'spawn');
  let browser;
  try {
    for(let n=0;n<500;n++) {
      try {browser=await puppeteer.connect({browserWSEndpoint:`ws://127.0.0.1:${port}`});break;} catch {if(proc.exitCode!==null)throw Error(`Lightpanda exited ${proc.exitCode}`);await new Promise(r=>setTimeout(r,10));}
    }
    if(!browser)throw Error('Lightpanda startup timeout');
    return {browser, pid:proc.pid, stop:async()=>{await browser.disconnect();proc.kill('SIGTERM');if(proc.exitCode===null)await once(proc,'exit');}};
  } catch(e) {proc.kill();throw e;}
}
try {
  if (options.mode !== 'cli') for(const [engine,optimized] of [['chrome',false],['chrome',true],['shell',true],['lightpanda',true]]) {
    if(options.engine !== 'all' && options.engine !== engine && !(options.engine === 'chrome-tuned' && engine === 'chrome' && optimized))continue;
    if(options.engine === 'chrome-tuned' && !optimized)continue;
    const name=`direct-${engine}${optimized?'-optimized':'-baseline'}`;
    if(engine === 'lightpanda') {
      try {await access(pandaPath);} catch {records.push({name,skipped:'Lightpanda not installed; use npm run setup -- --lightpanda'});continue;}
    }
    const samples=[];
    for(let i=0;i<rounds;i++) {
      const start=performance.now();let instance;
      try {
        instance=await launch(engine,optimized);
        const page=await instance.browser.newPage();
        await page.goto(url,{waitUntil:'load',timeout:10000});
        if(!await page.evaluate(()=>window.ready))throw Error('JS not ready');
        const ready=performance.now()-start;samples.push(ready);
        // Interaction through DOM works even in engines without visual geometry.
        await page.evaluate(()=>{document.querySelector('#name').value='Agent';document.querySelector('#submit').click();});
        if(await page.$eval('#result',e=>e.textContent)!=='Hello Agent')throw Error('form failed');
        records.push({name,trial:i+1,cold_start:true,browser_pid:instance.pid,profile:engine==='lightpanda'?'new-process':'fresh-directory',ready_ms:ready,form:true});
      }catch(e){records.push({name,trial:i+1,error:String(e)});console.log(name,String(e));break;}
      finally{if(instance)await instance.stop();}
    }
    console.log(name,JSON.stringify(summarize(samples)));
  }
  if(options.mode !== 'direct') for(const engine of ['chrome','chrome-tuned','shell','lightpanda']) {
    if(options.engine !== 'all' && engine !== options.engine)continue;
    const name=`cli-${engine}`;const samples=[];
    if(engine === 'lightpanda') {
      try {await access(pandaPath);} catch {records.push({name,skipped:'Lightpanda not installed; use npm run setup -- --lightpanda'});continue;}
    }
    const executable = await browserPath(engine);
    for(let i=0;i<rounds;i++) {
      const session=`${sessionPrefix}-${engine==='chrome-tuned'?'t':engine[0]}-${i+1}`;
      const base=['--config',config,'--namespace','startup-lab','--session',session,'--engine',engine==='lightpanda'?'lightpanda':'chrome','--executable-path',executable];
      if(engine==='chrome-tuned')base.push('--args',tunedArgs);
      const run=(args)=>exec(cli,[...base,...args],{cwd:root,env:cliEnv,timeout:20000,maxBuffer:1024*1024});
      const row={name,trial:i+1,cold_start:true,session,profile:'new-daemon-temporary-profile'};
      try {
        const start=performance.now();await run(['open',url]);row.open_ms=performance.now()-start;
        const snap=await run(['snapshot','-i']);row.ready_ms=performance.now()-start;
        if(!snap.stdout.includes('Submit'))throw Error('snapshot missing Submit');
        samples.push(row.ready_ms);
        if(i===0) {
          await writeFile(resolve(outputDir,`${name}-snapshot.txt`),snap.stdout);
          const input=snap.stdout.match(/textbox[^\n]*\[ref=(e\d+)\]/)?.[1];
          const button=snap.stdout.match(/button "Submit"[^\n]*\[ref=(e\d+)\]/)?.[1];
          if(!input||!button)throw Error('missing input/button refs');
          try {
            await run(['fill',`@${input}`,'Agent']);await run(['click',`@${button}`]);
            const result=await run(['get','text','#result']);row.form=result.stdout.includes('Hello Agent');
          }catch(e){row.form=false;row.form_error=e.stderr||String(e);}
          try {await run(['screenshot',resolve(outputDir,`${name}.png`)]);row.screenshot=true;}catch(e){row.screenshot_error=e.stderr||String(e);}
          const warm=performance.now();await run(['snapshot','-i']);row.warm_snapshot_ms=performance.now()-warm;
        }
      }catch(e){row.error=e.stderr||String(e);}
      finally{try{await run(['close']);row.closed=true;}catch(e){row.cleanup_error=e.stderr||String(e);process.exitCode=1;} }
      records.push(row);console.log(JSON.stringify(row));
      if(row.error || row.cleanup_error)break;
    }
    console.log(name,JSON.stringify(summarize(samples)));
  }
} finally {
  server.close();
  const summary = Object.fromEntries([...new Set(records.map(r=>r.name))].map(name=>[name,summarize(records.filter(r=>r.name===name && r.ready_ms !== undefined).map(r=>r.ready_ms))]));
  const dependencies = JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).dependencies;
  await writeFile(resolve(outputDir,'results.json'),JSON.stringify({date:new Date().toISOString(),platform:process.platform,arch:process.arch,osRelease:os.release(),cpu:os.cpus()[0]?.model,cores:os.cpus().length,memoryGB:os.totalmem()/2**30,node:process.version,options,methodology:{startup:'new browser process and, for CLI, unique daemon/session per trial',diskCache:'uncontrolled; no cache purge',rebootCold:'not established by this benchmark',readiness:'direct: local page load and JS evaluation; CLI: local page load and interactive snapshot',advisoryEnabled:!options.fast},dependencies,installation:await installationMetadata(),rounds,summary,records},null,2));
  console.log(JSON.stringify(summary,null,2));
  if(records.some(r=>r.error || r.cleanup_error))process.exitCode=1;
}
