// Skill effects: every skills.json `vfx` id resolves to a preset, and every `sk.*` spec is well-formed, documented by its
// metadata and satisfies the contract of the behaviour that fires it (loop / one-shot / line / target / size).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VARIANTS } from '../palette';
import { PRESETS, PRESET_ALIASES } from '../presets';
import { SKILL_SPECS } from '../skills';
import { elementRows, texOk } from '../spec/curves';
import { gradeElement } from '../spec/host';
import { BEHAVIOR_CONTRACTS } from '../spec/preset';
import { ROLES } from '../spec/roles';
import { LUT_H, LUT_SAMPLES, LUT_W } from '../spec/shaders';
import { isSocket } from '../spec/sockets';
import { MAX_ELEMENTS, type ElementSpec, type FxSpec, type Grade } from '../spec/types';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

interface SkillRow {
  id: string;
  behavior: keyof typeof BEHAVIOR_CONTRACTS;
  vfx: string;
}
const SKILLS = JSON.parse(readFileSync(new URL('../../data/content/skills.json', import.meta.url), 'utf8')) as SkillRow[];
const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

function resolves(id: string): boolean {
  if (BY_ID.has(id) || PRESET_ALIASES[id] !== undefined) return true;
  const dot = id.lastIndexOf('.');
  const base = dot > 0 ? BY_ID.get(id.slice(0, dot)) : undefined;
  return base?.variants === true && VARIANTS[id.slice(dot + 1)] !== undefined;
}

function curveOk(c: readonly number[] | undefined, stride = 2): boolean {
  if (c === undefined) return true;
  if (c.length === 0 || c.length % stride !== 0) return false;
  for (let i = stride; i < c.length; i += stride) if ((c[i] as number) < (c[i - stride] as number)) return false;
  return c.every((v) => Number.isFinite(v));
}

function elementProblems(spec: FxSpec, el: ElementSpec, where: string): string[] {
  const bad: string[] = [];
  if (!texOk(el.tex)) bad.push(`${where}: unknown texture role ${JSON.stringify(el.tex)}`);
  if (typeof el.tex !== 'string' && el.tex.fallback !== undefined && ROLES[el.tex.fallback] === undefined) bad.push(`${where}: unknown fallback role`);
  if (!curveOk(el.color, 3)) bad.push(`${where}: colour curve`);
  if ((el.minRank ?? 0) > (el.maxRank ?? 7)) bad.push(`${where}: minRank > maxRank`);
  if (el.kind === 'trail') {
    if (!(el.life > 0) || !(el.width > 0)) bad.push(`${where}: trail life/width`);
    if (el.attach !== 'origin' && !isSocket(el.attach)) bad.push(`${where}: trail anchor ${String(el.attach)}`);
    for (const c of [el.taper, el.fade]) if (!curveOk(c)) bad.push(`${where}: trail curve`);
    return bad;
  }
  if (typeof el.attach === 'string' && !isSocket(el.attach)) bad.push(`${where}: unknown socket ${el.attach}`);
  if (el.kind === 'particle') {
    for (const [k, c] of [['rate', el.rate], ['life', el.life], ['vel', el.vel], ['gravity', el.gravity], ['air', el.air], ['swirl', el.swirl]] as const) {
      if (!curveOk(c)) bad.push(`${where}: ${k} curve`);
    }
    const half = typeof el.half[0] === 'number' ? [el.half as readonly number[]] : (el.half as readonly (readonly number[])[]);
    const scale = el.scale === undefined ? [] : typeof el.scale[0] === 'number' ? [el.scale as readonly number[]] : (el.scale as readonly (readonly number[])[]);
    for (const c of [...half, ...scale]) if (!curveOk(c)) bad.push(`${where}: half/scale curve`);
    if (!(el.cycle > 0) || !(el.max >= 1)) bad.push(`${where}: cycle/max`);
  } else {
    if (!(el.life > 0)) bad.push(`${where}: life`);
    for (const c of [el.sweep?.[0], el.sweep?.[1], el.uv?.[0], el.uv?.[1], el.spin, el.move?.x, el.move?.y, el.move?.z]) if (!curveOk(c)) bad.push(`${where}: animated curve`);
  }
  if ((el.place === 'target' || el.place === 'along') && !BEHAVIOR_CONTRACTS[spec.behavior].needsTarget && spec.behavior !== 'beam') {
    bad.push(`${where}: place ${el.place} needs a line behaviour`);
  }
  return bad;
}

describe('skills.json vfx ids', () => {
  it('every skill vfx id resolves to a registered preset', () => {
    const missing = SKILLS.filter((s) => !resolves(s.vfx)).map((s) => `${s.id}: ${s.vfx}`);
    expect(missing).toEqual([]);
  });

  it('every sk.* id used by a skill belongs to a spec of that skill and behaviour', () => {
    const specs = new Map(SKILL_SPECS.map((s) => [s.id, s]));
    const bad = SKILLS.filter((s) => s.vfx.startsWith('sk.')).filter((s) => specs.get(s.vfx)?.behavior !== s.behavior || s.vfx !== `sk.${s.id}`);
    expect(bad.map((s) => s.id)).toEqual([]);
  });
});

describe('sk.* spec presets', () => {
  it('ids are unique and `sk.`-prefixed', () => {
    const ids = SKILL_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !id.startsWith('sk.'))).toEqual([]);
  });

  it.each(SKILL_SPECS.map((s) => [s.id, s] as const))('%s satisfies its behaviour contract', (_id, spec) => {
    const def = BY_ID.get(spec.id);
    const ct = BEHAVIOR_CONTRACTS[spec.behavior];
    expect(def).toBeDefined();
    expect(def!.loop).toBe(ct.loop);
    expect(def!.needsTarget === true).toBe(ct.needsTarget);
    expect(def!.size).toBe(ct.size);
    if (ct.needsTarget) expect(def!.demo?.target).toBeGreaterThan(0);
    if (ct.loop) {
      expect(typeof def!.tick).toBe('function');
      expect(typeof def!.end).toBe('function');
    }
    // impact lists only play when tracking / a zone stops
    if (spec.impact) expect(ct.path === 'track' || ct.path === 'zone').toBe(true);
  });

  it.each(SKILL_SPECS.map((s) => [s.id, s] as const))('%s is well-formed', (_id, spec) => {
    expect(typeof spec.desc).toBe('string');
    expect(spec.base).toBeGreaterThan(0);
    expect(spec.elements.length).toBeGreaterThan(0);
    expect(spec.elements.length).toBeLessThanOrEqual(MAX_ELEMENTS);
    const bad = [
      ...spec.elements.flatMap((el, i) => elementProblems(spec, el, `el ${i}`)),
      ...(spec.impact ?? []).flatMap((el, i) => elementProblems(spec, el, `impact ${i}`)),
    ];
    expect(bad).toEqual([]);
  });

  it('all specs fit the curve LUT (per-grade variants included)', () => {
    let rows = 0;
    for (const s of SKILL_SPECS) {
      for (const el of [...s.elements, ...(s.impact ?? [])]) {
        const seen = new Set<ElementSpec>();
        for (let g = 0; g < 4; g++) seen.add(gradeElement(el, g as Grade));
        for (const v of seen) rows += elementRows(v);
      }
    }
    expect(rows).toBeLessThanOrEqual((LUT_W / LUT_SAMPLES) * LUT_H);
  });
});
