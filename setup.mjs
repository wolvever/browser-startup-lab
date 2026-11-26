import {install} from '@puppeteer/browsers';
import {mkdir, writeFile, chmod, readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {root, cacheDir, chromeVersion, pandaPath} from './runtime.mjs';

const args = process.argv.slice(2);
if (args.some(a => !['--lightpanda', '--lightpanda-only', '--with-deps'].includes(a))) throw Error('Usage: node setup.mjs [--lightpanda|--lightpanda-only] [--with-deps]');
await mkdir(resolve(root, 'bin'), {recursive: true});
const metadata = {date: new Date().toISOString(), platform: process.platform, arch: process.arch, chromeVersion};
if (!args.includes('--lightpanda-only')) {
  for (const browser of ['chrome', 'chrome-headless-shell']) {
    console.log(`Installing ${browser}@${chromeVersion} for this host`);
    await install({browser, buildId: chromeVersion, cacheDir, installDeps:args.includes('--with-deps')});
  }
}
if (args.includes('--lightpanda') || args.includes('--lightpanda-only')) {
  if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) {
    throw Error('Lightpanda requires macOS or glibc Linux, x64/arm64. On Windows, run the whole lab inside WSL2.');
  }
  const asset = `lightpanda-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'darwin' ? 'macos' : 'linux'}`;
  const url = `https://github.com/lightpanda-io/browser/releases/download/nightly/${asset}`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw Error(`Download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(pandaPath));
  await chmod(pandaPath, 0o755);
  metadata.lightpanda = {url, version: execFileSync(pandaPath, ['version'], {encoding:'utf8'}).trim(), sha256: createHash('sha256').update(await readFile(pandaPath)).digest('hex')};
}
await writeFile(resolve(root, 'installation.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log('Setup complete. No browser was launched; first-use startup can now be measured.');
