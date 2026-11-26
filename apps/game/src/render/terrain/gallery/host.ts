// Terrain gallery host (DEV): boots a RenderCore, builds a zone from a biome preset, runs zone systems, and offers
// camera presets (gameplay / wide / orbit), quality switch, system toggles and an fps / draw-call / GPU readout.
// Modes (gallery/modes/*.ts) decide which systems get built; `window.__gallery` exposes automation hooks.
import { MathUtils, Vector3 } from 'three';
import { Assets } from '../../../engine/assets';
import type { BiomePreset } from '../../../data/schema';
import { createTerrainField, type TerrainField } from '../../../world/terrainField';
import { RenderCore } from '../../core';
import { GpuTimer } from '../../perf';
import type { QualityTier } from '../../quality';
import { worldUniforms, type ZoneContext, type ZoneSystem } from '../zoneContext';
import { resolveBiome } from '../look';
import { GALLERY_BIOMES, GALLERY_ZONES } from './biomes';
import { applyDevTextureFallback } from './devTextures';
import { createActors, type GalleryActors } from './actors';

export type CamPreset = 'gameplay' | 'wide' | 'orbit';

export interface GalleryMode {
  /** build systems for `host.ctx`; call host.addSystem for each */
  build(host: GalleryHost): Promise<void> | void;
}

export interface GalleryStats {
  fps: number;
  /** wall-clock animation-frame interval (ms); -1 when unavailable */
  frameMs: number;
  /** synchronous update + render CPU time (ms); -1 when unavailable */
  cpuMs: number;
  gpuMs: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

const PANEL =
  'position:fixed;color:#e8dcc0;font:12px/1.4 ui-monospace,Consolas,monospace;background:rgba(12,8,6,.78);border:1px solid #6b4a24;border-radius:4px;padding:8px 10px;z-index:50';

export class GalleryHost {
  readonly core: RenderCore;
  readonly assets: Assets;
  field!: TerrainField;
  biome!: BiomePreset;
  ctx!: ZoneContext;
  readonly systems: ZoneSystem[] = [];
  cam: CamPreset = 'gameplay';
  zoneId = 'yeonmu';
  mode: GalleryMode | null = null;
  /** orbit/wide camera state */
  readonly orbit = { yaw: 0, pitch: 0.5, dist: 120, target: new Vector3() };
  /** gameplay focus (hero) */
  readonly hero = new Vector3();
  private readonly keys = new Set<string>();
  private readonly statsEl: HTMLElement;
  private readonly sysEl: HTMLElement;
  private frameTimes: number[] = [];
  private cpuTimes: number[] = [];
  private lastFrameStart = 0;
  private frameCpuStart = 0;
  private lastCpuSample = -1;
  private cpuSampleSeq = 0;
  private busy = false;
  onZoneBuilt: (() => void) | null = null;
  /** place a hero + enemies around the hero focus (contrast check); `?actors=1` */
  showActors = false;
  private actors: GalleryActors | null = null;

  private constructor(core: RenderCore, assets: Assets) {
    this.core = core;
    this.assets = assets;
    const ui = document.getElementById('ui') as HTMLElement;
    this.statsEl = document.createElement('div');
    this.statsEl.style.cssText = `${PANEL};left:8px;bottom:8px;white-space:pre;min-width:260px`;
    this.sysEl = document.createElement('div');
    this.sysEl.style.cssText = `${PANEL};left:8px;top:8px;max-width:330px`;
    ui.append(this.statsEl, this.sysEl);
  }

  static async create(): Promise<GalleryHost> {
    const canvas = document.getElementById('game');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');
    const assets = new Assets();
    await assets.init();
    applyDevTextureFallback(assets);
    const core = new RenderCore(canvas, assets, { quality: 'high', fixedQuality: true });
    core.gpuTimer = new GpuTimer(core.renderer.getContext() as WebGL2RenderingContext);
    const host = new GalleryHost(core, assets);
    host.installInput(canvas);
    core.addSystem({
      name: 'gallery',
      update: (dt) => host.frame(dt),
    });
    core.quality.onChange((p) => {
      for (const s of host.systems) s.setQuality(p);
    });
    host.exposeApi();
    return host;
  }

  async setZone(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const preset = GALLERY_BIOMES[id];
      if (!preset) throw new Error(`unknown zone ${id}`);
      // render biome = content preset + the zone look's render-only override; the field is built from the preset
      const biome = resolveBiome(id, preset);
      this.clearSystems();
      this.zoneId = id;
      this.biome = biome;
      this.core.env.setBiome(biome);
      this.field = createTerrainField(preset, preset.seed);
      this.core.heightAt = (x, z) => this.field.heightAt(x, z);
      this.ctx = { core: this.core, assets: this.assets, field: this.field, biome, quality: this.core.quality.profile };
      worldUniforms.uSunDir.value.copy(this.core.env.sunDir);
      await this.mode?.build(this);
      this.actors = null;
      if (this.showActors) {
        this.actors = await createActors(this.assets, this.field);
        this.addSystem(this.actors);
        this.actors.place(this.hero.x, this.hero.z);
      }
      await Promise.all(this.systems.map((s) => s.ready));
      this.setCamera(this.cam === 'gameplay' ? 'gameplay' : this.cam);
      this.renderSystemList();
      this.onZoneBuilt?.();
    } finally {
      this.busy = false;
    }
  }

  addSystem(sys: ZoneSystem): void {
    this.systems.push(sys);
    this.core.scene.add(sys.group);
    sys.setQuality(this.core.quality.profile);
  }

  clearSystems(): void {
    for (const s of this.systems) {
      this.core.scene.remove(s.group);
      s.dispose();
    }
    this.systems.length = 0;
  }

  setQuality(q: QualityTier): void {
    this.core.setQualitySetting(q);
  }

  /** moves the gameplay hero focus to (x,z) */
  setHero(x: number, z: number): void {
    this.hero.set(x, this.field.heightAt(x, z), z);
    this.core.rig.setTarget(x, this.hero.y, z);
    this.actors?.place(x, z);
    this.core.rig.snap();
  }

  setCamera(preset: CamPreset, opts?: { yaw?: number; pitch?: number; dist?: number; target?: [number, number, number]; fov?: number }): void {
    this.cam = preset;
    // the wide establishing shot sits far outside the gameplay fog range: push the fog out so the zone is visible
    const fog = this.core.env.fog;
    const k = preset === 'wide' ? 2.6 : 1;
    fog.near = this.biome.fog.near * k;
    fog.far = this.biome.fog.far * k;
    const cam = this.core.camera;
    if (preset === 'gameplay') {
      cam.fov = 40;
      cam.updateProjectionMatrix();
      this.core.rig.setZoom(opts?.dist ?? 22);
      this.setHero(this.hero.x, this.hero.z);
    } else if (preset === 'wide') {
      cam.fov = opts?.fov ?? 46;
      cam.updateProjectionMatrix();
      this.orbit.yaw = opts?.yaw ?? 0;
      this.orbit.pitch = opts?.pitch ?? 0.42;
      this.orbit.dist = opts?.dist ?? 190;
      const t = opts?.target ?? [0, 4, -20];
      this.orbit.target.set(t[0], t[1], t[2]);
    } else {
      cam.fov = opts?.fov ?? 50;
      cam.updateProjectionMatrix();
      if (opts?.yaw !== undefined) this.orbit.yaw = opts.yaw;
      if (opts?.pitch !== undefined) this.orbit.pitch = opts.pitch;
      if (opts?.dist !== undefined) this.orbit.dist = opts.dist;
      if (opts?.target) this.orbit.target.set(opts.target[0], opts.target[1], opts.target[2]);
    }
  }

  private frame(dt: number): void {
    const now = performance.now();
    if (this.lastFrameStart > 0) {
      this.frameTimes.push(now - this.lastFrameStart);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
    }
    this.lastFrameStart = now;
    this.frameCpuStart = now;
    const speed = (this.keys.has('shift') ? 36 : 12) * dt;
    const up = this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0;
    const dn = this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0;
    const lf = this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0;
    const rt = this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0;
    if (this.field) {
      if (this.cam === 'gameplay') {
        if (up || dn || lf || rt) {
          this.hero.x = MathUtils.clamp(this.hero.x + (rt - lf) * speed, -250, 250);
          this.hero.z = MathUtils.clamp(this.hero.z + (dn - up) * speed, -250, 250);
          this.hero.y = this.field.heightAt(this.hero.x, this.hero.z);
          this.core.rig.setTarget(this.hero.x, this.hero.y, this.hero.z);
          this.actors?.place(this.hero.x, this.hero.z);
        }
      } else {
        const o = this.orbit;
        const fx = Math.sin(o.yaw);
        const fz = Math.cos(o.yaw);
        o.target.x += ((rt - lf) * fz - (up - dn) * fx) * speed * 2;
        o.target.z += (-(rt - lf) * fx - (up - dn) * fz) * speed * 2;
        const cp = Math.cos(o.pitch);
        const cam = this.core.camera;
        cam.position.set(o.target.x + Math.sin(o.yaw) * cp * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z + Math.cos(o.yaw) * cp * o.dist);
        cam.up.set(0, 1, 0);
        cam.lookAt(o.target);
        cam.updateMatrixWorld();
        this.core.rig.focus.copy(o.target);
      }
      const focus = this.cam === 'gameplay' ? this.core.rig.focus : this.orbit.target;
      for (const s of this.systems) s.update(dt, this.core.camera, focus);
    }
  }

  /** records one synchronous update+render CPU duration sample (ms) */
  recordCpuMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.cpuTimes.push(ms);
    if (this.cpuTimes.length > 120) this.cpuTimes.shift();
    this.lastCpuSample = ms;
    this.cpuSampleSeq++;
  }

  /** call after core.frame(): records synchronous frame CPU time and refreshes the readout from renderer.info */
  afterRender(cpuMs?: number): void {
    if (cpuMs !== undefined) {
      this.recordCpuMs(cpuMs);
      this.frameCpuStart = 0;
    } else if (this.frameCpuStart > 0) {
      this.recordCpuMs(Math.max(0, performance.now() - this.frameCpuStart));
      this.frameCpuStart = 0;
    }
    this.updateStats();
  }

  private updateStats(): void {
    const s = this.stats();
    this.statsEl.textContent =
      `${this.zoneId} · ${this.cam} · ${this.core.quality.profile.tier}\n` +
      `fps ${s.fps.toFixed(0)}  cpu ${s.cpuMs >= 0 ? s.cpuMs.toFixed(1) : 'n/a'} ms  gpu ${s.gpuMs >= 0 ? s.gpuMs.toFixed(2) : 'n/a'} ms\n` +
      `draw calls ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k  geo ${s.geometries}  tex ${s.textures}`;
  }

  stats(): GalleryStats {
    const ft = this.frameTimes;
    const avg = ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : 16.7;
    const cpu = this.cpuTimes;
    const info = this.core.renderer.info;
    return {
      fps: 1000 / avg,
      frameMs: ft.length ? avg : -1,
      cpuMs: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : -1,
      gpuMs: this.core.gpuTimer?.lastMs ?? -1,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  /** averages GPU/CPU frame stats over `frames` rendered frames (waits for them); reports real CPU samples separately from vsync frame interval */
  async measure(frames = 90): Promise<GalleryStats & { gpuMin: number }> {
    const gpu: number[] = [];
    const cpu: number[] = [];
    let calls = 0;
    let tris = 0;
    const warmup = frames > 16 ? 12 : 0;
    let seenSeq = this.cpuSampleSeq;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const seqNow = this.cpuSampleSeq;
      const hasNewCpu = seqNow !== seenSeq;
      seenSeq = seqNow;
      if (i > warmup || warmup === 0) {
        if (hasNewCpu && this.lastCpuSample >= 0) cpu.push(this.lastCpuSample);
        const g = this.core.gpuTimer?.lastMs ?? -1;
        if (g >= 0) gpu.push(g);
        calls = this.core.renderer.info.render.calls;
        tris = this.core.renderer.info.render.triangles;
      }
    }
    const wall = performance.now() - t0;
    const frameMs = frames > 0 ? wall / frames : -1;
    const cpuMs = cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : -1;
    gpu.sort((a, b) => a - b);
    const med = gpu.length ? (gpu[Math.floor(gpu.length / 2)] as number) : -1;
    return {
      fps: wall > 0 ? (frames * 1000) / wall : 0,
      frameMs,
      cpuMs,
      gpuMs: med,
      gpuMin: gpu[0] ?? -1,
      calls,
      triangles: tris,
      geometries: this.core.renderer.info.memory.geometries,
      textures: this.core.renderer.info.memory.textures,
    };
  }

  private renderSystemList(): void {
    const el = this.sysEl;
    el.replaceChildren();
    const row = (label: string, ...kids: HTMLElement[]): HTMLElement => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;gap:6px;align-items:center;margin:2px 0;flex-wrap:wrap';
      const l = document.createElement('span');
      l.textContent = label;
      l.style.minWidth = '56px';
      d.append(l, ...kids);
      el.append(d);
      return d;
    };
    const btn = (text: string, on: () => void, active = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = `font:11px ui-monospace,monospace;color:#f4e6c8;background:${active ? '#7a3a1a' : '#3a1a10'};border:1px solid #b88a3c;border-radius:3px;padding:2px 6px;cursor:pointer`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        on();
        this.renderSystemList();
        (document.getElementById('game') as HTMLCanvasElement | null)?.focus();
      });
      return b;
    };
    row('zone', ...GALLERY_ZONES.map((z) => btn(z, () => void this.setZone(z), z === this.zoneId)));
    row('camera', ...(['gameplay', 'wide', 'orbit'] as const).map((c) => btn(c, () => this.setCamera(c), c === this.cam)));
    row('quality', ...(['low', 'medium', 'high', 'ultra'] as const).map((q) => btn(q, () => this.setQuality(q), q === this.core.quality.profile.tier)));
    const sys = document.createElement('div');
    for (const s of this.systems) {
      const lab = document.createElement('label');
      lab.style.cssText = 'display:inline-flex;gap:3px;margin-right:8px;align-items:center';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = s.group.visible;
      cb.addEventListener('change', () => {
        s.group.visible = cb.checked;
      });
      lab.append(cb, document.createTextNode(s.name));
      sys.append(lab);
    }
    row('systems', sys);
    const hint = document.createElement('div');
    hint.style.cssText = 'opacity:.6;margin-top:4px';
    hint.textContent = 'WASD move · drag orbit · wheel zoom · shift fast';
    el.append(hint);
  }

  private installInput(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    let drag = false;
    let lx = 0;
    let ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      drag = true;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', () => (drag = false));
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (this.cam === 'gameplay') this.setCamera('orbit', { yaw: 0, pitch: 0.96, dist: 22, target: [this.hero.x, this.hero.y, this.hero.z], fov: 40 });
      this.orbit.yaw -= (e.clientX - lx) * 0.006;
      this.orbit.pitch = MathUtils.clamp(this.orbit.pitch + (e.clientY - ly) * 0.005, 0.05, 1.5);
      lx = e.clientX;
      ly = e.clientY;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.cam === 'gameplay') this.core.rig.setZoom(this.core.rig.zoom * (1 + Math.sign(e.deltaY) * 0.08));
        else this.orbit.dist = MathUtils.clamp(this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 4, 420);
      },
      { passive: false },
    );
  }

  private exposeApi(): void {
    const api = {
      host: this,
      setZone: (id: string) => this.setZone(id),
      setCamera: (p: CamPreset, o?: Parameters<GalleryHost['setCamera']>[1]) => this.setCamera(p, o),
      setQuality: (q: QualityTier) => this.setQuality(q),
      setHero: (x: number, z: number) => this.setHero(x, z),
      stats: () => this.stats(),
      measure: (n?: number) => this.measure(n),
      hide: (name: string, visible = false) => {
        for (const s of this.systems) if (s.name === name) s.group.visible = visible;
      },
      systems: () => this.systems.map((s) => s.name),
    };
    Object.assign(window, { __gallery: api });
  }
}

export { GALLERY_ZONES };
