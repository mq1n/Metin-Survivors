#!/usr/bin/env bun
// Re-encodes the WebP textures embedded in shipped prop GLBs to their texture budget (payload policy, ARCHITECTURE §11,
// tools/forge/src/archetypes/prop/texCap.ts):
//   - a normal prop: longest edge <= PROP_TEX_MAX (1024 px), resampled with the bake's WebP settings;
//   - a landmark (LANDMARKS in texCap.ts): the atlas keeps up to its own `edge` (<= LANDMARK_TEX_MAX, 2048 px) and the WebP
//     quality is lowered only as far as needed to keep the whole GLB under the landmark's byte `bytes` ceiling.
//
//   bun tools/forge/scripts/propTex.ts [id|prefix*|a,b ...] [--src=<dir>] [--max=N] [--fit=<edge> [--limit=<bytes>]] [--dry] [--out=<dir>] [--no-manifest]
//
// Only the image bytes change: the GLB is patched at the container level (JSON + BIN chunk), so the meshopt-compressed
// geometry, the quantised attributes and the scene extras stay bit-identical (no decode / re-encode of the mesh); every
// output is checked for that (`sameGeometry`: each non-image byte range and the JSON minus the image offsets are equal to
// the source and to the file it replaces). A map is never up-sampled, and an image already within its budget is left alone.
// Default ids: every `prop_*` model of the manifest part. Idempotent: a second run changes nothing.
//   --src=<dir>  read the SOURCE of each id from <dir> (`<id>.glb` or `<id>.<hash>.glb`) instead of the shipped file: the way
//                to give a prop back resolution it lost (the pre-cap build, e.g. `git show HEAD:<path>` into a scratch folder).
//                The result is shipped when it differs from the shipped file.
//   --max=N      plain resample of every selected id to N px (no landmark fit)
//   --fit=<edge> payload-neutral fit for any id: longest edge <edge> px at the highest WebP quality (floor 70) for which the
//                new file is not larger than the shipped one; --limit=<bytes> replaces that ceiling. (A landmark does this
//                with its table entry, so a plain run is enough.)
// Shipping = what forge `--ship` does: `<id>.<sha256[0:8]>.glb` next to the old build, the entry of
// manifest/models.json updated (url + bytes, under the 'manifest-parts' mutex the other producers use), then
// `bun tools/pipeline/manifest.ts` merges the parts into manifest.json, then the stale build of the id is deleted.
// --dry prints the plan only; --out=<dir> writes the patched GLBs there (review copies) and ships nothing.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import validator from 'gltf-validator';
import type { ModelAsset } from '../../../apps/game/src/data/assetManifest.ts';
import { MANIFEST_LOCK, withLockSync, type LockOptions } from '../../pipeline/lock.ts';
import { mergeManifestUnlocked, readManifestUrls, writeFileAtomic } from '../../pipeline/manifest.ts';
import { LANDMARKS, PROP_ALBEDO_QUALITY, PROP_EMISSIVE_QUALITY, propTexMax } from '../src/archetypes/prop/texCap.ts';
import { manifestPartPath, repoRoot } from '../src/core/export/manifest.ts';

const align4 = (n: number): number => (n + 3) & ~3;

/** lowest WebP quality `--fit` steps down to before it gives up */
const FIT_QUALITY_FLOOR = 70;

/** [width, height] of a WebP file (lossy VP8, lossless VP8L or extended VP8X) */
export function webpSize(b: Uint8Array): [number, number] {
  const tag = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
  if (tag !== 'WEBP') throw new Error('not a WebP');
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (fourcc === 'VP8 ') return [(b[26]! | (b[27]! << 8)) & 0x3fff, (b[28]! | (b[29]! << 8)) & 0x3fff];
  if (fourcc === 'VP8L') {
    const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1];
  }
  if (fourcc === 'VP8X') return [1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))];
  throw new Error(`unknown WebP chunk ${fourcc}`);
}

export interface Glb {
  json: Record<string, any>;
  bin: Uint8Array;
}

export function parseGlb(buf: Uint8Array): Glb {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('not a GLB 2.0');
  let json: Record<string, any> | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  for (let off = 12; off < buf.byteLength; ) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB without a JSON chunk');
  return { json, bin };
}

function writeGlb(json: Record<string, any>, bin: Uint8Array): Uint8Array {
  const j = new TextEncoder().encode(JSON.stringify(json));
  const jLen = align4(j.length);
  const bLen = align4(bin.length);
  const out = new Uint8Array(12 + 8 + jLen + 8 + bLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jLen);
  out.set(j, 20);
  const bOff = 20 + jLen;
  dv.setUint32(bOff, bLen, true);
  dv.setUint32(bOff + 4, 0x004e4942, true);
  out.set(bin, bOff + 8);
  return out;
}

/** ffmpeg / libwebp encode of `webp` scaled (Lanczos) to nw x nh at a fixed quality (the encoder and settings the forge bake uses) */
export function encodeWebpAt(webp: Uint8Array, nw: number, nh: number, quality: number): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'forge-proptex-'));
  try {
    const src = join(dir, 'in.webp');
    const dst = join(dir, 'out.webp');
    writeFileSync(src, webp);
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${nw}:${nh}:flags=lanczos+accurate_rnd`, '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', '-pix_fmt', 'yuv420p', dst],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
    return new Uint8Array(readFileSync(dst));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Resamples a WebP so its longest edge is `max` px. A map that only just exceeds the cap can come out bigger than it went
 * in (Lanczos sharpening is noise to the encoder): the quality then steps down (floor 82) until the result is no larger
 * than the original.
 */
function shrinkWebp(webp: Uint8Array, w: number, h: number, max: number, quality: number): { webp: Uint8Array; w: number; h: number } {
  const k = max / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * k));
  const nh = Math.max(1, Math.round(h * k));
  let out: Uint8Array = new Uint8Array(0);
  for (let q = quality; ; q -= 3) {
    out = encodeWebpAt(webp, nw, nh, q);
    if (out.length <= webp.length || q - 3 < 82) break;
  }
  return { webp: out, w: nw, h: nh };
}

export interface ImageReport {
  name: string;
  before: { w: number; h: number; bytes: number };
  after?: { w: number; h: number; bytes: number };
}

export interface ReencodeOpts {
  /** longest-edge cap (px) */
  max: number;
  /** per-image replacement: gets the source WebP, its size and the image name; returns the new bytes or null to keep the image. Default: shrink to `max` */
  encode?: (webp: Uint8Array, w: number, h: number, name: string) => { webp: Uint8Array; w: number; h: number } | null;
}

/** swaps the image bytes of `glb` (buffer 0 = the BIN chunk) and re-lays the BIN chunk; every other byte range is copied as is */
export function reencode(glb: Uint8Array, o: ReencodeOpts): { glb: Uint8Array; images: ImageReport[]; changed: boolean } {
  const { json, bin } = parseGlb(glb);
  const views: any[] = json.bufferViews ?? [];
  const buffers: any[] = json.buffers ?? [];
  if (buffers.some((b, i) => i > 0 && b.uri)) throw new Error('external buffers are not supported');
  // one slot per byte range in buffer 0: a plain bufferView, or the compressed payload of an EXT_meshopt_compression one
  interface Slot { view: number; ext: boolean; off: number; len: number; oldLen: number; data?: Uint8Array }
  const slots: Slot[] = [];
  views.forEach((v, i) => {
    const e = v.extensions?.EXT_meshopt_compression;
    if (e) {
      if ((e.buffer ?? 0) === 0) slots.push({ view: i, ext: true, off: e.byteOffset ?? 0, len: e.byteLength, oldLen: e.byteLength });
    } else if ((v.buffer ?? 0) === 0) slots.push({ view: i, ext: false, off: v.byteOffset ?? 0, len: v.byteLength, oldLen: v.byteLength });
  });
  const images: ImageReport[] = [];
  let changed = false;
  for (const img of (json.images ?? []) as any[]) {
    if (img.bufferView === undefined) throw new Error('image without a bufferView');
    const slot = slots.find((s) => s.view === img.bufferView && !s.ext);
    if (!slot) throw new Error('image bufferView outside buffer 0');
    const webp = bin.subarray(slot.off, slot.off + slot.len);
    if (img.mimeType !== 'image/webp') throw new Error(`image/${img.mimeType} is not supported (WebP only)`);
    const [w, h] = webpSize(webp);
    const name = String(img.name ?? '');
    const rep: ImageReport = { name, before: { w, h, bytes: webp.length } };
    images.push(rep);
    const small = o.encode ? o.encode(webp, w, h, name) : Math.max(w, h) <= o.max ? null : shrinkWebp(webp, w, h, o.max, name.includes('emissive') ? PROP_EMISSIVE_QUALITY : PROP_ALBEDO_QUALITY);
    if (!small) continue;
    rep.after = { w: small.w, h: small.h, bytes: small.webp.length };
    slot.data = small.webp;
    slot.len = small.webp.length;
    changed = true;
  }
  if (!changed) return { glb, images, changed };
  slots.sort((a, b) => a.off - b.off);
  let size = 0;
  for (const s of slots) size += align4(s.len);
  const out = new Uint8Array(size);
  let cur = 0;
  for (let i = 1; i < slots.length; i++) if (slots[i - 1]!.off + slots[i - 1]!.oldLen > slots[i]!.off) throw new Error('overlapping byte ranges in buffer 0');
  for (const s of slots) {
    const bytes = s.data ?? bin.subarray(s.off, s.off + s.len);
    out.set(bytes, cur);
    const v = views[s.view];
    if (s.ext) v.extensions.EXT_meshopt_compression.byteOffset = cur;
    else {
      v.byteOffset = cur;
      v.byteLength = s.len;
    }
    cur += align4(s.len);
  }
  buffers[0].byteLength = out.length;
  return { glb: writeGlb(json, out), images, changed };
}

/**
 * True when `b` differs from `a` only in its images: every non-image byte range of buffer 0 (meshopt payloads, plain views)
 * is byte-equal, and the JSON is equal once the offsets / lengths of the image views, the offsets of the views that moved
 * with them and `buffers[0].byteLength` are masked. This is the "geometry bit-identical" check of a texture-only re-ship.
 */
export function sameGeometry(a: Uint8Array, b: Uint8Array): string | null {
  const A = parseGlb(a);
  const B = parseGlb(b);
  const viewsA: any[] = A.json.bufferViews ?? [];
  const viewsB: any[] = B.json.bufferViews ?? [];
  if (viewsA.length !== viewsB.length) return `bufferViews ${viewsA.length} vs ${viewsB.length}`;
  const imageViews = new Set<number>((A.json.images ?? []).map((i: any) => i.bufferView));
  const range = (v: any): [number, number] => {
    const e = v.extensions?.EXT_meshopt_compression;
    return e ? [e.byteOffset ?? 0, e.byteLength] : [v.byteOffset ?? 0, v.byteLength];
  };
  for (let i = 0; i < viewsA.length; i++) {
    if (imageViews.has(i)) continue;
    const [oa, la] = range(viewsA[i]);
    const [ob, lb] = range(viewsB[i]);
    if (la !== lb) return `bufferView ${i} length ${la} vs ${lb}`;
    const x = A.bin.subarray(oa, oa + la);
    const y = B.bin.subarray(ob, ob + lb);
    for (let k = 0; k < la; k++) if (x[k] !== y[k]) return `bufferView ${i} differs at byte ${k}`;
  }
  const mask = (j: Record<string, any>): string => {
    const c = JSON.parse(JSON.stringify(j)) as Record<string, any>;
    const iv = new Set<number>((c.images ?? []).map((i: any) => i.bufferView));
    (c.bufferViews ?? []).forEach((v: any, i: number) => {
      delete v.byteOffset;
      if (v.extensions?.EXT_meshopt_compression) delete v.extensions.EXT_meshopt_compression.byteOffset;
      if (iv.has(i)) delete v.byteLength;
    });
    if (c.buffers?.[0]) delete c.buffers[0].byteLength;
    return JSON.stringify(c);
  };
  if (mask(A.json) !== mask(B.json)) return 'JSON differs outside the image byte ranges';
  return null;
}

/** the source file of `id` inside `dir`: `<id>.glb` or `<id>.<hash>.glb` */
function findInDir(dir: string, id: string): string {
  const hit = readdirSync(dir).filter((f) => f === `${id}.glb` || new RegExp(`^${id}\\.[0-9a-f]{6,}\\.glb$`).test(f));
  if (hit.length !== 1) throw new Error(`${id}: ${hit.length} matches in ${dir}`);
  return join(dir, hit[0]!);
}







export function fitGlb(src: Uint8Array, limit: number, edge: number): (ReturnType<typeof reencode> & { quality: number }) | null {
  const at = (q: number): ReturnType<typeof reencode> =>
    reencode(src, {
      max: edge,
      encode: (webp, w, h, name) => {
        const k = Math.min(1, edge / Math.max(w, h));
        if (k === 1 && q >= PROP_ALBEDO_QUALITY) return null; // the source image as it is
        const nw = Math.max(1, Math.round(w * k));
        const nh = Math.max(1, Math.round(h * k));
        return { webp: encodeWebpAt(webp, nw, nh, name.includes('emissive') ? Math.max(FIT_QUALITY_FLOOR, q - 2) : q), w: nw, h: nh };
      },
    });
  const top = at(PROP_ALBEDO_QUALITY);
  if (top.glb.length <= limit) return { ...top, quality: PROP_ALBEDO_QUALITY };
  let lo = FIT_QUALITY_FLOOR;
  let hi = PROP_ALBEDO_QUALITY - 1;
  const floor = at(lo);
  if (floor.glb.length > limit) return null;
  let best: ReturnType<typeof reencode> & { quality: number } = { ...floor, quality: lo };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const r = at(mid);
    if (r.glb.length <= limit) {
      best = { ...r, quality: mid };
      lo = mid;
    } else hi = mid - 1;
  }
  return best;
}

export interface PropShipUpdate {
  id: string;
  oldFile: string;
  glb: Uint8Array;
}

export interface PublishPropUpdatesOpts {
  publicDir: string;
  noManifest?: boolean;
  lock?: LockOptions;
}

export interface PublishPropUpdatesResult {
  written: Array<{ id: string; oldFile: string; newFile: string; url: string }>;
  pruned: string[];
  retained: string[];
  manifestLine?: string;
}

/**
 * Atomically publish updated prop GLBs under the shared `MANIFEST_LOCK`:
 * 1. write all new content-hashed GLBs,
 * 2. update `manifest/models.json`,
 * 3. unless `noManifest` is set, rebuild aggregate `manifest.json` inside the same lock,
 * 4. delete replaced old GLBs ONLY when they are no longer referenced by the live `manifest.json`.
 */
export function publishPropUpdates(
  shipped: PropShipUpdate[],
  opts: PublishPropUpdatesOpts,
): PublishPropUpdatesResult {
  const part = join(opts.publicDir, 'assets', 'manifest', 'models.json');
  return withLockSync(
    MANIFEST_LOCK,
    () => {
      const written: PublishPropUpdatesResult['written'] = [];
      const cur = JSON.parse(readFileSync(part, 'utf8')) as Record<string, ModelAsset>;
      for (const s of shipped) {
        const e = cur[s.id];
        if (!e) throw new Error(`${s.id} vanished from ${part}`);
        const hash = createHash('sha256').update(s.glb).digest('hex').slice(0, 8);
        const fileName = `${s.id}.${hash}.glb`;
        const newFile = join(dirname(s.oldFile), fileName);
        mkdirSync(dirname(newFile), { recursive: true });
        writeFileSync(newFile, s.glb);
        const url = `assets/models/${e.kind}/${fileName}`;
        cur[s.id] = { ...e, url, bytes: s.glb.length };
        written.push({ id: s.id, oldFile: s.oldFile, newFile, url });
      }
      const sorted = Object.fromEntries(Object.entries(cur).sort(([a], [b]) => (a < b ? -1 : 1)));
      writeFileAtomic(part, `${JSON.stringify(sorted, null, 2)}\n`);

      let manifestLine: string | undefined;
      if (!opts.noManifest) {
        manifestLine = mergeManifestUnlocked({ publicDir: opts.publicDir }).line;
      }

      const liveUrls = readManifestUrls(opts.publicDir);
      const pruned: string[] = [];
      const retained: string[] = [];
      for (const w of written) {
        if (w.oldFile === w.newFile || !existsSync(w.oldFile)) continue;
        const oldRel = relative(opts.publicDir, w.oldFile).replaceAll('\\', '/');
        if (liveUrls.has(oldRel)) {
          retained.push(w.oldFile);
        } else {
          rmSync(w.oldFile, { force: true });
          pruned.push(w.oldFile);
        }
      }
      return { written, pruned, retained, manifestLine };
    },
    { label: 'forge:propTex', ...opts.lock },
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const MAXFLAG = flag('max');
  const SRC = flag('src');
  const DRY = has('dry');
  const FIT = flag('fit');
  const LIMIT = flag('limit');
  const OUT = flag('out');
  const selectors = argv.filter((a) => !a.startsWith('--')).flatMap((a) => a.split(',')).filter(Boolean);

  const part = manifestPartPath();
  const models = JSON.parse(readFileSync(part, 'utf8')) as Record<string, ModelAsset>;
  const wanted = (id: string): boolean =>
    selectors.length === 0
      ? id.startsWith('prop_')
      : selectors.some((s) => (s.endsWith('*') ? id.startsWith(s.slice(0, -1)) : id === s || id === `prop_${s}`));
  const ids = Object.keys(models).filter((id) => models[id]!.kind === 'prop' && wanted(id));
  if (ids.length === 0) {
    console.error('no prop model matches');
    process.exit(2);
  }

  const root = join(repoRoot(), 'apps', 'game', 'public');
  let totalBefore = 0;
  let totalAfter = 0;
  let nChanged = 0;
  const shipped: Array<{ id: string; oldFile: string; newFile: string; glb: Uint8Array }> = [];
  for (const id of ids) {
    const asset = models[id]!;
    const oldFile = join(root, asset.url);
    const current = new Uint8Array(readFileSync(oldFile));
    const src = SRC ? new Uint8Array(readFileSync(findInDir(SRC, id))) : current;
    const max = MAXFLAG !== undefined ? Number(MAXFLAG) : propTexMax(id);
    // --fit=<edge> [--limit]: explicit payload-neutral fit; else a landmark is fitted to its table entry (edge, byte ceiling);
    // else (and with --max) a plain resample to the cap
    const lm = MAXFLAG === undefined ? LANDMARKS[id] : undefined;
    const fitEdge = FIT !== undefined ? Number(FIT) : lm?.edge;
    const limit = LIMIT !== undefined ? Number(LIMIT) : FIT !== undefined ? current.length : lm?.bytes;
    let fitQ = '';
    let r: ReturnType<typeof reencode>;
    if (fitEdge !== undefined && limit !== undefined) {
      const f = fitGlb(src, limit, Math.min(fitEdge, max));
      if (!f) {
        console.error(`${id}: no encoding at ${Math.min(fitEdge, max)} px fits ${limit} bytes above q${FIT_QUALITY_FLOOR}; kept the shipped file (lower the edge or raise the ceiling in texCap.ts)`);
        continue;
      }
      r = f;
      fitQ = ` q${f.quality}`;
    } else r = reencode(src, { max });
    const dims = r.images.map((i) => `${i.before.w}x${i.before.h}${i.after ? `->${i.after.w}x${i.after.h}` : ''}`).join(' ');
    totalBefore += current.length;
    // what would be shipped: the re-encoded file, or (with --src) the unchanged source when it differs from the shipped file
    const out = r.glb;
    const differs = out.length !== current.length || Buffer.compare(Buffer.from(out), Buffer.from(current)) !== 0;
    totalAfter += differs ? out.length : current.length;
    if (!differs) {
      console.log(`${id.padEnd(22)} ${String(current.length).padStart(8)}  unchanged  (cap ${max})  ${dims}`);
      continue;
    }
    nChanged++;
    // against the source, and (with --src) against the file being replaced: a --src folder from before the model was rebaked
    // would otherwise swap a different mesh in under a texture-only re-ship
    const bad = sameGeometry(src, out) ?? sameGeometry(current, out);
    if (bad) {
      console.error(`${id}: geometry is not bit-identical to the shipped file / the source: ${bad}`);
      process.exit(1);
    }
    const rep = await validator.validateBytes(out, { uri: `${id}.glb`, ignoredIssues: ['UNUSED_OBJECT'], maxIssues: 20 });
    if (rep.issues.numErrors > 0) {
      console.error(`${id}: re-encoded GLB has ${rep.issues.numErrors} validator error(s)`);
      for (const m of rep.issues.messages.slice(0, 6)) console.error(`   ${m.severity} ${m.code} ${m.pointer ?? ''} ${m.message}`);
      process.exit(1);
    }
    const delta = out.length - current.length;
    console.log(`${id.padEnd(22)} ${String(current.length).padStart(8)} -> ${String(out.length).padStart(8)}  (${delta >= 0 ? '+' : ''}${delta} B, ${fitEdge !== undefined && limit !== undefined ? `fit ${Math.min(fitEdge, max)} px${fitQ}` : `cap ${max}`}, validator 0 errors, geometry identical)  ${dims}`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${id}.glb`), out);
    } else if (!DRY) shipped.push({ id, oldFile, newFile: '', glb: out });
  }
  console.log(`${ids.length} props, ${nChanged} changed: ${totalBefore} -> ${totalAfter} bytes (${((totalAfter - totalBefore) / 1e6).toFixed(2)} MB)`);

  if (shipped.length > 0) {
    const res = publishPropUpdates(
      shipped.map(({ id, oldFile, glb }) => ({ id, oldFile, glb })),
      { publicDir: root, noManifest: has('no-manifest') },
    );
    if (res.manifestLine) console.log(res.manifestLine);
    const left = readdirSync(dirname(shipped[0]!.oldFile)).filter((f) => f.endsWith('.glb')).length;
    console.log(
      `shipped ${shipped.length} GLBs (${left} prop files in the folder${res.retained.length ? `, ${res.retained.length} prior file(s) retained for live manifest.json` : ''})`,
    );
  }
}

if (import.meta.main) await main();
