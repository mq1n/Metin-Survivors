// Gallery mode "structures". Owner: StructuresA.
//   (default)       debug ground + createStructures with the zone layout's props / walls / bridges
//                   (a layout without props falls back to the review sheet)
//   ?prop=<id>      that one prop alone at the origin on a flat 1 m-grid disc with a height ruler and a 1.8 m hero
//                   capsule (orbit camera; add &cam=gameplay&z=<m> to see it through the 55° gameplay camera)
//   ?sheet=1        every known prop in a row (&only=a,b,c filters), same markers
//   ?dense=<n>      n synthetic placements of all props scattered around the origin (draw-call / triangle stress test)
//   &fade=0         disables the camera→hero occlusion cut-out (orbit review of a prop that is itself the view target)
// `window.__structures.show(id | 'sheet')` switches the stage without reloading; `.stats()` lists per-prop triangles.
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  type Vector3,
} from 'three';
import type { PropPlacement } from '../../../../world/layoutTypes';
import { PROP_DEFS } from '../../../../world/props';
import { WorldRng } from '../../../../world/rng';
import { occlusionRadius } from '../../occlusion';
import { createStructures } from '../../structures';
import { STRUCTURES_A } from '../../structures/setA';
import { STRUCTURES_B } from '../../structures/setB';
import { worldUniforms, type ZoneSystem } from '../../zoneContext';
import { createDebugGround } from '../debugGround';
import type { GalleryHost, GalleryMode } from '../host';

const query = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
/** stage selected by the URL; changed at runtime through window.__structures.show */
let stage: string | null = query.get('prop') ?? (query.get('sheet') ? 'sheet' : null);
if (query.get('fade') === '0') occlusionRadius.value = 0;
/** host of the running gallery (set by build), used by window.__structures.show */
let activeHost: GalleryHost | null = null;

const KNOWN = (): string[] => Object.keys({ ...STRUCTURES_A, ...STRUCTURES_B }).filter((id) => id in PROP_DEFS);

function place(id: string, x: number, z: number, y = 0, yaw = 0, scale = 1, seed = 1): PropPlacement {
  return { id, x, z, y, yaw, scale, seed };
}

/** row of props along x, centred; returns placements and total width */
function sheetRow(ids: string[]): { placements: PropPlacement[]; width: number } {
  const gap = 3;
  const radius = (id: string): number => Math.max(1, (PROP_DEFS[id]?.radius ?? 2) * 0.9);
  let total = 0;
  for (const id of ids) total += radius(id) * 2 + gap;
  let x = -total / 2;
  const placements: PropPlacement[] = [];
  ids.forEach((id, i) => {
    const r = radius(id);
    x += r;
    placements.push(place(id, x, 0, 0, 0, 1, i + 1));
    x += r + gap;
  });
  return { placements, width: total };
}

function denseScatter(ids: string[], n: number, spread: number): PropPlacement[] {
  const rng = new WorldRng(7);
  const out: PropPlacement[] = [];
  const small = ids.filter((id) => (PROP_DEFS[id]?.height ?? 0) < 12);
  for (let i = 0; i < n; i++) {
    const id = small[i % small.length] as string;
    out.push(place(id, rng.range(-spread, spread), rng.range(-spread, spread), 0, rng.range(0, 6.28), rng.range(0.9, 1.15), i));
  }
  return out;
}

/** flat review stage: disc, 1 m grid, height ruler, hero capsule */
export function createStage(host: GalleryHost, extent: number, rulerHeight: number): ZoneSystem {
  const group = new Group();
  group.name = 'reviewStage';
  const disposables: Array<{ dispose(): void }> = [];

  const groundGeo = new CircleGeometry(Math.max(220, extent * 5), 64).rotateX(-Math.PI / 2);
  const groundMat = new MeshStandardMaterial({ color: '#70805a', roughness: 1 });
  disposables.push(groundGeo, groundMat);
  const ground = new Mesh(groundGeo, groundMat);
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  const minor: number[] = [];
  const major: number[] = [];
  const step = extent > 60 ? 5 : 1;
  const n = Math.ceil(extent / step) * step;
  for (let i = -n; i <= n; i += step) {
    const target = i % (step * 5) === 0 ? major : minor;
    target.push(i, 0.01, -n, i, 0.01, n, -n, 0.01, i, n, 0.01, i);
  }
  const lines = (pos: number[], opacity: number): LineSegments => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const m = new LineBasicMaterial({ color: '#10140c', transparent: true, opacity });
    disposables.push(g, m);
    return new LineSegments(g, m);
  };
  group.add(lines(minor, 0.16), lines(major, 0.45));

  // height ruler: alternating 1 m bands, red every 5 m
  const rx = -(extent + 1.5);
  for (let y = 0; y < rulerHeight; y++) {
    const g = new BoxGeometry(0.22, 1, 0.22);
    const m = new MeshStandardMaterial({ color: y % 5 === 4 ? '#c9302c' : y % 2 ? '#f0ead8' : '#2a2a2a', roughness: 0.9 });
    disposables.push(g, m);
    const band = new Mesh(g, m);
    band.position.set(rx, y + 0.5, 0);
    group.add(band);
  }

  // 1.8 m hero reference
  const heroGeo = new CapsuleGeometry(0.3, 1.2, 4, 10);
  const heroMat = new MeshStandardMaterial({ color: '#19c6d6', roughness: 0.55 });
  disposables.push(heroGeo, heroMat);
  const hero = new Mesh(heroGeo, heroMat);
  hero.castShadow = true;
  group.add(hero);

  return {
    name: 'stage',
    group,
    update(_dt: number, _camera: PerspectiveCamera, focus: Vector3) {
      if (host.cam === 'gameplay') hero.position.set(focus.x, focus.y + 0.9, focus.z);
      else hero.position.set(extent * 0.4 + 2.5, 0.9, extent * 0.3 + 2);
    },
    setQuality() {},
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.clear();
    },
  };
}

function createClock(): ZoneSystem {
  return {
    name: 'clock',
    group: new Group(),
    update(dt: number) {
      worldUniforms.uTime.value += dt;
    },
    setQuality() {},
    dispose() {},
  };
}

const mode: GalleryMode = {
  build(host) {
    activeHost = host;
    host.addSystem(createClock());
    const dense = Number(query.get('dense') ?? 0);
    const layoutHasProps = host.field.layout.props.length > 0;
    const only = query.get('only')?.split(',').filter(Boolean);
    const ids = (only && only.length ? only : KNOWN()).filter((id) => id in PROP_DEFS);

    if (dense > 0) {
      host.addSystem(createDebugGround(host.ctx));
      const placements = denseScatter(ids, dense, 70).map((p) => ({ ...p, y: host.field.heightAt(p.x, p.z) }));
      host.addSystem(createStructures(host.ctx, { placements, decor: false }));
      return;
    }
    const target = stage ?? (layoutHasProps ? null : 'sheet');
    if (!target) {
      host.addSystem(createDebugGround(host.ctx));
      host.addSystem(createStructures(host.ctx));
      return;
    }

    let placements: PropPlacement[];
    let extent: number;
    let ruler: number;
    const orbit = host.orbit;
    if (target === 'sheet') {
      const row = sheetRow(ids);
      placements = row.placements;
      extent = Math.max(12, row.width / 2);
      ruler = 12;
      orbit.target.set(0, 5, 0);
      orbit.dist = Math.max(40, row.width * 0.8);
      orbit.pitch = 0.3;
      orbit.yaw = 0;
    } else {
      const def = PROP_DEFS[target];
      if (!def) throw new Error(`unknown prop "${target}"`);
      placements = [place(target, 0, 0)];
      extent = Math.max(8, def.radius * 1.2);
      ruler = Math.ceil(def.height);
      orbit.target.set(0, def.height * 0.42, 0);
      orbit.dist = Math.min(170, Math.max(10, Math.max(def.height * 1.6, def.radius * 3)));
      orbit.pitch = 0.4;
      orbit.yaw = 0.55;
    }
    if (!query.get('cam')) host.cam = 'orbit';
    host.addSystem(createStage(host, extent, ruler));
    host.addSystem(createStructures(host.ctx, { placements, decor: false }));
  },
};

if (typeof window !== 'undefined') {
  Object.assign(window, {
    __structures: {
      ids: KNOWN,
      show(id: string | null): Promise<void> | undefined {
        stage = id;
        return activeHost?.setZone(activeHost.zoneId);
      },
    },
  });
}

export default mode;
