// `gen` arguments → JobSpec, with the default post chain per kind × background. Pure (no codex, no writes);
// unit-tested in genspec.test.ts.
import { resolveRefPath, storedRefPath } from './refs';
import type { Aspect, Background, JobKind, JobSpec, PostOp, RefSpec } from './types';

export const GEN_KINDS: readonly JobKind[] = ['vfx', 'terrain', 'rock', 'bark', 'foliage', 'rune', 'ui', 'portrait', 'illustration', 'icon'];
export const BACKGROUNDS: readonly Background[] = ['black', 'transparent', 'opaque'];
export const ASPECTS: readonly Aspect[] = ['square', 'landscape', 'portrait', 'wide'];
const ID_RE = /^[a-z0-9_]+$/;
const TILING_KINDS = new Set<JobKind>(['terrain', 'rock', 'bark']);

/** Raw option values as parsed from the command line. */
export interface GenArgs {
  id?: string;
  kind?: string;
  /** 'texture' references (Image 1..n in order) */
  ref?: string[];
  /** in-game screenshots of the original element (after the textures) */
  refContext?: string[];
  /** style references from our own game (last) */
  refStyle?: string[];
  goal?: string;
  /** optional extra prompt detail (plain text) */
  prompt?: string;
  bg?: string;
  size?: string | number;
  aspect?: string;
  variants?: string | number;
  keepColor?: boolean;
  trim?: boolean;
  group?: string;
  /** JSON array of PostOp replacing the default chain */
  post?: string;
}

export interface PostFlags {
  /** vfx: keep generated colours (no `neutral` op) */
  keepColor?: boolean;
  /** vfx: trim to the content and centre it before resizing */
  trim?: boolean;
}

export function defaultGroup(kind: JobKind): string {
  switch (kind) {
    case 'icon':
      return 'icons';
    case 'ui':
    case 'illustration':
      return 'ui';
    case 'portrait':
      return 'portraits';
    case 'rune':
      return 'metin';
    default:
      return kind;
  }
}

export function defaultSize(kind: JobKind): number {
  return kind === 'vfx' ? 512 : kind === 'icon' ? 128 : 1024;
}

export function defaultBackground(kind: JobKind): Background {
  return kind === 'vfx' ? 'black' : 'opaque';
}

/** Default post chain. vfx on black: neutral → blackpoint → [trim+centre] → Lanczos resize → 3 % edge fade → WebP q90
 *  (auto lossless); vfx transparent: keep alpha (key only if the raw came back opaque) → neutral → [trim] → resize →
 *  edge fade on alpha → colour bleed → WebP. Tiling kinds get the terrain chain (+ normal). */
export function defaultPost(kind: JobKind, bg: Background, size: number, aspect: Aspect = 'square', f: PostFlags = {}): PostOp[] {
  const square = aspect === 'square';
  const resize: PostOp = square ? { op: 'resize', w: size } : { op: 'resize', w: size, mode: 'fit' };
  if (kind === 'vfx') {
    const neutral: PostOp[] = f.keepColor ? [] : [{ op: 'neutral' }];
    const trim: PostOp[] = f.trim ? [{ op: 'trim', square, center: square, padFrac: 0.08, ...(bg === 'black' ? { thresh: 4 / 255 } : {}) }] : [];
    const webp: PostOp = { op: 'webp', quality: 90, lossless: 'auto' };
    if (bg === 'black') return [...neutral, { op: 'blackpoint' }, ...trim, resize, { op: 'edgefade', width: 0.03 }, webp];
    if (bg === 'transparent') {
      return [{ op: 'alpha', key: 'auto', onlyIfOpaque: true }, ...neutral, ...trim, resize, { op: 'edgefade', width: 0.03 }, { op: 'bleed', solid: 0.15 }, webp];
    }
    return [...neutral, resize, webp];
  }
  if (TILING_KINDS.has(kind)) {
    return [{ op: 'flatten', strength: 0.55 }, { op: 'tile' }, { op: 'resize', w: size }, { op: 'normal', strength: 2.2 }, { op: 'webp', quality: 84, normalQuality: 88 }];
  }
  if (bg === 'transparent') {
    return [{ op: 'alpha', key: 'auto', onlyIfOpaque: true }, { op: 'trim', pad: 6 }, { op: 'resize', w: size, mode: 'fit' }, { op: 'bleed' }, { op: 'webp', quality: 90 }];
  }
  return [resize, { op: 'webp', quality: kind === 'icon' ? 90 : 84 }];
}

function parsePost(text: string): PostOp[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`--post must be a JSON array of post ops: ${String(e)}`);
  }
  if (!Array.isArray(v) || !v.every((o) => o && typeof o === 'object' && typeof (o as { op?: unknown }).op === 'string')) {
    throw new Error('--post must be a JSON array of objects with an "op" field');
  }
  return v as PostOp[];
}

function intIn(name: string, v: string | number | undefined, dflt: number, lo: number, hi: number): number {
  const n = v === undefined ? dflt : Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`--${name} must be an integer in ${lo}..${hi} (got ${v})`);
  return n;
}

/** Validate gen arguments and build the job spec (refs stored repo-relative) + the variant count. */
export function genJobFromArgs(a: GenArgs, cwd = process.cwd()): { job: JobSpec; variants: number } {
  if (!a.id || !ID_RE.test(a.id)) throw new Error('--id <lowercase_snake_case id> is required');
  const kind = a.kind as JobKind;
  if (!GEN_KINDS.includes(kind)) throw new Error(`--kind must be one of ${GEN_KINDS.join('|')} (got ${a.kind})`);
  const goal = a.goal?.trim();
  if (!goal) throw new Error('--goal "<what the asset is for + what a good result looks like>" is required');
  const bg = (a.bg ?? defaultBackground(kind)) as Background;
  if (!BACKGROUNDS.includes(bg)) throw new Error(`--bg must be black|transparent|opaque (got ${a.bg})`);
  const aspect = (a.aspect ?? 'square') as Aspect;
  if (!ASPECTS.includes(aspect)) throw new Error(`--aspect must be ${ASPECTS.join('|')} (got ${a.aspect})`);
  const size = intIn('size', a.size, defaultSize(kind), 32, 2048);
  const variants = intIn('variants', a.variants, 3, 1, 8);
  const ref = (p: string): string => storedRefPath(resolveRefPath(p, cwd));
  const refs: (string | RefSpec)[] = [
    ...(a.ref ?? []).map(ref),
    ...(a.refContext ?? []).map((p) => ({ path: ref(p), role: 'context' })),
    ...(a.refStyle ?? []).map((p) => ({ path: ref(p), role: 'style' })),
  ];
  const job: JobSpec = {
    id: a.id,
    group: a.group ?? defaultGroup(kind),
    kind,
    goal,
    ...(a.prompt?.trim() ? { prompt: a.prompt.trim() } : {}),
    ...(refs.length ? { refs } : {}),
    background: bg,
    ...(a.keepColor ? { keepColor: true } : {}),
    aspect,
    size,
    ...(TILING_KINDS.has(kind) ? { tiling: true } : {}),
    post: a.post ? parsePost(a.post) : defaultPost(kind, bg, size, aspect, { keepColor: a.keepColor, trim: a.trim }),
  };
  return { job, variants };
}
