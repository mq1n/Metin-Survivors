// Emission façade used by presets: reusable fluent builders (no allocation) over the GPU batches.
import type { ElementalHost } from './elemental/host';
import type { SpecHost } from './spec/host';
import {
  D_STRIDE,
  P_STRIDE,
  R_PTS,
  R_STRIDE,
  R_VERTS,
  SHAPE_NEVER,
  S_STRIDE,
  type DebrisBatch,
  type ParticleBatch,
  type RibbonBatch,
  type ShapeBatch,
} from './batches';
import { PALETTES, type Palette } from './palette';
import type { VfxProfile } from './quality';
import { SPR } from './textures';
import { VRng, rgba } from './util';

/** particle orientation modes */
export const M = { bb: 0, streak: 1, ground: 2, upright: 3 } as const;
/** fade-out curves (shader `fadeOutCurve`) */
export const FO = { lin: 0, quad: 1, cubic: 2, sq: 3, late: 4, none: 5, snap: 6, cube: 7 } as const;
/** size curves */
export const SC = { lin: 0, out: 1, in: 2, bell: 3 } as const;
/** shape patterns (shader `pat`) */
export const PAT = {
  slash: 0,
  ring: 1,
  band: 2,
  disk: 3,
  rune: 4,
  cracks: 5,
  scorch: 6,
  pool: 7,
  frost: 8,
  flame: 9,
  pillar: 10,
  beam: 11,
  tele: 12,
  teleRing: 13,
  teleLane: 14,
  shadow: 15,
  arcane: 16,
  holy: 17,
  scratch: 18,
  /** C4 soft kit: soft noisy ring (gaussian band broken along the angle, no white lip) — kit.shockRing */
  ringSoft: 19,
  /** C4 soft kit: light column without a cap rim (streak noise scrolling up, tapered top) — kit.pillar */
  pillarSoft: 20,
  /** C4: heated cracks — fine ridged branches, hairline at the rim, white-hot → orange → dull red → char as they cool (alpha decal) */
  crackHeat: 21,
  /** C4: ground stain — noisy blob with a darker wet lip, mottled body, splatter drops, wet glints (alpha decal) */
  stain: 22,
  /** C4: impact crater — dark pit, raised dusty lip, radial ejecta streaks (alpha decal) */
  crater: 23,
  /** C4: light column on a vertical plane (shp.plane): crossed planes survive the 55° pitch with no cap and no hollow cylinder */
  pillarPlane: 24,
} as const;

/**
 * C3 bridge: a generated sprite (asset manifest kind 'vfx', public/assets/textures/vfx) the LEGACY kit may draw. It lives
 * in the spec runtime's art array (one art system, no second atlas): `PBuilder.art(a)` / `Fx.artCell(a)` give the packed
 * art role while that array holds the sprite and `fb` (a procedural atlas cell: SPR.* / FB.*) while it does not (missing
 * file, art outside the run's scope, `fx.legacyKit`, tests). The ids must be listed in common/kitArt.ts KIT_ART_IDS, so a
 * run packs them (the carrier spec `sk.gen.kit_art` references every one).
 */
export interface KitArt {
  readonly id: string;
  /** procedural atlas cell drawn when the sprite is not available */
  readonly fb: number;
  /** frames of the fallback when it is a flipbook (FB.*) */
  readonly fbFrames?: number;
}

/** C4 (S6 white-out): ceiling of a full-screen flash/tint alpha and of one kit `flash()` sprite's intensity */
export const SCREEN_FLASH_MAX = 0.18;
export const FLASH_INT_MAX = 2.2;

const SHAPE_ARC = 0;
const SHAPE_CYL = 1;
const SHAPE_BEAM = 2;
const SHAPE_LANE = 3;
const SHAPE_PLANE = 4;

/** Per-spawn context handed to presets (also the base of looping instances). */
export class Ctx {
  x = 0;
  y = 0;
  z = 0;
  /** unit direction on XZ, default +Z */
  dx = 0;
  dz = 1;
  /** yaw (0 = +Z) */
  rot = 0;
  /** size multiplier relative to the preset's authored size */
  scale = 1;
  /** area radius in metres (authored base × scale unless the caller gave a radius) */
  radius = 1;
  /** seconds (preset default if the caller gave none) */
  duration = 1;
  intensity = 1;
  seed = 0;
  tx = 0;
  ty = 0;
  tz = 0;
  hasTarget = false;
  a = 0;
  b = 0;
  /** a direction was supplied by the caller */
  hasDir = false;
  /** variant suffix index (palette.VARIANT_NAMES) or -1 */
  variant = -1;
  /** palette (resolved per spawn) */
  readonly pal: Palette = { ...PALETTES.physical };
  /** element index hint (-1 none) */
  element = -1;
  /** true when the caller overrode the colour */
  tinted = false;
}

export class PBuilder {
  private x = 0; private y = 0; private z = 0;
  private vx = 0; private vy = 0; private vz = 0;
  private lf = 0.5; private dl = 0;
  private s0 = 0.3; private s1 = 0.3;
  private r0 = 0; private sp = 0;
  private gr = 0; private dr = 0; private st = 0; private it = 1;
  private fl = -9999; private ce: number = SPR.glow; private wb = 0;
  private c0 = 0xffffffff; private c1 = 0x00ffffff;
  private md = 0; private fr = 0; private fin = 1; private fout = 0; private sc = 0; private rp = 0; private tw = 0;

  constructor(private readonly fx: Fx, private readonly b: ParticleBatch) {}

  at(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  vel(x: number, y: number, z: number): this { this.vx = x; this.vy = y; this.vz = z; return this; }
  life(s: number): this { this.lf = s; return this; }
  delay(s: number): this { this.dl = s; return this; }
  size(a: number, b: number = a): this { this.s0 = a; this.s1 = b; return this; }
  /** colour over life: (hex0, alpha0) → (hex1, alpha1); hex1 defaults to hex0, alpha1 to 0 */
  col(hex0: number, a0 = 1, hex1: number = hex0, a1 = 0): this { this.c0 = rgba(hex0, a0); this.c1 = rgba(hex1, a1); return this; }
  grav(g: number): this { this.gr = g; return this; }
  drag(d: number): this { this.dr = d; return this; }
  rot(r0: number, spin = 0): this { this.r0 = r0; this.sp = spin; return this; }
  spr(cell: number): this { this.ce = cell; return this; }
  /** a generated sprite of the art array (see KitArt), else its procedural fallback cell; frames come from the sprite itself */
  art(a: KitArt): this {
    const c = this.fx.artCell(a);
    this.ce = c;
    if (c < 65536) this.fr = a.fbFrames ?? 0;
    else this.fr = 0;
    return this;
  }
  /** flipbook: `n` frames starting at `cell`, played over the lifetime */
  frames(n: number): this { this.fr = n; return this; }
  mode(m: number): this { this.md = m; return this; }
  /** streak length factor (seconds of travel) or upright aspect */
  stretch(k: number): this { this.st = k; return this; }
  int(i: number): this { this.it = i; return this; }
  fade(inCode: number, outCode: number, sizeCurve = 0): this { this.fin = inCode; this.fout = outCode; this.sc = sizeCurve; return this; }
  floor(y: number): this { this.fl = y; return this; }
  wob(a: number): this { this.wb = a; return this; }
  /** treat the sprite's red channel as heat and colour it c1 (cool) → c0 (hot) */
  ramp(): this { this.rp = 1; return this; }
  twinkle(): this { this.tw = 1; return this; }

  emit(): void {
    const fx = this.fx;
    if (fx.budget <= 0) {
      fx.dropped++;
    } else {
      const b = this.b;
      const i = b.alloc();
      if (i < 0) {
        fx.dropped++;
      } else {
        fx.budget--;
        fx.spawned++;
        const o = i * P_STRIDE;
        const f = b.f;
        const birth = fx.time + this.dl;
        f[o] = this.x; f[o + 1] = this.y; f[o + 2] = this.z; f[o + 3] = birth;
        f[o + 4] = this.vx; f[o + 5] = this.vy; f[o + 6] = this.vz; f[o + 7] = this.lf;
        f[o + 8] = this.s0; f[o + 9] = this.s1; f[o + 10] = this.r0; f[o + 11] = this.sp;
        f[o + 12] = this.gr; f[o + 13] = this.dr; f[o + 14] = this.st; f[o + 15] = this.it;
        f[o + 16] = this.fl;
        f[o + 17] = this.ce;
        f[o + 18] = this.md | (this.fr << 2) | (this.fin << 8) | (this.fout << 11) | (this.sc << 14) | (this.rp << 16) | (this.tw << 17);
        f[o + 19] = this.wb;
        b.c[i * 2] = this.c0;
        b.c[i * 2 + 1] = this.c1;
        b.endT[i] = birth + this.lf;
      }
    }
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.lf = 0.5; this.dl = 0; this.s0 = 0.3; this.s1 = 0.3; this.r0 = 0; this.sp = 0;
    this.gr = 0; this.dr = 0; this.st = 0; this.it = 1; this.fl = -9999; this.ce = SPR.glow; this.wb = 0;
    this.c0 = 0xffffffff; this.c1 = 0x00ffffff;
    this.md = 0; this.fr = 0; this.fin = 1; this.fout = 0; this.sc = 0; this.rp = 0; this.tw = 0;
  }
}

export class SBuilder {
  private x = 0; private y = 0; private z = 0;
  private yaw = 0; private pitch = 0; private roll = 0;
  private lf = 1; private dl = 0;
  private md = 0; private pt = 0; private sd = 0; private fc = 5;
  private r0 = 0; private r1 = 1; private span = Math.PI * 2; private a0 = 0;
  private sw = 0; private tr = 0.5; private ex0 = 1; private aux = 0;
  private gx = 0; private gz = 0; private om = 0;
  private it = 1; private shr = 0; private lift = 0.03; private param = 0;
  private c0 = 0xffffffff; private c1 = 0x00ffffff;
  private pin = false;

  constructor(private readonly fx: Fx, private readonly b: ShapeBatch) {}

  at(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  /** ground-anchored: y and slope from the terrain sampler */
  ground(x: number, z: number, lift = 0.03): this {
    this.x = x; this.z = z; this.lift = lift;
    const fx = this.fx;
    this.y = fx.heightAt(x, z);
    if (fx.hasHeight) {
      const e = 0.9;
      this.gx = (fx.heightAt(x + e, z) - fx.heightAt(x - e, z)) / (2 * e);
      this.gz = (fx.heightAt(x, z + e) - fx.heightAt(x, z - e)) / (2 * e);
    }
    return this;
  }
  yaw_(r: number): this { this.yaw = r; return this; }
  tilt(pitch: number, roll: number): this { this.pitch = pitch; this.roll = roll; return this; }
  life(s: number): this { this.lf = s; return this; }
  delay(s: number): this { this.dl = s; return this; }
  /** arc / ring / disk / cone in the local XZ plane: inner radius, outer radius, angular span, start angle (0 = +Z, + toward +X) */
  arc(r0: number, r1: number, span: number, a0: number): this { this.md = SHAPE_ARC; this.r0 = r0; this.r1 = r1; this.span = span; this.a0 = a0; return this; }
  disk(r: number): this { return this.arc(0, r, Math.PI * 2, 0); }
  ring(r0: number, r1: number): this { return this.arc(r0, r1, Math.PI * 2, 0); }
  /** vertical cylinder: radius at bottom, at top, height */
  cyl(rBottom: number, rTop: number, height: number): this { this.md = SHAPE_CYL; this.r0 = rBottom; this.r1 = rTop; this.aux = height; this.span = Math.PI * 2; this.a0 = 0; return this; }
  /** camera-facing beam from the centre along (yaw, pitch): width, length */
  beam(width: number, length: number): this { this.md = SHAPE_BEAM; this.r0 = width; this.r1 = length; return this; }
  /** ground rectangle starting at the centre, extending along yaw: width, length */
  lane(width: number, length: number): this { this.md = SHAPE_LANE; this.r0 = width; this.r1 = length; return this; }
  /** vertical plane standing on the centre, facing along yaw (normal = yaw direction): width, height; tapers toward the top */
  plane(width: number, height: number): this { this.md = SHAPE_PLANE; this.r0 = width; this.r1 = width; this.aux = height; return this; }
  pat(p: number): this { this.pt = p; return this; }
  seed(s: number): this { this.sd = s; return this; }
  /** slash head sweep: fraction of the lifetime the head needs, trail window length (0..1 of the arc) */
  sweep(sw: number, trail: number): this { this.sw = sw; this.tr = trail; return this; }
  /** radius at birth as a fraction of the final radius (expanding ring) */
  expand(e0: number): this { this.ex0 = e0; return this; }
  crescent(k: number): this { this.aux = k; return this; }
  spin(omega: number): this { this.om = omega; return this; }
  col(hex0: number, a0 = 1, hex1: number = hex0, a1 = 1): this { this.c0 = rgba(hex0, a0); this.c1 = rgba(hex1, a1); return this; }
  int(i: number): this { this.it = i; return this; }
  fade(code: number): this { this.fc = code; return this; }
  shrink(k: number): this { this.shr = k; return this; }
  lift_(l: number): this { this.lift = l; return this; }
  param_(p: number): this { this.param = p; return this; }
  /** keep the slot alive until killed (loops) */
  pinned(): this { this.pin = true; return this; }

  private reset(): void {
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.lf = 1; this.dl = 0; this.md = 0; this.pt = 0; this.sd = 0; this.fc = 5;
    this.r0 = 0; this.r1 = 1; this.span = Math.PI * 2; this.a0 = 0;
    this.sw = 0; this.tr = 0.5; this.ex0 = 1; this.aux = 0; this.gx = 0; this.gz = 0; this.om = 0;
    this.it = 1; this.shr = 0; this.lift = 0.03; this.param = 0;
    this.c0 = 0xffffffff; this.c1 = 0x00ffffff; this.pin = false;
  }

  emit(): number {
    return this.emitAt(this.b.alloc(this.fx.time));
  }

  /** writes into an already reserved slot (immediate-mode decals); returns a generation-stamped handle or -1 on allocation failure */
  emitAt(i: number): number {
    const fx = this.fx;
    const b = this.b;
    if (i < 0 || i >= b.capacity) {
      fx.dropped++;
      this.reset();
      return -1;
    }
    b.touch(i);
    const o = i * S_STRIDE;
    const f = b.f;
    const birth = fx.time + this.dl;
    f[o] = this.x; f[o + 1] = this.y; f[o + 2] = this.z; f[o + 3] = birth;
    f[o + 4] = this.yaw; f[o + 5] = this.pitch; f[o + 6] = this.roll; f[o + 7] = this.lf;
    f[o + 8] = this.md; f[o + 9] = this.pt; f[o + 10] = this.sd; f[o + 11] = this.fc;
    f[o + 12] = this.r0; f[o + 13] = this.r1; f[o + 14] = this.span; f[o + 15] = this.a0;
    f[o + 16] = this.sw; f[o + 17] = this.tr; f[o + 18] = this.ex0; f[o + 19] = this.aux;
    f[o + 20] = this.gx; f[o + 21] = this.gz; f[o + 22] = SHAPE_NEVER; f[o + 23] = this.om;
    f[o + 24] = this.it; f[o + 25] = this.shr; f[o + 26] = this.lift; f[o + 27] = this.param;
    b.c[i * 2] = this.c0;
    b.c[i * 2 + 1] = this.c1;
    b.endT[i] = this.pin ? 1e9 : birth + this.lf;
    b.pinned[i] = this.pin ? 1 : 0;
    this.reset();
    return b.handleOf(i);
  }

  /** ends a pinned/long shape gracefully (0.3 s fade); no-ops on invalid or stale handles */
  kill(handle: number): void {
    const slot = this.b.resolveHandle(handle);
    if (slot < 0) return;
    const b = this.b;
    b.f[slot * S_STRIDE + 22] = this.fx.time;
    b.pinned[slot] = 0;
    b.endT[slot] = this.fx.time + 0.35;
    b.touch(slot);
  }
  move(handle: number, x: number, y: number, z: number): void {
    const slot = this.b.resolveHandle(handle);
    if (slot < 0) return;
    const o = slot * S_STRIDE;
    this.b.f[o] = x; this.b.f[o + 1] = y; this.b.f[o + 2] = z;
    this.b.touch(slot);
  }
  setYaw(handle: number, yaw: number): void {
    const slot = this.b.resolveHandle(handle);
    if (slot < 0) return;
    this.b.f[slot * S_STRIDE + 4] = yaw;
    this.b.touch(slot);
  }
}

export class DBuilder {
  private x = 0; private y = 0; private z = 0;
  private vx = 0; private vy = 0; private vz = 0;
  private lf = 1.2; private dl = 0; private sd = 0; private spin = 8; private size = 0.2; private fl = 0;
  private g = -14; private rest = 0.35; private em = 0; private asp = 1;
  private c0 = 0xff808080; private c1 = 0xff404040;
  constructor(private readonly fx: Fx, private readonly b: DebrisBatch) {}
  at(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  vel(x: number, y: number, z: number): this { this.vx = x; this.vy = y; this.vz = z; return this; }
  life(s: number): this { this.lf = s; return this; }
  delay(s: number): this { this.dl = s; return this; }
  sz(s: number): this { this.size = s; return this; }
  /** colour at birth and at death (opaque) */
  col(hex0: number, hex1: number = hex0): this { this.c0 = rgba(hex0, 1); this.c1 = rgba(hex1, 1); return this; }
  floor(y: number): this { this.fl = y; return this; }
  spin_(r: number): this { this.spin = r; return this; }
  bounce(e: number): this { this.rest = e; return this; }
  glow(e: number): this { this.em = e; return this; }
  tall(a: number): this { this.asp = a; return this; }
  grav(g: number): this { this.g = g; return this; }
  emit(): void {
    const fx = this.fx;
    if (fx.budget <= 0) {
      fx.dropped++;
    } else {
      const b = this.b;
      const i = b.alloc();
      if (i < 0) {
        fx.dropped++;
      } else {
        fx.budget--;
        fx.spawned++;
        const o = i * D_STRIDE;
        const f = b.f;
        const birth = fx.time + this.dl;
        f[o] = this.x; f[o + 1] = this.y; f[o + 2] = this.z; f[o + 3] = birth;
        f[o + 4] = this.vx; f[o + 5] = this.vy; f[o + 6] = this.vz; f[o + 7] = this.lf;
        f[o + 8] = fx.rng.f() * 100; f[o + 9] = this.spin * (0.5 + fx.rng.f()); f[o + 10] = this.size; f[o + 11] = this.fl;
        f[o + 12] = this.g; f[o + 13] = this.rest; f[o + 14] = this.em; f[o + 15] = this.asp;
        b.c[i * 2] = this.c0;
        b.c[i * 2 + 1] = this.c1;
        b.endT[i] = birth + this.lf;
      }
    }
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.lf = 1.2; this.dl = 0; this.spin = 8; this.size = 0.2; this.fl = 0; this.g = -14; this.rest = 0.35; this.em = 0; this.asp = 1;
    this.c0 = 0xff808080; this.c1 = 0xff404040;
  }
}

/** Ribbon builder: lightning bolts and straight streaks. */
export class RBuilder {
  private w = 0.3; private lf = 0.3; private dl = 0; private c0 = 0xffffffff; private c1 = 0xffffffff;
  private it = 1; private jg = 0.35; private br = 0; private style = 1; private fc = 3; private sd = 0;
  /** point scratch: x y z hw u birth life */
  readonly pts = new Float32Array(R_PTS * 7);
  private readonly ptsA = new Float32Array(R_PTS * 3);
  private readonly ptsB = new Float32Array(R_PTS * 3);

  constructor(private readonly fx: Fx, private readonly b: RibbonBatch) {}

  width(w: number): this { this.w = w; return this; }
  life(s: number): this { this.lf = s; return this; }
  delay(s: number): this { this.dl = s; return this; }
  col(hex0: number, hex1: number = hex0, a0 = 1, a1 = 1): this { this.c0 = rgba(hex0, a0); this.c1 = rgba(hex1, a1); return this; }
  int(i: number): this { this.it = i; return this; }
  jag(j: number): this { this.jg = j; return this; }
  branch(n: number): this { this.br = n; return this; }
  style_(s: number): this { this.style = s; return this; }
  fade(code: number): this { this.fc = code; return this; }
  seed(s: number): this { this.sd = s; return this; }

  private reset(): void {
    this.w = 0.3; this.lf = 0.3; this.dl = 0; this.c0 = 0xffffffff; this.c1 = 0xffffffff;
    this.it = 1; this.jg = 0.35; this.br = 0; this.style = 1; this.fc = 3; this.sd = 0;
  }

  /** Generates a jagged polyline into `out` (xyz triples), returns point count. Midpoint displacement. */
  private jagged(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, levels: number, jag: number, out: Float32Array, tmp: Float32Array): number {
    const rng = this.fx.rng;
    let a = out;
    let bArr = tmp;
    a[0] = x0; a[1] = y0; a[2] = z0; a[3] = x1; a[4] = y1; a[5] = z1;
    let m = 2;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let amp = len * jag * 0.5;
    for (let lv = 0; lv < levels; lv++) {
      for (let i = 0; i < m - 1; i++) {
        bArr[i * 6] = a[i * 3] as number;
        bArr[i * 6 + 1] = a[i * 3 + 1] as number;
        bArr[i * 6 + 2] = a[i * 3 + 2] as number;
        let rx = rng.s2(1), ry = rng.s2(1), rz = rng.s2(1);
        const dot = rx * ux + ry * uy + rz * uz;
        rx -= dot * ux; ry -= dot * uy; rz -= dot * uz;
        const rl = Math.hypot(rx, ry, rz) || 1;
        const k = (amp * rng.r(0.3, 1)) / rl;
        bArr[i * 6 + 3] = ((a[i * 3] as number) + (a[i * 3 + 3] as number)) * 0.5 + rx * k;
        bArr[i * 6 + 4] = ((a[i * 3 + 1] as number) + (a[i * 3 + 4] as number)) * 0.5 + ry * k;
        bArr[i * 6 + 5] = ((a[i * 3 + 2] as number) + (a[i * 3 + 5] as number)) * 0.5 + rz * k;
      }
      const last = (m - 1) * 3;
      bArr[(m - 1) * 6] = a[last] as number;
      bArr[(m - 1) * 6 + 1] = a[last + 1] as number;
      bArr[(m - 1) * 6 + 2] = a[last + 2] as number;
      m = m * 2 - 1;
      const t = a;
      a = bArr;
      bArr = t;
      amp *= 0.58;
    }
    if (a !== out) out.set(a.subarray(0, m * 3));
    return m;
  }

  private commit(n: number, width: number, life: number, birth: number): void {
    const b = this.b;
    const fx = this.fx;
    const chunk = b.alloc(fx.time);
    if (chunk < 0) {
      fx.dropped++;
      return;
    }
    const p = this.pts;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0;
      const taper = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, u * 0.96 + 0.02));
      p[i * 7] = this.ptsA[i * 3] as number;
      p[i * 7 + 1] = this.ptsA[i * 3 + 1] as number;
      p[i * 7 + 2] = this.ptsA[i * 3 + 2] as number;
      p[i * 7 + 3] = width * 0.5 * taper;
      p[i * 7 + 4] = u;
      p[i * 7 + 5] = birth;
      p[i * 7 + 6] = life;
    }
    b.writeStrip(chunk, n, p, this.style, this.it, this.fc, this.sd, this.c0, this.c1);
    b.endT[chunk] = birth + life;
  }

  /** Lightning bolt from (x0,y0,z0) to (x1,y1,z1) with optional forks. */
  bolt(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const fx = this.fx;
    const lv = fx.profile.segments < 0.7 ? 3 : 4;
    const birth = fx.time + this.dl;
    const n = this.jagged(x0, y0, z0, x1, y1, z1, lv, this.jg, this.ptsA, this.ptsB);
    this.commit(n, this.w, this.lf, birth);
    const rng = fx.rng;
    const nb = this.br;
    for (let k = 0; k < nb; k++) {
      const idx = rng.i(Math.max(1, n - 5)) + 2;
      const bx = this.ptsA[idx * 3] as number, by = this.ptsA[idx * 3 + 1] as number, bz = this.ptsA[idx * 3 + 2] as number;
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz);
      const L = len * rng.r(0.18, 0.36);
      let rx = rng.s2(1), ry = rng.s2(0.6), rz = rng.s2(1);
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      const fxd = dx / len * 0.7 + rx * 0.7, fyd = dy / len * 0.7 + ry * 0.5, fzd = dz / len * 0.7 + rz * 0.7;
      const fl = Math.hypot(fxd, fyd, fzd) || 1;
      const m = this.jagged(bx, by, bz, bx + (fxd / fl) * L, by + (fyd / fl) * L, bz + (fzd / fl) * L, lv - 1, this.jg, this.ptsA, this.ptsB);
      this.commit(m, this.w * 0.55, this.lf * 0.85, birth + rng.r(0, 0.03));
    }
    this.reset();
  }

  /** Straight ribbon streak (dash lines, speed trails): width tapers to the tail. */
  streak(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const fx = this.fx;
    const birth = fx.time + this.dl;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.ptsA[i * 3] = x0 + (x1 - x0) * t;
      this.ptsA[i * 3 + 1] = y0 + (y1 - y0) * t;
      this.ptsA[i * 3 + 2] = z0 + (z1 - z0) * t;
    }
    const b = this.b;
    const chunk = b.alloc(fx.time);
    if (chunk < 0) {
      fx.dropped++;
      this.reset();
      return;
    }
    const p = this.pts;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      p[i * 7] = this.ptsA[i * 3] as number;
      p[i * 7 + 1] = this.ptsA[i * 3 + 1] as number;
      p[i * 7 + 2] = this.ptsA[i * 3 + 2] as number;
      p[i * 7 + 3] = this.w * 0.5 * Math.min(1, u * 1.6 + 0.04);
      p[i * 7 + 4] = u;
      p[i * 7 + 5] = birth;
      p[i * 7 + 6] = this.lf;
    }
    b.writeStrip(chunk, n, p, this.style, this.it, this.fc, this.sd, this.c0, this.c1);
    b.endT[chunk] = birth + this.lf;
    this.reset();
  }
}

/** The object presets receive. */
export class Fx {
  time = 0;
  readonly rng = new VRng(0x1234abcd);
  profile: VfxProfile;
  density: number;
  detail: number;
  /** particles still allowed this frame */
  budget = 0;
  spawned = 0;
  dropped = 0;
  heightAt: (x: number, z: number) => number = () => 0;
  hasHeight = false;
  onShake: ((amount: number) => void) | null = null;
  onFlash: ((r: number, g: number, b: number, a: number, dur: number) => void) | null = null;

  readonly add: PBuilder;
  readonly alp: PBuilder;
  readonly shp: SBuilder;
  readonly dec: SBuilder;
  readonly rb: RBuilder;
  readonly db: DBuilder;
  /** signature (elemental) effects; null until the system installs it. Presets: `if (fx.el?.cast(kind, c)) return;` then the batched look. */
  el: ElementalHost | null = null;
  private specHost: SpecHost | null = null;
  /**
   * skill effect specs (`sk.*` presets); null until the system installs it. Installing the host also hands its generated-art
   * array to the legacy particle batches (C3 bridge): the same texture array, bound through the host's own uniform objects,
   * so a re-bake (tier change, late art) reaches both draw paths.
   */
  get spec(): SpecHost | null {
    return this.specHost;
  }
  set spec(h: SpecHost | null) {
    this.specHost = h;
    if (h === null) return;
    const u = h.uniforms;
    this.pAdd.bindArt(u.uSpecArt, u.uArtGrid);
    this.pAlpha.bindArt(u.uSpecArt, u.uArtGrid);
  }
  /** A/B opt-out of the C4 soft kit (thin rings, capped pillars, unclamped flashes); gallery `?legacyKit=1` */
  legacyKit = false;

  constructor(
    profile: VfxProfile,
    readonly pAdd: ParticleBatch,
    readonly pAlpha: ParticleBatch,
    readonly sAdd: ShapeBatch,
    readonly sAlpha: ShapeBatch,
    readonly ribbons: RibbonBatch,
    readonly debris: DebrisBatch,
  ) {
    this.profile = profile;
    this.density = profile.density;
    this.detail = profile.detail;
    this.add = new PBuilder(this, pAdd);
    this.alp = new PBuilder(this, pAlpha);
    this.shp = new SBuilder(this, sAdd);
    this.dec = new SBuilder(this, sAlpha);
    this.rb = new RBuilder(this, ribbons);
    this.db = new DBuilder(this, debris);
  }

  /** packed art role of `a` while the art array holds the sprite, else its procedural atlas cell (see KitArt) */
  artCell(a: KitArt): number {
    if (this.legacyKit) return a.fb;
    const r = this.specHost?.art.role(a.id);
    return r ? r.packed : a.fb;
  }

  /** true when the generated sprite `a` is packed and will draw (kit helpers pick their look / counts by it) */
  hasArt(a: KitArt): boolean {
    return !this.legacyKit && (this.specHost?.art.role(a.id) ?? null) !== null;
  }

  setProfile(p: VfxProfile): void {
    this.profile = p;
    this.density = p.density;
    this.detail = p.detail;
  }

  /** stochastically rounded, quality-scaled particle count */
  n(count: number): number {
    return this.rng.n(count * this.density);
  }

  shake(amount: number): void {
    this.onShake?.(amount);
  }

  flash(r: number, g: number, b: number, a: number, dur: number): void {
    this.onFlash?.(r, g, b, this.legacyKit ? a : Math.min(a, SCREEN_FLASH_MAX), dur);
  }
}

export { R_STRIDE, R_VERTS };
