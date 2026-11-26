// DEV demo: damage numbers + telegraph decals + ground rings on a (hilly) test terrain.
//   ?demo=fx-overlay[&scene=all|numbers|telegraphs|rings|ladder][&ground=grass|snow|lava][&hills=0|1][&quality=low..ultra]
//                    [&mode=bench][&hud=0][&stream=0]
// Keys: 1-4 quality tier · G ground · H hills · B damage burst · N toggle stream · Space pause · T/R/D toggle layers
// Automation: window.__fx = { show(scene, t), bench(frames), timings(), setQuality(tier), ... }
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Object3D,
} from 'three';
import { createHarness } from '../harness';
import type { RenderCore, RenderSystem } from '../../render/core';
import { TG_CIRCLE, TG_CONE, TG_LINE, TG_RING, type TelegraphFeed } from '../../render/feed';
import { QUALITY_TIERS, type QualityTier } from '../../render/quality';
import { DamageNumbers, elementColor } from '../../render/fx/damageNumbers';
import { GroundRings, type RingKind } from '../../render/fx/groundRings';
import { Telegraphs } from '../../render/fx/telegraphs';
import type { Element } from '../../data/schema';

const ELEMENTS: Element[] = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'];

type SceneName = 'all' | 'numbers' | 'telegraphs' | 'rings' | 'ladder' | 'bench';

class MutableFeed implements TelegraphFeed {
  count = 0;
  readonly shape = new Uint8Array(128);
  readonly owner = new Uint8Array(128);
  readonly x = new Float32Array(128);
  readonly z = new Float32Array(128);
  readonly rot = new Float32Array(128);
  readonly radius = new Float32Array(128);
  readonly length = new Float32Array(128);
  readonly width = new Float32Array(128);
  readonly progress = new Float32Array(128);
  set(i: number, shape: number, owner: number, x: number, z: number, rot: number, radius: number, length: number, width: number, progress: number): void {
    this.shape[i] = shape;
    this.owner[i] = owner;
    this.x[i] = x;
    this.z[i] = z;
    this.rot[i] = rot;
    this.radius[i] = radius;
    this.length[i] = length;
    this.width[i] = width;
    this.progress[i] = progress;
  }
}

/** Deterministic PRNG so screenshots are reproducible. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Timed extends RenderSystem {
  samples: Float64Array;
  n: number;
}

function timed(sys: RenderSystem): Timed {
  const t: Timed = {
    name: sys.name,
    samples: new Float64Array(600),
    n: 0,
    update(dt, alpha) {
      const t0 = performance.now();
      sys.update(dt, alpha);
      t.samples[t.n++ % 600] = performance.now() - t0;
    },
    onResize: (w, h, p) => sys.onResize?.(w, h, p),
    dispose: () => sys.dispose?.(),
  };
  return t;
}

interface TimingStats {
  mean: number;
  p95: number;
  max: number;
  n: number;
}

interface MeasureResult {
  fps: number;
  timings: Record<string, TimingStats>;
  active: { numbers: number; glyphs: number; telegraphs: number; ringsSmall: number; ringsLarge: number };
}

function stats(t: Timed): TimingStats {
  const n = Math.min(t.n, 600);
  if (n === 0) return { mean: 0, p95: 0, max: 0, n: 0 };
  const a = Array.from(t.samples.slice(0, n)).sort((x, y) => x - y);
  const mean = a.reduce((s, v) => s + v, 0) / n;
  return { mean, p95: a[Math.floor(n * 0.95)] as number, max: a[n - 1] as number, n };
}

export default async function run(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const tier = (QUALITY_TIERS as readonly string[]).includes(q.get('quality') ?? '') ? (q.get('quality') as QualityTier) : 'high';
  const h = await createHarness({ quality: tier, fixedQuality: true, noGround: true });
  const core: RenderCore = h.core;

  // ---- terrain ------------------------------------------------------------------------------------------------
  let hills = q.get('hills') !== '0';
  let groundKind = (q.get('ground') ?? 'grass') as 'grass' | 'snow' | 'lava';
  const hillHeight = (x: number, z: number): number =>
    1.25 * Math.sin(x * 0.17 + 0.6) * Math.cos(z * 0.14) + 0.45 * Math.sin(x * 0.52 - z * 0.37) + 0.12 * Math.sin(z * 0.9 + x * 0.3);
  core.heightAt = (x, z) => (hills ? hillHeight(x, z) : 0);

  const SIZE = 150;
  const SEG = 300;
  const terrainGeo = new PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  terrainGeo.setAttribute('color', new BufferAttribute(new Float32Array((SEG + 1) * (SEG + 1) * 3), 3));
  const terrain = new Mesh(terrainGeo, new MeshLambertMaterial({ vertexColors: true }));
  terrain.receiveShadow = true;
  core.scene.add(terrain);

  const vn = (x: number, z: number): number => {
    const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, z: number): number => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = vn(ix, iz);
    const b = vn(ix + 1, iz);
    const c = vn(ix, iz + 1);
    const d = vn(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  const tmpC = new Color();
  const paintTerrain = (): void => {
    const pos = terrainGeo.getAttribute('position') as BufferAttribute;
    const col = terrainGeo.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const hh = core.heightAt(x, z);
      pos.setY(i, hh);
      const n = noise(x * 0.35, z * 0.35) * 0.6 + noise(x * 1.4, z * 1.4) * 0.3 + noise(x * 5, z * 5) * 0.1;
      if (groundKind === 'grass') tmpC.setRGB(0.16 + n * 0.12, 0.3 + n * 0.22, 0.09 + n * 0.06, 'srgb');
      else if (groundKind === 'snow') tmpC.setRGB(0.82 + n * 0.14, 0.87 + n * 0.1, 0.95 + n * 0.05, 'srgb');
      else {
        const crack = Math.pow(Math.max(0, 1 - Math.abs(noise(x * 0.9, z * 0.9) - 0.5) * 7), 3);
        tmpC.setRGB(0.1 + n * 0.1 + crack * 0.95, 0.06 + n * 0.05 + crack * 0.35, 0.05 + n * 0.04, 'srgb');
      }
      col.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    terrainGeo.computeVertexNormals();
  };
  paintTerrain();

  // ---- dummies (scale references) ------------------------------------------------------------------------------
  const dummies: Object3D[] = [];
  const dummyMat = new MeshStandardMaterial({ color: '#8a7a68', roughness: 0.8 });
  const heroMat = new MeshStandardMaterial({ color: '#3c5f9a', roughness: 0.6 });
  const addDummy = (x: number, z: number, kind: 'hero' | 'enemy' | 'big'): void => {
    const g = new Mesh(
      kind === 'hero' ? new BoxGeometry(0.7, 1.7, 0.5) : kind === 'big' ? new BoxGeometry(2.2, 3.2, 2.0) : new BoxGeometry(0.8, 1.2, 0.8),
      kind === 'hero' ? heroMat : dummyMat,
    );
    const hgt = kind === 'hero' ? 1.7 : kind === 'big' ? 3.2 : 1.2;
    g.position.set(x, core.heightAt(x, z) + hgt / 2, z);
    if (kind === 'hero') {
      const head = new Mesh(new SphereGeometry(0.22, 16, 12), heroMat);
      head.position.y = 1.0;
      g.add(head);
    }
    g.castShadow = true;
    core.scene.add(g);
    dummies.push(g);
  };
  const clearDummies = (): void => {
    for (const d of dummies) core.scene.remove(d);
    dummies.length = 0;
  };
  const repositionDummies = (): void => {
    for (const d of dummies) {
      const half = ((d as Mesh).geometry as BoxGeometry).parameters.height / 2;
      d.position.y = core.heightAt(d.position.x, d.position.z) + half;
    }
  };

  // ---- systems -------------------------------------------------------------------------------------------------
  const numbers = new DamageNumbers(core, { rng: mulberry(7) });
  const telegraphs = new Telegraphs(core);
  const rings = new GroundRings(core);
  const feed = new MutableFeed();
  telegraphs.feed = feed;
  const tNumbers = timed(numbers);
  const tTele = timed(telegraphs);
  const tRings = timed(rings);
  core.addSystem(tRings);
  core.addSystem(tTele);
  core.addSystem(tNumbers);
  /** repaints the demo terrain and tells the decal systems their ground changed */
  const retouch = (): void => {
    paintTerrain();
    telegraphs.invalidateTerrain();
    rings.invalidateTerrain();
  };

  core.rig.setTarget(0, core.heightAt(0, 0), 0);
  core.rig.snap();

  // ---- scene state ---------------------------------------------------------------------------------------------
  let scene: SceneName = (q.get('scene') as SceneName | null) ?? 'all';
  let paused = false;
  let stream = q.get('stream') !== '0';
  let showNumbers = true;
  let showTele = true;
  let showRings = true;
  let burst = 0;
  let tgPhase = 0;
  const rnd = mulberry(1234);
  const bench = q.get('mode') === 'bench';
  let animate = q.get('anim') !== '0';
  let moveTg = q.get('move') === '1';

  type RingDef = { x: number; z: number; r: number; kind: RingKind; s: number; c?: string };
  const allSpots: Array<{ x: number; z: number }> = [];
  const ringDefs: RingDef[] = [];
  const tgDefs: Array<{ shape: number; owner: number; x: number; z: number; rot: number; r: number; len: number; w: number; p0: number; speed: number }> = [];

  const buildScene = (): void => {
    clearDummies();
    ringDefs.length = 0;
    tgDefs.length = 0;
    numbers.clear();
    const hz = core.heightAt(0, 0);
    core.rig.setTarget(0, hz, 0);

    if (scene === 'rings') {
      const R = (x: number, z: number, r: number, kind: RingKind, s = 1, c?: string): void => {
        ringDefs.push({ x, z, r, kind, s, c });
        addDummy(x, z, kind === 'hero' ? 'hero' : r > 2.6 ? 'big' : 'enemy');
      };
      const oz = 0;
      R(-12, oz - 5, 1.0, 'elite');
      R(-8.5, oz - 5, 1.3, 'elite');
      R(-4.5, oz - 5, 1.7, 'elite');
      R(-0.5, oz - 5, 1.3, 'champion');
      R(3.5, oz - 5, 1.7, 'champion');
      R(7.5, oz - 5, 0.9, 'hero');
      R(10.5, oz - 5, 1.05, 'target');
      R(-10.5, oz + 1, 4.2, 'boss');
      R(-2.5, oz + 1, 3.4, 'metin', 1, '#b46cff');
      R(3.5, oz + 1, 2.2, 'metin', 1, '#4fd8ff');
      R(9.5, oz + 1, 3.0, 'metin', 1, '#ff9a3a');
      R(-12, oz + 7, 3.0, 'boss');
      R(-6, oz + 7, 2.2, 'elite');
    }
    if (scene === 'telegraphs') {
      const T = (shape: number, owner: number, x: number, z: number, rot: number, r: number, len: number, w: number, p0: number, speed = 0.4): void => {
        tgDefs.push({ shape, owner, x, z, rot, r, len, w, p0, speed });
      };
      const fwdX = Math.PI / 2; // yaw that points the shape toward +X (screen right)
      const rows = [-6.5, 0, 6.5];
      const owners = [0, 1, 2];
      rows.forEach((z, i) => {
        const o = owners[i] as number;
        const sc = 1;
        T(TG_CIRCLE, o, -11.5, z, 0, 2.6 * sc, 0, 0, 0.62);
        T(TG_CONE, o, -7.2, z, fwdX, 5.4 * sc, 0, 1.05, 0.5);
        T(TG_LINE, o, -0.2, z, fwdX, 0, 7.2 * sc, 1.7, 0.72);
        T(TG_RING, o, 11.2, z, 0, 3.4 * sc, 1.5, 0, 0.55);
      });
    }
    if (scene === 'ladder') {
      const progress = [0, 0.15, 0.35, 0.55, 0.75, 0.93];
      for (let o = 0; o < 3; o++) {
        for (let i = 0; i < progress.length; i++) {
          const x = -12.5 + i * 5;
          const z = -7 + o * 6.3;
          const cone = o === 2;
          const p0 = progress[i] as number;
          if (cone) tgDefs.push({ shape: TG_CONE, owner: o, x: x - 1.6, z, rot: Math.PI / 2, r: 3.4, len: 0, w: 1.2, p0, speed: 0 });
          else tgDefs.push({ shape: TG_CIRCLE, owner: o, x, z, rot: 0, r: 2.1, len: 0, w: 0, p0, speed: 0 });
        }
      }
    }
    if (scene === 'bench') {
      // 300 numbers (streamed), 40 telegraphs, 150 rings spread over the visible ground
      const r2 = mulberry(99);
      for (let i = 0; i < 40; i++) {
        const shape = i % 4;
        const r = 1.6 + r2() * 3;
        tgDefs.push({ shape, owner: i % 3, x: (r2() - 0.5) * 34, z: (r2() - 0.5) * 22, rot: r2() * 6.28, r, len: shape === TG_RING ? r * 0.45 : 4 + r2() * 6, w: shape === TG_CONE ? 1 + r2() : 1.5, p0: r2(), speed: 0.35 });
      }
      const kinds: RingKind[] = ['elite', 'elite', 'elite', 'champion', 'hero', 'target', 'boss', 'metin'];
      for (let i = 0; i < 150; i++) {
        const kind = kinds[Math.floor(r2() * kinds.length)] as RingKind;
        const big = kind === 'boss' || kind === 'metin';
        ringDefs.push({ x: (r2() - 0.5) * 36, z: (r2() - 0.5) * 24, r: big ? 2.8 + r2() * 3 : 0.8 + r2() * 0.9, kind, s: 1, c: kind === 'metin' ? '#b46cff' : undefined });
      }
      for (let i = 0; i < 40; i++) addDummy((r2() - 0.5) * 34, (r2() - 0.5) * 22, 'enemy');
    }
    if (scene === 'numbers') {
      addDummy(0, 0, 'hero');
      for (let i = 0; i < 6; i++) addDummy(-12 + i * 4.8, 3, 'enemy');
    }
    if (scene === 'all') {
      // a gameplay-like frame: hero, a boss + metin, elites, mobs, a few live telegraphs, numbers over the mob
      addDummy(0, 0, 'hero');
      ringDefs.push({ x: 0, z: 0, r: 0.95, kind: 'hero', s: 1 });
      const mob: Array<[number, number]> = [[-1.6, -2.8], [3.4, 1.6], [-5.2, 0.6], [6.8, -0.8], [0.9, -5.6], [-3.1, 4.6], [7.4, 3.6], [-8.6, 3.2], [2.6, -7.2]];
      for (const [x, z] of mob) addDummy(x, z, 'enemy');
      addDummy(-4.2, 3.2, 'enemy');
      ringDefs.push({ x: -4.2, z: 3.2, r: 1.35, kind: 'elite', s: 1 });
      addDummy(4.6, 4.2, 'enemy');
      ringDefs.push({ x: 4.6, z: 4.2, r: 1.55, kind: 'champion', s: 1 });
      addDummy(2.0, -1.6, 'enemy');
      ringDefs.push({ x: 2.0, z: -1.6, r: 1.05, kind: 'target', s: 1 });
      addDummy(-9, -6, 'big');
      ringDefs.push({ x: -9, z: -6, r: 4.2, kind: 'boss', s: 1 });
      addDummy(10.5, -5.5, 'big');
      ringDefs.push({ x: 10.5, z: -5.5, r: 3.4, kind: 'metin', s: 1, c: '#b46cff' });
      const aim = Math.atan2(0 - -9, 0 - -6); // boss → hero
      tgDefs.push({ shape: TG_CONE, owner: 1, x: -9, z: -6, rot: aim, r: 10.5, len: 0, w: 0.95, p0: 0.62, speed: 0.12 });
      tgDefs.push({ shape: TG_CIRCLE, owner: 0, x: -5.2, z: 0.6, rot: 0, r: 2.1, len: 0, w: 0, p0: 0.5, speed: 0.3 });
      tgDefs.push({ shape: TG_LINE, owner: 0, x: 6.8, z: -0.8, rot: -Math.PI / 2, r: 0, len: 6.5, w: 1.5, p0: 0.7, speed: 0.3 });
      tgDefs.push({ shape: TG_RING, owner: 2, x: 10.5, z: -5.5, rot: 0, r: 5.2, len: 3.2, w: 0, p0: 0.35, speed: 0.1 });
      allSpots.length = 0;
      for (const [x, z] of mob) allSpots.push({ x, z });
      allSpots.push({ x: -4.2, z: 3.2 }, { x: 4.6, z: 4.2 }, { x: 2.0, z: -1.6 });
    }
    repositionDummies();
    core.rig.snap();
  };

  /** Static numbers showcase: every element normal + crit, heal, player, xp, yeop, status, big values. */
  const spawnShowcase = (): void => {
    let id = 1000;
    const oz = scene === 'all' ? 9 : -1.2;
    ELEMENTS.forEach((el, i) => {
      const x = -11.2 + i * 3.2;
      numbers.spawn(x, oz + 3.2, 1234 + i * 777, { color: elementColor(el), targetId: id++ });
      numbers.spawn(x, oz - (i % 2 === 0 ? 0.2 : 2.4), 4521 + i * 311, { color: elementColor(el), crit: true, targetId: id++ });
      numbers.spawn(x, oz - 4.6, 86 + i * 7, { color: elementColor(el), targetId: id++ });
    });
    numbers.spawn(-8, oz + 6, 128, { kind: 'heal', targetId: id++ });
    numbers.spawn(-4, oz + 6, 35, { kind: 'player', targetId: id++ });
    numbers.spawn(0, oz + 6, 12, { kind: 'xp', targetId: id++ });
    numbers.spawn(3.5, oz + 6, 250, { kind: 'yeop', targetId: id++ });
    numbers.spawn(7, oz + 6, 14, { kind: 'status', color: elementColor('poison'), targetId: id++ });
    numbers.spawn(11, oz + 6, 123456, { color: elementColor('holy'), crit: true, targetId: id++ });
    numbers.spawn(-12, oz + 6, 1250000, { color: elementColor('fire'), crit: true, targetId: id++ });
    
    numbers.spawnText('evade', -8, oz + 9, 0);
    numbers.spawnText('block', -3, oz + 9, 0);
    numbers.spawnText('xp', 2, oz + 9, 42);
  };

  const spawnStream = (dt: number): void => {
    const rate = burst > 0 ? 420 : bench ? 330 : 9;
    const nSpawn = Math.floor(rate * dt + rnd());
    for (let i = 0; i < nSpawn; i++) {
      const el = ELEMENTS[Math.floor(rnd() * ELEMENTS.length)] as Element;
      const crit = rnd() < 0.14;
      const base = Math.floor(30 + rnd() * rnd() * 900);
      const kindR = rnd();
      const kind = kindR < 0.04 ? 'heal' : kindR < 0.07 ? 'player' : kindR < 0.1 ? 'xp' : 'normal';
      const spot = scene === 'all' && allSpots.length > 0 ? (allSpots[Math.floor(rnd() * allSpots.length)] as { x: number; z: number }) : null;
      const x = spot ? spot.x + (rnd() - 0.5) * 0.9 : (rnd() - 0.5) * 34;
      const z = spot ? spot.z + (rnd() - 0.5) * 0.9 : (rnd() - 0.5) * 20;
      numbers.spawn(x, z, crit ? base * 2.4 : base, {
        crit: kind === 'normal' && crit,
        color: kind === 'normal' ? elementColor(el) : undefined,
        kind,
        targetId: burst > 0 ? 1 + Math.floor(rnd() * 120) : 5000 + Math.floor(rnd() * 100000),
      });
    }
  };

  buildScene();
  if (scene === 'numbers' || (scene === 'all' && q.get('showcase') === '1')) spawnShowcase();

  // ---- hud -----------------------------------------------------------------------------------------------------
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:10px;top:8px;color:#e9e4d6;font:12px/1.35 ui-monospace,Consolas,monospace;text-shadow:0 1px 2px #000;pointer-events:none;white-space:pre;z-index:5';
  if (q.get('hud') !== '0') document.body.appendChild(hud);
  let fpsAcc = 0;
  let fpsN = 0;
  let framesRendered = 0;
  let fps = 0;

  const applyLayers = (): void => {
    telegraphs.feed = showTele ? feed : null;
  };

  // ---- loop ----------------------------------------------------------------------------------------------------
  /** One frame: advance demo state by `dt`, refill the feeds, run the renderer. */
  const step = (dt: number): void => {
    if (dt > 0) {
      tgPhase += dt;
      if (burst > 0) burst -= dt;
      if (showNumbers && (stream || bench || burst > 0) && scene !== 'rings' && scene !== 'telegraphs' && scene !== 'ladder') spawnStream(dt);
      if (showNumbers && stream && (scene === 'rings' || scene === 'telegraphs')) spawnStream(dt * 0.5);
    }
    let n = 0;
    let k = 0;
    for (const d of tgDefs) {
      const moving = animate && d.speed > 0;
      const p = moving ? (d.p0 + tgPhase * d.speed) % 1.25 : d.p0;
      k++;
      // animated decals hold briefly at 1.0 and then vanish, so the release burst is visible
      if (moving && p > 1.12) continue;
      const dx = moveTg ? Math.sin(tgPhase * 0.9 + k * 1.7) * 3 : 0;
      const dz = moveTg ? Math.cos(tgPhase * 0.8 + k * 2.3) * 3 : 0;
      feed.set(n++, d.shape, d.owner, d.x + dx, d.z + dz, d.rot, d.r, d.len, d.w, Math.min(p, 1));
    }
    feed.count = n;
    if (showRings) for (const r of ringDefs) rings.add(r.x, r.z, r.r, r.kind, r.s, r.c);
    core.frame(dt, 1);
    hudText();
  };
  let last = performance.now();
  const frame = (now: number): void => {
    const rawDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    framesRendered++;
    fpsAcc += rawDt;
    fpsN++;
    if (fpsAcc > 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    step(paused ? 0 : rawDt);
    raf = requestAnimationFrame(frame);
  };

  const hudText = (): void => {
    if (!hud.isConnected) return;
    const f = (t: Timed): string => stats(t).mean.toFixed(3);
    hud.textContent =
      `fx-overlay  scene=${scene}  tier=${core.quality.tier}  ground=${groundKind}  hills=${hills ? 'on' : 'off'}  ${fps.toFixed(0)} fps${paused ? '  [paused]' : ''}\n` +
      `numbers ${numbers.activeNumbers}/${numbers.activeGlyphs} glyphs (cap ${core.quality.profile.damageGlyphCap})  merged ${numbers.field.stats.merged}  dropped ${numbers.field.stats.dropped}  ${f(tNumbers)} ms\n` +
      `telegraphs ${telegraphs.stats.drawn}/${telegraphs.stats.entries}  heights ${telegraphs.stats.heights}  ${f(tTele)} ms\n` +
      `rings small ${rings.stats.small} large ${rings.stats.large} dropped ${rings.stats.dropped}  ${f(tRings)} ms\n` +
      `keys: 1-4 tier  G ground  H hills  B burst  N stream  Space pause  T/R/D layers`;
  };

  let raf = 0;
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '4') core.setQualitySetting(QUALITY_TIERS[Number(k) - 1] as QualityTier);
    else if (k === 'g') {
      groundKind = groundKind === 'grass' ? 'snow' : groundKind === 'snow' ? 'lava' : 'grass';
      retouch();
    } else if (k === 'h') {
      hills = !hills;
      retouch();
      repositionDummies();
    } else if (k === 'b') burst = 2.0;
    else if (k === 'n') stream = !stream;
    else if (k === ' ') paused = !paused;
    else if (k === 't') {
      showTele = !showTele;
      applyLayers();
    } else if (k === 'r') showRings = !showRings;
    else if (k === 'd') showNumbers = !showNumbers;
  });

  raf = requestAnimationFrame(frame);

  // ---- automation ----------------------------------------------------------------------------------------------
  const api = {
    core,
    numbers,
    telegraphs,
    rings,
    feed,
    scene: (s: SceneName, opts: { ground?: 'grass' | 'snow' | 'lava'; hills?: boolean; showcase?: boolean; animate?: boolean; move?: boolean } = {}): void => {
      scene = s;
      if (opts.ground) groundKind = opts.ground;
      if (opts.animate !== undefined) animate = opts.animate;
      if (opts.move !== undefined) moveTg = opts.move;
      if (opts.hills !== undefined) hills = opts.hills;
      retouch();
      buildScene();
      tgPhase = 0;
      if (opts.showcase) spawnShowcase();
    },
    /** advance the sim by t seconds in one step, then freeze (for deterministic screenshots) */
    freezeAt: (t: number): void => {
      paused = false;
      tgPhase = 0;
      for (let left = t; left > 1e-6; ) {
        const dt = Math.min(1 / 60, left);
        step(dt);
        left -= dt;
      }
      paused = true;
    },
    pause: (p: boolean): void => {
      paused = p;
    },
    setQuality: (t: QualityTier): void => core.setQualitySetting(t),
    layers: (l: { numbers?: boolean; telegraphs?: boolean; rings?: boolean }): void => {
      if (l.numbers !== undefined) showNumbers = l.numbers;
      if (l.telegraphs !== undefined) showTele = l.telegraphs;
      if (l.rings !== undefined) showRings = l.rings;
      applyLayers();
    },
    burst: (s = 2): void => {
      burst = s;
    },
    stream: (on: boolean): void => {
      stream = on;
    },
    timings: (): Record<string, TimingStats> => ({ numbers: stats(tNumbers), telegraphs: stats(tTele), rings: stats(tRings) }),
    resetTimings: (): void => {
      for (const t of [tNumbers, tTele, tRings]) t.n = 0;
    },
    /** run the live loop for `seconds` and report fps + per-system CPU ms (real-time, uses rAF) */
    measure: async (seconds: number): Promise<MeasureResult> => {
      for (const t of [tNumbers, tTele, tRings]) t.n = 0;
      const f0 = framesRendered;
      const t0 = performance.now();
      // tsconfig lib is ES2023: Promise.withResolvers is not typed, so use the plain delay form
      await new Promise<void>((done) => setTimeout(done, seconds * 1000));
      const secs = (performance.now() - t0) / 1000;
      return {
        fps: (framesRendered - f0) / secs,
        timings: { numbers: stats(tNumbers), telegraphs: stats(tTele), rings: stats(tRings) },
        active: {
          numbers: numbers.activeNumbers,
          glyphs: numbers.activeGlyphs,
          telegraphs: telegraphs.stats.drawn,
          ringsSmall: rings.stats.small,
          ringsLarge: rings.stats.large,
        },
      };
    },
    /**
     * Synchronous GPU-cost probe: ms per frame (CPU waits on gl.finish) with each system's layer on/off.
     * Differences against `base` approximate each system's GPU + driver cost. Blocks the page for several seconds.
     */
    probe: (frames = 120): Record<string, number> => {
      const gl = core.renderer.getContext();
      const prev = { n: showNumbers, t: showTele, r: showRings };
      const variants: Record<string, [boolean, boolean, boolean]> = {
        base: [false, false, false],
        numbers: [true, false, false],
        telegraphs: [false, true, false],
        rings: [false, false, true],
        all: [true, true, true],
      };
      const out: Record<string, number> = {};
      paused = true;
      for (const [name, v] of Object.entries(variants)) {
        showNumbers = v[0];
        showTele = v[1];
        showRings = v[2];
        applyLayers();
        numbers.clear();
        for (let i = 0; i < 90; i++) step(1 / 60);
        gl.finish();
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) {
          step(1 / 60);
          gl.finish();
        }
        out[name] = (performance.now() - t0) / frames;
      }
      showNumbers = prev.n;
      showTele = prev.t;
      showRings = prev.r;
      applyLayers();
      paused = false;
      return out;
    },
    info: (): { calls: number; triangles: number; renderer: string } => {
      const gl = core.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        calls: core.renderer.info.render.calls,
        triangles: core.renderer.info.render.triangles,
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      };
    },
  };
  (window as unknown as { __fx: typeof api }).__fx = api;
  void h;
}
