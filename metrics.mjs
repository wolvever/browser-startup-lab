import {readFileSync, readdirSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

export function round1(value) { return Math.round(value * 10) / 10; }

export function summarize(samples) {
  if (!samples.length) return {n: 0};
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
  return {
    n: samples.length,
    min: round1(sorted[0]),
    median: round1(mid),
    p95: round1(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max: round1(sorted.at(-1)),
    under_1500: samples.filter(x => x < 1500).length,
  };
}

export function listPids() {
  return new Set(readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(Number));
}

function procStat(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
    let pss = null;
    try {
      const roll = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const match = roll.match(/^Pss:\s+(\d+)/m);
      if (match) pss = Number(match[1]);
    } catch { /* sandboxed children can hide smaps */ }
    const name = status.match(/^Name:\s+(\S+)/m)?.[1] ?? '';
    return {pid, rss, pss, name};
  } catch {
    return null;
  }
}

export function memoryOfNewPids(before) {
  const born = [...listPids()].filter(pid => !before.has(pid));
  let rss = 0; let pss = 0; let pssKnown = 0; const names = {};
  const live = [];
  for (const pid of born) {
    const stat = procStat(pid);
    if (!stat || stat.rss === 0) continue;
    live.push(pid);
    rss += stat.rss;
    names[stat.name] = (names[stat.name] ?? 0) + 1;
    if (stat.pss !== null) { pss += stat.pss; pssKnown++; }
  }
  return {
    processes: live.length,
    rss_kb: rss,
    pss_kb: pssKnown ? pss : null,
    pss_coverage: live.length ? pssKnown / live.length : 0,
    names,
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// The fixture paints a #123 page, a red canvas border, and a black canvas fill.
export function analyzePng(file) {
  const data = readFileSync(file);
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return {error: 'not a png', bytes: data.length};
  let pos = 8; let width = 0; let height = 0; let bitDepth = 0; let color = 0; let interlace = 0;
  const idat = [];
  while (pos + 8 <= data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.subarray(pos + 4, pos + 8).toString('ascii');
    const chunk = data.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]; color = chunk[9]; interlace = chunk[12];
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
  }
  const bytes = data.length;
  if (bitDepth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) {
    return {bytes, width, height, error: `unsupported png bit=${bitDepth} color=${color} interlace=${interlace}`};
  }
  let raw;
  try { raw = inflateSync(Buffer.concat(idat)); }
  catch (error) { return {bytes, width, height, error: String(error)}; }
  const bpp = color === 6 ? 4 : 3;
  const stride = width * bpp;
  let navy = 0; let red = 0; let black = 0; let white = 0; let sumR = 0; let sumG = 0; let sumB = 0;
  let prev = Buffer.alloc(stride);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const row = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const ul = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + ((left + up) >> 1)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, ul)) & 255;
      else if (filter !== 0) return {bytes, width, height, error: `bad filter ${filter}`};
    }
    prev = row;
    for (let x = 0; x < width; x++) {
      const i = x * bpp;
      const r = row[i]; const g = row[i + 1]; const b = row[i + 2];
      sumR += r; sumG += g; sumB += b;
      if (r >= 8 && r <= 40 && g >= 20 && g <= 60 && b >= 35 && b <= 80 && b > g && g > r) navy++;
      if (r > 200 && g < 70 && b < 70) red++;
      if (r < 16 && g < 16 && b < 16) black++;
      if (r > 245 && g > 245 && b > 245) white++;
    }
  }
  const pixels = width * height;
  const pass = navy > pixels * 0.2 && red > 30 && black > 200;
  return {
    bytes, width, height, pixels,
    mean_rgb: [Math.round(sumR / pixels), Math.round(sumG / pixels), Math.round(sumB / pixels)],
    navy, red, black, white, pass,
  };
}

export function refsFromSnapshot(text) {
  const input = text.match(/textbox[^\n]*\[ref=(e\d+)\]/)?.[1];
  const button = text.match(/button "Submit"[^\n]*\[ref=(e\d+)\]/)?.[1];
  return {input, button};
}
