
// swirl step of rotating emitters). Pins the CPU side (host packing: bit 22 of the record flags, stretch billboards only), the IDENTITY
// rule (flag absent = byte-identical records for every registered hand spec) and the shader contract (the two judge lines sit behind the
// bit, the default branch is untouched). The GPU itself is not available: the atlas bake is stubbed, the renderer is a recorder.
import { Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { PRESETS } from '../presets';
import { skillFamilies } from '../skills/families';
import { VRng } from '../util';
import { REC } from '../spec/batches';
import { SpecHost } from '../spec/host';
import { SPEC_REGISTRY } from '../spec/preset';
import { SPEC_PARTICLE_VERT } from '../spec/shaders';
import type { ElementSpec, FxSpec, ParticleSpec } from '../spec/types';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

const BIT = 1 << 22;
const FLAGS = 18; // float index of the record flags (aE.z)

const particle = (extra: Partial<ParticleSpec> = {}): ParticleSpec => ({
  kind: 'particle',
  cycle: 1,
  max: 16,
  rate: [0, 60],
  life: [0, 1],
  half: [0, 0.3],
  color: [0, 0xffffff, 1],
  billboard: 'stretch',
  blend: 'add',
  tex: 'glow',
  dir: { y: [0, 1] },
  vel: [0, 2],
  ...extra,
});

const spec = (id: string, elements: ElementSpec[], extra: Partial<FxSpec> = {}): FxSpec => ({ id, desc: 'test', behavior: 'selfBuff', ref: {}, size: 'radius', base: 2, dur: 1, elements, ...extra });

interface Batch {
  used: number;
  f: Float32Array;
}
interface Priv {
  pAdd: Batch;
  pAlpha: Batch;
  pAddD: Batch;
}

/** plays `s` for 12 frames on a fresh host (fixed seed, fixed steps) and returns the used records of the three particle batches */
function records(s: FxSpec, rank = 0): { add: Float32Array; alpha: Float32Array; addD: Float32Array } {
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  h.play(s, new Ctx(), false, { rank, awakened: false, caster: -1 });
  for (let i = 0; i < 12; i++) {
    fx.time += 1 / 60;
    h.update(1 / 60);
  }
  const p = h as unknown as Priv;
  const cut = (b: Batch): Float32Array => b.f.slice(0, b.used * REC);
  return { add: cut(p.pAdd), alpha: cut(p.pAlpha), addD: cut(p.pAddD) };
}

const flagList = (f: Float32Array): number[] => Array.from({ length: f.length / REC }, (_, i) => f[i * REC + FLAGS] as number);

describe('stretchU: host packing', () => {
  it('a stretch particle with stretchU carries bit 22 on every record, one without it never does', () => {
    const on = records(spec('sk.x', [particle({ stretchU: true })])).add;
    const off = records(spec('sk.x', [particle()])).add;
    expect(on.length).toBeGreaterThan(0);
    expect(flagList(on).every((f) => (f & BIT) === BIT)).toBe(true);
    expect(flagList(off).every((f) => (f & BIT) === 0)).toBe(true);
  });

  it('is the ONLY difference: every other float of every record (and every other flag bit) is identical', () => {
    const on = records(spec('sk.x', [particle({ stretchU: true, swirl: [0, 20] })])).add;
    const off = records(spec('sk.x', [particle({ swirl: [0, 20] })])).add;
    expect(on.length).toBe(off.length);
    for (let i = 0; i < on.length; i++) {
      if (i % REC === FLAGS) expect((on[i] as number) - (off[i] as number), `record ${Math.floor(i / REC)}`).toBe(BIT);
      else expect(on[i], `float ${i}`).toBe(off[i]);
    }
  });

  it('is ignored by the other billboards: screen, ground and upright records are byte-identical with and without it', () => {
    for (const billboard of ['screen', 'ground', 'upright'] as const) {
      const on = records(spec('sk.x', [particle({ billboard, stretchU: true })]));
      const off = records(spec('sk.x', [particle({ billboard })]));
      expect(on.add.length, billboard).toBeGreaterThan(0);
      expect(Array.from(on.add), billboard).toEqual(Array.from(off.add));
    }
  });

  it('works per grade band (the converter writes it on the base; a band may switch it on at P) and in the display batches', () => {
    const s = spec('sk.x', [particle({ grade: { g3: { stretchU: true } } })]);
    expect(flagList(records(s, 0).add).every((f) => (f & BIT) === 0)).toBe(true);
    const p7 = records(s, 7).add;
    expect(p7.length).toBeGreaterThan(0);
    expect(flagList(p7).every((f) => (f & BIT) === BIT)).toBe(true);
    const disp = records(spec('sk.x', [particle({ stretchU: true })], { space: 'display' }));
    expect(disp.add.length).toBe(0);
    expect(flagList(disp.addD).every((f) => (f & BIT) === BIT)).toBe(true);
  });

  it('alpha-blended stretch particles carry it too', () => {
    const r = records(spec('sk.x', [particle({ blend: 'alpha', stretchU: true })]));
    expect(r.alpha.length).toBeGreaterThan(0);
    expect(flagList(r.alpha).every((f) => (f & BIT) === BIT)).toBe(true);
  });

  it('bit 22 clears the other record flags (face turn 18-20, square 21) and every flag value stays exact in a float32', () => {
    expect(BIT).toBeGreaterThan(1 << 21);
    expect(BIT & ((1 << 22) - 1)).toBe(0);
    const all = (1 << 23) - 1; // every flag bit set
    expect(Math.fround(all)).toBe(all);
  });
});

describe('stretchU: identity for the registered hand specs (flag absent = the START records)', () => {
  const generated = new Set(skillFamilies().flatMap((f) => f.specs.map((s) => s.id)));
  const hand = (): FxSpec[] => {
    void PRESETS.length; // importing the presets registers every spec
    return SPEC_REGISTRY.filter((s) => !generated.has(s.id));
  };
  const particlesOf = (s: FxSpec): ParticleSpec[] =>
    [...s.elements, ...(s.impact ?? [])].filter((e): e is ParticleSpec => e.kind === 'particle');

  it('no hand spec sets stretchU anywhere (element, impact or grade band), so none of them can change', () => {
    const specs = hand();
    expect(specs.length).toBeGreaterThan(200);
    const set: string[] = [];
    for (const s of specs) {
      for (const e of particlesOf(s)) {
        const g = e.grade as Record<string, { stretchU?: boolean }> | undefined;
        if (e.stretchU !== undefined || Object.values(g ?? {}).some((b) => b.stretchU !== undefined)) set.push(s.id);
      }
    }
    expect(set).toEqual([]);
  });

  it('every record of every hand spec with stretch particles has bit 22 clear (rank 0 and P)', () => {
    const withStretch = hand().filter((s) => particlesOf(s).some((e) => e.billboard === 'stretch' || Object.values((e.grade ?? {}) as Record<string, { billboard?: string }>).some((b) => b.billboard === 'stretch')));
    expect(withStretch.length).toBeGreaterThan(20);
    let seen = 0;
    for (const s of withStretch) {
      for (const rank of [0, 7]) {
        const r = records(s, rank);
        for (const f of [r.add, r.alpha, r.addD]) {
          for (const flags of flagList(f)) {
            expect(flags & BIT, `${s.id} rank ${rank}`).toBe(0);
            seen++;
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(1000);
  });
});

describe('stretchU: shader contract (spec/shaders.ts SPEC_PARTICLE_VERT)', () => {
  const src = SPEC_PARTICLE_VERT;
  const GATE = '((fl >> 22) & 1) == 1';

  it('the judge S1 line (u along the motion, head at u = 1) sits behind the bit, the default branch keeps its exact old line', () => {
    expect(src).toContain(`if (${GATE}) wp = p + axis * q.x * len + side * q.y * sx;`);
    expect(src).toContain('else wp = p + axis * q.y * len + side * q.x * sx;');
  });

  it('the judge S2 line (swirl step in the stretch axis) sits behind the bit, after the swirl rotation and before the socket transforms', () => {
    const line = `if (${GATE}) vel += aC.w * vec3(rel.z, 0.0, -rel.x);`;
    expect(src).toContain(line);
    const rot = src.indexOf('vel.xz = vec2(c * vel.x + s * vel.z, -s * vel.x + c * vel.z);');
    const at = src.indexOf(line);
    const sock = src.indexOf('vel = qrot(sq, vel);');
    expect(rot).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(rot);
    expect(at).toBeLessThan(sock);
  });

  it('nothing else of the program changed: the gated lines are the only code that mentions bit 22 and the declarations are the same', () => {
    expect(src.split(GATE).length - 1).toBe(2);
    const decl = src
      .split('\n')
      .filter((l) => /^\s*(uniform|attribute|varying)\b/.test(l))
      .map((l) => l.replace(/\s*\/\/.*$/, '').trim());
    expect(decl).toEqual([
      'uniform sampler2D uLut;',
      'uniform sampler2D uAnchors;',
      'uniform float uArtGrid;',
      'uniform float uTime;',
      'attribute vec4 aA;',
      'attribute vec4 aB;',
      'attribute vec4 aC;',
      'attribute vec4 aD;',
      'attribute vec4 aE;',
      'attribute vec4 aF;',
      'varying vec2 vQ;',
      'varying vec4 vCol;',
      'varying vec4 vRectA;',
      'varying vec4 vRectB;',
      'varying float vMix;',
      'varying vec4 vMisc;',
      'varying float vSq;',
      'varying float vSoft;',
    ]);
  });

  it('S2 is the exact time derivative of the swirl rotation above it (vel += omega x rel, y untouched)', () => {
    // rel.xz(t) = R(w t) rel0 with R as in the shader; d/dt of (c x + s z, -s x + c z) = w (rel.z, -rel.x)
    const w = 1.7;
    const rel0 = { x: 0.9, z: -0.4 };
    const at = (t: number): { x: number; z: number } => {
      const c = Math.cos(w * t);
      const s = Math.sin(w * t);
      return { x: c * rel0.x + s * rel0.z, z: -s * rel0.x + c * rel0.z };
    };
    const t = 0.37;
    const e = 1e-6;
    const num = { x: (at(t + e).x - at(t - e).x) / (2 * e), z: (at(t + e).z - at(t - e).z) / (2 * e) };
    const rel = at(t);
    expect(num.x).toBeCloseTo(w * rel.z, 5);
    expect(num.z).toBeCloseTo(-w * rel.x, 5);
  });
});
