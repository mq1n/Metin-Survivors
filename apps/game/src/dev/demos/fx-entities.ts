// DEV demo: projectiles + pickups + post pipeline at the real game camera.
//   ?demo=fx-entities[&mode=showcase|stress|gallery][&proj=N][&pick=N][&tier=low|medium|high|ultra][&post=0|1]
//   [&freeze=1][&hud=0][&zoom=22]
// `window.__fx` exposes the same controls plus bench()/benchSync() for frame-cost measurements.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Shape,
  Path,
  Vector2,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type WebGLRenderer,
} from 'three';
import type { PickupFeed, ProjectileFeed, ProjectileStyleDef } from '../../render/feed';
import { Pickups } from '../../render/fx/pickups';
import { Projectiles } from '../../render/fx/projectiles';
import { PostPipeline } from '../../render/post';
import { QUALITY_TIERS, type QualityTier } from '../../render/quality';
import type { RenderSystem } from '../../render/core';
import { createHarness } from '../harness';
import type { ModelAsset } from '../../data/assetManifest';
import type { Assets, LoadedModel } from '../../engine/assets';

declare global {
  interface Window {
    __fx?: object;
  }
}

type Mode = 'showcase' | 'stress' | 'gallery';

const STEP = 1 / 60;
const PROJ_CAP = 1500;
const PICK_CAP = 1200;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Style table: index = feed `style` column. Index 12 is deliberately missing (neutral orb fallback). */
const STYLES: Array<ProjectileStyleDef | undefined> = [
  { shape: 'orb', color: '#4aa8ff', core: '#e6f5ff' },
  { shape: 'orb', color: '#58ff7a', core: '#eaffe8' },
  { shape: 'orb', color: '#ff9a34', core: '#fff0c4', trail: 0.2 },
  { shape: 'orb', color: '#b87bff', core: '#f4e8ff' },
  { shape: 'arrow', color: '#ffd27a', core: '#fff6dc' },
  { shape: 'arrow', color: '#7dff5a', core: '#f0ffe0', length: 7 },
  { shape: 'blade', color: '#7fe8ff', core: '#ffffff' },
  { shape: 'blade', color: '#ff7a3a', core: '#fff1d0', length: 1.25 },
  { shape: 'talisman', color: '#ff5a3a', core: '#ffe9c4' },
  { shape: 'talisman', color: '#6fb6ff', core: '#e8f4ff' },
  { shape: 'bolt', color: '#6f9bff', core: '#ffffff' },
  { shape: 'bolt', color: '#ffe46a', core: '#ffffff', length: 9 },
  undefined,
];
const STYLE_RADIUS = [0.32, 0.32, 0.4, 0.32, 0.3, 0.3, 0.5, 0.58, 0.38, 0.38, 0.3, 0.3, 0.32];
const STYLE_SPEED = [11, 10, 9, 12, 24, 22, 14, 13, 11, 12, 30, 28, 10];

export default async function run(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const tierParam = q.get('tier') as QualityTier | null;
  const tier: QualityTier = tierParam && QUALITY_TIERS.includes(tierParam) ? tierParam : 'high';
  const h = await createHarness({ quality: tier, fixedQuality: true, noGround: true });
  const { core } = h;
  const rng = mulberry32(0xc0ffee);

  // --- ground ---------------------------------------------------------------------------------------------------
  const hf: (x: number, z: number) => number = q.get('hills') === '1' ? (x, z) => 1.6 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 0.6 * Math.sin(z * 0.45 + x * 0.1) : () => 0;
  core.heightAt = hf;
  core.scene.add(makeGround(hf));
  core.env.setBiome({
    fog: { color: '#9fb4c2', near: 60, far: 150 },
    sun: { color: '#fff1d6', intensity: 2.6, dir: [0.45, 0.8, 0.35] },
    ambient: { sky: '#bcd0ff', ground: '#5a4a35', intensity: 0.9 },
  });

  // --- scale dummies + bloom test objects --------------------------------------------------------------------------
  const dummies = makeDummies(rng, hf);
  core.scene.add(dummies);
  const hero = new Mesh(new CapsuleGeometry(0.4, 0.95, 6, 14), new MeshLambertMaterial({ color: '#d9d2c4' }));
  hero.position.set(0, 0.88 + hf(0, 0), 0);
  hero.castShadow = true;
  const cape = new Mesh(new PlaneGeometry(0.7, 1.1), new MeshLambertMaterial({ color: '#8f1d1d', side: 2 }));
  cape.position.set(0, 0.95, -0.42);
  hero.add(cape);
  core.scene.add(hero);
  core.scene.add(makeBloomProps());

  core.rig.setZoom(Number(q.get('zoom') ?? 22));
  core.rig.setTarget(0, hf(0, 0), 0);
  core.rig.snap();

  // --- systems --------------------------------------------------------------------------------------------------
  const projectiles = new Projectiles(core);
  const pickups = new Pickups(core);
  projectiles.setStyles(STYLES);
  const sysTime = { proj: 0, pick: 0 };
  core.addSystem(timed(projectiles, (ms) => (sysTime.proj += ms)));
  core.addSystem(timed(pickups, (ms) => (sysTime.pick += ms)));
  if (q.get('standin') !== '0') installStandIns(h.assets);
  await pickups.load();

  // --- feeds ----------------------------------------------------------------------------------------------------
  const pj = makeProjectileState();
  const pk = makePickupState();
  projectiles.feed = pj.feed;
  pickups.feed = pk.feed;

  let mode: Mode = (q.get('mode') as Mode | null) ?? 'showcase';
  dummies.visible = mode !== 'gallery' && q.get('dummies') !== '0';
  let projTarget = Number(q.get('proj') ?? (mode === 'stress' ? 1500 : 260));
  let pickTarget = Number(q.get('pick') ?? (mode === 'stress' ? 1200 : 340));
  let frozen = q.get('freeze') === '1';
  let postOn = q.get('post') !== '0';

  // RenderCore.setComposer disposes the previous composer, so every enable creates a fresh pipeline
  const applyPost = (): void => {
    core.setComposer(postOn ? new PostPipeline(core.renderer, core.quality) : null);
  };
  applyPost();

  const setMode = (m: Mode): void => {
    mode = m;
    dummies.visible = m !== 'gallery' && q.get('dummies') !== '0';
    pj.clear();
    pk.clear();
    gallerySetup();
    pickGallerySetup();
  };

  // --- projectile spawners ------------------------------------------------------------------------------------------
  let showT = 0;
  let spiral = 0;
  const spawnShowcase = (dt: number): void => {
    showT += dt;
    // friendly orb rings
    if (showT % 0.9 < dt) {
      const n = 14;
      const s = Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.2;
        const sp = STYLE_SPEED[s] as number;
        pj.spawn(0, 0, Math.sin(a) * sp, Math.cos(a) * sp, s, 0, 2.2);
      }
    }
    // arrow fan
    if (showT % 1.1 < dt) {
      const base = rng() * Math.PI * 2;
      for (let i = -3; i <= 3; i++) {
        const a = base + i * 0.1;
        const st = rng() < 0.5 ? 4 : 5;
        pj.spawn(0, 0, Math.sin(a) * 22, Math.cos(a) * 22, st, 0, 1.4);
      }
    }
    // blades: forward slashes
    if (showT % 1.3 < dt) {
      const base = rng() * Math.PI * 2;
      for (let i = -1; i <= 1; i++) {
        const a = base + i * 0.5;
        pj.spawn(0, 0, Math.sin(a) * 14, Math.cos(a) * 14, 6 + (i & 1), 0, 1.5);
      }
    }
    // talisman spiral
    if (showT % 0.12 < dt) {
      spiral += 0.55;
      for (let k = 0; k < 3; k++) {
        const a = spiral + (k * Math.PI * 2) / 3;
        pj.spawn(0, 0, Math.sin(a) * 11, Math.cos(a) * 11, 8 + (k & 1), 0, 2.0);
      }
    }
    // bolts
    if (showT % 0.5 < dt) {
      for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2;
        pj.spawn(0, 0, Math.sin(a) * 30, Math.cos(a) * 30, 10 + (i & 1), 0, 0.7);
      }
    }
    // hostile fire from the ring
    if (showT % 0.35 < dt) {
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        const sx = Math.sin(a) * 13;
        const sz = Math.cos(a) * 13;
        const kind = Math.floor(rng() * 5);
        const style = [2, 4, 8, 10, 7][kind] as number;
        const sp = ((STYLE_SPEED[style] as number) * 0.55) | 0;
        const jitter = (rng() - 0.5) * 0.3;
        const ta = Math.atan2(-sx, -sz) + jitter;
        pj.spawn(sx, sz, Math.sin(ta) * sp, Math.cos(ta) * sp, style, 1, 2.6);
      }
    }
  };
  const spawnStress = (): void => {
    let guard = 0;
    const spread = Number(q.get('spread') ?? 1);
    while (pj.feed.count < projTarget && guard++ < 200) {
      const s = Math.floor(rng() * STYLES.length);
      const a = rng() * Math.PI * 2;
      const sp = (STYLE_SPEED[s] as number) * (0.5 + rng() * 0.6);
      const x = (rng() - 0.5) * 30 * spread;
      const z = (rng() - 0.5) * 22 * spread;
      pj.spawn(x, z, Math.sin(a) * sp, Math.cos(a) * sp, s, rng() < 0.3 ? 1 : 0, 1.2 + rng() * 2.2);
    }
  };
  // gallery: every style in its own lane, friendly (top half) and hostile (bottom half), looping in place
  const gallerySetup = (): void => {
    if (mode !== 'gallery') return;
    pj.gallery = [];
    const lanes = STYLES.length;
    for (let hostile = 0; hostile < 2; hostile++) {
      for (let s = 0; s < lanes; s++) {
        const z = -9.5 + s * 1.15 + hostile * 0.0;
        const x0 = -13.5 + hostile * 14;
        pj.gallery.push({ x0, z: z + (hostile ? 0 : 0), style: s, hostile, speed: STYLE_SPEED[s] as number });
      }
    }
  };
  const pickGallerySetup = (): void => {
    if (mode !== 'gallery') return;
    pk.clear();
    // rows of every kind/tier on a grid, in the lower half of the view
    let row = 0;
    const put = (kind: number, tier: number, x: number, z: number, magnet = 0): void => {
      pk.spawn(x, z, kind, tier, magnet, 5 + row * 0, false);
    };
    for (let t = 0; t < 5; t++) put(0, t, -6 + t * 1.2, 3.0);
    for (let t = 0; t < 3; t++) put(1, t, 1 + t * 1.2, 3.0);
    put(2, 0, 5.5, 3.0);
    put(4, 0, 7.5, 3.0);
    for (let t = 0; t < 3; t++) put(3, t, -5 + t * 3.2, 6.2);
    for (let t = 0; t < 5; t++) put(0, t, -6 + t * 1.2, 4.6, 1);
    // dense gem carpet to judge clustering
    for (let i = 0; i < 120; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 2.4;
      pk.spawn(8 + Math.cos(a) * r, 4.6 + Math.sin(a) * r, 0, Math.floor(rng() * rng() * 5), 0, 5, false);
    }
    row = 1;
  };
  gallerySetup();
  pickGallerySetup();

  // --- pickup spawners ---------------------------------------------------------------------------------------------
  const randomPickup = (age: number): void => {
    const r = rng();
    let kind = 0;
    let tier = 0;
    if (r < 0.62) {
      kind = 0;
      const t = rng();
      tier = t < 0.5 ? 0 : t < 0.75 ? 1 : t < 0.88 ? 2 : t < 0.96 ? 3 : 4;
    } else if (r < 0.88) {
      kind = 1;
      tier = rng() < 0.7 ? 0 : rng() < 0.7 ? 1 : 2;
    } else if (r < 0.95) kind = 2;
    else if (r < 0.985) {
      kind = 3;
      tier = rng() < 0.6 ? 0 : rng() < 0.7 ? 1 : 2;
    } else kind = 4;
    // clustered around "kill spots"
    const cx = ((Math.floor(rng() * 9) * 3.7 + 1.3) % 30) - 15;
    const cz = ((Math.floor(rng() * 7) * 3.1 + 0.7) % 22) - 12;
    const x = rng() < 0.5 ? (rng() - 0.5) * 34 : cx + (rng() + rng() + rng() - 1.5) * 2.4;
    const z = rng() < 0.5 ? (rng() - 0.5) * 24 : cz + (rng() + rng() + rng() - 1.5) * 2.4;
    pk.spawn(x, z, kind, tier, 0, age, true);
  };
  const fillPickups = (): void => {
    let guard = 0;
    while (pk.feed.count < pickTarget && guard++ < 400) randomPickup(5 + rng() * 20);
    // trim
    while (pk.feed.count > pickTarget) pk.remove(pk.feed.count - 1);
  };

  // --- sim step ------------------------------------------------------------------------------------------------------
  let popAcc = 0;
  let magAcc = 0;
  const step = (dt: number): void => {
    if (mode === 'showcase') spawnShowcase(dt);
    else if (mode === 'stress') spawnStress();
    pj.step(dt, mode === 'gallery');
    if (mode !== 'gallery') {
      fillPickups();
      popAcc += dt * 7;
      while (popAcc >= 1) {
        popAcc -= 1;
        if (pk.feed.count > 0) pk.remove(Math.floor(rng() * pk.feed.count));
        randomPickup(0);
      }
      magAcc += dt * 3.5;
      while (magAcc >= 1) {
        magAcc -= 1;
        const i = Math.floor(rng() * pk.feed.count);
        if (pk.feed.count > 0 && Math.hypot(pk.feed.x[i] as number, pk.feed.z[i] as number) < 12) pk.magnet[i] = 1;
      }
    }
    pk.step(dt, mode === 'gallery');
  };

  // --- HUD ----------------------------------------------------------------------------------------------------------
  const hud = makeHud(q.get('hud') !== '0');
  const stats = { frame: 0, cpu: 0, n: 0, last: performance.now(), fps: 0, cpuAvg: 0, projMs: 0, pickMs: 0 };
  const gpu = makeGpuTimer(core.renderer);
  const refreshHud = (): void => {
    hud.text.textContent =
      `${core.quality.tier.toUpperCase()}  post ${postOn ? 'ON' : 'OFF'}  ${mode}\n` +
      `proj ${pj.feed.count}/${projTarget}  pick ${pk.feed.count}/${pickTarget}\n` +
      `fps ${stats.fps.toFixed(0)}  cpu ${stats.cpuAvg.toFixed(2)} ms  proj ${stats.projMs.toFixed(2)}  pick ${stats.pickMs.toFixed(2)}` +
      (gpu.available ? `  gpu ${gpu.avgMs.toFixed(2)} ms` : '');
  };
  const btn = (label: string, fn: () => void): void => hud.button(label, fn);
  btn('Post', () => {
    postOn = !postOn;
    applyPost();
  });
  for (const t of QUALITY_TIERS) btn(t, () => core.setQualitySetting(t));
  btn('Freeze', () => (frozen = !frozen));
  btn('Showcase', () => setMode('showcase'));
  btn('Stress', () => {
    projTarget = 1500;
    pickTarget = 1200;
    setMode('stress');
  });
  btn('Gallery', () => setMode('gallery'));

  // --- loop -----------------------------------------------------------------------------------------------------------
  let acc = 0;
  let last = performance.now();
  let benchSink: { cpu: number[]; dt: number[]; proj: number[]; pick: number[]; gpu: number[] } | null = null;
  const frameOnce = (dt: number, alpha: number): number => {
    const t0 = performance.now();
    sysTime.proj = 0;
    sysTime.pick = 0;
    gpu.begin();
    core.frame(dt, alpha);
    gpu.end();
    return performance.now() - t0;
  };
  const loop = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    if (!frozen) {
      acc += dt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
      }
    }
    const alpha = frozen ? 1 : acc / STEP;
    const cpu = frameOnce(dt, alpha);
    stats.frame++;
    stats.cpu += cpu;
    stats.n++;
    stats.projMs += sysTime.proj;
    stats.pickMs += sysTime.pick;
    if (benchSink) {
      benchSink.cpu.push(cpu);
      benchSink.dt.push(dt * 1000);
      benchSink.proj.push(sysTime.proj);
      benchSink.pick.push(sysTime.pick);
      if (gpu.available) benchSink.gpu.push(gpu.lastMs);
    }
    if (now - stats.last > 500) {
      stats.fps = (stats.n * 1000) / (now - stats.last);
      stats.cpuAvg = stats.cpu / stats.n;
      stats.projMs /= stats.n;
      stats.pickMs /= stats.n;
      stats.last = now;
      stats.n = 0;
      stats.cpu = 0;
      refreshHud();
      stats.projMs = 0;
      stats.pickMs = 0;
    }
    gpu.poll();
    requestAnimationFrame(loop);
  };
  const warm = Number(q.get('warm') ?? 0);
  for (let i = 0; i < warm; i++) step(STEP);
  requestAnimationFrame(loop);

  const summarize = (a: number[]): { avg: number; p50: number; p95: number; max: number } => {
    if (a.length === 0) return { avg: 0, p50: 0, p95: 0, max: 0 };
    const s = a.slice().sort((x, y) => x - y);
    return { avg: a.reduce((x, y) => x + y, 0) / a.length, p50: s[s.length >> 1] as number, p95: s[Math.floor(s.length * 0.95)] as number, max: s[s.length - 1] as number };
  };

  const api = {
    core,
    setMode,
    setProj(n: number): void {
      projTarget = Math.min(PROJ_CAP, n);
    },
    setPick(n: number): void {
      pickTarget = Math.min(PICK_CAP, n);
    },
    setPost(on: boolean): void {
      postOn = on;
      applyPost();
    },
    setTier(t: QualityTier): void {
      core.setQualitySetting(t);
    },
    freeze(on: boolean): void {
      frozen = on;
    },
    hideUI(on = true): void {
      hud.root.style.display = on ? 'none' : '';
    },
    cam(x: number, z: number, zoom = 22): void {
      core.rig.setTarget(x, hf(x, z), z);
      core.rig.zoom = zoom;
      core.rig.snap();
    },
    counts: () => ({ proj: pj.feed.count, pick: pk.feed.count, mode, tier: core.quality.tier, post: postOn }),
    drawCalls: () => ({ ...core.renderer.info.render, programs: core.renderer.info.programs?.length ?? 0 }),
    /** rAF-paced measurement over `seconds`: frame interval, CPU time in core.frame, per-system update time, GPU timer (if exposed) */
    bench(seconds: number): Promise<unknown> {
      return new Promise((resolve) => {
        benchSink = { cpu: [], dt: [], proj: [], pick: [], gpu: [] };
        setTimeout(() => {
          const b = benchSink;
          benchSink = null;
          if (!b) return resolve(null);
          resolve({
            tier: core.quality.tier,
            post: postOn,
            proj: pj.feed.count,
            pick: pk.feed.count,
            interval: summarize(b.dt),
            cpuFrame: summarize(b.cpu),
            projUpdate: summarize(b.proj),
            pickUpdate: summarize(b.pick),
            gpu: gpu.available ? summarize(b.gpu) : null,
          });
        }, seconds * 1000);
      });
    },
    /** Unpaced throughput: N back-to-back frames + gl.finish() → ms per frame (max of CPU and GPU cost). */
    benchSync(frames: number): { msPerFrame: number; frames: number } {
      const gl = core.renderer.getContext();
      gl.finish();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) core.frame(1 / 60, 1);
      gl.finish();
      return { msPerFrame: (performance.now() - t0) / frames, frames };
    },
    gpuInfo(): string {
      const gl = core.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown');
    },
  };
  window.__fx = api;
}

// =================================================================================================================
// Pickup stand-ins (demo only): FORGE's real `pickup` GLBs / DevPlaceholders may not exist yet. These local models
// follow the same contract (metres, Y-up, vertex colours, +Z front) so the Pickups system is exercised end to end.
// Disable with ?standin=0 to load whatever Assets provides.
// =================================================================================================================

type Rgb = readonly [number, number, number];

function paint(geo: BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => Rgb): BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  return geo;
}

function standInGem(): Group {
  const prof = [
    [0.001, 0],
    [0.2, 0.15],
    [0.34, 0.29],
    [0.34, 0.33],
    [0.25, 0.45],
    [0.001, 0.5],
  ].map(([x, y]) => new Vector2(x, y));
  const g = new LatheGeometry(prof, 8).toNonIndexed();
  g.computeVertexNormals();
  paint(g, (x, y, z, _nx, ny) => {
    const s = 0.55 + 0.4 * Math.max(0, ny * 0.6 + 0.4) + 0.1 * Math.sin(Math.atan2(z, x) * 8 + 1);
    return [s, s, s];
  });
  const root = new Group();
  root.add(new Mesh(g, new MeshBasicMaterial()));
  return root;
}

function standInCoin(): Group {
  const shape = new Shape();
  shape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
  const hole = new Path();
  hole.moveTo(-0.11, -0.11);
  hole.lineTo(-0.11, 0.11);
  hole.lineTo(0.11, 0.11);
  hole.lineTo(0.11, -0.11);
  hole.closePath();
  shape.holes.push(hole);
  const g = new ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 40 });
  g.translate(0, 0, -0.0475);
  paint(g, (x, y) => {
    const r = Math.hypot(x, y);
    const rim = Math.min(1, Math.max(0, (r - 0.4) / 0.12));
    return [0.95 * (1 - rim) + 0.6 * rim, 0.62 * (1 - rim) + 0.36 * rim, 0.12 * (1 - rim) + 0.06 * rim];
  });
  const root = new Group();
  root.add(new Mesh(g, new MeshBasicMaterial()));
  return root;
}

function standInPotion(): Group {
  const prof = [
    [0.001, 0],
    [0.22, 0],
    [0.3, 0.08],
    [0.34, 0.24],
    [0.3, 0.4],
    [0.18, 0.52],
    [0.1, 0.58],
    [0.1, 0.7],
    [0.13, 0.74],
    [0.13, 0.78],
    [0.001, 0.78],
  ].map(([x, y]) => new Vector2(x, y));
  const g = new LatheGeometry(prof, 24);
  paint(g, (_x, y) => (y < 0.5 ? [0.72, 0.04, 0.07] : y < 0.72 ? [0.78, 0.85, 0.9] : [0.62, 0.42, 0.24]));
  const root = new Group();
  root.add(new Mesh(g, new MeshBasicMaterial()));
  return root;
}

function standInChest(wood: Rgb, band: Rgb, lock: Rgb, gem: Rgb | null): Group {
  const root = new Group();
  const add = (geo: BufferGeometry, c: Rgb, x: number, y: number, z: number): void => {
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    paint(geo, () => c);
    const m = new Mesh(geo, new MeshBasicMaterial());
    m.position.set(x, y, z);
    root.add(m);
  };
  add(new BoxGeometry(1.0, 0.45, 0.68), wood, 0, 0.225, 0);
  add(new CylinderGeometry(0.34, 0.34, 1.0, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood, 0, 0.45, 0);
  for (const x of [-0.32, 0.32]) {
    add(new BoxGeometry(0.08, 0.47, 0.7), band, x, 0.225, 0);
    add(new CylinderGeometry(0.352, 0.352, 0.08, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), band, x, 0.45, 0);
  }
  add(new BoxGeometry(0.16, 0.2, 0.06), lock, 0, 0.42, 0.35);
  if (gem) add(new BoxGeometry(0.1, 0.1, 0.05), gem, 0, 0.42, 0.385);
  return root;
}

function installStandIns(assets: Assets): void {
  const makers: Record<string, () => Group> = {
    xp_gem: standInGem,
    yeop_coin: standInCoin,
    potion_hp: standInPotion,
    chest_wood: () => standInChest([0.22, 0.11, 0.05], [0.16, 0.16, 0.18], [0.7, 0.55, 0.2], null),
    chest_gold: () => standInChest([0.33, 0.04, 0.03], [0.9, 0.6, 0.1], [0.95, 0.7, 0.15], null),
    chest_boss: () => standInChest([0.06, 0.025, 0.045], [0.95, 0.68, 0.14], [0.95, 0.7, 0.15], [1.0, 0.08, 0.06]),
  };
  const loaded = new Map<string, LoadedModel>();
  for (const [id, make] of Object.entries(makers)) {
    const scene = make();
    scene.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    const asset: ModelAsset = { id, url: '', kind: 'pickup', height: 0.5, radius: 0.3, clips: {}, tris: 0, bones: 0, bytes: 0 };
    loaded.set(id, { id, asset, scene, clips: [], clipMap: new Map(), skinned: [], meshes, extras: {}, placeholder: true });
  }
  const origLoad = assets.loadBatch.bind(assets);
  const origModel = assets.model.bind(assets);
  assets.loadBatch = (reqs, onProgress) => origLoad(reqs.filter((r) => !(r.kind === 'model' && loaded.has(r.id))), onProgress);
  assets.model = (id) => loaded.get(id) ?? origModel(id);
}

// =================================================================================================================
// helpers
// =================================================================================================================

function timed(sys: RenderSystem, add: (ms: number) => void): RenderSystem {
  return {
    name: sys.name,
    update(dt, alpha): void {
      const t0 = performance.now();
      sys.update(dt, alpha);
      add(performance.now() - t0);
    },
    onResize: sys.onResize ? (w, hh, pr): void => sys.onResize?.(w, hh, pr) : undefined,
    dispose: () => sys.dispose?.(),
  };
}

function makeGround(hf: (x: number, z: number) => number): Mesh {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(S, S);
  const rnd = mulberry32(77);
  const lat: Float32Array[] = [];
  const dims = [8, 16, 32, 64, 128];
  for (const d of dims) {
    const a = new Float32Array(d * d);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    lat.push(a);
  }
  const sample = (li: number, u: number, v: number): number => {
    const d = dims[li] as number;
    const a = lat[li] as Float32Array;
    const x = u * d;
    const y = v * d;
    const x0 = Math.floor(x) % d;
    const y0 = Math.floor(y) % d;
    const x1 = (x0 + 1) % d;
    const y1 = (y0 + 1) % d;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = a[y0 * d + x0] as number;
    const v10 = a[y0 * d + x1] as number;
    const v01 = a[y1 * d + x0] as number;
    const v11 = a[y1 * d + x1] as number;
    return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = sample(0, u, v) * 0.35 + sample(1, u, v) * 0.25 + sample(2, u, v) * 0.18 + sample(3, u, v) * 0.13 + sample(4, u, v) * 0.09;
      const dirt = Math.min(1, Math.max(0, (sample(1, u + 0.31, v + 0.17) - 0.52) * 5));
      const grass = [58 + n * 60, 92 + n * 70, 46 + n * 40];
      const earth = [118 + n * 50, 98 + n * 40, 70 + n * 30];
      const o = (y * S + x) * 4;
      img.data[o] = grass[0]! * (1 - dirt) + earth[0]! * dirt;
      img.data[o + 1] = grass[1]! * (1 - dirt) + earth[1]! * dirt;
      img.data[o + 2] = grass[2]! * (1 - dirt) + earth[2]! * dirt;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.anisotropy = 8;
  const geo = new PlaneGeometry(220, 220, 220, 220).rotateX(-Math.PI / 2);
  const gp = geo.getAttribute('position');
  for (let i = 0; i < gp.count; i++) gp.setY(i, hf(gp.getX(i), gp.getZ(i)));
  geo.computeVertexNormals();
  const m = new Mesh(geo, new MeshLambertMaterial({ map: tex }));
  m.receiveShadow = true;
  return m;
}

function makeDummies(rng: () => number, hf: (x: number, z: number) => number): Object3D {
  const root = new Object3D();
  const n = 220;
  const body = new InstancedMesh(new CapsuleGeometry(0.34, 0.85, 4, 10), new MeshLambertMaterial({ color: '#ffffff' }), n);
  const head = new InstancedMesh(new SphereGeometry(0.24, 12, 10), new MeshLambertMaterial({ color: '#ffffff' }), n);
  body.castShadow = true;
  head.castShadow = true;
  const o = new Object3D();
  const col = new Color();
  const palette = ['#6b5a45', '#7d4a3a', '#4f5a46', '#5a5e68', '#8a7355', '#3f3a36'];
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = 3.2 + Math.sqrt(rng()) * 16;
    const s = 0.8 + rng() * 0.6;
    const px = Math.sin(a) * r;
    const pz = Math.cos(a) * r * 0.8;
    o.position.set(px, 0.7 * s + 0.1 + hf(px, pz), pz);
    o.rotation.set(0, rng() * 6.28, 0);
    o.scale.setScalar(s);
    o.updateMatrix();
    body.setMatrixAt(i, o.matrix);
    body.setColorAt(i, col.set(palette[Math.floor(rng() * palette.length)] as string));
    o.position.y += 0.78 * s;
    o.updateMatrix();
    head.setMatrixAt(i, o.matrix);
    head.setColorAt(i, col.set('#a99070'));
  }
  body.instanceMatrix.setUsage(DynamicDrawUsage);
  root.add(body, head);
  return root;
}

/** emissive objects at increasing HDR intensities: bloom threshold / falloff / wash-out check */
function makeBloomProps(): Object3D {
  const root = new Object3D();
  const gain = [1.0, 2.0, 4.0, 8.0, 16.0];
  for (let i = 0; i < gain.length; i++) {
    const mat = new MeshBasicMaterial({ color: new Color('#ff7a2a').multiplyScalar(gain[i] as number) });
    const s = new Mesh(new SphereGeometry(0.42, 24, 16), mat);
    s.position.set(-11 + i * 1.7, 0.9, -8.5);
    root.add(s);
  }
  const rune = new Mesh(new RingGeometry(1.7, 2.1, 64), new MeshBasicMaterial({ color: new Color('#58d8ff').multiplyScalar(3.2), side: 2 }));
  rune.rotation.x = -Math.PI / 2;
  rune.position.set(9.5, 0.04, -7.5);
  root.add(rune);
  const inner = new Mesh(new TorusGeometry(1.0, 0.07, 10, 48), new MeshBasicMaterial({ color: new Color('#b6f0ff').multiplyScalar(5) }));
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(9.5, 0.12, -7.5);
  root.add(inner);
  const lava = new Mesh(new PlaneGeometry(4.4, 1.8), new MeshBasicMaterial({ color: new Color('#ff5a14').multiplyScalar(2.2) }));
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(-6.5, 0.03, -11.2);
  root.add(lava);
  const white = new Mesh(new PlaneGeometry(2.4, 1.2), new MeshLambertMaterial({ color: '#e6e6e6' }));
  white.rotation.x = -Math.PI / 2;
  white.position.set(3.5, 0.03, -11.2);
  root.add(white);
  return root;
}

interface GalleryLane {
  x0: number;
  z: number;
  style: number;
  hostile: number;
  speed: number;
}

function makeProjectileState(): {
  feed: ProjectileFeed;
  gallery: GalleryLane[];
  spawn: (x: number, z: number, vx: number, vz: number, style: number, hostile: number, life: number) => void;
  step: (dt: number, gallery: boolean) => void;
  clear: () => void;
} {
  const feed = {
    count: 0,
    x: new Float32Array(PROJ_CAP),
    z: new Float32Array(PROJ_CAP),
    px: new Float32Array(PROJ_CAP),
    pz: new Float32Array(PROJ_CAP),
    h: new Float32Array(PROJ_CAP),
    rot: new Float32Array(PROJ_CAP),
    radius: new Float32Array(PROJ_CAP),
    style: new Uint8Array(PROJ_CAP),
    hostile: new Uint8Array(PROJ_CAP),
    age: new Float32Array(PROJ_CAP),
  };
  const vx = new Float32Array(PROJ_CAP);
  const vz = new Float32Array(PROJ_CAP);
  const life = new Float32Array(PROJ_CAP);
  const lane = new Int16Array(PROJ_CAP).fill(-1);
  const st = { gallery: [] as GalleryLane[] };

  const copy = (dst: number, src: number): void => {
    feed.x[dst] = feed.x[src] as number;
    feed.z[dst] = feed.z[src] as number;
    feed.px[dst] = feed.px[src] as number;
    feed.pz[dst] = feed.pz[src] as number;
    feed.h[dst] = feed.h[src] as number;
    feed.rot[dst] = feed.rot[src] as number;
    feed.radius[dst] = feed.radius[src] as number;
    feed.style[dst] = feed.style[src] as number;
    feed.hostile[dst] = feed.hostile[src] as number;
    feed.age[dst] = feed.age[src] as number;
    vx[dst] = vx[src] as number;
    vz[dst] = vz[src] as number;
    life[dst] = life[src] as number;
    lane[dst] = lane[src] as number;
  };

  const spawn = (x: number, z: number, svx: number, svz: number, style: number, hostile: number, l: number): void => {
    if (feed.count >= PROJ_CAP) return;
    const i = feed.count++;
    feed.x[i] = feed.px[i] = x;
    feed.z[i] = feed.pz[i] = z;
    feed.h[i] = 0.9 + (hostile ? 0.1 : 0);
    feed.rot[i] = Math.atan2(svx, svz);
    feed.radius[i] = STYLE_RADIUS[style] ?? 0.32;
    feed.style[i] = style;
    feed.hostile[i] = hostile;
    feed.age[i] = 0;
    vx[i] = svx;
    vz[i] = svz;
    life[i] = l;
    lane[i] = -1;
  };

  const step = (dt: number, gallery: boolean): void => {
    if (gallery) {
      // keep one projectile per lane, looping along +x
      if (feed.count === 0) {
        st.gallery.forEach((g, gi) => {
          spawn(g.x0, g.z, g.speed, 0, g.style, g.hostile, 1e9);
          lane[feed.count - 1] = gi;
          feed.x[feed.count - 1] = g.x0;
          feed.h[feed.count - 1] = 0.9;
        });
      }
      for (let i = 0; i < feed.count; i++) {
        const g = st.gallery[lane[i] as number];
        feed.px[i] = feed.x[i] as number;
        feed.pz[i] = feed.z[i] as number;
        feed.x[i] = (feed.x[i] as number) + (vx[i] as number) * dt;
        feed.age[i] = (feed.age[i] as number) + dt;
        if (g && (feed.x[i] as number) > g.x0 + 12) {
          feed.x[i] = g.x0;
          feed.px[i] = g.x0;
          feed.age[i] = 0;
        }
      }
      return;
    }
    for (let i = 0; i < feed.count; ) {
      feed.px[i] = feed.x[i] as number;
      feed.pz[i] = feed.z[i] as number;
      feed.x[i] = (feed.x[i] as number) + (vx[i] as number) * dt;
      feed.z[i] = (feed.z[i] as number) + (vz[i] as number) * dt;
      feed.age[i] = (feed.age[i] as number) + dt;
      life[i] = (life[i] as number) - dt;
      if ((life[i] as number) <= 0) {
        feed.count--;
        if (i !== feed.count) copy(i, feed.count);
        continue;
      }
      i++;
    }
  };

  return {
    feed,
    get gallery() {
      return st.gallery;
    },
    set gallery(g: GalleryLane[]) {
      st.gallery = g;
    },
    spawn,
    step,
    clear(): void {
      feed.count = 0;
    },
  };
}

function makePickupState(): {
  feed: PickupFeed & { px: Float32Array; pz: Float32Array };
  magnet: Uint8Array;
  spawn: (x: number, z: number, kind: number, tier: number, magnet: number, age: number, popping: boolean) => void;
  remove: (i: number) => void;
  step: (dt: number, frozenLayout: boolean) => void;
  clear: () => void;
} {
  const feed = {
    count: 0,
    x: new Float32Array(PICK_CAP),
    z: new Float32Array(PICK_CAP),
    px: new Float32Array(PICK_CAP),
    pz: new Float32Array(PICK_CAP),
    kind: new Uint8Array(PICK_CAP),
    tier: new Uint8Array(PICK_CAP),
    age: new Float32Array(PICK_CAP),
    magnet: new Uint8Array(PICK_CAP),
    h: new Float32Array(PICK_CAP),
  };
  const speed = new Float32Array(PICK_CAP);
  const copy = (d: number, s: number): void => {
    for (const k of ['x', 'z', 'px', 'pz', 'kind', 'tier', 'age', 'magnet', 'h'] as const) feed[k][d] = feed[k][s] as number;
    speed[d] = speed[s] as number;
  };
  return {
    feed,
    magnet: feed.magnet,
    spawn(x, z, kind, tier, magnet, age): void {
      if (feed.count >= PICK_CAP) return;
      const i = feed.count++;
      feed.x[i] = feed.px[i] = x;
      feed.z[i] = feed.pz[i] = z;
      feed.kind[i] = kind;
      feed.tier[i] = tier;
      feed.magnet[i] = magnet;
      feed.age[i] = age;
      feed.h[i] = 0;
      speed[i] = 0;
    },
    remove(i): void {
      feed.count--;
      if (i !== feed.count) copy(i, feed.count);
    },
    step(dt, frozenLayout): void {
      for (let i = 0; i < feed.count; ) {
        feed.px[i] = feed.x[i] as number;
        feed.pz[i] = feed.z[i] as number;
        feed.age[i] = (feed.age[i] as number) + dt;
        const a = feed.age[i] as number;
        feed.h[i] = a < 0.4 ? 0.9 * 4 * (a / 0.4) * (1 - a / 0.4) : 0;
        if (feed.magnet[i]) {
          const dx = -(feed.x[i] as number);
          const dz = -(feed.z[i] as number);
          const d = Math.hypot(dx, dz);
          speed[i] = Math.min(24, (speed[i] as number) + 38 * dt);
          if (d < 0.7 && !frozenLayout) {
            feed.count--;
            if (i !== feed.count) copy(i, feed.count);
            continue;
          }
          const k = (Math.min(speed[i] as number, d / Math.max(dt, 1e-4)) * dt) / Math.max(d, 1e-4);
          feed.x[i] = (feed.x[i] as number) + dx * k;
          feed.z[i] = (feed.z[i] as number) + dz * k;
          if (frozenLayout && d < 0.7) {
            feed.x[i] = feed.px[i] = 8;
            feed.z[i] = feed.pz[i] = 4;
            speed[i] = 0;
          }
        }
        i++;
      }
    },
    clear(): void {
      feed.count = 0;
    },
  };
}

function makeHud(visible: boolean): { root: HTMLDivElement; text: HTMLPreElement; button: (label: string, fn: () => void) => void } {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:10;font:12px/1.35 ui-monospace,Consolas,monospace;color:#fff;background:rgba(10,8,6,.62);padding:6px 8px;border-radius:6px;pointer-events:auto;max-width:560px';
  if (!visible) root.style.display = 'none';
  const text = document.createElement('pre');
  text.style.cssText = 'margin:0 0 6px;white-space:pre';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
  root.append(text, row);
  document.body.append(root);
  return {
    root,
    text,
    button(label, fn): void {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:inherit;padding:2px 7px;background:#2a2118;color:#fff;border:1px solid #6b5a45;border-radius:4px;cursor:pointer';
      b.addEventListener('click', fn);
      row.append(b);
    },
  };
}

/** EXT_disjoint_timer_query_webgl2 wrapper (when the browser exposes it). */
function makeGpuTimer(renderer: WebGLRenderer): {
  available: boolean;
  avgMs: number;
  lastMs: number;
  begin: () => void;
  end: () => void;
  poll: () => void;
} {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const pending: WebGLQuery[] = [];
  const t = { available: !!ext, avgMs: 0, lastMs: 0 };
  let active: WebGLQuery | null = null;
  return {
    get available() {
      return t.available;
    },
    get avgMs() {
      return t.avgMs;
    },
    get lastMs() {
      return t.lastMs;
    },
    begin(): void {
      if (!ext || active || pending.length > 6) return;
      const qy = gl.createQuery();
      if (!qy) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, qy);
      active = qy;
    },
    end(): void {
      if (!ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll(): void {
      if (!ext) return;
      const qy = pending[0];
      if (!qy) return;
      if (!gl.getQueryParameter(qy, gl.QUERY_RESULT_AVAILABLE)) return;
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      if (!disjoint) {
        t.lastMs = (gl.getQueryParameter(qy, gl.QUERY_RESULT) as number) / 1e6;
        t.avgMs = t.avgMs === 0 ? t.lastMs : t.avgMs * 0.9 + t.lastMs * 0.1;
      }
      gl.deleteQuery(qy);
    },
  };
}
