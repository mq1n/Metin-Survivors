// r8 M8a (r7 judge MF5): what a metin break piece meets in a zone. Before r8 the pieces only asked the field's rest kind at their centre point, against
// collision circles (rocks shrunk to 0.82 of their drawn size), so a pile rested inside a snow boulder and a burst flew through a stone lantern. The run
// builds this once per zone from the layout: every static's BODY as a disc that stands from the ground up to its top (a prop's footprint circles up to
// its PROP_DEFS height, a blocking rock's real half side up to its top, a tree trunk, a wall every 0.9 m), plus the liquid under a point and its level.
import { SURFACE, type ZoneLayout } from '../world/layoutTypes';
import { PROP_DEFS, propBlockers } from '../world/props';
import { TREE_DIMS } from '../world/trees';
import type { Blocker } from '../world/layoutTypes';
import { metinBodyIndex, type MetinBody, type MetinRestWorld } from './metin';
import { SINK_LAVA, SINK_WATER } from './metinSinkCue';
import { METIN_PROP_BANDS } from './metinPropBands';
import { REST9_LEDGE_ROCK, REST9_LOW_TOP } from './metinRest9';

/** the part of a TerrainField this needs (a plain object in tests) */
export interface MetinRestSource {
  readonly layout: ZoneLayout;
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): number;
}

/** a rock blocks like world/terrainField.ts `rock()` without an override: not pebbles / outcrops / ledges, taller than 0.7 m */
function rockBlocks(k: ZoneLayout['rocks'][number]): boolean {
  return k.kind !== 'pebbles' && k.kind !== 'outcrop' && k.kind !== 'ledge' && k.sy > 0.7;
}

/** every static body of a zone layout (world discs with their top height) */
export function metinBodies(L: ZoneLayout, heightAt: (x: number, z: number) => number): MetinBody[] {
  const out: MetinBody[] = [];
  const circles: Blocker[] = [];
  for (const p of L.props) {
    const def = PROP_DEFS[p.id];
    if (!def) continue;
    circles.length = 0;
    propBlockers(p, circles);
    const top = p.y + def.height * p.scale;
    for (const c of circles) out.push({ x: c.x, z: c.z, r: c.r, top });
  }
  for (const k of L.rocks) if (rockBlocks(k)) out.push({ x: k.x, z: k.z, r: 0.5 * Math.max(k.sx, k.sz), top: k.y + k.sy - (k.sink ?? 0) });
  for (const t of L.trees) { const d = TREE_DIMS[t.species]; out.push({ x: t.x, z: t.z, r: d.trunkR * t.scale, top: t.y + d.height * t.scale }); }
  for (const w of L.walls) {
    const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0), n = Math.max(1, Math.ceil(len / 0.9));
    for (let i = 0; i <= n; i++) {
      const x = w.x0 + ((w.x1 - w.x0) * i) / n, z = w.z0 + ((w.z1 - w.z0) * i) / n;
      out.push({ x, z, r: 0.55, top: heightAt(x, z) + w.height });
    }
  }
  return out;
}

/** r9 M9b: a bridge's rail stands this far (m) outside its deck half width, this tall (m) over the deck, as discs of this radius every 0.9 m */
export const METIN_RAIL_OUT = 0.25;
export const METIN_RAIL_TALL = 1.2;
export const METIN_RAIL_R = 0.3;

/**
 * r9 M9b (r8 M8a critic): the bodies a rest9 stone's pieces meet. Against metinBodies: a single-circle prop is a stack of discs (METIN_PROP_BANDS: plinth,
 * column, roof), each with its own bottom (`y0`); a prop, rock or outcrop whose top stands at most REST9_LOW_TOP over its ground is a LOW body (a ledge a
 * piece settles on): every rock up to REST9_LEDGE_ROCK tall (pebbles, outcrops, ledges, low and mid boulders) is one; a bridge's two rails are tall bodies
 * (the lava-stair parapet). Trees and walls as before.
 */
export function metinBodies9(L: ZoneLayout, heightAt: (x: number, z: number) => number): MetinBody[] {
  const out: MetinBody[] = [];
  const circles: Blocker[] = [];
  for (const p of L.props) {
    const def = PROP_DEFS[p.id];
    if (!def) continue;
    circles.length = 0;
    propBlockers(p, circles);
    const tall = def.height * p.scale, top = p.y + tall;
    const bands = circles.length === 1 ? METIN_PROP_BANDS[p.id] : undefined;
    if (tall <= REST9_LOW_TOP) { for (const c of circles) out.push({ x: c.x, z: c.z, r: c.r, top, y0: p.y, low: true }); continue; }
    if (!bands) { for (const c of circles) out.push({ x: c.x, z: c.z, r: c.r, top, y0: p.y }); continue; }
    const c = circles[0]!;
    bands.forEach(([a, b, k], i) => out.push({ x: c.x, z: c.z, r: c.r * k, top: p.y + tall * b, y0: i === 0 ? -Infinity : p.y + tall * a }));
  }
  for (const k of L.rocks) {
    const top = k.y + k.sy - (k.sink ?? 0), r = 0.5 * Math.max(k.sx, k.sz);
    const rise = top - heightAt(k.x, k.z);
    if (rise <= REST9_LEDGE_ROCK || k.kind === 'pebbles' || k.sy <= 0.7) out.push({ x: k.x, z: k.z, r, top, low: true });
    else out.push({ x: k.x, z: k.z, r, top });
  }
  for (const t of L.trees) { const d = TREE_DIMS[t.species]; out.push({ x: t.x, z: t.z, r: d.trunkR * t.scale, top: t.y + d.height * t.scale }); }
  for (const w of L.walls) {
    const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0), n = Math.max(1, Math.ceil(len / 0.9));
    for (let i = 0; i <= n; i++) {
      const x = w.x0 + ((w.x1 - w.x0) * i) / n, z = w.z0 + ((w.z1 - w.z0) * i) / n;
      out.push({ x, z, r: 0.55, top: heightAt(x, z) + w.height });
    }
  }
  for (const b of L.bridges ?? []) {
    const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
    if (!(len > 1e-3)) continue;
    const ux = (b.x1 - b.x0) / len, uz = (b.z1 - b.z0) / len, off = b.width * 0.5 + METIN_RAIL_OUT, n = Math.max(1, Math.ceil(len / 0.9));
    const top = Math.max(b.yEnd, b.yMid) + METIN_RAIL_TALL;
    for (let i = 0; i <= n; i++) {
      const cx = b.x0 + ux * ((len * i) / n), cz = b.z0 + uz * ((len * i) / n);
      for (const sgn of [-1, 1]) out.push({ x: cx - uz * off * sgn, z: cz + ux * off * sgn, r: METIN_RAIL_R, top });
    }
  }
  return out;
}

/** the run's MetinViews.restWorld for a zone: the body index (4 m cells), the liquid kind of the field's surface and the layout's liquid level */
export function metinRestWorld(f: MetinRestSource): MetinRestWorld {
  const near = metinBodyIndex(metinBodies(f.layout, (x, z) => f.heightAt(x, z)), 4);
  // r9 M9b: the rest9 bodies (stacked props, ledges, bridge rails) in their own index, built here at the zone load (a few ms), never in the frame of a
  // great metin's break; a stone without extras.rest9 never asks for them
  const near9 = metinBodyIndex(metinBodies9(f.layout, (x, z) => f.heightAt(x, z)), 4);
  const level = f.layout.liquid?.level;
  return {
    bodiesNear: near,
    bodiesNear9: near9,
    liquidAt: (x, z) => {
      const s = f.surfaceAt(x, z);
      return s === SURFACE.LAVA ? SINK_LAVA : s === SURFACE.DEEP ? SINK_WATER : 0;
    },
    // the surface the piece goes through: the zone's liquid level where it is above the ground (lava trench, river), else the ground itself
    liquidY: (x, z) => {
      const h = f.heightAt(x, z);
      return level !== undefined && Number.isFinite(level) && level > h ? level : h;
    },
  };
}
