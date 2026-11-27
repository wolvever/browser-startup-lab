import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access, constants} from 'node:fs/promises';

const exec = promisify(execFile);
export const image = 'ghcr.io/cloudflare/kitesurf:latest';
const healthUrl = 'http://127.0.0.1:8787/health';
export const wsEndpoint = 'ws://127.0.0.1:8787/devtools/browser';

async function dockerArgs() {
  try {
    await access('/var/run/docker.sock', constants.W_OK);
    return ['docker'];
  } catch {
    return ['sudo', 'docker'];
  }
}

async function docker(args) {
  const [bin, ...prefix] = await dockerArgs();
  return exec(bin, [...prefix, ...args], {timeout: 120000, maxBuffer: 2 * 1024 * 1024});
}

async function healthy() {
  try {
    const response = await fetch(healthUrl);
    return response.ok;
  } catch {
    return false;
  }
}

export async function imageIdentity() {
  try {
    const inspected = await docker(['image', 'inspect', '--format', '{{.Id}} {{index .RepoDigests 0}}', image]);
    return inspected.stdout.trim();
  } catch (error) {
    return error.stderr?.trim() || error.message;
  }
}

// A cold engine is a new container. The local image runs page JavaScript in
// workerd, which is not a hardened sandbox, so callers must open only the
// lab's own fixture.
export async function startKitesurf(name) {
  await docker(['rm', '-f', name]).catch(() => {});
  const started = performance.now();
  await docker(['run', '-d', '--name', name, '--network', 'host', '-e', 'KITESURF_ALLOW_PRIVATE_NETWORK=1', image]);
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    if (await healthy()) {
      return {
        ws: wsEndpoint,
        start_ms: performance.now() - started,
        stop: () => docker(['rm', '-f', name]).catch(() => {}),
      };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const logs = await docker(['logs', '--tail', '40', name]).catch(error => ({stdout: '', stderr: error.message}));
  await docker(['rm', '-f', name]).catch(() => {});
  throw Error(`Kitesurf did not answer ${healthUrl}. ${logs.stdout} ${logs.stderr}`.slice(0, 800));
}
