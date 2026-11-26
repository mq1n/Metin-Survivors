// VFX gallery (dev only): every preset looping in a grid at the game camera angle + a stress mode.
//   /vfx.html?cat=hit&page=0&q=high        category page          (cat=all|hit|melee|…, ids=a,b,c to pick)
//   /vfx.html?stress=300&q=high            stress mode: N simultaneous effects over a crowd
//   &dpr=1  &bloom=0.55  &cols=4  &t=0.3 (freeze after t seconds)  &bench=1 (gpu-finish timing)


//   &classes=warrior,ninja  loads only these skill classes (default: all five + the common pack); the page awaits them before it builds anything
import { NoToneMapping, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { Assets } from '../../engine/assets';
import { createVfx } from '../index';
import { PRESETS } from '../presets';
import { ensureAllSkillVfx, ensureSkillVfx } from '../skills/loader';
import { DEV_SPEC_PRESETS } from '../spec/demo';
import { SPEC_REGISTRY, specPreset } from '../spec/preset';
import type { FxSpec, StandInPose, StandInSwing } from '../spec/types';
import type { PresetDef } from '../presets/types';
import type { Vfx, VfxQuality } from '../types';
import { HdrPost } from './post';
import { StandInBody } from './standin';
import { createWorld, heightAt as roughHeightAt } from './world';

const params = new URLSearchParams(location.search);
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
const origError = console.error;
console.error = (...a: unknown[]) => {
  errors.push(a.map(String).join(' '));
  origError(...a);
};

// the class specs are lazy chunks (skills/loader.ts): the VfxSystem below compiles the registry as it is when it is built, and `cats` reads PRESETS
const classesParam = params.get('classes');
await (classesParam ? ensureSkillVfx(classesParam.split(',').map((c) => c.trim()).filter(Boolean)) : ensureAllSkillVfx());


const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const dpr = Number(params.get('dpr') ?? Math.min(window.devicePixelRatio || 1, 1.5));
const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = NoToneMapping;
renderer.setClearColor('#0b0d10');

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 220);
const PITCH = (55 * Math.PI) / 180;
const focus = new Vector3();
let camDist = 22;
function placeCamera(): void {
  camera.position.set(focus.x, focus.y + Math.sin(PITCH) * camDist, focus.z + Math.cos(PITCH) * camDist);
  camera.lookAt(focus);
  camera.updateMatrixWorld();
}

const flat = params.has('flat') && params.get('flat') !== '0';
/** ground height under the gallery's effects (0 everywhere with &flat=1) */
const heightAt: (x: number, z: number) => number = flat ? () => 0 : roughHeightAt;
const world = createWorld({ flat });
const standBody = new StandInBody();
world.scene.add(standBody.group);
const post = new HdrPost(renderer, Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
post.strength = Number(params.get('bloom') ?? 0.55);
const quality = (params.get('q') ?? 'high') as VfxQuality;
const vfx: Vfx = createVfx(world.scene, camera, renderer, quality, { heightAt });
if (params.has('soft')) vfx.setDepthTexture(post.depth, camera.near, camera.far);
// C4 A/B: &legacyKit=1 draws the pre-soft-kit rings / pillars / flashes
if (params.has('legacyKit')) (vfx as unknown as { fx: { legacyKit: boolean } }).fx.legacyKit = true;
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  post.setSize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  layout();
});

// ------------------------------------------------------------------------------------------------ UI
const bar = document.createElement('div');
bar.id = 'bar';
ui.appendChild(bar);
const hud = document.createElement('div');
hud.id = 'hud';
ui.appendChild(hud);
const labels = document.createElement('div');
ui.appendChild(labels);

const cats = ['all', ...Array.from(new Set(PRESETS.map((p) => p.cat)))];
let cat = params.get('cat') ?? 'hit';
let page = Number(params.get('page') ?? 0);
const cols = Number(params.get('cols') ?? 4);
const rows = Number(params.get('rows') ?? 3);
let stress = Number(params.get('stress') ?? 0);
const idsParam = params.get('ids');
/** &rank=0..7: skill rank of every spawn (1,2,3,M1,M2,G1,G2,P → `sk.*` grade escalation); __gallery.setRank(n) */
let galleryRank = Number(params.get('rank') ?? 0);

function button(text: string, on: () => void, active = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (active) b.classList.add('on');
  b.onclick = on;
  bar.appendChild(b);
  return b;
}

function rebuildBar(): void {
  bar.textContent = '';
  for (const c of cats) button(c, () => { cat = c; page = 0; stress = 0; layout(); rebuildBar(); }, c === cat && stress === 0);
  button('◀', () => { page = Math.max(0, page - 1); layout(); });
  button('▶', () => { page += 1; layout(); });
  button('stress 300', () => { stress = stress ? 0 : 300; layout(); rebuildBar(); }, stress > 0);
  const sel = document.createElement('select');
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const o = document.createElement('option');
    o.value = q;
    o.textContent = q;
    if (q === vfx.stats().quality) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => vfx.setQuality(sel.value as VfxQuality);
  bar.appendChild(sel);
}

// ------------------------------------------------------------------------------------------------ cells
interface Cell {
  def: PresetDef;
  id: string;
  x: number;
  z: number;
  next: number;
  handle: number;
  label: HTMLDivElement;
}
let cells: Cell[] = [];

interface Entry {
  def: PresetDef;
  id: string;
}

/** entries of the current page source; `ids=` accepts base ids and palette variants (`melee.slash.gold`) */
function pool(): Entry[] {
  if (idsParam) {
    const out: Entry[] = [];
    for (const id of idsParam.split(',')) {
      const all = [...PRESETS, ...DEV_SPEC_PRESETS];
      const def = vfx.has(id) ? all.find((p) => p.id === id) ?? all.find((p) => id.startsWith(p.id + '.')) : undefined;
      if (def) out.push({ def, id });
    }
    return out;
  }
  return (cat === 'all' ? PRESETS : PRESETS.filter((p) => p.cat === cat)).map((def) => ({ def, id: def.id }));
}

const SPACING = 9.5;

function layout(): void {
  labels.textContent = '';
  cells = [];
  vfx.clear();
  if (stress > 0) {
    world.hero.visible = true;
    world.hero.position.set(0, heightAt(0, 0), 0);
    world.setCrowd(Math.min(600, Math.round(stress * 1.7)), 14);
    focus.set(0, heightAt(0, 0), 0);
    camDist = 22;
    placeCamera();
    return;
  }
  world.setCrowd(0, 0);
  const list = pool();
  const per = cols * rows;
  const pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages - 1);
  const slice = list.slice(page * per, page * per + per);
  const w = Math.min(cols, slice.length) || 1;
  const h = Math.ceil(slice.length / cols) || 1;
  focus.set(0, 0, 0);
  camDist = params.has('zoom') ? Number(params.get('zoom')) : Math.max(20, Math.max(w * SPACING * 0.62, h * SPACING * 0.95) + 4);
  placeCamera();
  slice.forEach(({ def, id }, i) => {
    const cx = (i % cols - (w - 1) / 2) * SPACING;
    const cz = (Math.floor(i / cols) - (h - 1) / 2) * SPACING;
    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = `${id}<small>${def.desc}</small>`;
    labels.appendChild(label);
    cells.push({ def, id, x: cx, z: cz, next: 0.1 + i * 0.07, handle: 0, label });
  });
  positionLabels();
  hud.dataset.pages = `${page + 1}/${pages}`;
}

const tmp = new Vector3();
function positionLabels(): void {
  for (const c of cells) {
    tmp.set(c.x, heightAt(c.x, c.z), c.z + SPACING * 0.46);
    tmp.project(camera);
    c.label.style.left = `${(tmp.x * 0.5 + 0.5) * window.innerWidth}px`;
    c.label.style.top = `${(-tmp.y * 0.5 + 0.5) * window.innerHeight}px`;
  }
}

// ------------------------------------------------------------------------------------------------ demo spawns
const scratch = { x: 0, z: 0, y: undefined as number | undefined, dirX: 0, dirZ: -1, tx: 0, tz: 0, hasTarget: false, scale: undefined as number | undefined, duration: 0, element: undefined as number | undefined, rank: 0 };

function spawnCell(c: Cell, now: number): void {
  const def = c.def;
  const d = def.demo;
  const dir = d?.dir ?? 0;
  scratch.x = c.x;
  scratch.z = c.z;
  scratch.y = def.cat === 'hit' ? heightAt(c.x, c.z) + 0.9 : undefined;
  scratch.dirX = Math.sin(dir);
  scratch.dirZ = -Math.cos(dir);
  const reach = d?.target ?? 4.2;
  scratch.hasTarget = def.needsTarget === true || d?.target !== undefined;
  scratch.tx = c.x + scratch.dirX * reach;
  scratch.tz = c.z + scratch.dirZ * reach;
  scratch.scale = undefined;
  scratch.rank = galleryRank;
  scratch.duration = def.loop ? Math.min(def.dur > 0 ? def.dur : 3, d?.loopFor ?? 3.2) : 0;
  c.handle = vfx.spawn(c.id, scratch);
  const life = def.loop ? scratch.duration + 0.9 : def.dur > 0 ? def.dur + 1.1 : 1.7;
  c.next = now + life;
}

const STRESS_MIX: ReadonlyArray<readonly [string, number, number]> = [
  ['hit.physical', 30, 0], ['hit.fire', 12, 1], ['hit.ice', 9, 2], ['hit.lightning', 10, 3], ['hit.dark', 8, 4],
  ['hit.poison', 7, 5], ['hit.holy', 6, 6], ['hit.wind', 5, 7], ['hit.crit', 10, 0], ['death.dust', 6, 0],
  ['death.undead', 3, 0], ['death.orc', 3, 0], ['death.animal', 3, 0], ['melee.slash.gold', 3, 0], ['melee.claw.red', 1.5, 0],
  ['shock.wave.ice', 0.7, 2], ['shock.wave', 0.8, 0], ['spin.blades.gold', 0, 0], ['sky.lightning', 0.35, 3],
  ['zone.poison', 0.3, 5], ['chain.bolt.blue', 1.2, 3], ['sky.meteor.fire', 0.25, 1], ['pickup.xp', 6, 0],
  ['ult.storm', 0.25, 3], ['ult.anvilfall.gold', 0.2, 0], ['ult.frostlance.ice', 0.2, 2], ['ult.dragonbreath', 0.2, 1], ['ult.novabeam', 0.15, 6], ['ult.blizzard', 0.15, 2],
];
const MIX_TOTAL = STRESS_MIX.reduce((a, m) => a + m[1], 0);
let stressAcc = 0;
const sOpts = { x: 0, z: 0, dirX: 0, dirZ: 1, scale: 1, tx: 0, tz: 0, hasTarget: false, y: 0 as number | undefined, duration: 0 };

function stressSpawn(dt: number): void {
  // average effect life ≈ 0.7 s → spawn rate for N simultaneous
  stressAcc += (stress / 0.7) * dt;
  let guard = 0;
  while (stressAcc >= 1 && guard++ < 40) {
    stressAcc -= 1;
    let r = Math.random() * MIX_TOTAL;
    let pick = STRESS_MIX[0] as readonly [string, number, number];
    for (const m of STRESS_MIX) {
      r -= m[1];
      if (r <= 0) { pick = m; break; }
    }
    const i = (Math.random() * world.crowdCount) | 0;
    const ex = world.crowdPos[i * 4] as number;
    const ez = world.crowdPos[i * 4 + 1] as number;
    const id = pick[0];
    const isHit = id.startsWith('hit.');
    sOpts.x = isHit ? ex : ex + (Math.random() - 0.5) * 3;
    sOpts.z = isHit ? ez : ez + (Math.random() - 0.5) * 3;
    sOpts.y = isHit ? heightAt(ex, ez) + 0.9 : undefined;
    const a = Math.random() * 6.283;
    sOpts.dirX = Math.sin(a);
    sOpts.dirZ = Math.cos(a);
    sOpts.scale = id.startsWith('shock') ? 3.5 : id.startsWith('zone') ? 2.5 : id.startsWith('sky') ? 1.6 : 1;
    sOpts.hasTarget = id.startsWith('chain');
    sOpts.tx = sOpts.x + Math.sin(a) * 3.5;
    sOpts.tz = sOpts.z + Math.cos(a) * 3.5;
    sOpts.duration = id.startsWith('zone') ? 2.5 : 0;
    vfx.spawn(id, sOpts);
  }
}

// ------------------------------------------------------------------------------------------------ loop
// &det=1: paused from the first frame, so time + RNG only move through __gallery.advance() → byte-identical captures
let paused = params.has('det');
let last = performance.now();
let simTime = 0;
let fps = 60;
let frameMs = 16;
let renderMs = 0;
const freezeAt = params.has('t') ? Number(params.get('t')) : -1;
const bench = params.has('bench');
const gl = renderer.getContext();

function frame(nowMs: number): void {
  const rawDt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  frameMs += (rawDt * 1000 - frameMs) * 0.05;
  fps += (1 / Math.max(rawDt, 1e-4) - fps) * 0.05;
  const dt = paused ? 0 : rawDt;
  if (dt > 0) {
    simTime += dt;
    if (stress > 0) {
      stressSpawn(dt);
      world.updateCrowd(dt);
    } else {
      for (const c of cells) if (simTime >= c.next) spawnCell(c, simTime);
    }
  }
  vfx.update(dt);
  const t0 = performance.now();
  post.render(world.scene, camera);
  if (bench) {
    gl.finish();
    renderMs += (performance.now() - t0 - renderMs) * 0.05;
  }
  const s = vfx.stats();
  hud.textContent =
    `fps ${fps.toFixed(0)}  frame ${frameMs.toFixed(1)}ms${bench ? `  render+gpu ${renderMs.toFixed(2)}ms` : ''}   q=${s.quality}\n` +
    `vfx draws ${s.drawCalls}  particles ${s.particles} (add ${s.particlesAdd} / alpha ${s.particlesAlpha})  shapes ${s.shapes}  ribbons ${s.ribbons}  debris ${s.debris}  loops ${s.loops}\n` +
    `spawned/frame ${s.spawnedThisFrame}  dropped ${s.droppedThisFrame}  cpu ${s.cpuMs.toFixed(2)}ms  tris~${(s.triangles / 1000).toFixed(0)}k   ${stress ? `STRESS ${stress}` : `page ${hud.dataset.pages ?? ''}`}`;
  if (freezeAt >= 0 && simTime >= freezeAt && !paused) paused = true;
  requestAnimationFrame(frame);
}

declare global {
  interface Window {
    __gallery: unknown;
    __vfxReady: boolean;
  }
}

// ------------------------------------------------------------------------------------------------ draft loader


// registered preset is renamed `sk.draft_<rest>` (re-registering a draft replaces its previous version).
let galleryAssets: Assets | null = null;

interface VfxInternals {
  defs?: Map<string, { def: PresetDef; palette: null; element: number; variant: number }>;
  spec?: { compile?: (spec: FxSpec) => { els?: unknown[] } };
}

interface DraftResult {
  from: string;
  id: string;
  renamed: boolean;
  ok: boolean;
  error?: string;
}

async function registerDrafts(specs: readonly FxSpec[]): Promise<DraftResult[]> {
  const inner = vfx as unknown as VfxInternals;
  if (!(inner.defs instanceof Map) || typeof inner.spec?.compile !== 'function') {
    throw new Error('registerDrafts: VfxSystem internals changed (defs / spec.compile): update vfx/gallery/main.ts');
  }
  const out: DraftResult[] = [];
  for (const draft of specs) {
    const from = draft.id;
    let id = from;
    const own = (x: string): boolean => x.startsWith('sk.draft_');
    if (vfx.has(id) && !own(id)) id = `sk.draft_${from.replace(/^sk\./, '')}`;
    const spec: FxSpec = { ...draft, id };
    const before = errors.length;
    try {
      const def = specPreset(spec);
      inner.defs.set(def.id, { def, palette: null, element: -1, variant: -1 });
      const c = inner.spec.compile(spec);
      const err = errors.slice(before).find((e) => e.includes(id));
      if (err || ((spec.elements?.length ?? 0) > 0 && (c.els?.length ?? 0) === 0)) throw new Error(err ?? 'compiled to no elements');
      out.push({ from, id, renamed: id !== from, ok: true });
    } catch (e) {
      out.push({ from, id, renamed: id !== from, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // sprites of the newly compiled specs (frames already loaded stay): the first play must not draw the fallback roles
  if (galleryAssets) await vfx.preloadArt?.(galleryAssets);
  return out;
}

window.__gallery = {
  vfx,
  world,
  camera,
  errors,
  renderer,
  post,
  flat,
  /** ground height at (x, z) (0 with &flat=1) */
  groundAt: (x: number, z: number) => heightAt(x, z),
  /** registered spec preset `id` → { behavior, size, base, … } (null for classic presets) */
  specInfo(id: string) {
    const s = SPEC_REGISTRY.find((x) => x.id === id);
    return s ? { id: s.id, behavior: s.behavior, size: s.size, base: s.base, dur: s.dur, follow: s.follow === true } : null;
  },
  allSpecInfo: () => SPEC_REGISTRY.map((s) => ({ id: s.id, behavior: s.behavior, size: s.size, base: s.base })),
  registerDrafts,
  

  standIn(x: number, z: number, t: number, mirror = 1, swing?: StandInSwing, yaw = Math.PI / 2, pose?: StandInPose) {
    const y = heightAt(x, z);
    world.hero.visible = false;
    vfx.setPlayer(0, x, z, y);
    (vfx as unknown as { standIn?(player: number, x: number, y: number, z: number, yaw: number, t: number, mirror?: number, swing?: StandInSwing, pose?: StandInPose): void }).standIn?.(0, x, y, z, yaw, t, mirror, swing, pose);
    standBody.place(x, y, z, yaw, t, mirror, swing, pose);
  },
  get paused() { return paused; },
  setPaused(p: boolean) { paused = p; },
  setStress(n: number) { stress = n; layout(); rebuildBar(); },
  setCat(c: string, p = 0) { cat = c; page = p; stress = 0; layout(); rebuildBar(); },
  setQuality(q: VfxQuality) { vfx.setQuality(q); },
  setRank(r: number) { galleryRank = r; },
  stats: () => vfx.stats(),
  fps: () => ({ fps, frameMs, renderMs }),
  /** advance deterministically by `seconds` without wall-clock (screenshots) */
  advance(seconds: number, step = 1 / 60) {
    let t = 0;
    while (t < seconds) {
      const d = Math.min(step, seconds - t);
      simTime += d;
      if (stress > 0) { stressSpawn(d); world.updateCrowd(d); } else { for (const c of cells) if (simTime >= c.next) spawnCell(c, simTime); }
      vfx.update(d);
      t += d;
    }
    post.render(world.scene, camera);
  },
  /** PNG data-URL of the last rendered frame (no DOM overlays); optional crop in canvas pixels */
  capture(x = 0, y = 0, w = canvas.width, h = canvas.height, type = 'image/png', quality = 0.92): string {
    post.render(world.scene, camera);
    if (x === 0 && y === 0 && w === canvas.width && h === canvas.height) return canvas.toDataURL(type, quality);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return c.toDataURL(type, quality);
  },
  /** respawn every cell now (screenshots): call, then advance(t) */
  respawn() { for (const c of cells) c.next = simTime; },
  cell(i: number) { return cells[i]; },
  get cells() { return cells.length; },
  get simTime() { return simTime; },
};

rebuildBar();
layout();
// generated sprites of the registered specs (`tex: { art }`) are packed before the first frame: no pop-in in captures
void (async () => {
  try {
    const assets = new Assets();
    galleryAssets = assets;
    await assets.init();
    await vfx.preloadArt?.(assets);
  } catch (err) {
    errors.push(`art preload: ${err instanceof Error ? err.message : String(err)}`);
  }
  window.__vfxReady = true;
  requestAnimationFrame(frame);
})();
