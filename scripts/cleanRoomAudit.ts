#!/usr/bin/env bun
/**
 * Clean-room release audit.
 * Scans a target directory (source assets or built dist) and fails if:
 *   1. Any file carries an extension outside the strict web-asset allowlist.
 *   2. Any GLB fails glTF 2.0 container validation or embeds host filesystem paths.
 *   3. Any shipped text file contains host filesystem paths or optional local deny-list matches.
 *
 * Usage: bun scripts/cleanRoomAudit.ts --scan <dir> [--patterns <file>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ALLOWED_EXTS = new Set([
  '.css',
  '.glb',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.cjs',
  '.mjs',
  '.json',
  '.mp3',
  '.ogg',
  '.png',
  '.svg',
  '.txt',
  '.wasm',
  '.wav',
  '.webmanifest',
  '.webp',
  '.woff2',
]);

const ALLOWED_EXTENSIONLESS = new Set(['_headers', '_redirects']);

const TEXT_EXTS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.svg', '.txt', '.webmanifest']);

// Reject leaked developer machine paths in shipped assets or GLB JSON chunks.
const HOST_PATH_RE = /(?:[A-Za-z]:\\(?:Users|Git)\\|\/(?:Users|home)\/[A-Za-z0-9._-]+\/|file:\/\/\/)/;

function parseArgs(): { dir: string; patternsFile?: string } {
  const idx = process.argv.indexOf('--scan');
  const dir = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!dir) {
    console.error('usage: bun scripts/cleanRoomAudit.ts --scan <dir> [--patterns <file>]');
    process.exit(2);
  }
  const pIdx = process.argv.indexOf('--patterns');
  const patternsFile = pIdx >= 0 ? process.argv[pIdx + 1] : undefined;
  return { dir, patternsFile };
}

function loadExtraPatterns(file?: string): RegExp[] {
  if (!file || !existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  return lines.map((p) => new RegExp(p, 'i'));
}

function glbJsonText(buf: Uint8Array): string | null {
  if (buf.byteLength < 20) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) return null;
  for (let off = 12; off + 8 <= buf.byteLength; ) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) return new TextDecoder().decode(buf.subarray(off + 8, off + 8 + len));
    off += 8 + len;
  }
  return null;
}

const { dir: targetDir, patternsFile } = parseArgs();
if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  console.error(`cleanRoomAudit: directory not found: ${targetDir}`);
  process.exit(2);
}

const extraPatterns = loadExtraPatterns(patternsFile);
let scanned = 0;
const violations: { file: string; reason: string }[] = [];

function checkText(rel: string, label: string, text: string): void {
  const hostMatch = HOST_PATH_RE.exec(text);
  if (hostMatch) {
    violations.push({ file: rel, reason: `host path leaked in ${label}: ${hostMatch[0]}` });
    return;
  }
  for (const re of extraPatterns) {
    const m = re.exec(text);
    if (m) {
      violations.push({ file: rel, reason: `restricted token in ${label}: ${m[0]}` });
      return;
    }
  }
}

function walk(dir: string): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(abs);
      continue;
    }
    scanned++;
    const rel = relative(targetDir, abs).replace(/\\/g, '/');
    const ext = extname(ent.name).toLowerCase();
    if (ext === '') {
      if (!ALLOWED_EXTENSIONLESS.has(ent.name)) {
        violations.push({ file: rel, reason: `disallowed extensionless file ${ent.name}` });
      }
      continue;
    }
    if (!ALLOWED_EXTS.has(ext)) {
      violations.push({ file: rel, reason: `disallowed extension ${ext}` });
      continue;
    }
    if (ext === '.glb') {
      const jsonText = glbJsonText(new Uint8Array(readFileSync(abs)));
      if (!jsonText) {
        violations.push({ file: rel, reason: 'invalid glTF 2.0 binary container' });
        continue;
      }
      checkText(rel, 'GLB JSON', jsonText);
      continue;
    }
    if (TEXT_EXTS.has(ext)) {
      checkText(rel, 'text asset', readFileSync(abs, 'utf8'));
    }
  }
}

walk(targetDir);
console.log(`cleanRoomAudit: scanned ${scanned} files in ${targetDir}`);
if (violations.length > 0) {
  for (const v of violations.slice(0, 30)) console.error(`  FAIL ${v.file}: ${v.reason}`);
  if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
  process.exit(1);
}
console.log('cleanRoomAudit: CLEAN');
