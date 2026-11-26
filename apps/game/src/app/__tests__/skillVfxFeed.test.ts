// Skill VFX feed: every player zone row / `sk.*` projectile row the sim creates reaches the VFX layer as a resolvable
// preset with a live handle (zones: spawn → move → stop, projectiles: track every frame), and the generic projectile body
// skips `sk.*` styles.
import { describe, expect, it } from 'vitest';
import { compileProjectileStyles } from '../../render/fx/projectiles';
import { NO_INPUT, freezeSchedules, giveSkill, makeWorld, spawn } from '../../sim/__tests__/helpers';
import { ZoneKind } from '../../sim/stores';
import { VARIANTS } from '../../vfx/palette';
import { PRESETS, PRESET_ALIASES, type PresetDef } from '../../vfx/presets';
import type { SpawnOpts, Vfx } from '../../vfx/types';
import { SkillVfxFeed } from '../skillVfxFeed';
import { styleFromName } from '../simFeed';
import { ensureAllSkillVfx } from '../../vfx/skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

function resolve(id: string): PresetDef | undefined {
  const hit = BY_ID.get(id) ?? BY_ID.get(PRESET_ALIASES[id] ?? '');
  if (hit) return hit;
  const dot = id.lastIndexOf('.');
  const base = dot > 0 ? BY_ID.get(id.slice(0, dot)) : undefined;
  return base?.variants === true && VARIANTS[id.slice(dot + 1)] !== undefined ? base : undefined;
}

/** records what the feed asks for; handles only for loop presets (like VfxSystem.spawn) */
class FakeVfx {
  spawned: Array<{ id: string; handle: number; opts: SpawnOpts }> = [];
  moved = new Set<number>();
  stopped = new Set<number>();
  tracked = new Map<string, number>();
  unknown: string[] = [];
  private next = 1;
  spawn(id: string, o: SpawnOpts): number {
    const def = resolve(id);
    if (!def) {
      this.unknown.push(id);
      return 0;
    }
    const handle = def.loop ? this.next++ : 0;
    this.spawned.push({ id, handle, opts: { ...o } });
    return handle;
  }
  move(h: number): void {
    this.moved.add(h);
  }
  stop(h: number): void {
    this.stopped.add(h);
  }
  track(id: string): void {
    if (!resolve(id)?.loop) this.unknown.push(id);
    this.tracked.set(id, (this.tracked.get(id) ?? 0) + 1);
  }
}

/** fixture zone skills → the real preset their behaviour uses in skills.json (fixture vfx ids are placeholders) */
const ZONE_SKILLS: ReadonlyArray<readonly [string, string]> = [
  ['bladewheel', 'spin.blades.gold'],
  ['fury_aura', 'aura.ring.gold'],
  ['venom_pool', 'sk.noxious_pall'],
  ['arc_of_might', 'shock.wave.white'],
  ['soul_beam', 'beam.line.white'],
];
const PROJ_SKILLS = ['spirit_bolt', 'soul_crash', 'sword_circle', 'phantom_blades'];
/** stand-in specs per behaviour (real `sk.*` presets) so projectile rows take the spec path */
const SK_FOR: Record<string, string> = {
  spirit_bolt: 'sk.drifting_charms',
  soul_crash: 'sk.drifting_charms',
  sword_circle: 'sk.drifting_charms',
  phantom_blades: 'sk.drifting_charms',
};

function runSkill(id: string, vfx?: string): { fake: FakeVfx; zoneRows: number; projRows: number } {
  const w = makeWorld({
    config: { seed: 5 },
    content: (c) => {
      const s = c.skills.find((k) => k.id === id);
      if (s && vfx) s.vfx = vfx;
    },
  });
  freezeSchedules(w);
  w.players[0]!.skills.length = 0;
  giveSkill(w, id);
  spawn(w, 'wolf', 0, 4);
  spawn(w, 'wolf', 1.5, 5);
  const feed = new SkillVfxFeed();
  const fake = new FakeVfx();
  let zoneRows = 0;
  let projRows = 0;
  for (let t = 0; t < 420; t++) {
    w.step([NO_INPUT]);
    for (let i = 0; i < w.zones.count; i++) if (w.zones.team[i] === 0 && w.zones.kind[i] !== ZoneKind.Strike) zoneRows++;
    projRows += w.projectiles.count;
    feed.update(w, fake as unknown as Vfx, 1, () => 0);
  }
  return { fake, zoneRows, projRows };
}

describe('skill VFX feed', () => {
  it.each(ZONE_SKILLS)('%s (%s): zone rows spawn a resolvable preset, loops get a moved handle', (id, vfx) => {
    const { fake, zoneRows } = runSkill(id, vfx);
    expect(zoneRows).toBeGreaterThan(0);
    expect(fake.unknown).toEqual([]);
    expect(fake.spawned.length).toBeGreaterThan(0);
    for (const s of fake.spawned) {
      expect(s.opts.scale).toBeGreaterThan(0);
      if (s.handle !== 0) expect(fake.moved.has(s.handle)).toBe(true);
    }
  });

  it('stops a zone handle once its row is gone', () => {
    const { fake } = runSkill('venom_pool', 'sk.noxious_pall');
    const loops = fake.spawned.filter((s) => s.handle !== 0);
    expect(loops.length).toBeGreaterThan(0);
    for (const s of loops) expect(fake.stopped.has(s.handle)).toBe(true);
  });

  it.each(PROJ_SKILLS)('%s: `sk.*` projectile rows are tracked every frame', (id) => {
    const sk = SK_FOR[id] as string;
    const { fake, projRows } = runSkill(id, sk);
    expect(projRows).toBeGreaterThan(0);
    expect(fake.unknown).toEqual([]);
    expect(fake.tracked.get(sk) ?? 0).toBeGreaterThan(0);
  });

  it('generic projectile bodies skip `sk.*` styles only', () => {
    const tab = compileProjectileStyles([styleFromName('sk.drifting_charms', false), styleFromName('proj.talisman.dragon', false)]);
    expect(Array.from(tab.hidden)).toEqual([1, 0, 0]);
  });
});
