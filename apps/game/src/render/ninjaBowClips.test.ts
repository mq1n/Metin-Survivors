// The ninja heroes' doctrine-B (bow) clip set: HeroView.clipFor plays `<clip>_b` for the bow doctrine when the model ships one, so the bow-only copies of the clips the
// two doctrines used to share (walk / hit / death / spawn / victory; weapon-fit F2 r2 2026-10-30) give the archer's left fist its own path (the shared ones also carried
// the dagger there). Data test of the shipped files: every ninja hero GLB declares the full set, the manifest entry lists exactly the GLB's clips.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const models = JSON.parse(readFileSync(resolve(REPO, 'apps/game/public/assets/manifest/models.json'), 'utf8')) as Record<string, { url: string; clips: Record<string, { duration: number; loop: boolean }> }>;

/** the animation names (and the scene extras) of a GLB, read from its JSON chunk */
function glbJson(url: string): { animations?: { name: string }[]; scenes: { extras?: Record<string, unknown> }[] } {
  const buf = readFileSync(resolve(REPO, 'apps/game/public', url));
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

/** every shot / carry clip the bow doctrine had before, plus the five copies of the shared clips */
const BOW_SET = ['idle_b', 'run_b', 'attack_b', 'attack2_b', 'cast_b', 'dash_b'];
const SHARED_COPIES = ['walk_b', 'hit_b', 'death_b', 'spawn_b', 'victory_b'];
const BASE = ['idle', 'walk', 'run', 'attack', 'attack2', 'cast', 'dash', 'hit', 'death', 'spawn', 'victory'];

describe('ninja heroes: doctrine-B clip set', () => {
  for (const sex of ['m', 'f']) {
    for (const t of [0, 1, 2, 3]) {
      const id = `ninja_${sex}_t${t}`;
      it(`${id} ships the bow clips and a bow-only copy of every shared clip`, () => {
        const names = (glbJson(models[id]!.url).animations ?? []).map((a) => a.name);
        for (const n of [...BASE, ...BOW_SET, ...SHARED_COPIES]) expect(names, `${id} clip ${n}`).toContain(n);
        // the manifest entry lists exactly the clips of the GLB (names)
        expect(Object.keys(models[id]!.clips).sort()).toEqual([...names].sort());
      });
    }
  }

  it('the bow-only copies keep the duration of the clip they copy (the hit times and the game feel stay)', () => {
    for (const sex of ['m', 'f']) {
      for (const t of [0, 1, 2, 3]) {
        const c = models[`ninja_${sex}_t${t}`]!.clips;
        for (const n of ['walk', 'hit', 'death', 'spawn', 'victory']) {
          expect(c[`${n}_b`]!.duration, `ninja_${sex}_t${t} ${n}_b`).toBeCloseTo(c[n]!.duration, 2);
          expect(c[`${n}_b`]!.loop).toBe(c[n]!.loop);
        }
      }
    }
  });
});
