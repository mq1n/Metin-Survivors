// Gallery mode "structuresB" (DEV, owner: StructuresB): review harness for the set-B procedural props, walls and bridges.
//   ?mode=structuresB&sheet=1              all set-B props in two rows on flat ground, hero-height reference beside the first
//   ?mode=structuresB&prop=orc_tent        one prop at the origin (+ hero reference)
//   ?mode=structuresB&walls=1              the five wall kinds along curved paths over rolling synthetic hills
//   ?mode=structuresB&bridges=1            wood / rope / stone bridge over a carved channel
// Automation: window.__structB.show('sheet' | 'prop' | 'walls' | 'bridges', id?) rebuilds the scene in place.
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Material,
  type PerspectiveCamera,
  type Texture,
  type Vector3,
} from 'three';
import { archHeight } from '../../../../world/shapes';
import type { Bridge, WallKind, WallPlacement } from '../../../../world/layoutTypes';
import { QUALITY_PROFILES } from '../../../quality';
import { buildBridges, BRIDGE_TEXTURES } from '../../structures/bridges';
import { STRUCTURES_B } from '../../structures/setB';
import type { StructureBuildContext, StructureModel } from '../../structures/types';
import { buildWalls, WALL_TEXTURES } from '../../structures/walls';
import { tryNormal, tryTexture, worldUniforms, type ZoneSystem } from '../../zoneContext';
import type { GalleryHost, GalleryMode } from '../host';

type SceneKind = 'sheet' | 'prop' | 'walls' | 'bridges';

/** synthetic ground for the walls/bridges scenes: rolling hills + a channel along z = 0 */
const CHANNEL = { halfW: 5.5, bank: 2.2, depth: 2.6, water: -0.7 };

function hills(x: number, z: number): number {
  return 0.9 * Math.sin(x * 0.11 + 0.7) * Math.cos(z * 0.09) + 0.35 * Math.sin(x * 0.31 + z * 0.23);
}

/** ground without bridge decks (TerrainField.bedHeightAt) */
function bedHeight(x: number, z: number): number {
  const d = Math.abs(z);
  const bed = d < CHANNEL.halfW + CHANNEL.bank ? -CHANNEL.depth * Math.min(1, Math.max(0, 1 - (d - CHANNEL.halfW) / CHANNEL.bank)) : 0;
  const s = Math.max(0, Math.min(1, (d - CHANNEL.halfW + CHANNEL.bank) / (CHANNEL.bank * 2)));
  return hills(x, z) * s * s * (3 - 2 * s) * 0.5 + bed + 0.12 * Math.sin(x * 0.7) * Math.sin(z * 0.6) * (d > CHANNEL.halfW ? 1 : 0.3);
}

function bridgeDef(kind: Bridge['kind'], x: number, halfSpan: number, width: number, rise: number): Bridge {
  const yEnd = (bedHeight(x, -halfSpan) + bedHeight(x, halfSpan)) / 2;
  return { kind, x0: x, z0: -halfSpan, x1: x, z1: halfSpan, width, yEnd, yMid: yEnd + rise };
}

const BRIDGE_DEFS: Bridge[] = [bridgeDef('wood', -22, 9.5, 5, 0.35), bridgeDef('rope', 0, 11.5, 5, 0.25), bridgeDef('stone', 24, 9.5, 6, 1.3)];

/** same deck rasterisation as TerrainField (deck = archHeight over the width, 0.7 m shoulder, max with the bed) */
function heightAt(x: number, z: number): number {
  const ground = bedHeight(x, z);
  let h = ground;
  for (const b of BRIDGE_DEFS) {
    const dx = b.x1 - b.x0;
    const dz = b.z1 - b.z0;
    const len = Math.hypot(dx, dz);
    const t = ((x - b.x0) * dx + (z - b.z0) * dz) / (len * len);
    const lat = Math.abs(((x - b.x0) * dz - (z - b.z0) * dx) / len);
    const hw = b.width * 0.5;
    if (t < 0 || t > 1 || lat > hw + 0.7) continue;
    const k = lat <= hw ? 1 : 1 - (lat - hw) / 0.7;
    const v = ground + (archHeight(t, b.yEnd, b.yMid) - ground) * (k * k * (3 - 2 * k));
    if (v > h) h = v;
  }
  return h;
}

const SYNTH_FIELD = { heightAt, bedHeightAt: bedHeight };

function terrainMesh(extent: number): Mesh {
  const n = extent * 2 + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const c = new Color();
  const grass = new Color('#62743f');
  const dry = new Color('#7a7447');
  const bed = new Color('#4d4a3a');
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i - extent;
      const z = j - extent;
      const h = bedHeight(x, z);
      const o = (j * n + i) * 3;
      pos[o] = x;
      pos[o + 1] = h;
      pos[o + 2] = z;
      c.copy(grass).lerp(dry, 0.5 + 0.5 * Math.sin(x * 0.2) * Math.sin(z * 0.17));
      if (h < CHANNEL.water + 0.4) c.lerp(bed, 0.8);
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new Mesh(g, new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

function flatGround(): Mesh {
  const m = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#667a46', roughness: 0.95 }));
  m.receiveShadow = true;
  return m;
}

function heroMarker(): Mesh {
  const m = new Mesh(new CapsuleGeometry(0.28, 1.24, 4, 10).translate(0, 0.9, 0), new MeshStandardMaterial({ color: '#e0762a', roughness: 0.6 }));
  m.castShadow = true;
  return m;
}

function disposeObject(root: Group): void {
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      const m = o.material as Material | Material[];
      for (const mm of Array.isArray(m) ? m : [m]) mm.dispose();
    }
  });
}

class StructBSystem implements ZoneSystem {
  readonly name = 'structB';
  readonly group = new Group();
  readonly ready: Promise<void>;
  propId: string | undefined;
  private content = new Group();
  private models: StructureModel[] = [];
  private extras: Array<{ update?(t: number): void; dispose(): void }> = [];
  private textures = new Map<string, Texture | null>();
  private normals = new Map<string, Texture | null>();
  private time = 0;
  private readonly host: GalleryHost;
  kind: SceneKind = 'sheet';

  constructor(host: GalleryHost) {
    this.host = host;
    this.group.add(this.content);
    const ids = new Set<string>([...WALL_TEXTURES, ...BRIDGE_TEXTURES]);
    for (const def of Object.values(STRUCTURES_B)) for (const t of def.textures ?? []) ids.add(t);
    this.ready = Promise.all(
      [...ids].map(async (id) => {
        this.textures.set(id, await tryTexture(host.assets, id));
        this.normals.set(id, await tryNormal(host.assets, id));
      }),
    ).then(() => {
      this.show(this.kind, this.propId);
    });
  }

  private ctx(): StructureBuildContext {
    return {
      texture: (id) => this.textures.get(id) ?? null,
      normal: (id) => this.normals.get(id) ?? null,
      quality: this.host.core.quality.profile ?? QUALITY_PROFILES.high,
      zone: this.host.zoneId,
    };
  }

  private clear(): void {
    for (const e of this.extras) e.dispose();
    this.extras = [];
    this.models = [];
    disposeObject(this.content);
    this.group.remove(this.content);
    this.content = new Group();
    this.group.add(this.content);
  }

  private place(model: StructureModel, x: number, z: number, yaw = 0): void {
    const g = new Group();
    for (const p of model.parts) {
      const m = new Mesh(p.geometry, p.material);
      m.castShadow = p.castShadow ?? true;
      m.receiveShadow = true;
      g.add(m);
    }
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    this.content.add(g);
    this.models.push(model);
  }

  show(kind: SceneKind, id?: string): string[] {
    this.clear();
    this.kind = kind;
    this.propId = id;
    const ids = Object.keys(STRUCTURES_B);
    const cam = this.host;
    const ctx = this.ctx();
    if (kind === 'walls' || kind === 'bridges') {
      this.content.add(terrainMesh(70));
      const water = new Mesh(new PlaneGeometry(160, CHANNEL.halfW * 2 + 1).rotateX(-Math.PI / 2).translate(0, CHANNEL.water, 0), new MeshBasicMaterial({ color: '#2f6f86', transparent: true, opacity: 0.8, side: DoubleSide }));
      this.content.add(water);
      if (kind === 'walls') {
        const kinds: WallKind[] = ['palisade', 'fence', 'stone_wall', 'ruin_wall', 'ice_wall'];
        const walls: WallPlacement[] = [];
        kinds.forEach((k, ki) => {
          const z0 = -42 + ki * 14 + (ki > 2 ? 8 : 0);
          const segs = 9;
          for (let s = 0; s < segs; s++) {
            const xa = -34 + s * 8;
            const xb = xa + 8;
            const za = z0 + Math.sin(xa * 0.09 + ki) * 3.2;
            const zb = z0 + Math.sin(xb * 0.09 + ki) * 3.2;
            walls.push({ kind: k, x0: xa, z0: za, x1: xb, z1: zb, height: k === 'fence' ? 1.2 : k === 'palisade' ? 3.2 : k === 'ice_wall' ? 2.6 : 2, seed: 100 + ki * 31 + s });
          }
        });
        const res = buildWalls(walls, SYNTH_FIELD, ctx);
        this.content.add(res.group);
        this.extras.push(res);
        cam.setCamera('orbit', { yaw: 0.35, pitch: 0.55, dist: 62, target: [0, 0, -12], fov: 40 });
      } else {
        const res = buildBridges(BRIDGE_DEFS, SYNTH_FIELD, ctx);
        this.content.add(res.group);
        this.extras.push(res);
        cam.setCamera('orbit', { yaw: 0.5, pitch: 0.42, dist: 70, target: [0, 0, 0], fov: 40 });
      }
      return [];
    }
    this.content.add(flatGround());
    const hero = heroMarker();
    const list = kind === 'prop' && id ? [id] : ids;
    let x = 0;
    let zRow = 0;
    list.forEach((pid, i) => {
      const def = STRUCTURES_B[pid];
      if (!def) return;
      const model = def.build(ctx);
      if (kind === 'prop') {
        this.place(model, 0, 0);
        hero.position.set(2.6, 0, 1.8);
      } else {
        const col = i % 8;
        zRow = Math.floor(i / 8);
        if (col === 0) x = 0;
        const width = 6;
        this.place(model, x, zRow * 8);
        x += width;
      }
    });
    if (kind === 'prop') {
      this.content.add(hero);
      cam.setCamera('orbit', { yaw: 0.6, pitch: 0.5, dist: 9, target: [0, 1.6, 0], fov: 40 });
    } else {
      hero.position.set(-3, 0, 2.5);
      this.content.add(hero);
      cam.setCamera('orbit', { yaw: 0.25, pitch: 0.7, dist: 52, target: [21, 0, 4], fov: 40 });
    }
    return list;
  }

  triangleCounts(): Record<string, { tris: number; parts: number; verts: number }> {
    const out: Record<string, { tris: number; parts: number; verts: number }> = {};
    const ctx = this.ctx();
    for (const [id, def] of Object.entries(STRUCTURES_B)) {
      const model = def.build(ctx);
      let tris = 0;
      let verts = 0;
      for (const p of model.parts) {
        tris += (p.geometry.index?.count ?? p.geometry.getAttribute('position').count) / 3;
        verts += p.geometry.getAttribute('position').count;
        p.geometry.dispose();
        p.material.dispose();
      }
      out[id] = { tris, parts: model.parts.length, verts };
    }
    return out;
  }

  update(dt: number, _camera: PerspectiveCamera, _focus: Vector3): void {
    this.time += dt;
    worldUniforms.uTime.value = this.time;
    for (const m of this.models) m.update?.(this.time);
    for (const e of this.extras) e.update?.(this.time);
  }

  setQuality(): void {}

  dispose(): void {
    this.clear();
  }
}

const mode: GalleryMode = {
  build(host) {
    const sys = new StructBSystem(host);
    const q = new URLSearchParams(location.search);
    sys.kind = q.get('walls') ? 'walls' : q.get('bridges') ? 'bridges' : q.get('prop') ? 'prop' : 'sheet';
    host.addSystem(sys);
    sys.propId = q.get('prop') ?? undefined;
    Object.assign(window, {
      __structB: {
        show: (kind: SceneKind, id?: string) => sys.show(kind, id),
        ids: () => Object.keys(STRUCTURES_B),
        /** triangles / parts per prop id (builds each model once, then disposes it) */
        tris: () => sys.triangleCounts(),
        current: () => ({ kind: sys.kind, id: sys.propId }),
      },
    });
  },
};
export default mode;
