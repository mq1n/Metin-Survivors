
// traces); particles, trail segments and surfaces are GPU-analytic records in 4 ring batches. Attachment frames
// (follow / projectile) live in a 256-slot anchor texture, body sockets (hands, blade tip …) in its rows 2-3, so a
// moving effect costs one texel write per frame instead of per-particle updates.
import { DataTexture, DataUtils, FloatType, HalfFloatType, LinearFilter, NearestFilter, RGBAFormat, type Camera, type Scene, type Texture, type WebGLRenderer } from 'three';
import type { Ctx, Fx } from '../emit';
import { ART_ROLE_BASE, ART_RUN_BUDGET_MB, ART_STREAM_AFTER_S, SpecArt, type ArtPlan, type ArtSource, type ArtStats, type ArtStream } from './art';
import { artKey } from './artScope';
import type { RunArtTiers } from './artTier';
import { bakeSpecAtlas, type SpecAtlas } from './atlas';
import { REC, SpecBatch, type SpecUniforms } from './batches';
import { bakeParticle, bakeSurface, bakeTrail, curveMax, elementRows, evalCurve, withDefaults } from './curves';
import { artGain, clearDisplayLayer, resolveSpace, setDisplayLayer, type DisplayLayer } from './display';
import { frameModeBits, recordSeed } from './flip';
import { ROLES, packRole } from './roles';
import { ANCHORS, ANCHOR_ROWS, LUT_H, LUT_SAMPLES, LUT_W, SURF_KIND } from './shaders';
import { PLAYER_SETS, SET_FLOATS, SOCKET_ID, SOCKET_SETS, SOCKET_STRIDE, SOCKETS_PER_SET, isSocket, qrot, quatYaw, standInSockets } from './sockets';
import { MAX_ELEMENTS, type ElementSpec, type FxSpec, type Grade, type ParticleSpec, type StandInPose, type StandInSwing, type SurfaceSpec, type TexSrc, type TierIdx, type TrailSpec } from './types';

/** elements compiled per list: the ONE limit (types.ts MAX_ELEMENTS); a longer list is cut with a console warning, never silently */
const MAX_EL = MAX_ELEMENTS;
const RING = 64;
const DEG = Math.PI / 180;

export const EMIT_STEP = 1 / 60;
const LUT_ROWS = (LUT_W / LUT_SAMPLES) * LUT_H;
/** batch capacities (records) per quality tier: [add particles, alpha particles, add surfaces, alpha surfaces] */
const CAPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1500, 700, 160, 96],
  [3000, 1400, 320, 160],
  [5000, 2400, 512, 256],
  [7000, 3200, 640, 320],
];
/** particle record flags (shaders.ts SPEC_PARTICLE_VERT) */
const PF_TRAIL = 16;
const PF_RIBBON = 32;
const PF_OCC = 6;
const PF_CLAMP = 10;
const PF_FRONT = 1 << 15;
/** bit 21: ElementCommon.square (display space: the element adds (texel x colour)^2, SRCCOLOR / ONE) */
const PF_SQ = 1 << 21;

const PF_STRETCH_U = 1 << 22;
/** flipbook mode bits (2): FrameMode 0 blend, 1 cut, 2 random (shaders.ts flipFrame) */
const PF_FRAMES = 16;
/** bits 18-20: turn of an upright face about the vertical axis (FACE_CODES, shaders.ts faceAngle) */
const PF_FACE = 18;

const FACE_CODES: readonly (readonly number[])[] = [[0], [0], [1, 2], [0, 3, 4]];
/** ParticleSpec.travel: finite-difference step (cycle seconds) of the emitter's segment velocity */
const TRAVEL_DT = 1 / 120;
/** surface record flags: occlude / clamp / flipbook mode bit offsets */
const SF_OCC = 12;
const SF_CLAMP = 16;
const SF_FRAMES = 21;
/** surface bit 23: ElementCommon.square (bits 21-22 are the flipbook mode) */
const SF_SQ = 1 << 23;
/** trail sampling: minimum move (m) before a new point, sub-segment length (m), max sub-segments per frame */
const TRAIL_MIN_STEP = 0.004;
const TRAIL_SEG = 0.1;
const TRAIL_MAX_SUB = 8;
/** trail state floats per element (prev-prev point / base, prev point / base, prev time, prev fade, samples) */
const TS = 16;
/** players count as fed for this long after their last socket update (s) */
const SOCKET_STALE = 0.5;


export function gradeOf(rank: number, awakened = false): Grade {
  if (awakened || rank >= 7) return 3;
  return rank >= 5 ? 2 : rank >= 3 ? 1 : 0;
}

/** rank / caster of a spawn (SpawnOpts.rank / awakened / caster, carried by the VfxSystem Inst) */
export interface SpecMeta {
  rank: number;
  awakened: boolean;
  /** player index whose body sockets anchored elements use (-1 = nearest fed player, else a stand-in body) */
  caster: number;
}

/** one grade variant of a compiled element */
interface CVar {
  el: ElementSpec;
  p: ParticleSpec | null;
  s: SurfaceSpec | null;
  tr: TrailSpec | null;
  row: number;
  /** packed role drawn now (the art role once baked, else the fallback) */
  role: number;
  frames: number;
  /** art key ('' = procedural role): a manifest id, or the frame ids of a list joined (spec/artScope.ts) */
  art: string;
  fallback: number;
  fallbackFrames: number;
  t0: number;
  /** emission end relative to effect start (Infinity = repeats until the effect stops) */
  end: number;
  /** last death relative to effect start (finite part) */
  tail: number;
  add: boolean;
  /** additive element blended in display space (display.ts): drawn into the display batches, after the final composite */
  disp: boolean;
  /** display-space brightness factor applied at emission: the sprite's (artGain.ts) while the element draws its sprite, else 1 */
  gain: number;
  /** the sprite's factor (artGain.ts); 1 outside the display-space layer */
  gainArt: number;
  /** display-space element adds (texel x colour)^2 (ElementCommon.square) */
  sq: boolean;
  /** quantised tone flags (occlude 0..15, clamp 0..31 in 1/8) */
  occQ: number;
  clampQ: number;
  /** screen / upright billboards drawn in front of the floor (ElementCommon.front) */
  front: boolean;
  /** socket id the element is anchored to (attach / from / trail anchor), 0 = none */
  sock: number;
  /** particles / surfaces live in the socket frame (attach: socket); false = born in world (from) */
  sockAttach: boolean;
  /** sizes use the body scale (socket elements, trails on sockets) instead of the area scale */
  body: boolean;
}

interface CEl {
  v: readonly [CVar, CVar, CVar, CVar];
  minTier: TierIdx;
  minRank: number;
  maxRank: number;
  trail: boolean;
  /** 0 = every pulse, 1 = first pulse of a cast only, 2 = later pulses only (ElementCommon.pulse) */
  pulse: number;
}

interface Compiled {
  spec: FxSpec;
  els: CEl[];
  impact: Compiled | null;
  /** finite timeline end (all non-repeating elements dead) */
  end: number;
  /** longest particle/surface/trail-point life (drain time after emission stops) */
  maxLife: number;
  /** some element reads a body socket */
  sockets: boolean;
  /** art keys of every element of the list (and of the impact list), all grade variants */
  art: Set<string>;
  /** the art scope was checked for this spec since the last scope change (play() loads missing art late, once) */
  artChecked: boolean;
}

class SInst {
  active = false;
  /** anchor slot (pool index + 1) */
  slot = 0;
  gen = 0;
  c: Compiled | null = null;
  t = 0;
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  /** area scale (radius / base) × grade scale */
  k = 1;
  /** body scale (grade scale only): socket elements, socket trails */
  kb = 1;
  mirror = 1;
  tx = 0;
  ty = 0;
  tz = 0;
  hasT = false;
  /** emission of repeating elements stops at this effect time */
  until = 0;
  loop = false;
  stopped = false;
  stopT = 0;
  fade = 0.35;
  /** effect time after which every record of this instance is dead */
  drain = 0;
  intensity = 1;
  seed = 0;
  /** tracked player index the origin rides (FxSpec.follow), -1 = static */
  follow = -1;
  /** per-spawn tint (FxSpec.tint) as 0xRRGGBB; white = none */
  tint = 0xffffff;
  rank = 0;
  grade: Grade = 0;
  awakened = false;
  caster = -1;
  /** 0 = first pulse of its cast (FxSpec.castGap), n = n-th later pulse */
  pulse = 0;
  /** socket set read by anchored elements (-1 none); stand-in sets are owned and released with the instance */
  set = -1;
  standIn = false;
  readonly acc = new Float32Array(MAX_EL);
  /** cycle-local time and effect time of the last emitter step (float64: long-running zone loops) */
  readonly cyc = new Float64Array(MAX_EL);
  readonly step = new Float64Array(MAX_EL);
  /** per-element start shift (ParticleSpec.tEnd: caller duration - tEnd), 0 for everything else */
  readonly off = new Float32Array(MAX_EL);
  readonly loops = new Int32Array(MAX_EL);
  readonly next = new Float32Array(MAX_EL);
  readonly done = new Uint8Array(MAX_EL);
  readonly head = new Uint16Array(MAX_EL);
  readonly deaths = new Float32Array(MAX_EL * RING);
  /** trail sampling state per element */
  readonly tr = new Float32Array(MAX_EL * TS);
}








export function particleFlags(bb: 0 | 1 | 2 | 3, attached: boolean, mirror: number): number {
  const texMirror = bb !== 3 && (bb === 0 || bb === 2) !== (mirror < 0);
  return bb | (attached ? 4 : 0) | (texMirror ? 8 : 0);
}

/** per-spawn tint of a spec (0xRRGGBB, white = none): opt-in templates take the palette the caller resolved (explicit
 *  colour, variant suffix or element hint; see VfxSystem.fillCtx), every other spec keeps its authored colours */
export function spawnTint(spec: FxSpec, c: Ctx | null): number {
  if (spec.tint !== true || c === null) return 0xffffff;
  return c.tinted || c.variant >= 0 || (c.element >= 0 && c.element < 8) ? c.pal.main & 0xffffff : 0xffffff;
}

/** the grade variant of an element: base merged with g1..g (cumulative); the base object itself when nothing changes */
export function gradeElement(el: ElementSpec, g: Grade): ElementSpec {
  const gr = el.grade as { g1?: object; g2?: object; g3?: object } | undefined;
  if (gr === undefined || g === 0) return el;
  const parts = [gr.g1, g >= 2 ? gr.g2 : undefined, g >= 3 ? gr.g3 : undefined].filter((x): x is object => x !== undefined);
  if (parts.length === 0) return el;
  return Object.assign({}, el, ...parts) as ElementSpec;
}

/** the LUT content of an element: variants with equal keys share their curve rows */
function lutKey(el: ElementSpec): string {
  if (el.kind === 'particle') return JSON.stringify(['p', el.life, el.scale, el.color, el.gravity, el.air]);
  if (el.kind === 'surface') return JSON.stringify(['s', el.scale, el.color, el.sweep, el.uv, el.move, el.spin]);
  return JSON.stringify(['t', el.taper, el.color]);
}

const q01 = (v: number | undefined, n: number): number => (v === undefined || !(v > 0) ? 0 : Math.max(0, Math.min(n, Math.round(v * n))));

const NO_ART: ReadonlySet<string> = new Set();

export interface SpecStats {
  active: number;
  particles: number;
  surfaces: number;
  drawCalls: number;
  triangles: number;
}

export class SpecHost implements DisplayLayer {
  readonly uniforms: SpecUniforms;
  private readonly atlas: SpecAtlas;
  /** generated sprites (art roles) */
  readonly art: SpecArt;
  private readonly lutData: Uint16Array;
  private readonly lutTex: DataTexture;
  private readonly lutScratch = new Float32Array(LUT_SAMPLES * 4 * 4);
  private lutNext = 0;
  /** lutKey → first LUT row of that curve content (rows are shared by every element with equal curves) */
  private readonly lutRows = new Map<string, number>();
  private lutDirty = false;
  private readonly anchorData = new Float32Array(ANCHORS * ANCHOR_ROWS * 4);
  private readonly anchorTex: DataTexture;
  /** socket sets (sockets.ts layout): world position, blade length, orientation */
  private readonly sock = new Float32Array(SOCKET_SETS * SET_FLOATS);
  /** VFX time each player set was last fed (-∞ = never) */
  private readonly fedAt = new Float64Array(PLAYER_SETS).fill(-1e9);
  private readonly setUsed = new Uint8Array(SOCKET_SETS);
  private readonly compiled = new Map<FxSpec, Compiled>();
  private readonly compiledById = new Map<string, Compiled>();
  /** art keys referenced by compiled specs (preloadArt default) */
  readonly artIds = new Set<string>();
  /** the compiled variants that draw each art key (a blit re-resolves only these) */
  private readonly artUsers = new Map<string, CVar[]>();
  /** where late art comes from (the last preloadArt source) */
  private artSrc: ArtSource | null = null;
  private readonly pAdd: SpecBatch;
  private readonly pAlpha: SpecBatch;
  private readonly sAdd: SpecBatch;
  private readonly sAlpha: SpecBatch;
  /** the additive batches of the display-space layer (display.ts): surfaces, particles (draw order of the overlay) */
  private readonly sAddD: SpecBatch;
  private readonly pAddD: SpecBatch;
  private readonly dispBatches: SpecBatch[];
  /** visibility of the display batches when beginScene hid them (restored by drawOverlay) */
  private readonly dispWas = [false, false];
  /** metres over which a billboard particle of a display-space element fades out in front of the surface it crosses (the floor): 0 = a hard depth cut */
  softDepth = 0.35;
  private dispHidden = false;
  /** runtime switch: false routes display-space elements into the linear batches (A/B comparisons, `space` ignored) */
  displayOn = true;
  private readonly batches: SpecBatch[];
  private readonly insts: SInst[] = [];
  private tier: TierIdx;
  private time = 0;
  /** last spawn per spec + caster of the specs with a castGap (pulse trains) */
  private casts = new Map<string, { t: number; n: number }>();
  private activeN = 0;
  private artVersion = 0;
  private readonly tmp = new Float32Array(12);
  /** tracked player positions (x, y, z per player) for FxSpec.follow; set by the VfxSystem */
  followSrc: { readonly players: Float32Array; readonly playerCount: number } | null = null;

  constructor(
    private readonly scene: Scene,
    renderer: WebGLRenderer,
    timeUniform: { value: number },
    private readonly fx: Fx,
    tier: TierIdx,
    renderOrder: number,
    specs: Iterable<FxSpec>,
  ) {
    this.tier = tier;
    this.atlas = bakeSpecAtlas(renderer);
    this.art = new SpecArt(renderer, tier);
    this.lutData = new Uint16Array(LUT_W * LUT_H * 4);
    this.lutTex = new DataTexture(this.lutData, LUT_W, LUT_H, RGBAFormat, HalfFloatType);
    this.lutTex.minFilter = LinearFilter;
    this.lutTex.magFilter = LinearFilter;
    this.lutTex.generateMipmaps = false;
    this.lutTex.needsUpdate = true;
    // slot 0 = identity anchor (alpha 1, white tint); instance i uses slot i + 1. Row 1 = (alpha, tint r, g, b)
    this.anchorData.fill(1, ANCHORS * 4, ANCHORS * 4 + 4);
    // sockets start as identity frames at the origin
    for (let i = 0; i < SOCKET_SETS * SOCKETS_PER_SET; i++) this.sock[i * SOCKET_STRIDE + 7] = 1;
    this.anchorTex = new DataTexture(this.anchorData, ANCHORS, ANCHOR_ROWS, RGBAFormat, FloatType);
    this.anchorTex.minFilter = NearestFilter;
    this.anchorTex.magFilter = NearestFilter;
    this.anchorTex.generateMipmaps = false;
    this.anchorTex.needsUpdate = true;
    this.uniforms = {
      uTime: timeUniform,
      uLut: { value: this.lutTex },
      uAnchors: { value: this.anchorTex },
      uSpecAtlas: { value: this.atlas.texture },
      uSpecArt: { value: this.art.texture },
      uArtGrid: { value: this.art.grid },
      uOverlay: { value: 0 },
      uDepthOn: { value: 0 },
      uSceneDepth: { value: null },
      uInvRes: { value: { x: 1, y: 1 } },
      uSoftZ: { value: { x: 0.5, y: 220, z: 0 } },
    };
    const cap = CAPS[3] as readonly [number, number, number, number];
    this.pAdd = new SpecBatch(cap[0], 'add', false, this.uniforms);
    this.pAlpha = new SpecBatch(cap[1], 'alpha', false, this.uniforms);
    this.sAdd = new SpecBatch(cap[2], 'add', true, this.uniforms);
    this.sAlpha = new SpecBatch(cap[3], 'alpha', true, this.uniforms);
    this.pAddD = new SpecBatch(cap[0], 'add', false, this.uniforms, true);
    this.sAddD = new SpecBatch(cap[2], 'add', true, this.uniforms, true);
    // draw order: alpha surfaces, add surfaces, alpha particles, add particles (after the core batches, before the flash).
    // The display-space batches take the add slots in the scene pass only when no post pipeline draws them as an overlay
    this.sAlpha.mesh.renderOrder = renderOrder;
    this.sAdd.mesh.renderOrder = renderOrder + 1;
    this.sAddD.mesh.renderOrder = renderOrder + 1;
    this.pAlpha.mesh.renderOrder = renderOrder + 2;
    this.pAdd.mesh.renderOrder = renderOrder + 3;
    this.pAddD.mesh.renderOrder = renderOrder + 3;
    this.dispBatches = [this.sAddD, this.pAddD];
    this.batches = [this.sAlpha, this.sAdd, this.pAlpha, this.pAdd, this.sAddD, this.pAddD];
    for (const b of this.batches) scene.add(b.mesh);
    setDisplayLayer(this);
    for (let i = 0; i < ANCHORS - 1; i++) {
      const s = new SInst();
      s.slot = i + 1;
      this.insts.push(s);
    }
    this.setTier(tier);
    for (const s of specs) this.compile(s);
  }

  setTier(t: TierIdx): void {
    this.tier = t;
    const c = CAPS[t] as readonly [number, number, number, number];
    this.pAdd.setCap(c[0]);
    this.pAlpha.setCap(c[1]);
    this.sAdd.setCap(c[2]);
    this.sAlpha.setCap(c[3]);
    this.pAddD.setCap(c[0]);
    this.sAddD.setCap(c[2]);
    this.art.setTier(t);
    this.syncArt();
  }

  // ------------------------------------------------------------------ art (generated sprites)

  /**
   * Loads the generated sprites through `src` and packs them into the art atlas. Await it while the loading screen is up
   * (no pop-in); missing ids warn once and keep their fallback role.
   *  - no `specs`: every sprite any compiled spec references, at the tier's full cell size, added to what is loaded
   *    (galleries, compare strips: they show every preset);
   *  - `specs` (preset ids, see artScope.ts runSpecIds): THIS RUN's scope. Only the sprites of those specs are packed, the
   *    previous run's leave the array, and the cell shrinks until the array fits ART_RUN_BUDGET_MB[tier]. A spec outside
   *    the scope that still plays (a dev grant, an unforeseen path) loads its art late, once (ensureArt).
   */
  async preloadArt(src: ArtSource, specs?: Iterable<string>, tiers?: RunArtTiers): Promise<void> {
    this.artSrc = src;
    if (specs === undefined) {
      this.art.setBudget(null);
      await this.art.preload(src, this.artIds);
    } else {
      const keys = new Set<string>();
      for (const id of specs) for (const k of this.artOf(id)) keys.add(k);
      this.art.setBudget(ART_RUN_BUDGET_MB);
      await this.art.preload(src, keys, true, tiers === undefined ? undefined : this.artPlan(keys, tiers));
    }
    for (const c of this.compiled.values()) c.artChecked = c.art.size === 0;
    this.syncArt();
  }

  /**
   * Splits the scope's keys by tier (artTier.ts). NOW awaits the base-grade art of the NOW specs; everything else streams
   * after the first seconds, in the order: the NOW specs' higher grades, SOON specs, LATE specs.
   */
  private artPlan(scope: ReadonlySet<string>, tiers: RunArtTiers): ArtPlan {
    const now = new Set<string>();
    for (const id of tiers.now) for (const k of this.artBase(id)) now.add(k);
    const later: string[] = [];
    const seen = new Set<string>();
    const push = (k: string): void => {
      if (now.has(k) || seen.has(k) || !scope.has(k)) return;
      seen.add(k);
      later.push(k);
    };
    for (const list of [tiers.now, tiers.soon, tiers.late]) for (const id of list) for (const k of this.artOf(id)) push(k);
    return { now, later, after: ART_STREAM_AFTER_S };
  }

  /** the art keys of the base grade of the compiled spec `id` (the grade variants of ranks 3+ draw more, see artOf) */
  private artBase(id: string): ReadonlySet<string> {
    const c = this.compiledById.get(id);
    if (c === undefined) return NO_ART;
    const out = new Set<string>();
    for (const list of [c, c.impact]) {
      if (list) for (const ce of list.els) if (ce.v[0].art !== '') out.add(ce.v[0].art);
    }
    return out;
  }

  /** the art keys of the compiled spec preset `id` (empty for unknown ids and specs without art) */
  artOf(id: string): ReadonlySet<string> {
    return this.compiledById.get(id)?.art ?? NO_ART;
  }

  /** the last art bake: layers, layer edge, cell edge, VRAM bytes, ms */
  artStats(): ArtStats {
    return this.art.stats;
  }

  /** what the background art stream did (slices, ms, demanded keys), refreshed */
  artStream(): ArtStream {
    return this.art.streamStats();
  }

  /** first play of a spec after a scope change: art outside the scope loads in the background (this cast draws the
   *  fallback roles, later ones the sprites), so a dev grant or an unforeseen skill never stays procedural */
  private ensureArt(c: Compiled): void {
    c.artChecked = true;
    const src = this.artSrc;
    if (src === null) return;
    const need: string[] = [];
    for (const k of c.art) {
      if (!this.art.covers(k)) need.push(k);
      else this.art.request(k); // a staged scope: the stream has not reached this key yet, fetch it now (once)
    }
    if (need.length === 0) return;
    console.info(`[vfx] ${c.spec.id}: art outside the run's scope, loading late (${need.join(', ')})`);
    void this.art.preload(src, need).then(() => this.syncArt());
  }

  /** re-resolves element roles after an art bake (also on tier changes) or after the stream blitted sprites (their users only) */
  private syncArt(): void {
    if (this.artVersion === this.art.version) return;
    this.artVersion = this.art.version;
    this.uniforms.uSpecArt.value = this.art.texture;
    this.uniforms.uArtGrid.value = this.art.grid;
    const changed = this.art.takeChanged();
    if (changed !== null) {
      for (const k of changed) for (const cv of this.artUsers.get(k) ?? []) this.resolveArt(cv);
      return;
    }
    for (const c of this.compiled.values()) {
      for (const list of [c, c.impact]) {
        if (!list) continue;
        for (const ce of list.els) for (const cv of ce.v) this.resolveArt(cv);
      }
    }
  }

  private resolveArt(cv: CVar): void {
    if (cv.art === '') return;
    const r = this.art.role(cv.art, false);
    cv.role = r ? r.packed : cv.fallback;
    cv.frames = r ? r.frames : cv.fallbackFrames;
    
    cv.gain = r ? cv.gainArt : 1;
  }

  // ------------------------------------------------------------------ sockets

  /** body sockets of player `player` (0..3): 6 sockets in SOCKET_ID order × 8 floats (sockets.ts), world space */
  setSockets(player: number, data: ArrayLike<number>, offset = 0): void {
    if (player < 0 || player >= PLAYER_SETS) return;
    const o = player * SET_FLOATS;
    for (let i = SOCKET_STRIDE; i < SET_FLOATS; i++) this.sock[o + i] = data[offset + i] as number;
    this.fedAt[player] = this.time;
  }

  /** stand-in body for player `player` (compare strips: a caster without a skinned hero), `t` s into its swing (with a `pose`: into the pose clip) */
  standInFor(player: number, x: number, y: number, z: number, yaw: number, t: number, mirror = 1, swing?: StandInSwing, pose?: StandInPose): void {
    if (player < 0 || player >= PLAYER_SETS) return;
    standInSockets(this.sock, player * SET_FLOATS, x, y, z, yaw, t, mirror, swing, pose);
    this.fedAt[player] = this.time;
  }

  /** world position (3) + orientation (4) of socket `id` of set `set` into this.tmp[0..6] */
  private socketFrame(set: number, id: number): Float32Array {
    const o = set * SET_FLOATS + id * SOCKET_STRIDE;
    const t = this.tmp;
    for (let i = 0; i < 3; i++) t[i] = this.sock[o + i] as number;
    for (let i = 0; i < 4; i++) t[3 + i] = this.sock[o + 4 + i] as number;
    return t;
  }

  private pickSet(s: SInst): number {
    const now = this.time;
    const fed = (p: number): boolean => now - (this.fedAt[p] as number) < SOCKET_STALE;
    if (s.caster >= 0 && s.caster < PLAYER_SETS && fed(s.caster)) return s.caster;
    // no (fed) caster given: the nearest fed hero within 12 m (sky strikes land ~10 m out), else a stand-in body
    let best = -1;
    let bd = 144;
    for (let p = 0; p < PLAYER_SETS; p++) {
      if (!fed(p)) continue;
      const o = p * SET_FLOATS + SOCKET_ID.root * SOCKET_STRIDE;
      const d = ((this.sock[o] as number) - s.x) ** 2 + ((this.sock[o + 2] as number) - s.z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ compile (curves → LUT rows)

  /** compiles once; a broken spec (bad role, LUT full, …) is logged and compiles to nothing so it can never take the
   *  VFX system down (one draft must not break every gallery / game boot) */
  private compile(spec: FxSpec): Compiled {
    const hit = this.compiled.get(spec);
    if (hit) return hit;
    let c: Compiled;
    try {
      c = this.compileList(spec, spec.elements ?? []);
      if (spec.impact && spec.impact.length > 0) {
        c.impact = this.compileList(spec, spec.impact);
        c.sockets = c.sockets || c.impact.sockets;
        for (const k of c.impact.art) c.art.add(k);
        c.artChecked = c.art.size === 0;
      }
    } catch (err) {
      console.error(`spec ${spec.id}: not compiled (${err instanceof Error ? err.message : String(err)})`);
      c = { spec, els: [], impact: null, end: 0, maxLife: 0, sockets: false, art: new Set(), artChecked: true };
    }
    this.compiled.set(spec, c);
    if (!this.compiledById.has(spec.id)) this.compiledById.set(spec.id, c);
    return c;
  }

  private bakeRows(el: ElementSpec): number {
    const rows = elementRows(el);
    if (this.lutNext + rows > LUT_ROWS) throw new Error(`spec LUT full (${LUT_ROWS} rows)`);
    const row = this.lutNext;
    this.lutNext += rows;
    const scratch = this.lutScratch;
    if (el.kind === 'particle') bakeParticle(el, scratch, 0);
    else if (el.kind === 'surface') bakeSurface(el, scratch, 0);
    else bakeTrail(el, scratch, 0);
    const base = row * LUT_SAMPLES * 4;
    for (let i = 0; i < rows * LUT_SAMPLES * 4; i++) this.lutData[base + i] = DataUtils.toHalfFloat(scratch[i] as number);
    this.lutDirty = true;
    return row;
  }

  private compileVar(spec: FxSpec, el: ElementSpec, row: number): CVar {
    const tex: TexSrc = el.tex;
    const art = typeof tex === 'string' ? '' : artKey(tex.art);
    const fbRole = ROLES[typeof tex === 'string' ? tex : (tex.fallback ?? 'glow')];
    if (art !== '' && typeof tex !== 'string') {
      this.artIds.add(art);
      this.art.hint(tex);
    }
    const t0 = el.t0 ?? 0;
    let end: number;
    let tail: number;
    let sock = 0;
    let sockAttach = false;
    if (el.kind === 'particle') {
      const life = curveMax(el.life, 0.5);
      const loops = el.loops ?? 1;
      end = loops === 0 ? Infinity : t0 + el.cycle * Math.max(1, loops);
      tail = (loops === 0 ? t0 + el.cycle : end) + life;
      if (isSocket(el.attach)) {
        sock = SOCKET_ID[el.attach];
        sockAttach = true;
      } else if (isSocket(el.from)) sock = SOCKET_ID[el.from];
    } else if (el.kind === 'surface') {
      end = el.loop ? Infinity : t0 + el.life;
      tail = t0 + el.life;
      if (isSocket(el.attach)) {
        sock = SOCKET_ID[el.attach];
        sockAttach = true;
      }
    } else {
      end = el.dur !== undefined && el.dur > 0 ? t0 + el.dur : Infinity;
      tail = (end === Infinity ? t0 : end) + el.life;
      if (isSocket(el.attach)) sock = SOCKET_ID[el.attach];
    }
    const add = el.blend === 'add';
    const cv: CVar = {
      el,
      p: el.kind === 'particle' ? el : null,
      s: el.kind === 'surface' ? el : null,
      tr: el.kind === 'trail' ? el : null,
      row,
      role: packRole(fbRole),
      frames: fbRole.frames,
      art,
      fallback: packRole(fbRole),
      fallbackFrames: fbRole.frames,
      t0,
      end,
      tail,
      add,
      disp: add && resolveSpace(spec, el) === 'display',
      gain: 1,
      gainArt: add && spec.artGain !== false && resolveSpace(spec, el) === 'display' ? artGain(art) : 1,
      sq: add && el.square === true && resolveSpace(spec, el) === 'display',
      occQ: add ? q01(el.occlude ?? spec.occlude, 15) : 0,
      clampQ: Math.min(31, q01(el.clamp ?? spec.clamp, 8)),
      front: el.front === true,
      sock,
      sockAttach,
      body: sock > 0 && el.areaScale !== true,
    };
    if (art !== '') {
      const users = this.artUsers.get(art);
      if (users) users.push(cv);
      else this.artUsers.set(art, [cv]);
    }
    this.resolveArt(cv);
    return cv;
  }

  private compileList(spec: FxSpec, list: readonly ElementSpec[]): Compiled {
    const els: CEl[] = [];
    const artKeys = new Set<string>();
    let end = 0;
    let maxLife = 0;
    let sockets = false;
    if (list.length > MAX_EL) console.warn(`[vfx] ${spec.id}: ${list.length} elements, the host compiles ${MAX_EL}: the rest is dropped`);
    for (const raw of list.slice(0, MAX_EL)) {
      const vars: CVar[] = [];
      const keys: string[] = [];
      for (let g = 0; g < 4; g++) {
        const merged = gradeElement(raw, g as Grade);
        if (g > 0 && merged === raw) {
          vars.push(vars[0] as CVar);
          keys.push(keys[0] as string);
          continue;
        }
        const el = withDefaults(merged);
        const key = lutKey(el);
        const same = keys.indexOf(key);
        // equal curve content shares its rows host-wide (families repeat the same fade / size curves across elements and specs)
        let row = same >= 0 ? (vars[same] as CVar).row : this.lutRows.get(key);
        if (row === undefined) {
          row = this.bakeRows(el);
          this.lutRows.set(key, row);
        }
        const cv = this.compileVar(spec, el, row);
        if (cv.art !== '') artKeys.add(cv.art);
        vars.push(cv);
        keys.push(key);
        const life = el.kind === 'particle' ? curveMax(el.life, 0.5) : el.life;
        maxLife = Math.max(maxLife, life);
        end = Math.max(end, cv.tail);
        if (cv.sock > 0) sockets = true;
      }
      els.push({
        v: vars as unknown as readonly [CVar, CVar, CVar, CVar],
        minTier: raw.minTier ?? 0,
        minRank: raw.minRank ?? 0,
        maxRank: raw.maxRank ?? 7,
        trail: raw.kind === 'trail',
        pulse: raw.pulse === 'first' ? 1 : raw.pulse === 'later' ? 2 : 0,
      });
    }
    return { spec, els, impact: null, end, maxLife, sockets, art: artKeys, artChecked: artKeys.size === 0 };
  }

  // ------------------------------------------------------------------ instances

  /** starts an effect; returns a handle (> 0) or 0 when the pool is full */
  play(spec: FxSpec, c: Ctx, loop: boolean, meta?: SpecMeta | null): number {
    const comp = this.compile(spec);
    if (!comp.artChecked) this.ensureArt(comp);
    return this.start(comp, c.x, c.y + (spec.lift ?? 0), c.z, c.rot, c.scale, c.b < 0 ? -1 : 1, c, loop, c.duration, spawnTint(spec, c), meta ?? null);
  }

  private start(comp: Compiled, x: number, y: number, z: number, yaw: number, k: number, mirror: number, c: Ctx | null, loop: boolean, duration: number, tint: number, meta: SpecMeta | null): number {
    let idx = -1;
    for (let i = 0; i < this.insts.length; i++) {
      if (!(this.insts[i] as SInst).active) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return 0;
    const s = this.insts[idx] as SInst;
    s.active = true;
    s.gen = (s.gen + 1) & 0x7fffff;
    s.c = comp;
    s.t = 0;
    s.x = x;
    s.y = y;
    s.z = z;
    s.yaw = yaw;
    s.rank = meta && Number.isFinite(meta.rank) ? Math.max(0, Math.min(7, Math.round(meta.rank))) : 0;
    s.awakened = meta?.awakened === true;
    s.grade = gradeOf(s.rank, s.awakened);
    if (s.awakened) s.rank = 7;
    s.caster = meta && Number.isFinite(meta.caster) ? meta.caster : -1;
    s.pulse = 0;
    const gap = comp.spec.castGap ?? 0;
    if (gap > 0) {
      const key = comp.spec.id + '|' + s.caster;
      const last = this.casts.get(key);
      if (last && this.time - last.t < gap && this.time >= last.t) s.pulse = last.n + 1;
      this.casts.set(key, { t: this.time, n: s.pulse });
    }
    const gs = comp.spec.gradeScale?.[s.grade] ?? 1;
    s.kb = gs > 0 ? gs : 1;
    s.k = k * s.kb;
    s.mirror = mirror;
    s.loop = loop;
    s.stopped = false;
    s.stopT = 0;
    s.fade = comp.spec.fadeOut ?? 0.35;
    s.intensity = c?.intensity ?? 1;
    s.seed = c?.seed ?? this.fx.rng.f();
    s.hasT = c?.hasTarget ?? false;
    s.tx = c?.tx ?? x;
    s.ty = c ? (c.hasTarget ? c.ty : y) : y;
    s.tz = c?.tz ?? z;
    s.tint = tint;
    // repeating elements of one-shots run for the caller's duration (buffs) or the spec default
    s.until = loop ? Infinity : duration > 0 ? duration : comp.spec.dur;
    s.drain = loop ? Infinity : Math.max(comp.end, s.until + comp.maxLife);
    s.acc.fill(0);
    s.cyc.fill(0);
    s.next.fill(0);
    s.done.fill(0);
    s.head.fill(0);
    s.deaths.fill(-1);
    s.tr.fill(0);
    for (let e = 0; e < comp.els.length; e++) {
      const cv = (comp.els[e] as CEl).v[s.grade];
      s.loops[e] = cv.p?.loops ?? 1;
      // tEnd: the element starts at (caller duration - tEnd) + t0, e.g. a dash strike at the arrival whatever the range
      const off = cv.p?.tEnd !== undefined && !loop ? Math.max(0, s.until - cv.p.tEnd) : 0;
      s.off[e] = off;
      s.step[e] = cv.t0 + off;
    }
    s.follow = -1;
    const src = this.followSrc;
    if (comp.spec.follow === true && src && c !== null) {
      if (s.caster >= 0 && s.caster < src.playerCount) {
        s.follow = s.caster;
      } else {
        let best = 4;
        for (let p = 0; p < src.playerCount; p++) {
          const d2 = ((src.players[p * 3] as number) - x) ** 2 + ((src.players[p * 3 + 2] as number) - z) ** 2;
          if (d2 < best) {
            best = d2;
            s.follow = p;
          }
        }
      }
    }
    // body sockets: the caster's (fed by the render world) or a private stand-in body (galleries)
    s.set = -1;
    s.standIn = false;
    if (comp.sockets) {
      s.set = this.pickSet(s);
      if (s.set < 0) {
        for (let k2 = PLAYER_SETS; k2 < SOCKET_SETS; k2++) {
          if (this.setUsed[k2] === 0) {
            this.setUsed[k2] = 1;
            s.set = k2;
            s.standIn = true;
            this.updateStandIn(s);
            break;
          }
        }
      }
    }
    this.activeN++;
    this.writeAnchor(idx, s, 1);
    // tint (sRGB 0..1, multiplies the colour curves in both vertex shaders): constant for the instance's life
    const o = ANCHORS * 4 + (idx + 1) * 4;
    this.anchorData[o + 1] = ((tint >> 16) & 255) / 255;
    this.anchorData[o + 2] = ((tint >> 8) & 255) / 255;
    this.anchorData[o + 3] = (tint & 255) / 255;
    return (s.gen << 8) | (idx + 1);
  }

  private updateStandIn(s: SInst): void {
    const lift = s.c?.spec.lift ?? 0;
    standInSockets(this.sock, s.set * SET_FLOATS, s.x, s.y - lift, s.z, s.yaw, s.t, s.mirror, s.c?.spec.demo?.swing);
  }

  private get(handle: number): SInst | null {
    const idx = (handle & 255) - 1;
    const s = this.insts[idx];
    return s && s.active && s.gen === handle >>> 8 ? s : null;
  }

  /** true while the effect behind `handle` still has live records */
  alive(handle: number): boolean {
    return this.get(handle) !== null;
  }

  move(handle: number, x: number, y: number, z: number, dirX: number, dirZ: number): void {
    const s = this.get(handle);
    if (!s || s.stopped) return;
    s.x = x;
    s.y = y + (s.c?.spec.lift ?? 0);
    s.z = z;
    if (dirX * dirX + dirZ * dirZ > 1e-8) s.yaw = Math.atan2(dirX, dirZ);
  }

  setTarget(handle: number, tx: number, ty: number, tz: number): void {
    const s = this.get(handle);
    if (!s) return;
    s.tx = tx;
    s.ty = ty;
    s.tz = tz;
    s.hasT = true;
  }

  /** graceful end: emission stops, the anchor fades, the impact list plays at the last position */
  stop(handle: number): void {
    const s = this.get(handle);
    if (!s || s.stopped) return;
    s.stopped = true;
    s.stopT = s.t;
    s.until = Math.min(s.until, s.t);
    s.drain = s.t + Math.max(s.fade, s.c ? s.c.maxLife : 0);
    const imp = s.c?.impact;
    if (imp) {
      const meta: SpecMeta = { rank: s.rank, awakened: s.awakened, caster: s.caster };
      this.start(imp, s.x, s.c?.spec.impactGround ? this.fx.heightAt(s.x, s.z) : s.y, s.z, s.yaw, s.k / s.kb, s.mirror, null, false, 0, s.tint, meta);
    }
  }

  private writeAnchor(idx: number, s: SInst, alpha: number): void {
    const a = this.anchorData;
    const o = (idx + 1) * 4;
    a[o] = s.x;
    a[o + 1] = s.y;
    a[o + 2] = s.z;
    a[o + 3] = s.yaw;
    a[ANCHORS * 4 + o] = alpha;
  }

  /** copies the socket sets into anchor rows 2 (position, blade length) and 3 (quaternion) */
  private uploadSockets(): void {
    const a = this.anchorData;
    const r2 = ANCHORS * 2 * 4, r3 = ANCHORS * 3 * 4;
    const n = SOCKET_SETS * SOCKETS_PER_SET;
    for (let i = 0; i < n; i++) {
      const o = i * SOCKET_STRIDE;
      a[r2 + i * 4] = this.sock[o] as number;
      a[r2 + i * 4 + 1] = this.sock[o + 1] as number;
      a[r2 + i * 4 + 2] = this.sock[o + 2] as number;
      a[r2 + i * 4 + 3] = this.sock[o + 3] as number;
      a[r3 + i * 4] = this.sock[o + 4] as number;
      a[r3 + i * 4 + 1] = this.sock[o + 5] as number;
      a[r3 + i * 4 + 2] = this.sock[o + 6] as number;
      a[r3 + i * 4 + 3] = this.sock[o + 7] as number;
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const fx = this.fx;
    this.time = fx.time;
    if (this.lutDirty) {
      this.lutTex.needsUpdate = true;
      this.lutDirty = false;
    }
    this.art.pump(dt);
    this.syncArt();
    if (dt > 0 && this.activeN > 0) {
      for (let i = 0; i < this.insts.length; i++) {
        const s = this.insts[i] as SInst;
        if (!s.active) continue;
        s.t += dt;
        if (s.follow >= 0 && this.followSrc) {
          const pl = this.followSrc.players, o = s.follow * 3;
          s.x = pl[o] as number;
          s.z = pl[o + 2] as number;
          // never below the ground under the player (galleries / menus feed y = 0)
          s.y = Math.max(pl[o + 1] as number, fx.heightAt(s.x, s.z)) + (s.c?.spec.lift ?? 0);
        }
        if (s.standIn) this.updateStandIn(s);
        this.emit(s);
        this.sampleTrails(s);
        let alpha = 1;
        if (s.stopped) alpha = Math.max(0, 1 - (s.t - s.stopT) / Math.max(0.01, s.fade));
        this.writeAnchor(i, s, alpha > 0 ? alpha : 0.0001);
        if (s.t >= s.drain) {
          s.active = false;
          s.c = null;
          if (s.standIn && s.set >= 0) this.setUsed[s.set] = 0;
          s.standIn = false;
          s.set = -1;
          this.anchorData[ANCHORS * 4 + (i + 1) * 4] = 0;
          this.activeN--;
        }
      }
    }
    this.uploadSockets();
    this.anchorTex.needsUpdate = true;
    const now = this.time;
    for (const b of this.batches) b.flush(now);
  }

  /** the particle batch an element writes into: alpha, additive (linear light) or additive display space */
  private pickP(cv: CVar): SpecBatch {
    return cv.add ? (cv.disp && this.displayOn ? this.pAddD : this.pAdd) : this.pAlpha;
  }

  private pickS(cv: CVar): SpecBatch {
    return cv.add ? (cv.disp && this.displayOn ? this.sAddD : this.sAdd) : this.sAlpha;
  }

  // ------------------------------------------------------------------ display-space layer (display.ts)

  beginScene(): boolean {
    for (let i = 0; i < 2; i++) {
      const m = (this.dispBatches[i] as SpecBatch).mesh;
      this.dispWas[i] = m.visible;
      m.visible = false;
    }
    this.dispHidden = true;
    return (this.dispWas[0] as boolean) || (this.dispWas[1] as boolean);
  }

  drawOverlay(renderer: WebGLRenderer, camera: Camera, sceneDepth: Texture | null, width: number, height: number): void {
    if (!this.dispHidden) return;
    this.dispHidden = false;
    const u = this.uniforms;
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    u.uOverlay.value = 1;
    u.uDepthOn.value = sceneDepth ? 1 : 0;
    u.uSceneDepth.value = sceneDepth;
    u.uInvRes.value.x = 1 / Math.max(1, width);
    u.uInvRes.value.y = 1 / Math.max(1, height);
    const pc = camera as { isPerspectiveCamera?: boolean; near?: number; far?: number };
    u.uSoftZ.value.x = pc.near ?? 0.5;
    u.uSoftZ.value.y = pc.far ?? 220;
    u.uSoftZ.value.z = pc.isPerspectiveCamera ? this.softDepth : 0;
    try {
      for (let i = 0; i < 2; i++) {
        const m = (this.dispBatches[i] as SpecBatch).mesh;
        if (this.dispWas[i]) {
          m.visible = true;
          renderer.render(m, camera);
        }
        m.visible = this.dispWas[i] as boolean;
      }
    } finally {
      u.uOverlay.value = 0;
      u.uDepthOn.value = 0;
      u.uSceneDepth.value = null;
      renderer.autoClear = prevAuto;
    }
  }

  private emit(s: SInst): void {
    const comp = s.c as Compiled;
    const t1 = s.t;
    for (let e = 0; e < comp.els.length; e++) {
      const ce = comp.els[e] as CEl;
      if (ce.trail || ce.minTier > this.tier || s.done[e] === 1 || s.rank < ce.minRank || s.rank > ce.maxRank) continue;
      if (ce.pulse !== 0 && (ce.pulse === 1) !== (s.pulse === 0)) continue;
      const cv = ce.v[s.grade];
      const off = s.off[e] as number;
      if (t1 < cv.t0 + off) continue;
      const endE = cv.end + off;
      const stopAt = Math.min(endE, endE === Infinity ? s.until : Infinity);
      if (cv.p) this.emitParticles(s, e, cv, cv.p, Math.min(t1, stopAt));
      else if (cv.s) this.emitSurfaces(s, e, cv, cv.s, Math.min(t1, stopAt));
      if (t1 >= stopAt) s.done[e] = 1;
    }
  }

  





  private emitParticles(s: SInst, e: number, cv: CVar, p: ParticleSpec, b: number): void {
    let g = s.step[e] as number;
    while (g + EMIT_STEP <= b + 1e-6 && s.done[e] === 0) {
      this.emitStep(s, e, cv, p, g);
      g += EMIT_STEP;
    }
    s.step[e] = g;
  }

  /** one emitter step [a, a + EMIT_STEP] (effect time): curves sampled at the step's end, births spread across it */
  private emitStep(s: SInst, e: number, cv: CVar, p: ParticleSpec, a: number): void {
    const fx = this.fx;
    const dt = EMIT_STEP;
    // cycle-local time (emitter curves); cycles repeat while loops remain
    let cyc = (s.cyc[e] as number) + dt;
    if (cyc >= p.cycle) {
      const left = s.loops[e] as number;
      if (left === 0 || left > 1) {
        cyc -= p.cycle * Math.floor(cyc / p.cycle);
        if (left > 1) s.loops[e] = left - 1;
      } else {
        s.done[e] = 1;
        return;
      }
    }
    s.cyc[e] = cyc;
    const dens = fx.density;
    const rate = Math.max(0, evalCurve(p.rate, cyc)) * dens;
    let acc = (s.acc[e] as number) + rate * dt;
    const n = Math.floor(acc);
    acc -= n;
    s.acc[e] = acc;
    if (n <= 0) return;
    const maxAlive = Math.max(1, Math.min(RING, Math.round(p.max * Math.max(dens, 0.25))));
    const now = this.time;
    const ring = e * RING;
    const batch = this.pickP(cv);
    const rng = fx.rng;
    // socket elements live at body scale and follow the real body (no swing mirroring)
    const sockOk = cv.sock > 0 && s.set >= 0;
    const k = cv.body ? s.kb : s.k;
    const m = sockOk ? 1 : s.mirror;
    const sockAtt = sockOk && cv.sockAttach;
    const sockFrom = sockOk && !cv.sockAttach;
    // `travel` (flight legs of line effects): the emitter itself moves origin -> target, so the particles are born in the world
    // (`attach: true` then means "rides the emitter": the segment velocity is added below)
    const trav = p.travel !== undefined && s.hasT && !sockOk;
    const attached = (p.attach === true && !trav) || sockAtt;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const life = Math.max(0.01, evalCurve(p.life, cyc, 0.5));
    const vel = evalCurve(p.vel, cyc, 0);
    const dX = evalCurve(p.dir?.x, cyc, 0), dY = evalCurve(p.dir?.y, cyc, 0), dZ = evalCurve(p.dir?.z, cyc, 0);
    const h = p.half;
    const hx = (typeof h[0] === 'number' ? evalCurve(h as readonly number[], cyc, 0.5) : evalCurve(h[0] as readonly number[], cyc, 0.5)) * k;
    const hy = (typeof h[0] === 'number' ? hx / k : evalCurve(h[1] as readonly number[], cyc, 0.5)) * k;
    const swirl = p.swirl ? evalCurve(p.swirl, cyc, 0) * 60 * DEG * m : 0;
    const esize = p.shape?.size ? evalCurve(p.shape.size, cyc, 0) : 0;
    const px = (p.at?.[0] ?? 0) + evalCurve(p.path?.x, cyc, 0);
    const py = (p.at?.[1] ?? 0) + evalCurve(p.path?.y, cyc, 0);
    const pz = (p.at?.[2] ?? 0) + evalCurve(p.path?.z, cyc, 0);
    const bb = p.billboard === 'screen' ? 0 : p.billboard === 'ground' ? 1 : p.billboard === 'upright' ? 2 : 3;
    
    // flipbook: generated art hard-cuts by default, procedural roles cross-fade (frameModeBits); the mode of what is drawn NOW
    const fmode = frameModeBits(p.frames?.mode, cv.role >= ART_ROLE_BASE);
    const faceCodes = FACE_CODES[bb === 2 ? Math.max(1, Math.min(3, p.faces ?? 1)) : 1] as readonly number[];
    const flags = particleFlags(bb, attached, m) | (cv.occQ << PF_OCC) | (cv.clampQ << PF_CLAMP) | (cv.front && (bb === 0 || bb === 2) ? PF_FRONT : 0) | (fmode << PF_FRAMES) | (cv.sq ? PF_SQ : 0) | (bb === 3 && p.stretchU === true ? PF_STRETCH_U : 0);
    const bright = (p.bright ?? 1) * s.intensity * cv.gain;
    const fps = p.frames?.fps ?? 0;
    const sockTexel = sockOk ? s.set * SOCKETS_PER_SET + cv.sock : 0;
    const anchor = s.slot + (sockAtt ? 256 * sockTexel : 0);
    // `from`: the emitter frame is the socket's current world frame
    let sfx = 0, sfy = 0, sfz = 0, sYaw = 0;
    let sq: Float32Array | null = null;
    if (sockFrom) {
      const f = this.socketFrame(s.set, cv.sock);
      sfx = f[0] as number;
      sfy = f[1] as number;
      sfz = f[2] as number;
      sq = f;
      sYaw = quatYaw(f, 3);
    }
    const tv = this.tmp;
    for (let i = 0; i < n; i++) {
      
      const hd = s.head[e] as number;
      if ((s.deaths[ring + hd] as number) > now) break;
      if (fx.budget <= 0) {
        fx.dropped++;
        continue;
      }
      fx.budget--;
      fx.spawned++;
      // exact birth inside this frame's emission window [a, b] (effect time) → batch clock
      const birth = now - (s.t - (a + dt * (i + 0.5) / n));
      s.deaths[ring + hd] = birth + life;
      s.head[e] = (hd + 1) % maxAlive;
      // shape sample (local, metres)
      let ox = 0, oy = 0, oz = 0;
      const sh = p.shape;
      if (sh && sh.kind !== 'point') {
        if (sh.kind === 'box') {
          const bx = sh.box ?? [0, 0, 0];
          ox = rng.s2((bx[0] as number) * 0.5) + esize;
          oy = rng.s2((bx[1] as number) * 0.5) + esize;
          oz = rng.s2((bx[2] as number) * 0.5) + esize;
        } else {
          let ux = rng.s2(1), uy = sh.kind === 'sphere' ? rng.s2(1) : 0, uz = rng.s2(1);
          const l = Math.hypot(ux, uy, uz) || 1;
          const rr = (sh.edge ? (sh.radius ?? 0) : rng.f() * (sh.radius ?? 0)) + esize;
          ux *= rr / l;
          uy *= rr / l;
          uz *= rr / l;
          ox = ux;
          oy = uy;
          oz = uz;
        }
      }
      
      let vx = dX, vy = dY, vz = dZ;
      if (p.adv === 'outer' || p.adv === 'inner') {
        const sg = p.adv === 'outer' ? 100 : -100;
        if (!sh || sh.kind === 'point') {
          if (p.adv === 'outer') {
            vx += rng.s2(100);
            vy += rng.s2(100);
            vz += rng.s2(100);
          }
        } else {
          const l = Math.hypot(ox, oy, oz) || 1;
          vx += (ox / l) * sg;
          vy += (oy / l) * sg;
          vz += (oz / l) * sg;
        }
      }
      const j = p.jitter;
      if (j) {
        if (j[0] > 0) vx += rng.s2(j[0] * 0.5) * 1000;
        if (j[1] > 0) vy += rng.s2(j[1] * 0.5) * 1000;
        if (j[2] > 0) vz += rng.s2(j[2] * 0.5) * 1000;
      }
      vx *= vel * k;
      vy *= vel * k;
      vz *= vel * k;
      // placement + mirror + effect frame
      const lx = (px + ox) * k * m, ly = (py + oy) * k, lz = (pz + oz) * k;
      const cx = px * k * m, cyy = py * k, cz = pz * k;
      vx *= m;
      let wx: number, wy: number, wz: number, ocx: number, ocy: number, ocz: number, wvx: number, wvy = vy, wvz: number;
      if (attached) {
        wx = lx; wy = ly; wz = lz; ocx = cx; ocy = cyy; ocz = cz; wvx = vx; wvz = vz;
      } else if (sq !== null) {
        qrot(sq, 3, lx, ly, lz, tv, 7);
        wx = sfx + (tv[7] as number); wy = sfy + (tv[8] as number); wz = sfz + (tv[9] as number);
        qrot(sq, 3, cx, cyy, cz, tv, 7);
        ocx = sfx + (tv[7] as number); ocy = sfy + (tv[8] as number); ocz = sfz + (tv[9] as number);
        qrot(sq, 3, vx, vy, vz, tv, 7);
        wvx = tv[7] as number; wvy = tv[8] as number; wvz = tv[9] as number;
      } else {
        let bx = s.x, by = s.y, bz = s.z;
        let rvx = 0, rvy = 0, rvz = 0;
        if (trav) {
          // moving emitter: progress at THIS particle's birth inside the frame's emission window (cycle time)
          const cb = Math.max(0, cyc - dt * (1 - (i + 0.5) / n));
          const f = evalCurve(p.travel, cb, 0);
          const sgx = s.tx - s.x, sgy = s.ty - s.y, sgz = s.tz - s.z;
          bx += sgx * f;
          by += sgy * f;
          bz += sgz * f;
          if (p.attach === true) {
            // the born particles ride the emitter: its velocity = the segment's (world) + the local `path` motion (turned into the world)
            const df = (evalCurve(p.travel, cb + TRAVEL_DT, 0) - f) / TRAVEL_DT;
            const lvx = ((evalCurve(p.path?.x, cb + TRAVEL_DT, 0) - evalCurve(p.path?.x, cb, 0)) / TRAVEL_DT) * k * m;
            const lvy = ((evalCurve(p.path?.y, cb + TRAVEL_DT, 0) - evalCurve(p.path?.y, cb, 0)) / TRAVEL_DT) * k;
            const lvz = ((evalCurve(p.path?.z, cb + TRAVEL_DT, 0) - evalCurve(p.path?.z, cb, 0)) / TRAVEL_DT) * k;
            rvx = sgx * df + cy * lvx + sy * lvz;
            rvy = sgy * df + lvy;
            rvz = sgz * df - sy * lvx + cy * lvz;
          }
        } else if (p.place === 'target' || (p.place === 'along' && s.hasT)) {
          const f = p.place === 'target' ? 1 : rng.f();
          bx += (s.tx - s.x) * f;
          by += (s.ty - s.y) * f;
          bz += (s.tz - s.z) * f;
        }
        wx = bx + cy * lx + sy * lz;
        wz = bz - sy * lx + cy * lz;
        wy = by + ly;
        ocx = bx + cy * cx + sy * cz;
        ocz = bz - sy * cx + cy * cz;
        ocy = by + cyy;
        wvx = cy * vx + sy * vz + rvx;
        wvy = vy + rvy;
        wvz = -sy * vx + cy * vz + rvz;
      }
      const rs = p.rotation?.start;
      
      // at 180 bulges toward the target, nwegeomsplash at 160-200 sprays forward), hence the -180° for ground quads
      const frameYaw = sq !== null ? sYaw : s.yaw;
      const rot0 = ((rs ? rs[0] + rng.f() * (rs[1] - rs[0]) : 0) - (bb === 1 ? 180 : 0)) * DEG * m + (bb === 1 && !attached ? frameYaw : 0);
      const spin = (p.rotation?.spin ?? 0) * DEG * m * (p.rotation?.randomDir && rng.f() < 0.5 ? -1 : 1);
      const frames = cv.frames;
      // start frame (random: true); a random-mode particle carries its hash seed instead (a new frame every step)
      const frame0 = frames > 1 ? (fmode === 2 ? Math.floor(rng.f() * 16777216) : p.frames?.random ? Math.floor(rng.f() * frames) : 0) : 0;
      const slotI = batch.alloc();
      const f = batch.f;
      const o = slotI * REC;
      f[o] = ocx; f[o + 1] = ocy; f[o + 2] = ocz; f[o + 3] = birth;
      f[o + 4] = wx - ocx; f[o + 5] = wy - ocy; f[o + 6] = wz - ocz; f[o + 7] = life;
      f[o + 8] = wvx; f[o + 9] = wvy; f[o + 10] = wvz; f[o + 11] = swirl;
      f[o + 12] = hx; f[o + 13] = hy; f[o + 14] = rot0; f[o + 15] = spin;
      f[o + 16] = cv.row; f[o + 17] = cv.role; f[o + 18] = flags | ((faceCodes[0] as number) << PF_FACE); f[o + 19] = anchor;
      f[o + 20] = bright; f[o + 21] = fps; f[o + 22] = frame0; f[o + 23] = k;
      batch.endT[slotI] = birth + life;
      // 2FACE / 3FACE: the other faces are copies of the record turned about the vertical axis (one record each)
      for (let fi = 1; fi < faceCodes.length; fi++) {
        const o2 = batch.alloc() * REC;
        for (let c = 0; c < REC; c++) f[o2 + c] = f[o + c] as number;
        f[o2 + 18] = flags | ((faceCodes[fi] as number) << PF_FACE);
        batch.endT[o2 / REC] = birth + life;
      }
    }
  }

  private emitSurfaces(s: SInst, e: number, cv: CVar, sp: SurfaceSpec, b: number): void {
    // one record per life period; repeating elements re-emit back to back (exact births, no gaps)
    let next = s.next[e] as number;
    if (next === 0) next = cv.t0;
    while (next <= b && next < (cv.end === Infinity ? s.until : cv.end)) {
      this.writeSurface(s, e, sp.loop ? Math.round((next - cv.t0) / sp.life) : 0, cv, sp, next);
      next += sp.loop ? sp.life : Infinity;
    }
    s.next[e] = next;
  }

  private writeSurface(s: SInst, e: number, period: number, cv: CVar, sp: SurfaceSpec, tEff: number): void {
    const batch = this.pickS(cv);
    const sockOk = cv.sock > 0 && s.set >= 0;
    const k = cv.body ? s.kb : s.k;
    const m = sockOk ? 1 : s.mirror;
    const attached = sockOk || (sp.attach === undefined ? s.loop && s.c !== null && s.c.spec.behavior !== 'groundZone' : sp.attach === true);
    const sh = sp.shape;
    let p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    let taperQ = 0;
    let wall = 0;
    let lx = (sp.at?.[0] ?? 0) * k * m, ly = (sp.at?.[1] ?? 0) * k, lz = (sp.at?.[2] ?? 0) * k;
    let yaw = (sp.rot?.[0] ?? 0) * DEG * m;
    const pitch = (sp.rot?.[1] ?? 0) * DEG;
    const roll = (sp.rot?.[2] ?? 0) * DEG * m;
    const segX = s.tx - s.x, segZ = s.tz - s.z, segY = s.ty - s.y;
    const segL = Math.hypot(segX, segY, segZ);
    switch (sh.kind) {
      case 'card':
        p0 = sh.w * k; p1 = sh.h * k; p2 = sh.bend ?? 0;
        if (sp.place === 'along' && s.hasT && !sockOk) {
          p0 = segL;
          lz += segL * 0.5;
          yaw += Math.PI / 2;
        }
        break;
      case 'arc':
        p0 = sh.r0 * k; p1 = sh.r1 * k; p2 = sh.span * m; p3 = (sh.a0 ?? 0) * m; p4 = sh.taper ?? 0;
        break;
      case 'cyl':
        p0 = sh.rb * k; p1 = sh.rt * k; p2 = sh.h * k; p3 = (sh.span ?? 360) * m; p4 = (sh.bulge ?? 0) * k;
        break;
      case 'sphere':
        p0 = sh.r * k; p1 = sh.lat0 ?? -90; p2 = sh.lat1 ?? 90;
        break;
      case 'ribbon':
        p0 = sh.r * k; p1 = sh.span * m; p2 = (sh.rise ?? 0) * k; p3 = sh.w * k; p4 = (sh.a0 ?? 0) * m;
        wall = sh.wall ? 1 : 0;
        break;
      case 'tube':
        p0 = sh.r * k; p1 = sh.span * m; p2 = (sh.rise ?? 0) * k; p3 = sh.tr * k; p4 = (sh.a0 ?? 0) * m;
        taperQ = Math.round(Math.min(1, Math.max(0, sh.taper ?? 0)) * 15);
        break;
      case 'bolt':
        p0 = (sp.place === 'along' && s.hasT && !sockOk ? segL : sh.len * k); p1 = sh.w * k; p2 = sh.jag ?? 0.5; p4 = sh.hz ?? 14;
        break;
    }
    let wx: number, wy: number, wz: number, wyaw: number;
    if (attached) {
      wx = lx; wy = ly; wz = lz; wyaw = yaw;
    } else {
      let bx = s.x, by = s.y, bz = s.z;
      let fyaw = s.yaw;
      if (sp.place === 'target') {
        bx = s.tx; by = s.ty; bz = s.tz;
      } else if (sp.place === 'along' && s.hasT) {
        fyaw = Math.atan2(segX, segZ);
      }
      const cy = Math.cos(fyaw), sy = Math.sin(fyaw);
      wx = bx + cy * lx + sy * lz;
      wz = bz - sy * lx + cy * lz;
      wy = by + ly;
      wyaw = yaw + fyaw;
    }
    const role = ROLES[typeof sp.tex === 'string' ? sp.tex : (sp.tex.fallback ?? 'glow')];
    const bb = sp.billboard === 'screen' ? 1 : sp.billboard === 'upright' ? 2 : 0;
    const window = (sp.uvWindow ?? sp.sweep !== undefined) ? 1 : 0;
    const tile = (cv.art === '' && role.tile) || (sp.tile !== undefined && (sp.tile[0] !== 1 || sp.tile[1] !== 1)) || sp.uv !== undefined ? 1 : 0;
    const flat = !sockOk && (sh.kind === 'arc' || (sh.kind === 'ribbon' && !sh.wall)) && Math.abs(pitch) < 0.2 && (sp.at?.[1] ?? 0) < 0.3 ? 1 : 0;
    const fmode = frameModeBits(sp.frames?.mode, cv.role >= ART_ROLE_BASE);
    const flags = bb | (attached ? 4 : 0) | (window << 3) | (tile << 4) | (flat << 5) | (wall << 7) | (taperQ << 8) | (cv.occQ << SF_OCC) | (cv.clampQ << SF_CLAMP) | (fmode << SF_FRAMES) | (cv.sq ? SF_SQ : 0);
    // random frame mode: every record (each surface of the spawn, each loop period) draws its own frame sequence; every other
    // mode keeps the spawn seed (it only feeds the bolt jag there)
    const seed = fmode === 2 ? recordSeed(s.seed, e, period) : s.seed;
    const birth = this.time - (s.t - tEff);
    const i = batch.alloc();
    const f = batch.f;
    const o = i * REC;
    f[o] = wx; f[o + 1] = wy; f[o + 2] = wz; f[o + 3] = birth;
    f[o + 4] = wyaw; f[o + 5] = pitch; f[o + 6] = roll; f[o + 7] = sp.life;
    f[o + 8] = p0; f[o + 9] = p1; f[o + 10] = p2; f[o + 11] = p3;
    f[o + 12] = p4; f[o + 13] = SURF_KIND[sh.kind]; f[o + 14] = cv.row; f[o + 15] = cv.role;
    f[o + 16] = sp.tile?.[0] ?? 1; f[o + 17] = sp.tile?.[1] ?? 1; f[o + 18] = flags;
    f[o + 19] = s.slot + (sockOk ? 256 * (s.set * SOCKETS_PER_SET + cv.sock) : 0);
    f[o + 20] = (sp.bright ?? 1) * s.intensity * cv.gain; f[o + 21] = (sp.soft ?? 0) + 2 * Math.round(Math.min(0.5, Math.max(0, sp.softU ?? 0)) * 100); f[o + 22] = seed; f[o + 23] = sp.frames?.fps ?? 0;
    batch.endT[i] = birth + sp.life;
  }

  // ------------------------------------------------------------------ trails

  /** samples every active trail element of `s` once (after the frame's socket feed) and writes the new segments */
  private sampleTrails(s: SInst): void {
    const comp = s.c as Compiled;
    for (let e = 0; e < comp.els.length; e++) {
      const ce = comp.els[e] as CEl;
      if (!ce.trail || ce.minTier > this.tier || s.rank < ce.minRank || s.rank > ce.maxRank) continue;
      const cv = ce.v[s.grade];
      const tr = cv.tr as TrailSpec;
      const t = s.t;
      if (t < cv.t0) continue;
      const winEnd = cv.end === Infinity ? s.until : cv.end;
      const st = e * TS;
      if (t > winEnd + 1e-6 || s.stopped) {
        s.tr[st + 14] = 0;
        continue;
      }
      if (cv.sock > 0 && s.set < 0) continue;
      const k = cv.body ? s.kb : s.k;
      // anchor frame
      const fr = this.tmp;
      if (cv.sock > 0) this.socketFrame(s.set, cv.sock);
      else {
        fr[0] = s.x;
        fr[1] = s.y;
        fr[2] = s.z;
        fr[3] = 0;
        fr[4] = Math.sin(s.yaw * 0.5);
        fr[5] = 0;
        fr[6] = Math.cos(s.yaw * 0.5);
      }
      const ax = (tr.at?.[0] ?? 0) * k, ay = (tr.at?.[1] ?? 0) * k, az = (tr.at?.[2] ?? 0) * k;
      qrot(fr, 3, ax, ay, az, fr, 7);
      const Px = (fr[0] as number) + (fr[7] as number), Py = (fr[1] as number) + (fr[8] as number), Pz = (fr[2] as number) + (fr[9] as number);
      const ribbon = tr.mode === 'ribbon';
      let Qx = 0, Qy = 0, Qz = 0;
      if (!ribbon) {
        qrot(fr, 3, 0, -tr.width * k, 0, fr, 7);
        Qx = Px + (fr[7] as number);
        Qy = Py + (fr[8] as number);
        Qz = Pz + (fr[9] as number);
      }
      const span = winEnd === Infinity ? 0 : Math.max(1e-3, winEnd - cv.t0);
      const fade = evalCurve(tr.fade, span > 0 ? (t - cv.t0) / span : 0, 1);
      const T = s.tr;
      const n = T[st + 14] as number;
      const now = this.time;
      if (n === 0) {
        this.trailStore(s, st, Px, Py, Pz, Qx, Qy, Qz, now, fade, true);
        continue;
      }
      const p1x = T[st + 6] as number, p1y = T[st + 7] as number, p1z = T[st + 8] as number;
      const q1x = T[st + 9] as number, q1y = T[st + 10] as number, q1z = T[st + 11] as number;
      const dP = Math.hypot(Px - p1x, Py - p1y, Pz - p1z);
      const dQ = ribbon ? 0 : Math.hypot(Qx - q1x, Qy - q1y, Qz - q1z);
      if (Math.max(dP, dQ) < TRAIL_MIN_STEP) continue;
      const t1 = T[st + 12] as number, f1 = T[st + 13] as number;
      // Catmull-Rom through p0 (previous-previous), p1, P with an extrapolated look-ahead
      const has0 = n >= 2;
      const p0x = has0 ? (T[st] as number) : p1x, p0y = has0 ? (T[st + 1] as number) : p1y, p0z = has0 ? (T[st + 2] as number) : p1z;
      const q0x = has0 ? (T[st + 3] as number) : q1x, q0y = has0 ? (T[st + 4] as number) : q1y, q0z = has0 ? (T[st + 5] as number) : q1z;
      const p3x = 2 * Px - p1x, p3y = 2 * Py - p1y, p3z = 2 * Pz - p1z;
      const q3x = 2 * Qx - q1x, q3y = 2 * Qy - q1y, q3z = 2 * Qz - q1z;
      let sub = Math.min(TRAIL_MAX_SUB, Math.max(1, Math.ceil(Math.max(dP, dQ) / (TRAIL_SEG * Math.max(0.3, k)))));
      if (this.fx.budget < sub) sub = 1;
      const batch = this.pickP(cv);
      const flags = PF_TRAIL | (ribbon ? PF_RIBBON : 0) | (cv.occQ << PF_OCC) | (cv.clampQ << PF_CLAMP) | (cv.sq ? PF_SQ : 0);
      const bright = (tr.bright ?? 1) * s.intensity * cv.gain;
      const halfW = ribbon ? tr.width * k * 0.5 : 0;
      const tile = tr.tile !== undefined && tr.tile > 0 ? tr.tile : 1;
      // previous sub-point (starts at p1)
      let ax0 = p1x, ay0 = p1y, az0 = p1z, bx0 = q1x, by0 = q1y, bz0 = q1z, ta = t1, fa = f1;
      if (ribbon) {
        // tangent at p1 from the spline derivative at u = 0
        bx0 = 0.5 * (Px - p0x);
        by0 = 0.5 * (Py - p0y);
        bz0 = 0.5 * (Pz - p0z);
      }
      for (let i = 1; i <= sub; i++) {
        const u = i / sub;
        const u2 = u * u, u3 = u2 * u;
        // Catmull-Rom weights
        const w0 = -0.5 * u3 + u2 - 0.5 * u;
        const w1 = 1.5 * u3 - 2.5 * u2 + 1;
        const w2 = -1.5 * u3 + 2 * u2 + 0.5 * u;
        const w3 = 0.5 * u3 - 0.5 * u2;
        const cx = w0 * p0x + w1 * p1x + w2 * Px + w3 * p3x;
        const cy = w0 * p0y + w1 * p1y + w2 * Py + w3 * p3y;
        const cz = w0 * p0z + w1 * p1z + w2 * Pz + w3 * p3z;
        let dx: number, dy: number, dz: number;
        if (ribbon) {
          const d0 = -1.5 * u2 + 2 * u - 0.5, d1 = 4.5 * u2 - 5 * u, d2 = -4.5 * u2 + 4 * u + 0.5, d3 = 1.5 * u2 - u;
          dx = d0 * p0x + d1 * p1x + d2 * Px + d3 * p3x;
          dy = d0 * p0y + d1 * p1y + d2 * Py + d3 * p3y;
          dz = d0 * p0z + d1 * p1z + d2 * Pz + d3 * p3z;
        } else {
          dx = w0 * q0x + w1 * q1x + w2 * Qx + w3 * q3x;
          dy = w0 * q0y + w1 * q1y + w2 * Qy + w3 * q3y;
          dz = w0 * q0z + w1 * q1z + w2 * Qz + w3 * q3z;
        }
        const tb = t1 + (now - t1) * u;
        const fb = f1 + (fade - f1) * u;
        this.fx.budget--;
        this.fx.spawned++;
        const slotI = batch.alloc();
        const f = batch.f;
        const o = slotI * REC;
        f[o] = ax0; f[o + 1] = ay0; f[o + 2] = az0; f[o + 3] = ta;
        f[o + 4] = bx0; f[o + 5] = by0; f[o + 6] = bz0; f[o + 7] = tr.life;
        f[o + 8] = cx; f[o + 9] = cy; f[o + 10] = cz; f[o + 11] = tb;
        f[o + 12] = dx; f[o + 13] = dy; f[o + 14] = dz; f[o + 15] = tile;
        f[o + 16] = cv.row; f[o + 17] = cv.role; f[o + 18] = flags; f[o + 19] = s.slot;
        f[o + 20] = bright; f[o + 21] = fa; f[o + 22] = fb; f[o + 23] = halfW;
        batch.endT[slotI] = tb + tr.life;
        ax0 = cx; ay0 = cy; az0 = cz; bx0 = dx; by0 = dy; bz0 = dz; ta = tb; fa = fb;
      }
      this.trailStore(s, st, Px, Py, Pz, Qx, Qy, Qz, now, fade, false);
    }
  }

  private trailStore(s: SInst, st: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, t: number, fade: number, first: boolean): void {
    const T = s.tr;
    if (!first) T.copyWithin(st, st + 6, st + 12);
    T[st + 6] = px;
    T[st + 7] = py;
    T[st + 8] = pz;
    T[st + 9] = qx;
    T[st + 10] = qy;
    T[st + 11] = qz;
    T[st + 12] = t;
    T[st + 13] = fade;
    T[st + 14] = Math.min(1e6, (T[st + 14] as number) + 1);
  }

  // ------------------------------------------------------------------ housekeeping

  clear(): void {
    for (let i = 0; i < this.insts.length; i++) {
      const s = this.insts[i] as SInst;
      s.active = false;
      s.c = null;
      s.standIn = false;
      s.set = -1;
      this.anchorData[ANCHORS * 4 + (i + 1) * 4] = 0;
    }
    this.setUsed.fill(0);
    this.activeN = 0;
    this.casts.clear();
    for (const b of this.batches) b.clear();
    this.anchorTex.needsUpdate = true;
  }

  stats(): SpecStats {
    const now = this.time;
    let calls = 0;
    let tris = 0;
    for (const b of this.batches) if (b.mesh.visible) calls++;
    const pa = this.pAdd.live(now) + this.pAlpha.live(now) + this.pAddD.live(now);
    const sa = this.sAdd.live(now) + this.sAlpha.live(now) + this.sAddD.live(now);
    tris += (this.pAdd.used + this.pAlpha.used + this.pAddD.used) * 2 + (this.sAdd.used + this.sAlpha.used + this.sAddD.used) * 768;
    return { active: this.activeN, particles: pa, surfaces: sa, drawCalls: calls, triangles: tris };
  }

  dispose(): void {
    clearDisplayLayer(this);
    for (const b of this.batches) {
      this.scene.remove(b.mesh);
      b.dispose();
    }
    this.lutTex.dispose();
    this.anchorTex.dispose();
    this.atlas.dispose();
    this.art.dispose();
  }
}
