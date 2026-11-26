// Zones core A3 (cliff knobs), A4 (plaza medallion) and the A2 rock look block: a look without the new knobs selects exactly the
// old shader (no new define), each knob switches its own path on, and every shipped zone look only references assets that exist.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ZoneLayout } from '../../world/layoutTypes';
import { lookFor } from './look';
import type { ZoneLook } from './look/types';
import { capStrength, terrainDefines } from './terrainMaterial';

const layout = { groundLayers: [{ tex: 'tex_grass_a', scale: 5 }, { tex: 'tex_mud', scale: 4 }] } as unknown as ZoneLayout;

/** a copy of a shipped look with every zones-core knob (C1..C8 and A1..A4) removed: what a zone had before the core */
function plainLook(): ZoneLook {
  const l = structuredClone(lookFor('yeonmu'));
  delete l.style.cliff;
  delete l.style.calm;
  delete l.style.blend;
  delete l.shadow.soft;
  delete l.liquidLook;
  delete l.occlusion;
  delete l.edge;
  delete l.medallion;
  delete l.rocks;
  l.decals = l.decals.slice(0, 4);
  return l;
}

const on = (patch: (l: ZoneLook) => void): string[] => {
  const l = plainLook();
  patch(l);
  return Object.keys(terrainDefines(l, layout)).filter((k) => k !== 'DECALS').sort();
};

describe('A3 cliff knobs', () => {
  it('the plain look compiles the old shader', () => {
    expect(terrainDefines(plainLook(), layout)).toEqual({ DECALS: 4 });
  });

  it('onset, onsetNoise and cap each switch their own path on', () => {
    expect(on((l) => (l.style.cliff = { onset: [0.13, 0.3] }))).toEqual(['CLIFF_ONSET', 'CLIFF_V2']);
    expect(on((l) => (l.style.cliff = { onsetNoise: 0 }))).toEqual(['CLIFF_ONSET', 'CLIFF_V2']);
    expect(on((l) => (l.style.cliff = { cap: false }))).toEqual(['CLIFF_CAPK', 'CLIFF_V2']);
    expect(on((l) => (l.style.cliff = { cap: 0.4 }))).toEqual(['CLIFF_CAPK', 'CLIFF_V2']);
    expect(on((l) => (l.style.cliff = { floor: 0.2 }))).toEqual(['CLIFF_V2']);
  });

  it('cap strength: absent / true = today (1), false = 0, numbers are clamped', () => {
    expect(capStrength(undefined)).toBe(1);
    expect(capStrength(true)).toBe(1);
    expect(capStrength(false)).toBe(0);
    expect(capStrength(0)).toBe(0);
    expect(capStrength(0.35)).toBeCloseTo(0.35);
    expect(capStrength(7)).toBe(1);
    expect(capStrength(-2)).toBe(0);
  });
});

describe('A4 medallion', () => {
  it('only a look with a medallion compiles the path', () => {
    expect(on(() => undefined)).toEqual([]);
    expect(on((l) => (l.medallion = { tex: 'tex_x', radius: 8 }))).toEqual(['MEDALLION']);
  });
});

describe('shipped zone looks only reference assets that exist', () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../public/assets/manifest/textures.json'), 'utf8')) as { textures?: Record<string, { url: string }> } & Record<string, unknown>;
  const textures = (manifest.textures ?? manifest) as Record<string, { url: string }>;
  const assetsDir = resolve(__dirname, '../../../public');

  for (const id of ['yeonmu', 'suryeon', 'seori', 'daeryeol']) {
    it(`${id}: medallion and rock textures are shipped files`, () => {
      const look = lookFor(id);
      const ids: string[] = [];
      if (look.medallion) ids.push(look.medallion.tex);
      for (const t of Object.values(look.rocks?.tex ?? {})) ids.push(t);
      for (const t of ids) {
        const a = textures[t];
        expect(a, `${t} is in the manifest`).toBeDefined();
        expect(existsSync(resolve(assetsDir, (a as { url: string }).url)), `${t} file`).toBe(true);
      }
    });
  }
});
