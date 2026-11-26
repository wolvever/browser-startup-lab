import {findNativeBinary, nativeTarget} from './node_modules/agent-browser/scripts/native.js';
import {access, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import os from 'node:os';

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

// Resolving the pinned Chrome path locally avoids importing @puppeteer/browsers
// on every agent command. That import was about 30 ms, paid again on each of
// the five agent-loop commands.
function hostPlatform() {
  const {platform, arch} = process;
  if (platform === 'darwin') return arch === 'arm64' ? 'mac_arm' : 'mac';
  if (platform === 'linux') return arch === 'arm64' ? 'linux_arm' : 'linux';
  if (platform === 'win32') {
    const [major = 0, minor = 0, patch = 0] = os.release().split('.').map(Number);
    const windows11 = major > 10 || (major === 10 && (minor > 0 || patch >= 22000));
    return arch === 'x64' || (arch === 'arm64' && windows11) ? 'win64' : 'win32';
  }
  throw Error(`unsupported platform ${platform}/${arch}`);
}
function archiveFolder(platform) {
  return {linux_arm: 'linux-arm64', linux: 'linux64', mac_arm: 'mac-arm64', mac: 'mac-x64', win32: 'win32', win64: 'win64'}[platform];
}
export async function browserPath(engine) {
  if (engine === 'lightpanda') return pandaPath;
  const platform = hostPlatform();
  const folder = archiveFolder(platform);
  const shell = engine === 'shell';
  const browser = shell ? 'chrome-headless-shell' : 'chrome';
  const exe = process.platform === 'win32' ? (shell ? 'chrome-headless-shell.exe' : 'chrome.exe') : (shell ? 'chrome-headless-shell' : 'chrome');
  const relative = !shell && process.platform === 'darwin'
    ? `chrome-${folder}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    : `${shell ? 'chrome-headless-shell' : 'chrome'}-${folder}/${exe}`;
  const executable = resolve(cacheDir, browser, `${platform}-${chromeVersion}`, relative);
  try { await access(executable); }
  catch { throw Error(`${browser} ${chromeVersion} missing for this host; run npm run setup`); }
  return executable;
}

export async function installationMetadata() {
  try { return JSON.parse(await readFile(resolve(root, 'installation.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
