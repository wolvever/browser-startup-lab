#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {root, browserPath, cliPath, tunedArgs} from './runtime.mjs';

const input = process.argv.slice(2);
const fast = input[0] === '--fast';
if(fast)input.shift();
const [engine = 'shell', ...args] = input;
if (!['shell','chrome','lightpanda'].includes(engine) || !args.length) {
  console.error('Usage: node agent.mjs [--fast] <shell|chrome|lightpanda> <agent-browser arguments>');
  process.exit(1);
}
const executable = await browserPath(engine);
const flags = ['--config',resolve(root,'empty-config.json'),'--namespace','startup-lab-use','--session',`lab-${engine}`,'--engine',engine==='lightpanda'?'lightpanda':'chrome','--executable-path',executable];
if(engine==='chrome')flags.push('--args',tunedArgs);
const child=spawn(cliPath(),[...flags,...args],{stdio:'inherit',env:{...process.env,...(fast?{AGENT_BROWSER_NO_VERSION_CHECK:'1'}:{})}});
child.on('error', error => {console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exitCode=code;});
