import {getInstalledBrowsers, detectBrowserPlatform} from '@puppeteer/browsers';
import {findNativeBinary, nativeTarget} from './node_modules/agent-browser/scripts/native.js';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';

export const root = import.meta.dirname;
export const cacheDir = resolve(root, 'browsers');
export const chromeVersion = '158.0.8127.88';
export const pandaPath = resolve(root, 'bin', process.platform === 'win32' ? 'lightpanda.exe' : 'lightpanda');
export const tunedArgs = '--disable-extensions\n--disable-component-extensions-with-background-pages\nabout:blank';

export function cliPath() {
  const target = nativeTarget();
  const binary = target && findNativeBinary(resolve(root, 'node_modules/agent-browser'), target);
  if (!binary) throw Error(`agent-browser binary unavailable for ${process.platform}/${process.arch}; run npm ci with optional dependencies enabled`);
  return binary;
}

export async function browserPath(engine) {
  if (engine === 'lightpanda') return pandaPath;
  const browser = engine === 'shell' ? 'chrome-headless-shell' : 'chrome';
  const installed = await getInstalledBrowsers({cacheDir});
  const match = installed.find(b => b.browser === browser && b.buildId === chromeVersion && b.platform === detectBrowserPlatform());
  if (!match) throw Error(`${browser} ${chromeVersion} missing for this host; run npm run setup`);
  return match.executablePath;
}

export async function installationMetadata() {
  try { return JSON.parse(await readFile(resolve(root, 'installation.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
