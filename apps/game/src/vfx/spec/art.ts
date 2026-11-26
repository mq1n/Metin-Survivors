// Spec ART atlas: generated VFX sprites (asset manifest kind 'vfx', public/assets/textures/vfx/*.webp) packed at load
// into ONE mipmapped sRGB texture array, `uSpecArt` (the spec shaders' only extra binding; no extra draw call). Each
// layer is a G × G grid of cells (G = 1, 2, 4 or 8, the smallest that fits everything); a cell is 128 px on the low
// tier and 256 px above (the sources are drawn with their own mipmaps, premultiplied in linear space). Flipbook sheets
// are unpacked frame by frame into consecutive cells, like the procedural roles, so the shaders' frame logic is shared;
// a flipbook given as a LIST of separate sprites (`art: ['a', 'b', …]`, spec/artScope.ts art keys) is blitted the same
// way, frame f from sprite f. A run packs only the art of the specs it can spawn and, when that would exceed the tier's
// VRAM budget (ART_RUN_BUDGET_MB), shrinks the cell size in 16 px steps. Missing ids keep the element's procedural
// fallback role and warn once. Only the GPU array is scoped: decoded sprite images stay in the Assets texture cache.
//
// CAPACITY: the packed role has 3 bits for the layer and 3 + 3 for the cell, so an array is at most ART_MAX_LAYERS layers of
// ART_MAX_GRID × ART_MAX_GRID cells (ART_MAX_CELLS = 512) and every run's scope has to fit it. The manifest is NOT the measure:
// it holds every sprite ever shipped (~465, several hundred of them drawn by no registered spec yet), a run packs ~160-250
// cells; the worst real runs (every class x doctrine, every party of up to 4) are pinned in __tests__/specArt.test.ts. The
// packer is a first-fit over per-layer occupancy maps (small runs fill the holes the tall ones leave), so a scope uses the
// whole 512 cells before a key is left out (the shelf packer it replaced needed a fifth layer for every scope past 236 cells
// although four hold 256: 74 of the 386 real scopes, and a layer is worth 16-30 px of cell on the high tiers).
// When a scope still exceeds the array (the skill scale-out wires more sprites than a 4-hero party fits), `packArt` keeps the
// keys that matter most: ArtFootprint.rank orders them (SpecArt ranks a staged scope by its plan: the awaited NOW keys first,
// then the stream order SOON, LATE), only the last ones lose their cell (ArtStats.dropped, a warning each, fallback role).
//
// SECOND CELL SIZE (artPage.ts): a scope that does not fit ART_PAGE1_LAYERS full layers may put its SOFT sprites (artDetail.ts,
// measured: they lose almost nothing at half size) on DENSE layers of the same array: the same pixel size with ART_DENSE_RATIO x the
// cells per side, so 4 x the cells for the VRAM of a layer. packArt keeps the full-layer layout of every scope that fits, packDual
// demotes the fewest softest keys otherwise; the role carries a page field (packArtRole) the shaders decode (spec/shaders.ts
// roleRect); the staged scope blits dense keys into their reserved cells like any other. The legacy kit's entry (`role`) never gets a
// dense role (its shader does not decode the page): `peek` is the spec host's.
//
// STAGED SCOPE (production, `?payload=1`; ARCHITECTURE §11): `preload(src, keys, true, plan)` awaits only `plan.now` and
// lays out the WHOLE scope at once (cells come from the manifest's sizes, so every key has its place before its pixels
// exist). The rest streams in behind the first seconds of the run (`pump`, driven by the VFX update): a sprite that
// arrives is blitted into its reserved cell, a slice per frame sized to ART_BLIT_MS (ART_BLIT_PIXELS .. ART_BLIT_PIXELS_MAX of source), with one mip regeneration per slice and
// no repack, so roles of sprites already in the array never move. Until then a key has no role (`role()` is null) and its
// elements draw their fallback. A key whose effect plays before its turn is fetched at once (`request`: the spec host's
// ensureArt and the legacy kit's artCell/hasArt both ask). Without a plan every key is awaited and baked in one pass.
import {
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataArrayTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLArrayRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { ART_DENSE_RATIO, ART_PAGE1_LAYERS, ART_ROLE_PAGE_UNIT, artSoftness } from './artPage';
import { ART_GUTTER } from './artGutter';
import { artKey, artParts } from './artScope';
import type { ArtTex, TierIdx } from './types';

/** manifest fields the packer reads (engine/assets TextureAsset satisfies it; `grid` / `frames` are optional extras) */
export interface ArtManifestEntry {
  w: number;
  h: number;
  /** meaningful alpha channel; without it the sprite is treated as additive-on-black (alpha = brightest channel) */
  alpha?: boolean;
  grid?: unknown;
  frames?: unknown;
}

/** what the art loader needs from the asset layer (engine/assets `Assets` satisfies it structurally) */
export interface ArtSource {
  hasTexture(id: string): boolean;
  loadTexture(id: string): Promise<Texture>;
  readonly manifest: { readonly textures: Readonly<Record<string, ArtManifestEntry>> };
}

/** art cell edge in px per quality tier (lower tiers downscale) */
export const ART_CELL_PX: readonly [number, number, number, number] = [128, 256, 256, 256];
export const ART_MAX_GRID = 8;
export const ART_MAX_LAYERS = 8;
/** cells of a full array: what a run's scope has to fit (the 3-bit layer and cell fields of the packed role cap it, see packArtRole) */
export const ART_MAX_CELLS = ART_MAX_GRID * ART_MAX_GRID * ART_MAX_LAYERS;
/** VRAM budget (MB, mip chain included) of the art array in a run, per quality tier; the cell shrinks until it fits */
export const ART_RUN_BUDGET_MB: readonly [number, number, number, number] = [12, 24, 32, 32];
/** smallest cell a budget may shrink to, and the shrink step (px) */
export const ART_MIN_CELL_PX = 64;
export const ART_CELL_STEP_PX = 16;
/** packed art roles start here (procedural roles pack below 65536, see roles.ts packRole) */
export const ART_ROLE_BASE = 65536;

export interface ArtFootprint {
  id: string;
  /** cells per frame (w × h) */
  cw: number;
  ch: number;
  frames: number;
  /** sheet layout of the source image */
  cols: number;
  rows: number;
  /** only read when the scope exceeds the array: the keys with the HIGHEST rank lose their cell first (default 0 = all equal, then the largest runs go first) */
  rank?: number;
  /** measured softness (artPage.ts artSoftness, lower = softer): the key MAY sit on a dense layer. Absent = crisp, full cells only */
  soft?: number;
}

export interface ArtPlace {
  layer: number;
  /** cell of the first frame; 0..grid-1 on a full layer, 0..ART_DENSE_RATIO * grid-1 on a dense one */
  col: number;
  row: number;
  /** on a dense layer (cells 1 / ART_DENSE_RATIO of a full cell); absent on a full layer */
  dense?: boolean;
}

export interface ArtLayout {
  /** cells per side of a FULL layer (a dense layer has ART_DENSE_RATIO x as many) */
  grid: number;
  /** layers of the array, dense ones included */
  layers: number;
  place: Map<string, ArtPlace>;
  /** how many of the last layers are dense (absent = none: every layer is full, the layout of a scope that fits one page) */
  denseLayers?: number;
}

function gridOf(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) return [Math.max(1, Math.round(v[0] as number)), Math.max(1, Math.round(v[1] as number))];
  return null;
}

/** cells a sprite needs: frames of the sheet, each 1, 2 or 4 cells wide / tall by its aspect ratio */
export function artFootprint(id: string, w: number, h: number, grid?: readonly [number, number] | null, frames?: number): ArtFootprint {
  const cols = Math.max(1, Math.round(grid?.[0] ?? 1));
  const rows = Math.max(1, Math.round(grid?.[1] ?? 1));
  const aspect = w / cols / Math.max(1e-6, h / rows);
  const cw = aspect >= 2.8 ? 4 : aspect >= 1.4 ? 2 : 1;
  const ch = aspect <= 1 / 2.8 ? 4 : aspect <= 1 / 1.4 ? 2 : 1;
  const cap = Math.min(32, cols * rows, Math.floor((ART_MAX_GRID * ART_MAX_GRID) / (cw * ch)));
  const n = Math.max(1, Math.min(cap, Math.round(frames ?? cols * rows)));
  return { id, cw, ch, frames: n, cols, rows };
}

/**
 * the cells a run occupies when its first frame sits at (col, row): frame f is at cell `col + f * cw` of the band-wrapped row
 * (the shaders' roleRect decode, artRect). Cell indexes are row * G + col; null when a frame leaves the grid.
 */
function runCells(it: ArtFootprint, G: number, col: number, row: number): number[] | null {
  const out: number[] = [];
  for (let f = 0; f < it.frames; f++) {
    const cc = col + f * it.cw;
    const c = cc % G;
    const r = row + Math.floor(cc / G) * it.ch;
    if (c + it.cw > G || r + it.ch > G) return null;
    for (let dy = 0; dy < it.ch; dy++) for (let dx = 0; dx < it.cw; dx++) out.push((r + dy) * G + c + dx);
  }
  return out;
}

/**
 * First-fit packing into occupancy maps (one G x G map per layer): every run takes the first free spot (layers first, then
 * rows, then columns), so the small runs fill the holes the tall ones leave. A run that fits one band may sit anywhere; a
 * longer run wraps into bands of `ch` rows and starts at column 0 (the unused tail of its last band stays free). `extra` are
 * placed afterwards wherever they still fit; the ones that do not are left out. null when an item of `items` does not fit.
 */
function tryPack(items: readonly ArtFootprint[], G: number, maxLayers: number, extra: readonly ArtFootprint[] = []): ArtLayout | null {
  const pk = makePacker(G, maxLayers);
  for (const it of items) if (!pk.put(it)) return null;
  for (const it of extra) pk.put(it);
  return { grid: G, layers: Math.max(1, pk.layers()), place: pk.place };
}

/** incremental first-fit packer (tryPack's engine): runs go to the first free spot, a layer is opened only when no earlier one has room */
interface Packer {
  readonly place: Map<string, ArtPlace>;
  /** places `it` in the first free spot of layers [0, limit) (default: every layer the packer may open); false when it does not fit */
  put(it: ArtFootprint, limit?: number): boolean;
  /** layers opened so far */
  layers(): number;
}

/** `dense`: the grid is a dense layer's and the layers are numbered from `layerBase` (the places carry `dense: true`) */
function makePacker(G: number, maxLayers: number, layerBase = 0, dense = false): Packer {
  const place = new Map<string, ArtPlace>();
  const occ: Uint8Array[] = [];
  let layers = 0;
  const put = (it: ArtFootprint, limit: number = maxLayers): boolean => {
    if (it.cw > G || it.ch > G) return false;
    const wide = it.cw * it.frames > G;
    for (let layer = 0; layer < limit; layer++) {
      const map = (occ[layer] ??= new Uint8Array(G * G));
      for (let row = 0; row + it.ch <= G; row++) {
        for (let col = 0; col < G; col += wide ? G : 1) {
          if (!wide && col + it.cw * it.frames > G) break;
          const cells = runCells(it, G, col, row);
          if (cells === null || cells.some((c) => map[c] === 1)) continue;
          for (const c of cells) map[c] = 1;
          place.set(it.id, dense ? { layer: layerBase + layer, col, row, dense: true } : { layer, col, row });
          if (layer >= layers) layers = layer + 1;
          return true;
        }
      }
    }
    return false;
  };
  return { place, put, layers: () => layers };
}

/** packing order: tall runs first, then the longest run, then the id (a total order: the layout is deterministic) */
function bySize(a: ArtFootprint, b: ArtFootprint): number {
  return b.ch - a.ch || b.cw * b.frames - a.cw * a.frames || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * packs sprite runs into the smallest grid that holds everything in one layer, else 8 × 8 cells over several layers. While
 * everything fits, `rank` plays no part (the layout is the size order's). Past ART_MAX_CELLS the keys are admitted in rank order
 * (lowest first, then the size order) and the ones that no longer fit keep their fallback role: a scope that is too big costs
 * its least important keys, never an arbitrary slice of the id alphabet.
 *
 * SECOND PAGE: a scope whose full-layer layout (the packing above) needs more than ART_PAGE1_LAYERS layers, or loses keys, may move
 * its SOFT keys (ArtFootprint.soft: measured to lose almost nothing at half size) onto dense layers (cells 1 / ART_DENSE_RATIO of a
 * full cell, ART_DENSE_RATIO² x the cells per layer): `packDual`. Every scope that fits ART_PAGE1_LAYERS layers, and every scope without
 * soft keys, gets exactly the layout it always had.
 */
export function packArt(items: readonly ArtFootprint[]): ArtLayout {
  const single = packFull(items);
  if (single.layers <= ART_PAGE1_LAYERS && single.place.size === items.length) return single;
  const soft = items.filter((it) => it.soft !== undefined);
  return soft.length === 0 ? single : (packDual(items, soft, single) ?? single);
}

/** the full-layer layout: one page of cells of one size (the layout every scope had before the second page existed) */
function packFull(items: readonly ArtFootprint[]): ArtLayout {
  const sorted = [...items].sort(bySize);
  for (let g = 1; g <= ART_MAX_GRID; g *= 2) {
    const r = tryPack(sorted, g, g === ART_MAX_GRID ? ART_MAX_LAYERS : 1);
    if (r) return r;
  }
  // more than ART_MAX_CELLS of art: the largest rank-ordered prefix that packs keeps its cells, then the keys behind it are tried
  // one by one in the holes that are left; the rest keeps its fallback role
  const order = [...items].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || bySize(a, b));
  const packPrefix = (k: number, rest?: readonly ArtFootprint[]): ArtLayout | null => tryPack(order.slice(0, k).sort(bySize), ART_MAX_GRID, ART_MAX_LAYERS, rest);
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (packPrefix(mid)) lo = mid;
    else hi = mid - 1;
  }
  return packPrefix(lo, order.slice(lo)) ?? { grid: 1, layers: 1, place: new Map() };
}

/** a dense layer's cells per side */
const DENSE_GRID = ART_MAX_GRID * ART_DENSE_RATIO;

/**
 * Two pages: `demoted` keys (soft ones the layout may spend on a dense layer) are placed AFTER the others. The rest (crisp keys, soft
 * keys that stay) is packed on full layers as packFull does (rank-ordered prefix when even that overflows); then each demoted key takes
 * a hole of those layers if one is left (it keeps a full cell there, for free), else a cell of a dense layer; the dense layers follow the
 * full ones, so the array has `full + dense <= ART_MAX_LAYERS` layers. A demoted key that finds no room is left out (the keys are
 * placed in size order: the dense page is 4 x as roomy as a full one, so this only happens far past the capacity).
 */
function layoutDual(items: readonly ArtFootprint[], demoted: ReadonlySet<string>): ArtLayout {
  const keep = items.filter((it) => !demoted.has(it.id));
  const moved = items.filter((it) => demoted.has(it.id)).sort(bySize);
  const sorted = [...keep].sort(bySize);
  let full = makePacker(ART_MAX_GRID, ART_MAX_LAYERS);
  if (!sorted.every((it) => full.put(it))) {
    const order = [...keep].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || bySize(a, b));
    const prefix = (k: number): Packer | null => {
      const pk = makePacker(ART_MAX_GRID, ART_MAX_LAYERS);
      return order.slice(0, k).sort(bySize).every((it) => pk.put(it)) ? pk : null;
    };
    let lo = 0;
    let hi = order.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (prefix(mid)) lo = mid;
      else hi = mid - 1;
    }
    full = prefix(lo) as Packer;
    for (const it of order.slice(lo)) full.put(it);
  }
  const n1 = full.layers();
  const dense = makePacker(DENSE_GRID, ART_MAX_LAYERS - n1, n1, true);
  for (const it of moved) if (!full.put(it, n1)) dense.put(it);
  const place = new Map(full.place);
  for (const [id, pl] of dense.place) place.set(id, pl);
  return { grid: ART_MAX_GRID, layers: Math.max(1, n1 + dense.layers()), place, denseLayers: dense.layers() };
}

/**
 * The smallest set of the softest keys to demote so the array needs as few layers as the soft keys can make it (a layer is worth
 * 16-30 px of cell, a demoted key costs it a quarter of its cell area): all soft keys demoted gives the layer count to beat, then a
 * binary search takes the fewest softest ones that still reach it. null when it does not beat the full-layer layout.
 */
function packDual(items: readonly ArtFootprint[], soft: readonly ArtFootprint[], single: ArtLayout): ArtLayout | null {
  const order = [...soft].sort((a, b) => (a.soft as number) - (b.soft as number) || (a.id < b.id ? -1 : 1));
  const build = (k: number): ArtLayout => layoutDual(items, new Set(order.slice(0, k).map((it) => it.id)));
  let best = build(order.length);
  if (!(best.place.size > single.place.size || (best.place.size === single.place.size && best.layers < single.layers))) return null;
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = build(mid);
    if (r.place.size === best.place.size && r.layers <= best.layers) {
      best = r;
      hi = mid;
    } else lo = mid + 1;
  }
  return best;
}

/**
 * float the shaders decode (spec/shaders.ts roleRect): 65536 + layer + 8 col + 64 row + 512 (w-1) + 2048 (h-1) + 8192 (frames-1)
 * (+ ART_ROLE_PAGE_UNIT x page for a dense layer: artPage.ts says how; a role of a full layer is what it always was)
 */
export function packArtRole(p: ArtPlace, f: ArtFootprint): number {
  const body = 512 * (f.cw - 1) + 2048 * (f.ch - 1) + 8192 * (f.frames - 1);
  if (p.dense) return ART_ROLE_BASE + p.layer + 8 * (p.col & 7) + 64 * (p.row & 7) + body + ART_ROLE_PAGE_UNIT * (1 + (p.col >> 3) + 2 * (p.row >> 3));
  return ART_ROLE_BASE + p.layer + 8 * p.col + 64 * p.row + body;
}

/** the role sits on a dense layer: the legacy kit's decoder (shaders/common.ts GLSL_ART) does not know that page */
export function isDenseRole(pk: number): boolean {
  return pk - ART_ROLE_BASE >= ART_ROLE_PAGE_UNIT;
}

/**
 * JS mirror of the GLSL decode: atlas rect (u0, v0, du, dv) + layer of frame `f` (tests, tools). `grid` is the full layers' cells per
 * side (uArtGrid); `cells` is the grid the rect is in (a dense role: ART_DENSE_RATIO x grid), so `du * cells` is the width in cells.
 */
export function artRect(pk: number, f: number, grid: number): { u0: number; v0: number; du: number; dv: number; layer: number; frames: number; cells: number; dense: boolean } {
  const d0 = pk - ART_ROLE_BASE;
  const layer = d0 % 8;
  let d = Math.floor(d0 / 8);
  let c0 = d % 8;
  d = Math.floor(d / 8);
  let r0 = d % 8;
  d = Math.floor(d / 8);
  const w = (d % 4) + 1;
  d = Math.floor(d / 4);
  const h = (d % 4) + 1;
  d = Math.floor(d / 4);
  const frames = (d % 32) + 1;
  const page = Math.floor(d / 32);
  let G = grid;
  if (page > 0) {
    G = grid * ART_DENSE_RATIO;
    c0 += 8 * ((page - 1) & 1);
    r0 += 8 * ((page - 1) >> 1);
  }
  const cc = c0 + f * w;
  const row = r0 + Math.floor(cc / G) * h;
  const col = cc % G;
  return { u0: col / G, v0: 1 - (row + h) / G, du: w / G, dv: h / G, layer, frames, cells: G, dense: page > 0 };
}

/** VRAM of an art array of `layers` layers of `grid` × `grid` cells of `cell` px (RGBA8 + full mip chain, ≈ 4/3) */
export function artBytes(grid: number, layers: number, cell: number): number {
  const edge = grid * cell;
  return Math.ceil(layers * edge * edge * 4 * (4 / 3));
}

/** the cell edge (px) an art array of this layout gets: the tier's cell, shrunk in steps until it fits `budgetBytes` */
export function artCellFor(layout: { grid: number; layers: number }, tierCell: number, budgetBytes: number | null): number {
  let cell = tierCell;
  if (budgetBytes === null) return cell;
  while (cell - ART_CELL_STEP_PX >= ART_MIN_CELL_PX && artBytes(layout.grid, layout.layers, cell) > budgetBytes) cell -= ART_CELL_STEP_PX;
  return cell;
}

// ------------------------------------------------------------------------------------------------ GPU bake

const BLIT_VERT = /* glsl */ `attribute vec4 aBox; varying vec2 vUv; varying vec4 vBox; void main(){ vUv = uv; vBox = aBox; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLIT_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uLuma;
varying vec2 vUv;
varying vec4 vBox;
void main(){
  // the quad covers a whole cell run, gutter included (artGutter.ts): the uv runs past the image there, and the clamp to the image's box (half a source
  // texel inside, so a sheet's neighbouring frame never leaks in) repeats the border texels = the gutter holds the image's own edge colour
  vec4 c = texture2D(map, clamp(vUv, vBox.xy, vBox.zw));
  // sources are straight alpha (sampled linear from sRGB storage): premultiply in linear space; sprites without an
  // alpha channel are additive-on-black: their colour already is the premultiplied value, alpha = brightest channel
  gl_FragColor = uLuma > 0.5 ? vec4(c.rgb, max(c.r, max(c.g, c.b))) : vec4(c.rgb * c.a, c.a);
}`;

interface Source {
  tex: Texture;
  entry: ArtManifestEntry;
}

export interface ArtRole {
  packed: number;
  frames: number;
}

/** what the last bake produced (perf notes, QA evals) */
export interface ArtStats {
  layers: number;
  /** layer edge px (grid × cell) */
  size: number;
  /** cell edge px actually used (the tier's cell, shrunk to fit the budget) */
  cell: number;
  grid: number;
  /** VRAM of the array incl. mips (artBytes) */
  bytes: number;
  ms: number;
  /** baked art keys (a flipbook list counts once) */
  sprites: number;
  /** keys with a reserved cell whose pixels are not in the array yet (a staged scope; 0 otherwise) */
  pending: number;
  /** keys of the scope that found no cell (the scope exceeds ART_MAX_CELLS): they draw their fallback role; 0 in every real run today */
  dropped: number;
  /** second page: layers of half-size cells (the last `denseLayers` of `layers`), keys placed on them, and their cell edge px (`cell` / ART_DENSE_RATIO); all 0 when the scope fits the full page */
  denseLayers: number;
  dense: number;
  denseCell: number;
}

/** sources loaded at once (the browser caps parallel fetches anyway; 261 at once only floods the queue) */
const LOAD_PARALLEL = 8;
/** keys fetched at once by the background stream (a request for a key that plays now ignores the cap) */
export const ART_STREAM_PARALLEL = 4;
/** the stream opens this many seconds of rendered VFX time into the run: the payload gate window ends at HUD + 6 s (tools/qa/payload.ts) */
export const ART_STREAM_AFTER_S = 8.5;
/** source pixels a stream slice starts with (one 512 px sprite) and the most it ever takes: the slice size then follows the measured cost, see ART_BLIT_MS */
export const ART_BLIT_PIXELS = 300_000;
export const ART_BLIT_PIXELS_MAX = 1_000_000;
/** CPU time (ms) one stream slice aims for (upload of the sources + the blit + one mip regeneration of the array); a frame that ran longer than ART_BLIT_SKIP_S gets none */
export const ART_BLIT_MS = 3;
export const ART_BLIT_SKIP_S = 0.05;
/** frames in a row a slow frame may hold the stream back (so it cannot starve on a machine that is always slow) */
const ART_BLIT_MAX_SKIPS = 8;

/** how a run's scope is split when it is loaded in stages (preload's `plan`) */
export interface ArtPlan {
  /** keys awaited by preload (every key that is already loaded joins them) */
  now: ReadonlySet<string>;
  /** keys fetched once the stream opens, in this order; scope keys in neither list follow in scope order */
  later: readonly string[];
  /** stream clock (seconds of rendered VFX time since the run started) at which the stream opens */
  after: number;
}

/** what the background stream did (perf notes, QA evals) */
export interface ArtStream {
  /** a staged scope is loaded */
  staged: boolean;
  /** keys of the scope not requested yet / fetching / arrived but not in the array yet */
  queued: number;
  flying: number;
  ready: number;
  /** keys requested because an effect that draws them played before the stream reached them */
  demanded: number;
  /** blit slices run, their total and longest CPU time (ms), keys and source pixels they put into the array */
  slices: number;
  ms: number;
  maxMs: number;
  keys: number;
  pixels: number;
  /** seconds of rendered VFX time since the run started, and when the stream opens */
  clock: number;
  after: number;
}

export class SpecArt {
  /** bound to `uSpecArt`: a 1×1×1 transparent placeholder until the first bake */
  texture: Texture;
  /** cells per layer side of the current bake (`uArtGrid`) */
  grid = 1;
  /** bumps on every bake: the host re-resolves element roles */
  version = 0;
  stats: ArtStats = { layers: 0, size: 0, cell: 0, grid: 1, bytes: 0, ms: 0, sprites: 0, pending: 0, dropped: 0, denseLayers: 0, dense: 0, denseCell: 0 };
  private rt: WebGLArrayRenderTarget | null = null;
  private readonly placeholder: DataArrayTexture;
  /** loaded sprites by manifest id */
  private readonly sources = new Map<string, Source>();
  /** art keys to bake (plain ids and flipbook lists): the run's scope, or everything the gallery shows */
  private readonly want = new Set<string>();
  private readonly hints = new Map<string, ArtTex>();
  private readonly missing = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly roles = new Map<string, ArtRole>();
  private tier: TierIdx;
  /** per-tier VRAM budget in MB (null = none: galleries and tools bake every sprite at the full cell size) */
  private budgetMB: readonly number[] | null = null;
  private layout: ArtLayout | null = null;
  /** keys in the array: blitted by the last bake or by a later slice */
  private baked = new Set<string>();
  /** where late art comes from (the last preload source) */
  private src: ArtSource | null = null;
  /** a staged scope is loaded (see the header): `queue`, `asked` and `ready` are in use */
  private staged = false;
  /** scope keys not requested yet, in stream order (`queued`: the same keys as a set, for the per-spawn `role` check) */
  private queue: string[] = [];
  private readonly queued = new Set<string>();
  /** scope keys requested (fetching or fetched) since the scope was set */
  private readonly asked = new Set<string>();
  /** staged scope: key -> how late the run needs it (0 = awaited NOW keys, then the stream order); a key outside it ranks last. Read by packArt on overflow only */
  private readonly rank = new Map<string, number>();
  /** keys whose sprites all arrived but are not in the array yet */
  private ready: string[] = [];
  private flying = 0;
  /** rendered VFX time (s) since the scope was set, and when the stream opens */
  private clock = 0;
  private after = 0;
  /** bumps with every scope change: a fetch of an older scope that lands late is dropped */
  private scopeGen = 0;
  private disposed = false;
  /** a full bake happened since the host last re-resolved its roles (null `takeChanged`), else the keys that joined the array */
  private fullDirty = true;
  private changedKeys = new Set<string>();
  /** a blit material kept alive: three frees a program the moment no material uses it, and the next slice would compile it again (a 1 s hitch) */
  private keeper: ShaderMaterial | null = null;
  /** source pixels the next slice may take, and the frames in a row the stream was held back */
  private slicePx = ART_BLIT_PIXELS;
  private msPerPx = 0;
  private skips = 0;
  readonly stream: ArtStream = { staged: false, queued: 0, flying: 0, ready: 0, demanded: 0, slices: 0, ms: 0, maxMs: 0, keys: 0, pixels: 0, clock: 0, after: 0 };

  constructor(
    private readonly renderer: WebGLRenderer,
    tier: TierIdx,
  ) {
    this.tier = tier;
    this.placeholder = new DataArrayTexture(new Uint8Array(4), 1, 1, 1);
    this.placeholder.needsUpdate = true;
    this.texture = this.placeholder;
  }

  /**
   * packed role of a key in the array; null while it is missing or not in the array yet. Asking for a key of a staged scope
   * that has not been requested yet fetches it now: callers of `role` draw with the answer at once (the legacy kit's
   * Fx.artCell / hasArt at spawn). The host re-resolving its compiled elements uses `peek`, which never fetches.
   */
  role(key: string, demand = true): ArtRole | null {
    const r = this.roles.get(key);
    if (r !== undefined) {
      // `demand` is the legacy kit's entry (Fx.artCell / hasArt): its particle shader (shaders/common.ts GLSL_ART) has no dense page, so it
      
      // so this is a net under a rule, not a path a real run takes; the spec host reads through `peek`
      if (demand && isDenseRole(r.packed)) {
        if (!this.warned.has(`dense:${key}`)) {
          this.warned.add(`dense:${key}`);
          console.warn(`[vfx] art "${key}" sits on the dense atlas page, which the legacy kit cannot draw: procedural fallback (list it as crisp in artDetail.ts)`);
        }
        return null;
      }
      return r;
    }
    if (demand && this.queued.has(key)) this.request(key);
    return null;
  }

  /** like `role`, without the side effect */
  peek(key: string): ArtRole | null {
    return this.role(key, false);
  }

  /** element-side sheet layout hints (grid / frames), first declaration of a key wins */
  hint(t: ArtTex): void {
    const key = artKey(t.art);
    if (key !== '' && !this.hints.has(key)) this.hints.set(key, t);
  }

  /** a part of the key is missing from the manifest or failed to load, or the key itself found no cell (a sheet key that did not fit is marked under its own name) */
  isMissing(key: string): boolean {
    return this.missing.has(key) || artParts(key).some((p) => this.missing.has(p));
  }

  /** the key is part of the current scope (baked, or known missing): nothing to load for it */
  covers(key: string): boolean {
    return this.want.has(key);
  }

  /** marks an id missing and warns once (the element keeps drawing its procedural fallback) */
  warnMissing(id: string, why: string): void {
    this.missing.add(id);
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(`[vfx] art "${id}" ${why}: drawing the procedural fallback role`);
  }

  /** sets the per-tier VRAM budget (MB) the cell shrinks to fit; null = full cells. Takes effect at the next bake. */
  setBudget(mb: readonly number[] | null): void {
    this.budgetMB = mb;
  }

  /**
   * Loads every id the keys need that is not loaded yet through `src`, then re-bakes when the scope changed. `replace`
   * makes `keys` THE scope (a run: sprites of other classes leave the array); without it the keys are added to it
   * (galleries, late loads). With a `plan` (needs `replace`) only `plan.now` is awaited and baked; the array is laid out
   * for the whole scope and the other keys stream in later (see the header). Never rejects; true when a bake or a blit ran.
   */
  async preload(src: ArtSource, keys: Iterable<string>, replace = false, plan?: ArtPlan): Promise<boolean> {
    if (this.disposed) return false;
    this.src = src;
    let changed = false;
    const next = new Set<string>();
    for (const k of keys) if (k !== '') next.add(k);
    if (replace) {
      for (const k of this.want) {
        if (!next.has(k)) {
          this.want.delete(k);
          changed = true;
        }
      }
      // a new scope: the old stream and its late arrivals are over
      this.scopeGen++;
      this.staged = false;
      this.rank.clear();
      this.queue = [];
      this.queued.clear();
      this.asked.clear();
      this.ready = [];
      this.flying = 0;
    }
    const stage = replace && plan !== undefined ? plan : undefined;
    const fetch: string[] = [];
    const deferred: string[] = [];
    for (const k of next) {
      if (!this.want.has(k)) {
        this.want.add(k);
        changed = true;
      }
      // a staged key can wait for the stream when its footprint is known without the pixels (the manifest size)
      let defer = stage !== undefined && !stage.now.has(k);
      const need: string[] = [];
      for (const id of artParts(k)) {
        if (this.sources.has(id) || this.missing.has(id) || need.includes(id)) continue;
        if (!src.hasTexture(id)) {
          this.warnMissing(id, "is not in the asset manifest (kind 'vfx')");
          continue;
        }
        const e = src.manifest.textures[id] as ArtManifestEntry;
        if (!(e.w > 0 && e.h > 0)) defer = false;
        need.push(id);
      }
      if (need.length === 0) continue;
      if (defer && !this.isMissing(k)) deferred.push(k);
      else for (const id of need) if (!fetch.includes(id)) fetch.push(id);
    }
    if (stage !== undefined) this.beginStage(stage, deferred);
    const gen = this.scopeGen;
    let at = 0;
    const worker = async (): Promise<void> => {
      for (let id = fetch[at++]; id !== undefined; id = fetch[at++]) {
        if (this.disposed || gen !== this.scopeGen) return;
        const entry = src.manifest.textures[id] as ArtManifestEntry;
        try {
          const tex = await src.loadTexture(id);
          if (!this.disposed && gen === this.scopeGen) this.sources.set(id, { tex, entry });
        } catch (err) {
          if (!this.disposed && gen === this.scopeGen) this.warnMissing(id, `failed to load (${err instanceof Error ? err.message : String(err)})`);
        }
      }
    };
    if (fetch.length > 0) {
      await Promise.all(Array.from({ length: Math.min(LOAD_PARALLEL, fetch.length) }, worker));
      changed = true;
    }
    if (this.disposed || gen !== this.scopeGen) return false;
    if (this.staged) {
      // the array holds a place for every key of the scope: a new scope (or a key that is new to it) lays it out again,
      // else the sprites that are loaded already (an earlier run's) go into their cells now
      if (this.layout === null || !this.layoutHolds()) {
        this.bake();
        return true;
      }
      this.collectReady();
      return this.blitReady(Number.POSITIVE_INFINITY) > 0;
    }
    if (!changed || !this.bakeNeeded()) return false;
    this.bake();
    return true;
  }

  // ------------------------------------------------------------------------------------------------ staged scope

  /** starts the stream of `deferred` (scope keys that wait): `plan.later` orders them, the rest keeps scope order */
  private beginStage(plan: ArtPlan, deferred: string[]): void {
    const order = new Map<string, number>();
    plan.later.forEach((k, i) => order.set(k, i));
    this.queue = deferred.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
    this.rank.clear();
    for (const k of plan.now) this.rank.set(k, 0);
    plan.later.forEach((k, i) => {
      if (!this.rank.has(k)) this.rank.set(k, 1 + i);
    });
    this.queued.clear();
    for (const k of this.queue) this.queued.add(k);
    this.staged = true;
    this.clock = 0;
    this.after = plan.after;
  }

  /** the layout is the scope's: every key that can have a cell has one, and no cell belongs to a key that left the scope */
  private layoutHolds(): boolean {
    const layout = this.layout;
    if (layout === null) return false;
    let n = 0;
    for (const k of this.want) {
      if (layout.place.has(k)) n++;
      else if (!this.isMissing(k) && this.footprintOf(k) !== null) return false;
    }
    return n === layout.place.size;
  }

  /** wanted keys whose sprites are all loaded but that the array does not hold yet join the blit queue */
  private collectReady(): void {
    const have = new Set(this.ready);
    for (const k of this.want) {
      if (this.baked.has(k) || have.has(k) || this.isMissing(k) || !this.layout?.place.has(k)) continue;
      if (artParts(k).every((id) => this.sources.has(id))) this.ready.push(k);
    }
  }

  /**
   * Fetches a deferred key of the staged scope now, ahead of the stream (an effect that draws it plays): once, a no-op for
   * a key that is requested already, in the array, outside the scope or missing.
   */
  request(key: string): void {
    if (!this.staged || !this.queued.has(key)) return;
    this.queue.splice(this.queue.indexOf(key), 1);
    this.stream.demanded++;
    this.fetchKey(key);
  }

  /** starts loading the sprites of one key of the staged scope; it joins the blit queue when all have arrived */
  private fetchKey(key: string): void {
    const src = this.src;
    this.queued.delete(key);
    if (src === null || this.asked.has(key)) return;
    this.asked.add(key);
    const gen = this.scopeGen;
    const parts = artParts(key).filter((id) => !this.sources.has(id) && !this.missing.has(id));
    this.flying++;
    const one = async (id: string): Promise<void> => {
      const entry = src.manifest.textures[id] as ArtManifestEntry | undefined;
      if (entry === undefined) {
        if (gen === this.scopeGen) this.warnMissing(id, "is not in the asset manifest (kind 'vfx')");
        return;
      }
      try {
        const tex = await src.loadTexture(id);
        // decode off the main thread now: the blit's texImage2D would otherwise decode the image inside a frame
        const img = tex.image as { decode?: () => Promise<void> } | null;
        if (img && typeof img.decode === 'function') await img.decode().catch(() => undefined);
        if (gen === this.scopeGen) this.sources.set(id, { tex, entry });
      } catch (err) {
        if (gen === this.scopeGen) this.warnMissing(id, `failed to load (${err instanceof Error ? err.message : String(err)})`);
      }
    };
    void Promise.all(parts.map(one)).then(() => {
      if (gen !== this.scopeGen) return;
      this.flying--;
      if (this.want.has(key) && !this.isMissing(key) && artParts(key).every((id) => this.sources.has(id)) && !this.baked.has(key)) this.ready.push(key);
    });
  }

  /**
   * Once per frame (the VFX update): advances the stream clock, opens the stream when it is due, tops up its fetches, and
   * blits the sprites that have arrived (one slice per frame, sized to ART_BLIT_MS; none in a frame that already ran long).
   */
  pump(dt: number): void {
    if (!this.staged) return;
    if (dt > 0) this.clock += dt > 0.1 ? 0.1 : dt;
    if (this.queue.length > 0 && this.clock >= this.after) {
      while (this.flying < ART_STREAM_PARALLEL && this.queue.length > 0) {
        const key = this.queue.shift() as string;
        // a key that found no cell in the array (more than 8 layers of art) or went missing is not worth a download
        if (this.layout?.place.has(key) && !this.isMissing(key)) this.fetchKey(key);
        else this.queued.delete(key);
      }
    }
    if (this.ready.length === 0) return;
    // a frame that is already long is left alone (a few frames at most), else the slice takes what it cost last time allows
    if (dt > ART_BLIT_SKIP_S && this.skips < ART_BLIT_MAX_SKIPS) {
      this.skips++;
      return;
    }
    this.skips = 0;
    this.blitReady(this.slicePx);
  }

  /** the keys that joined the array by blits since the last call, null when a full bake ran (everything may have moved) */
  takeChanged(): Set<string> | null {
    if (this.fullDirty) {
      this.fullDirty = false;
      this.changedKeys = new Set();
      return null;
    }
    const c = this.changedKeys;
    this.changedKeys = new Set();
    return c;
  }

  /** the stream counters now (the object is live; this refreshes its gauges) */
  streamStats(): ArtStream {
    const st = this.stream;
    st.staged = this.staged;
    st.queued = this.queue.length;
    st.flying = this.flying;
    st.ready = this.ready.length;
    st.clock = this.clock;
    st.after = this.after;
    return st;
  }

  /** the keys that can be baked now (all their sprites loaded) differ from the last bake */
  private bakeNeeded(): boolean {
    let n = 0;
    for (const k of this.want) {
      if (!artParts(k).every((id) => this.sources.has(id))) continue;
      if (!this.baked.has(k)) return true;
      n++;
    }
    return n !== this.baked.size;
  }

  setTier(t: TierIdx): void {
    this.tier = t;
    if (this.layout !== null && (this.sources.size > 0 || this.staged) && this.cellFor(this.layout) !== this.stats.cell) this.bake();
  }

  private cellFor(layout: ArtLayout): number {
    const mb = this.budgetMB?.[this.tier];
    return artCellFor(layout, ART_CELL_PX[this.tier], mb === undefined ? null : mb * 1048576);
  }

  /**
   * The cells key `key` needs, from the manifest side only (null: a part is missing or failed, or its pixels are needed to
   * know the shape). A sprite that has not arrived can be laid out from its manifest size, but only in a staged scope.
   */
  private footprintOf(key: string): ArtFootprint | null {
    const parts = artParts(key);
    const entries: ArtManifestEntry[] = [];
    let loaded = true;
    for (const id of parts) {
      if (this.missing.has(id)) return null;
      const s = this.sources.get(id);
      const e = s?.entry ?? this.src?.manifest.textures[id];
      if (!e) return null;
      if (!s) loaded = false;
      entries.push(e);
    }
    if (!loaded && !this.staged) return null;
    const e0 = entries[0] as ArtManifestEntry;
    const first = this.sources.get(parts[0] as string);
    const img = first?.tex.image as { width?: number; height?: number } | null | undefined;
    const w = e0.w > 0 ? e0.w : first ? (img?.width ?? 256) : 0;
    const h = e0.h > 0 ? e0.h : first ? (img?.height ?? 256) : 0;
    if (!(w > 0 && h > 0)) return null;
    const hint = this.hints.get(key);
    let fp: ArtFootprint;
    if (parts.length === 1) {
      const frames = hint?.frames ?? (typeof e0.frames === 'number' ? e0.frames : undefined);
      fp = artFootprint(key, w, h, hint?.grid ?? gridOf(e0.grid), frames);
    } else {
      // a frame list: one cell run, frame f = sprite f (cell shape from the first sprite)
      fp = artFootprint(key, w * parts.length, h, [parts.length, 1], hint?.frames);
    }
    // a soft key may go to the second page when the scope needs it (artPage.ts); crisp keys carry no field at all
    const soft = artSoftness(key);
    if (soft !== undefined) fp.soft = soft;
    return fp;
  }

  /** adds the quads that copy key `fp` into its cells (place `pl` of an array of G × G cells) to a blit scene */
  private addBlit(scene: Scene, fp: ArtFootprint, pl: ArtPlace, srcs: Source[], grid: number, mats: Map<Source, ShaderMaterial>, geos: BufferGeometry[]): void {
    // a dense place counts its cells on the dense grid: the same layer, ART_DENSE_RATIO x the cells per side
    const G = pl.dense ? grid * ART_DENSE_RATIO : grid;
    const single = srcs.length === 1;
    // a single image draws all its frames in one mesh; a frame list needs one mesh per frame (own source)
    for (let m = 0; m < (single ? 1 : fp.frames); m++) {
      const s = srcs[m] as Source;
      let mat = mats.get(s);
      if (!mat) {
        mat = new ShaderMaterial({
          vertexShader: BLIT_VERT,
          fragmentShader: BLIT_FRAG,
          uniforms: { map: { value: s.tex }, uLuma: { value: s.entry.alpha === true ? 0 : 1 } },
          blending: NoBlending,
          depthTest: false,
          depthWrite: false,
        });
        mats.set(s, mat);
      }
      const pos: number[] = [];
      const uv: number[] = [];
      const box: number[] = [];
      const idx: number[] = [];
      // half a texel of the source (normalised): the box the gutter's clamp keeps inside the image / the sheet frame
      const hx = s.entry.w > 0 ? 0.5 / s.entry.w : 0;
      const hy = s.entry.h > 0 ? 0.5 / s.entry.h : 0;
      // the image is drawn into the run inset by the gutter (ART_GUTTER of a cell on every side); the quad keeps covering the whole run, so the
      // uv of its corners lies past the image by gutter / inner size of the image's extent
      const kx = ART_GUTTER / (fp.cw - 2 * ART_GUTTER);
      const ky = ART_GUTTER / (fp.ch - 2 * ART_GUTTER);
      for (let f = single ? 0 : m; f < (single ? fp.frames : m + 1); f++) {
        const c0 = pl.col + f * fp.cw;
        const cx = c0 % G;
        const cy = pl.row + Math.floor(c0 / G) * fp.ch;
        const x0 = (cx / G) * 2 - 1, x1 = ((cx + fp.cw) / G) * 2 - 1;
        const y0 = (1 - (cy + fp.ch) / G) * 2 - 1, y1 = (1 - cy / G) * 2 - 1;
        // single image: frame f is cell f of its sheet; frame list: the whole sprite
        const cols = single ? fp.cols : 1, rows = single ? fp.rows : 1;
        const fx = single ? f % fp.cols : 0, fy = single ? Math.floor(f / fp.cols) : 0;
        const u0 = fx / cols, u1 = (fx + 1) / cols;
        const v1 = 1 - fy / rows, v0 = 1 - (fy + 1) / rows;
        const b = pos.length / 3;
        pos.push(x0, y0, 0, x1, y0, 0, x0, y1, 0, x1, y1, 0);
        const ex = (u1 - u0) * kx;
        const ey = (v1 - v0) * ky;
        uv.push(u0 - ex, v0 - ey, u1 + ex, v0 - ey, u0 - ex, v1 + ey, u1 + ex, v1 + ey);
        for (let v = 0; v < 4; v++) box.push(u0 + hx, v0 + hy, u1 - hx, v1 - hy);
        idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      g.setAttribute('aBox', new Float32BufferAttribute(box, 4));
      g.setIndex(idx);
      geos.push(g);
      const mesh = new Mesh(g, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  /** (re)builds the texture array from every wanted key whose sprites are loaded, at the current tier's cell size */
  bake(): void {
    const t0 = performance.now();
    // sources nobody wants any more (a previous run's classes) are dropped from this cache only: the engine's Assets keeps
    // every texture it ever loaded (no eviction API), so their decoded images stay in CPU memory for the session. What the
    // scope saves is the GPU array (VRAM) and the bake, not the decoded copies
    const keep = new Set<string>();
    for (const k of this.want) for (const id of artParts(k)) keep.add(id);
    for (const id of [...this.sources.keys()]) if (!keep.has(id)) this.sources.delete(id);
    // the layout covers every key that has a footprint: in a staged scope that includes the sprites still on their way
    // (their cells stay empty until the stream blits them), else only the loaded ones
    const fps: ArtFootprint[] = [];
    const srcOf = new Map<string, Source[]>();
    for (const key of this.want) {
      const fp = this.footprintOf(key);
      if (fp === null) continue;
      // a staged scope ranks its keys by when the run needs them (packArt reads it on overflow only); a key the plan does not name (a late load) ranks last
      if (this.rank.size > 0) fp.rank = this.rank.get(key) ?? this.rank.size + 1;
      fps.push(fp);
      const srcs: Source[] = [];
      for (const id of artParts(key)) {
        const s = this.sources.get(id);
        if (s) srcs.push(s);
      }
      if (srcs.length === artParts(key).length) srcOf.set(key, srcs);
    }
    this.baked = new Set(srcOf.keys());
    if (fps.length === 0) {
      // nothing to show (a scope without art): release the array
      this.rt?.dispose();
      this.rt = null;
      this.texture = this.placeholder;
      this.grid = 1;
      this.layout = null;
      this.roles.clear();
      this.version++;
      this.fullDirty = true;
      this.stats = { layers: 0, size: 0, cell: 0, grid: 1, bytes: 0, ms: performance.now() - t0, sprites: 0, pending: 0, dropped: 0, denseLayers: 0, dense: 0, denseCell: 0 };
      return;
    }
    const layout = packArt(fps);
    const cell = this.cellFor(layout);
    const size = layout.grid * cell;
    const rt = new WebGLArrayRenderTarget(size, size, layout.layers, {
      format: RGBAFormat,
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace();
    const prevLevel = r.getActiveMipmapLevel();
    const prevAutoClear = r.autoClear;
    const prevClear = new Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mats = new Map<Source, ShaderMaterial>();
    const geos: BufferGeometry[] = [];
    const G = layout.grid;
    this.roles.clear();
    try {
      r.autoClear = false;
      r.setClearColor(0x000000, 0);
      for (let L = 0; L < layout.layers; L++) {
        const scene = new Scene();
        for (const fp of fps) {
          const pl = layout.place.get(fp.id);
          const srcs = srcOf.get(fp.id);
          if (!pl || !srcs || pl.layer !== L) continue;
          this.addBlit(scene, fp, pl, srcs, G, mats, geos);
          this.roles.set(fp.id, { packed: packArtRole(pl, fp), frames: fp.frames });
        }
        r.setRenderTarget(rt, L);
        r.clear(true, false, false);
        // one render per layer: three regenerates the array's mipmaps once after it
        r.render(scene, cam);
      }
    } finally {
      r.setRenderTarget(prevTarget, prevFace, prevLevel);
      r.autoClear = prevAutoClear;
      r.setClearColor(prevClear, prevAlpha);
      this.releaseBlitMaterials(mats);
      for (const g of geos) g.dispose();
    }
    // the sources' own GPU uploads are freed (their images stay in the Assets cache, also for tier re-bakes)
    for (const s of this.sources.values()) s.tex.dispose();
    const old = this.rt;
    this.rt = rt;
    this.texture = rt.texture;
    this.grid = G;
    this.layout = layout;
    this.version++;
    this.fullDirty = true;
    this.ready = this.ready.filter((k) => !this.baked.has(k));
    let dense = 0;
    for (const pl of layout.place.values()) if (pl.dense) dense++;
    const denseLayers = layout.denseLayers ?? 0;
    this.stats = {
      layers: layout.layers,
      size,
      cell,
      grid: G,
      bytes: artBytes(G, layout.layers, cell),
      ms: performance.now() - t0,
      sprites: this.roles.size,
      pending: layout.place.size - this.roles.size,
      dropped: fps.length - layout.place.size,
      denseLayers,
      dense,
      denseCell: denseLayers > 0 ? Math.round(cell / ART_DENSE_RATIO) : 0,
    };
    old?.dispose();
    for (const fp of fps) if (!layout.place.has(fp.id)) this.warnMissing(fp.id, `does not fit the art atlas (${ART_MAX_LAYERS} layers of ${ART_MAX_GRID} × ${ART_MAX_GRID} cells)`);
  }

  /** disposes the blit materials of a pass but one: that one stays (without its source) so the blit program is never freed and recompiled */
  private releaseBlitMaterials(mats: Map<Source, ShaderMaterial>): void {
    for (const m of mats.values()) {
      if (this.keeper === null) {
        this.keeper = m;
        (m.uniforms.map as { value: Texture | null }).value = null;
      } else m.dispose();
    }
  }

  /**
   * Copies the arrived sprites of the staged scope into their reserved cells, `maxPx` source pixels at most (and at least
   * one key). No clear, no repack: the cells of every sprite already in the array stay where they are. The array's mipmaps
   * are regenerated once for the whole slice (only the last layer's render asks three for it). Returns the keys blitted.
   */
  private blitReady(maxPx: number): number {
    const layout = this.layout;
    const rt = this.rt;
    if (layout === null || rt === null) return 0;
    const t0 = performance.now();
    const picks: { fp: ArtFootprint; pl: ArtPlace; srcs: Source[] }[] = [];
    let px = 0;
    while (this.ready.length > 0) {
      const key = this.ready[0] as string;
      const pl = layout.place.get(key);
      const srcs: Source[] = [];
      for (const id of artParts(key)) {
        const s = this.sources.get(id);
        if (s) srcs.push(s);
      }
      const fp = pl && !this.baked.has(key) && this.want.has(key) && srcs.length === artParts(key).length ? this.footprintOf(key) : null;
      if (pl === undefined || fp === null) {
        this.ready.shift(); // nothing to blit for it (left the scope, in the array already, no cell)
        continue;
      }
      let cost = 0;
      for (const s of srcs) cost += Math.max(1, s.entry.w) * Math.max(1, s.entry.h);
      // a slice takes keys while they fit the budget, but always at least one
      if (picks.length > 0 && px + cost > maxPx) break;
      this.ready.shift();
      picks.push({ fp, pl, srcs });
      px += cost;
    }
    if (picks.length === 0) return 0;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevFace = r.getActiveCubeFace();
    const prevLevel = r.getActiveMipmapLevel();
    const prevAutoClear = r.autoClear;
    const prevClear = new Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mats = new Map<Source, ShaderMaterial>();
    const geos: BufferGeometry[] = [];
    const layers = [...new Set(picks.map((p) => p.pl.layer))].sort((a, b) => a - b);
    // the slice runs inside the frame: its draws must not show in the frame's draw-call / triangle counters (autoReset is off)
    const info = r.info?.render;
    const counted = info ? { calls: info.calls, triangles: info.triangles, points: info.points, lines: info.lines } : null;
    try {
      r.autoClear = false;
      r.setClearColor(0x000000, 0);
      for (let i = 0; i < layers.length; i++) {
        const scene = new Scene();
        for (const p of picks) if (p.pl.layer === layers[i]) this.addBlit(scene, p.fp, p.pl, p.srcs, layout.grid, mats, geos);
        rt.texture.generateMipmaps = i === layers.length - 1;
        r.setRenderTarget(rt, layers[i] as number);
        r.render(scene, cam);
      }
    } finally {
      rt.texture.generateMipmaps = true;
      if (info && counted) Object.assign(info, counted);
      r.setRenderTarget(prevTarget, prevFace, prevLevel);
      r.autoClear = prevAutoClear;
      r.setClearColor(prevClear, prevAlpha);
      this.releaseBlitMaterials(mats);
      for (const g of geos) g.dispose();
    }
    for (const p of picks) {
      for (const s of p.srcs) s.tex.dispose();
      this.roles.set(p.fp.id, { packed: packArtRole(p.pl, p.fp), frames: p.fp.frames });
      this.baked.add(p.fp.id);
      this.changedKeys.add(p.fp.id);
    }
    this.version++;
    this.stats.sprites = this.roles.size;
    this.stats.pending = layout.place.size - this.roles.size;
    const ms = performance.now() - t0;
    const st = this.stream;
    st.slices++;
    st.ms += ms;
    if (ms > st.maxMs) st.maxMs = ms;
    st.keys += picks.length;
    st.pixels += px;
    // the next slice: the pixels that fit ART_BLIT_MS at the cost per pixel just measured (smoothed), within [one sprite, 1 Mpx]
    const per = ms / Math.max(px, 1);
    this.msPerPx = this.msPerPx === 0 ? per : this.msPerPx * 0.6 + per * 0.4;
    this.slicePx = Math.max(ART_BLIT_PIXELS, Math.min(ART_BLIT_PIXELS_MAX, ART_BLIT_MS / this.msPerPx));
    return picks.length;
  }

  /** Re-bakes the GPU texture array after WebGL context restoration so newly allocated GL storage is repopulated. */
  onContextRestored(): void {
    if (this.disposed) return;
    this.keeper?.dispose();
    this.keeper = null;
    this.placeholder.needsUpdate = true;
    for (const s of this.sources.values()) s.tex.needsUpdate = true;
    this.baked.clear();
    this.roles.clear();
    if (this.want.size > 0 || this.rt !== null) {
      this.bake();
    } else {
      this.version++;
      this.fullDirty = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.scopeGen++;
    this.staged = false;
    this.keeper?.dispose();
    this.keeper = null;
    this.rt?.dispose();
    this.rt = null;
    this.placeholder.dispose();
    this.texture = this.placeholder;
  }
}
