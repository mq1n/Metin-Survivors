// Ground cover system: one instanced draw per CoverSpec (grass, flowers, shrubs), generated entirely in the vertex
// shader around the focus (see coverMaterial.ts). The CPU only bakes the height / density textures once per zone and
// updates a handful of uniforms per frame and on quality changes.
//
// Cover v2 (zones core C4): per-spec knobs in CoverSpec (clump, jitter, variants, lean, heightVar, cards, splay, face) and
// the zone-wide look.cover (grade, density, cards, splay) of render/terrain/look/<zone>.ts. A spec that uses none of the
// shape / placement knobs keeps the legacy crossed quads, placement and shader exactly; grade and density only change the
// tint / the density value. The draw budget stays MAX_DRAWS.
import { BufferAttribute, Color, Float32BufferAttribute, Group, InstancedBufferGeometry, Mesh, Vector3, type MeshLambertMaterial, type PerspectiveCamera } from 'three';
import type { CoverSpec } from '../../world/layoutTypes';
import { zoneSeedSalt } from '../../world/rng';
import { findLook, type CoverLook } from '../terrain/look';
import type { ZoneContext } from '../terrain/zoneContext';
import { bakeCover, type CoverBake } from './coverBake';
import { createCoverMaterial, type CoverRing, type CoverUniforms, type CoverV2 } from './coverMaterial';
import { loadOwnedVegTexture, type OwnedVegTexture } from './textures';
import type { VegPart, VegQuality } from './types';

/** hard cap on cover draw calls (budget: <= 6 for the whole system) */
const MAX_DRAWS = 6;
const FAR_RADIUS = 62;
/** v2 fan: cards when a zone / spec turns the fan on without a count, default splay (rad), absolute card cap */
const FAN_CARDS = 5;
const FAN_SPLAY = 0.45;
/** v2 fan: share of the cards facing the camera when a spec does not say (every shipped tuft card is a side view) */
const FAN_FACE = 1;
const FAN_MAX = 8;
/** v2 legacy-lean constant (the legacy shader's fixed lean) */
const LEAN = 0.12;

interface SpecDraw {
  spec: CoverSpec;
  mesh: Mesh<InstancedBufferGeometry, MeshLambertMaterial>;
  uniforms: CoverUniforms;
  maxLayer: number;
  extra: boolean;
  /** cards of the current geometry (crossed quads, or fan cards when `v2.fan`) */
  cards: number;
  /** v2 knobs (null = legacy) and the fan card count asked for by the spec / zone (before the tier cap) */
  v2: CoverV2 | null;
  fanCards: number;
}

/** Crossed upright quads: x spans the card width (-0.5..0.5), y is the height fraction. Normals point up (soft turf shading); without a normal attribute three would switch the material to flat shading. */
function tuftGeometry(cards: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let c = 0; c < cards; c++) {
    const a = (c / cards) * Math.PI;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    const base = pos.length / 3;
    // alternate lean directions so the tuft splays like a real clump when seen from above
    const tilt = c % 2 === 0 ? 0.5 : -0.5;
    for (const y of [0, 1]) {
      for (const x of [-0.5, 0.5]) {
        pos.push(cx * x - sz * tilt * y, y, sz * x + cx * tilt * y);
        uv.push(x + 0.5, y);
      }
    }
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: pos.length }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

/**
 * v2 splayed fan: `cards` quads; position = (x across the card -0.5..0.5, height fraction 0..1, card index). The vertex
 * shader stands each card with its foot near the tuft centre and leans it away from the camera (face) or outward on its
 * own azimuth (radial), with per-card jitter (coverMaterial.ts BODY_V2).
 */
function fanGeometry(cards: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let c = 0; c < cards; c++) {
    const base = pos.length / 3;
    for (const y of [0, 1]) {
      for (const x of [-0.5, 0.5]) {
        pos.push(x, y, c);
        uv.push(x + 0.5, y);
      }
    }
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: pos.length }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

/** candidate grid for a target tuft density: cell edge, cells per axis, candidates per cell and survival scale */
export function planRing(density: number, radius: number, cellMin: number, cellMax: number): CoverRing & { count: number; sub: number } {
  const cell = Math.min(cellMax, Math.max(cellMin, Math.sqrt(2 / Math.max(density, 1e-4))));
  const perCell = Math.max(1, Math.ceil(density * cell * cell));
  const grid = Math.ceil((2 * radius) / cell) + 2;
  const keep = Math.min(1, density / (perCell / (cell * cell)));
  return { cell, grid, perCell, keep, sub: 1, count: grid * grid * perCell };
}

/**
 * v2 stratified grid (CoverSpec.jitter): one candidate per sub-cell of about 1/sqrt(density) m, `sub` x `sub` sub-cells
 * per cell (cells clamped like the legacy plan), survival scale `keep` for the remainder.
 */
export function planGrid(density: number, radius: number, cellMin: number, cellMax: number): CoverRing & { count: number; sub: number } {
  const ideal = 1 / Math.sqrt(Math.max(density, 1e-4));
  const cell = Math.min(cellMax, Math.max(cellMin, ideal));
  const sub = Math.max(1, Math.round(cell / ideal));
  const step = cell / sub;
  const grid = Math.ceil((2 * radius) / cell) + 2;
  const keep = Math.min(1, density * step * step);
  return { cell, grid, perCell: sub * sub, keep, sub, count: grid * grid * sub * sub };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Resolved v2 knobs of a spec (null = none set: the legacy path). `index` seeds an independent clump pattern. */
export function coverV2(spec: CoverSpec, look: CoverLook | undefined, index: number): { v2: CoverV2; fanCards: number } | null {
  const cards = spec.cards ?? look?.cards;
  const splay = spec.splay ?? look?.splay;
  const fan = cards !== undefined || splay !== undefined || spec.face !== undefined;
  const placement = spec.clump !== undefined || spec.jitter !== undefined;
  const shape = spec.variants !== undefined || spec.lean !== undefined || spec.heightVar !== undefined;
  if (!fan && !placement && !shape) return null;
  const c = spec.clump;
  const clump =
    c && c.scale > 0
      ? { scale: c.scale, lo: c.lo, hi: Math.abs(c.hi - c.lo) < 1e-3 ? c.lo + (c.hi < c.lo ? -1e-3 : 1e-3) : c.hi, seed: (c.seed ?? index) >>> 0 }
      : null;
  const v = spec.variants;
  const atlas: [number, number] =
    v === undefined ? [1, 1] : typeof v === 'number' ? [Math.max(1, Math.round(v)), 1] : [Math.max(1, Math.round(v[0])), Math.max(1, Math.round(v[1]))];
  return {
    v2: {
      fan,
      splay: clamp(splay ?? FAN_SPLAY, 0, 1.2),
      face: clamp(spec.face ?? FAN_FACE, 0, 1),
      lean: clamp(spec.lean ?? LEAN, 0, 1),
      heightVar: clamp(spec.heightVar ?? 0, 0, 0.9),
      jitter: spec.jitter === undefined ? -1 : clamp(spec.jitter, 0, 1),
      clump,
      atlas,
    },
    fanCards: clamp(Math.round(cards ?? FAN_CARDS), 2, FAN_MAX),
  };
}

export function createCover(ctx: ZoneContext, specs: readonly CoverSpec[]): VegPart {
  const group = new Group();
  group.name = 'cover';
  const draws: SpecDraw[] = [];
  const ownedTextures: OwnedVegTexture[] = [];
  const focus = new Vector3();
  let bake: CoverBake | null = null;
  let quality: VegQuality | null = null;
  let disposed = false;
  // zone-wide cover look (render/terrain/look/<zone>.ts): absent = today's cover
  const look = findLook(ctx.biome.id)?.cover;

  function apply(d: SpecDraw, q: VegQuality): void {
    const base = d.spec.density * d.maxLayer * q.coverDensity;
    const dens = look?.density === undefined ? base : base * look.density;
    const on = dens > 1e-4 && (q.coverExtras || !d.extra);
    d.mesh.visible = on;
    if (!on) return;
    const fan = d.v2?.fan === true;
    const cards = fan ? Math.max(2, Math.min(d.fanCards, q.coverFanMax)) : q.coverCards;
    if (cards !== d.cards) {
      d.mesh.geometry.dispose();
      d.mesh.geometry = fan ? fanGeometry(cards) : tuftGeometry(cards);
      d.cards = cards;
    }
    const u = d.uniforms;
    u.uCards.value = cards;
    const grid = d.v2 !== null && d.v2.jitter >= 0;
    const R = q.coverRadius;
    const near = grid ? planGrid(dens, R, 0.35, 4) : planRing(dens, R, 1, 4);
    u.uNear.value = [near.cell, near.grid, near.perCell, near.keep];
    u.uFade.value = [R * 0.62, R, R * 0.94, R * 1.18];
    let count = near.count;
    u.uNearCount.value = near.count;
    u.uSub.value = [near.sub, 1];
    if (d.spec.far && q.coverFar) {
      // coarse ring: ~40 % of the density, tufts 2.4x bigger, from the near radius out to FAR_RADIUS
      const far = grid ? planGrid(dens * 0.4, FAR_RADIUS, 3, 6) : planRing(dens * 0.4, FAR_RADIUS, 3, 6);
      u.uFar.value = [far.cell, far.grid, far.perCell, far.keep];
      u.uFarOut.value = [FAR_RADIUS * 0.8, FAR_RADIUS];
      u.uSub.value = [near.sub, far.sub];
      count += far.count;
    } else {
      u.uFar.value = [1, 1, 1, 0];
    }
    d.mesh.geometry.instanceCount = count;
  }

  const ready = (async () => {
    if (specs.length === 0) return;
    bake = bakeCover(ctx.field, specs);
    const seedBase = zoneSeedSalt(ctx.field.zoneId);
    for (let i = 0; i < specs.length && draws.length < MAX_DRAWS; i++) {
      const spec = specs[i] as CoverSpec;
      const texRes = await loadOwnedVegTexture(ctx.assets, spec.tex);
      if (disposed || !bake) {
        texRes.dispose();
        return;
      }
      if (texRes.owned) ownedTextures.push(texRes);
      const tex = texRes.texture;
      const img = tex.image as { width?: number; height?: number } | undefined;
      const v2 = coverV2(spec, look, i);
      // card aspect of one atlas cell (the whole texture when there is no atlas)
      const [cols, rows] = v2?.v2.atlas ?? [1, 1];
      const aspect = img?.width && img.height ? img.height / rows / (img.width / cols) : 1;
      const tint = new Color(spec.tint ?? '#ffffff');
      const g = look?.grade;
      if (g) tint.setRGB(tint.r * g[0], tint.g * g[1], tint.b * g[2]);
      const { material, uniforms } = createCoverMaterial({
        map: tex,
        height: bake.height,
        mask: bake.masks[i] as CoverBake['masks'][number],
        heightBase: bake.heightBase,
        domain: bake.size,
        heightN: ctx.field.grid.n,
        size: spec.size,
        aspect,
        tint,
        tintVar: spec.tintVar ?? 0.2,
        sway: spec.sway ?? 1,
        seed: (seedBase + i * 7919) >>> 0,
        focus,
        ...(v2 ? { v2: v2.v2 } : {}),
      });
      const fan = v2?.v2.fan === true;
      const cards0 = fan ? (v2?.fanCards ?? FAN_CARDS) : 2;
      uniforms.uCards.value = cards0;
      const mesh = new Mesh(fan ? fanGeometry(cards0) : tuftGeometry(2), material);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.name = `cover_${spec.tex}`;
      const d: SpecDraw = {
        spec,
        mesh,
        uniforms,
        maxLayer: bake.layerMax[i] as number,
        extra: /flowers|bush/.test(spec.tex),
        cards: cards0,
        v2: v2?.v2 ?? null,
        fanCards: v2?.fanCards ?? FAN_CARDS,
      };
      draws.push(d);
      group.add(mesh);
      if (quality) apply(d, quality);
    }
  })();

  return {
    group,
    ready,
    update(_dt: number, _camera: PerspectiveCamera, f: Vector3) {
      focus.copy(f);
    },
    setQuality(q) {
      quality = q;
      for (const d of draws) apply(d, q);
    },
    dispose() {
      disposed = true;
      for (const d of draws) {
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
      }
      draws.length = 0;
      for (const t of ownedTextures) t.dispose();
      ownedTextures.length = 0;
      bake?.height.dispose();
      for (const m of bake?.masks ?? []) m.dispose();
      bake = null;
      group.clear();
    },
  };
}
