import { describe, expect, test } from 'bun:test';
import { defaultPost, genJobFromArgs } from './genspec';
import { ROOT } from './paths';
import type { PostOp } from './types';

const goal = 'additive swirl for a spin skill';
const ops = (post: PostOp[]): string[] => post.map((o) => o.op);

describe('genJobFromArgs', () => {
  test('vfx defaults: group vfx, black, 512, square, 3 variants, the additive chain', () => {
    const { job, variants } = genJobFromArgs({ id: 'vfx_a', kind: 'vfx', goal: `  ${goal} ` }, ROOT);
    expect(variants).toBe(3);
    expect(job).toEqual({
      id: 'vfx_a',
      group: 'vfx',
      kind: 'vfx',
      goal,
      background: 'black',
      aspect: 'square',
      size: 512,
      post: [{ op: 'neutral' }, { op: 'blackpoint' }, { op: 'resize', w: 512 }, { op: 'edgefade', width: 0.03 }, { op: 'webp', quality: 90, lossless: 'auto' }],
    });
  });

  test('refs: texture refs stay plain strings, repo paths are stored repo-relative, outside paths absolute; roles kept', () => {
    const { job } = genJobFromArgs(
      {
        id: 'vfx_b',
        kind: 'vfx',
        goal,
        ref: ['tools/imagegen/package.json', 'C:/tmp/refs/vfx/x.png'],
        refContext: [`${ROOT}/tools/imagegen/tsconfig.json`],
        refStyle: ['tools/imagegen/icon_hints.json'],
      },
      ROOT,
    );
    expect(job.refs).toEqual([
      'tools/imagegen/package.json',
      'C:/tmp/refs/vfx/x.png',
      { path: 'tools/imagegen/tsconfig.json', role: 'context' },
      { path: 'tools/imagegen/icon_hints.json', role: 'style' },
    ]);
  });

  test('flags: keepColor drops neutral, trim adds a centred square trim, size/variants/aspect parsed', () => {
    const { job, variants } = genJobFromArgs({ id: 'vfx_c', kind: 'vfx', goal, keepColor: true, trim: true, size: '256', variants: '5' }, ROOT);
    expect(variants).toBe(5);
    expect(job.keepColor).toBe(true);
    expect(ops(job.post)).toEqual(['blackpoint', 'trim', 'resize', 'edgefade', 'webp']);
    expect(job.post[1]).toEqual({ op: 'trim', square: true, center: true, padFrac: 0.08, thresh: 4 / 255 });
    expect(job.post[2]).toEqual({ op: 'resize', w: 256 });
    const wide = genJobFromArgs({ id: 'vfx_d', kind: 'vfx', goal, aspect: 'wide' }, ROOT).job;
    expect(wide.post.find((o) => o.op === 'resize')).toEqual({ op: 'resize', w: 512, mode: 'fit' });
  });

  test('transparent vfx keeps the generator alpha, fades it, bleeds colour', () => {
    const { job } = genJobFromArgs({ id: 'vfx_smoke', kind: 'vfx', goal, bg: 'transparent' }, ROOT);
    expect(job.post[0]).toEqual({ op: 'alpha', key: 'auto', onlyIfOpaque: true });
    expect(ops(job.post)).toEqual(['alpha', 'neutral', 'resize', 'edgefade', 'bleed', 'webp']);
    expect(job.post.find((o) => o.op === 'bleed')).toEqual({ op: 'bleed', solid: 0.15 });
  });

  test('other kinds: tiling chain for terrain, icon size 128, explicit --post override, group override', () => {
    const t = genJobFromArgs({ id: 'tex_snow', kind: 'terrain', goal }, ROOT).job;
    expect(t.tiling).toBe(true);
    expect(t.background).toBe('opaque');
    expect(ops(t.post)).toEqual(['flatten', 'tile', 'resize', 'normal', 'webp']);
    expect(genJobFromArgs({ id: 'icon_x', kind: 'icon', goal }, ROOT).job.size).toBe(128);
    const o = genJobFromArgs({ id: 'ui_x', kind: 'ui', goal, group: 'hud', post: '[{"op":"resize","w":64},{"op":"webp","quality":80}]' }, ROOT).job;
    expect(o.group).toBe('hud');
    expect(o.post).toEqual([{ op: 'resize', w: 64 }, { op: 'webp', quality: 80 }]);
  });

  test('argument errors', () => {
    expect(() => genJobFromArgs({ kind: 'vfx', goal }, ROOT)).toThrow(/--id/);
    expect(() => genJobFromArgs({ id: 'Bad-Id', kind: 'vfx', goal }, ROOT)).toThrow(/--id/);
    expect(() => genJobFromArgs({ id: 'a', kind: 'sprite', goal }, ROOT)).toThrow(/--kind/);
    expect(() => genJobFromArgs({ id: 'a', kind: 'vfx' }, ROOT)).toThrow(/--goal/);
    expect(() => genJobFromArgs({ id: 'a', kind: 'vfx', goal, bg: 'white' }, ROOT)).toThrow(/--bg/);
    expect(() => genJobFromArgs({ id: 'a', kind: 'vfx', goal, size: '5000' }, ROOT)).toThrow(/--size/);
    expect(() => genJobFromArgs({ id: 'a', kind: 'vfx', goal, variants: '0' }, ROOT)).toThrow(/--variants/);
    expect(() => genJobFromArgs({ id: 'a', kind: 'vfx', goal, aspect: 'tall' }, ROOT)).toThrow(/--aspect/);
    expect(() => genJobFromArgs({ id: 'a', kind: 'vfx', goal, post: '{"op":"x"}' }, ROOT)).toThrow(/--post/);
  });
});

describe('defaultPost', () => {
  test('vfx on black ends with the 3 % edge fade and auto-lossless WebP q90', () => {
    const p = defaultPost('vfx', 'black', 1024);
    expect(p.slice(-2)).toEqual([{ op: 'edgefade', width: 0.03 }, { op: 'webp', quality: 90, lossless: 'auto' }]);
  });
  test('opaque vfx is neutral + resize only; non-vfx transparent uses keep-alpha + trim + bleed', () => {
    expect(ops(defaultPost('vfx', 'opaque', 512))).toEqual(['neutral', 'resize', 'webp']);
    expect(ops(defaultPost('ui', 'transparent', 512))).toEqual(['alpha', 'trim', 'resize', 'bleed', 'webp']);
  });
});
