// EV-03b: the run-event visuals. The specs (ids, art, tiers, readability rules), the route (spawn / follow / remove per phase, persistent handles keyed
// by the event id, no leak after the end, a late joiner, a dropped message, an evicted loop) and the champion locator of app/simFeed.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { championLocator, runEventSource } from '../../../../app/simFeed';
import { content } from '../../../../data/loader';
import { ByteReader } from '../../../../net/coop/bytes';
import { EventCollector, WireStrings, decodeEvents } from '../../../../net/coop/events';
import { CAMERA_PITCH } from '../../../../render/camera';
import { spawnEnemy } from '../../../../sim/enemies';
import { EventBus, type RunEventEvent, type SimEvent } from '../../../../sim/events';
import { EnemyFlag, EnemyState } from '../../../../sim/stores';
import { createWorld } from '../../../../sim/world';
import type { SpawnOpts } from '../../../types';
import { evalColor } from '../../../spec/curves';
import { EVENT_SPEC_KINDS, EVENT_SPEC_PREFIX } from '../../../spec/artScope';
import { SPEC_REGISTRY } from '../../../spec/preset';
import type { ElementSpec, FxSpec, ParticleSpec } from '../../../spec/types';
import {
  CHAMPION_BASE,
  CHANNEL_STALE,
  EVENT_ART_IDS,
  EVENT_PRESETS,
  EVENT_PRESET_IDS,
  EVENT_SPECS,
  LIVENESS_EVERY,
  RAIN_MARK_BASE,
  RAIN_MARK_WINDOW,
  RunEventVfx,
  SHRINE_BASE,
  SHRINE_SEGMENTS,
  setRunEventSource,
  type EventVfxHost,
  type RunEventSource,
} from '..';

// ------------------------------------------------------------------------------------------------------------------------ specs

const manifest = JSON.parse(readFileSync(new URL('../../../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as { textures?: Record<string, unknown> } & Record<string, unknown>;
const manifestIds = new Set(Object.keys(manifest.textures ?? manifest));

const LOOPS: ReadonlySet<string> = new Set([EVENT_PRESET_IDS.shrine, EVENT_PRESET_IDS.shrinePillar, EVENT_PRESET_IDS.shrineChannel, EVENT_PRESET_IDS.champion]);

function artOf(el: ElementSpec): string[] {
  const t = el.tex;
  if (typeof t === 'string') return [];
  return typeof t.art === 'string' ? [t.art] : [...t.art];
}

describe('run-event specs', () => {
  it('the ids are the contract: six presets, the art-scope table names exactly them, each registered as a spec', () => {
    const ids = EVENT_SPECS.map((s) => s.id).sort();
    expect(ids).toEqual(Object.values(EVENT_PRESET_IDS).sort());
    expect(Object.values(EVENT_SPEC_KINDS).flat().sort()).toEqual(ids);
    expect(EVENT_PRESETS.map((p) => p.id).sort()).toEqual(ids);
    const reg = new Set(SPEC_REGISTRY.map((s) => s.id));
    for (const id of ids) {
      expect(id.startsWith(EVENT_SPEC_PREFIX), id).toBe(true);
      expect(reg.has(id), id).toBe(true);
    }
  });

  it('persistent layers are auras (loops), the claim and the rain mark are one-shots; every spec is SOON (pinned) and none is a moment spec', () => {
    for (const s of EVENT_SPECS) {
      expect(s.artTier, s.id).toBe(1);
      expect(s.moment, s.id).toBeUndefined();
      expect(s.follow, `${s.id}: follow would make the effect ride a hero standing within 2 m`).toBeUndefined();
      expect(s.behavior === 'persistentAura', s.id).toBe(LOOPS.has(s.id));
    }
    const preset = (id: string) => EVENT_PRESETS.find((p) => p.id === id);
    for (const id of LOOPS) expect(preset(id)?.loop, id).toBe(true);
    expect(preset(EVENT_PRESET_IDS.shrineClaim)?.loop).toBe(false);
    expect(preset(EVENT_PRESET_IDS.rainMark)?.loop).toBe(false);
  });

  it('every sprite is a shipped one (no new raster): the manifest has it, the art list names exactly the ones the specs draw', () => {
    const used = new Set<string>();
    for (const s of EVENT_SPECS) for (const el of s.elements) for (const a of artOf(el)) used.add(a);
    expect([...used].sort()).toEqual([...EVENT_ART_IDS].sort());
    for (const id of EVENT_ART_IDS) expect(manifestIds.has(id), id).toBe(true);
  });

  it('nothing here darkens: no occlude; an alpha layer of the shrine (a hero channels inside it) never pulls the ground it covers toward a dark colour (the rule of noCasterDarkening: alpha x (0.45 - luma) <= 0.08)', () => {
    const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const rgba = [0, 0, 0, 0];
    for (const s of EVENT_SPECS) {
      expect(s.occlude, s.id).toBeUndefined();
      for (const el of s.elements) {
        expect((el as { occlude?: number }).occlude, `${s.id}: ${el.note}`).toBeUndefined();
        if (!s.id.startsWith('ev.shrine') || el.blend === 'add') continue;
        for (let i = 0; i < 33; i++) {
          evalColor(el.color as number[], i / 32, rgba);
          const [r, g, b, a] = rgba as [number, number, number, number];
          if (a <= 0.1) continue;
          expect(a * Math.max(0, 0.45 - luma(r, g, b) * ((el as { bright?: number }).bright ?? 1)), `${s.id} ${el.note} @${i}/32`).toBeLessThanOrEqual(0.08);
        }
      }
    }
  });

  it('quality tiers: low draws the alpha layers only (no additive element without a minimum tier), at most 8 elements; medium / high add the rest', () => {
    for (const s of EVENT_SPECS) {
      const low = s.elements.filter((el) => (el.minTier ?? 0) === 0);
      expect(low.length, `${s.id} low elements`).toBeLessThanOrEqual(8);
      // the rain mark is two surfaces (an annulus each): on low a surface batch would cost draws the stone's own warning disc does not need, so low draws none of it
      if (s.id === EVENT_PRESET_IDS.rainMark) {
        expect(low.length, 'rain mark on low').toBe(0);
        expect(s.elements.every((el) => el.kind === 'surface'), 'rain mark: surfaces only').toBe(true);
        continue;
      }
      expect(low.length, `${s.id} draws something on low`).toBeGreaterThan(0);
      // the additive HDR layers clip to white at once without the composite pass: on low only the alpha layers (and the shrine's one-shot flare / pillar glow stay soft)
      for (const el of low) if (el.blend === 'add') expect((el as { clamp?: number }).clamp ?? 1, `${s.id}: ${el.note}`).toBeLessThanOrEqual(1);
    }
    const shrine = EVENT_SPECS.find((s) => s.id === EVENT_PRESET_IDS.shrine) as FxSpec;
    expect(shrine.elements.some((el) => (el.minTier ?? 0) >= 1), 'medium adds layers').toBe(true);
    expect(shrine.elements.length).toBeLessThanOrEqual(14);
  });

  it('the shrine is authored for the radius of the content (kinds.bargain.radius = 2.5 m) and the channel ring has 8 segments of 41 deg', () => {
    expect(SHRINE_BASE).toBe(content.runEvents?.kinds.bargain.radius);
    expect(SHRINE_SEGMENTS).toBe(8);
    const seg = EVENT_SPECS.find((s) => s.id === EVENT_PRESET_IDS.shrineChannel) as FxSpec;
    const arcs = seg.elements.filter((el) => el.kind === 'surface').map((el) => (el as { shape: { kind: string; span?: number } }).shape);
    expect(arcs.length).toBeGreaterThan(0);
    for (const a of arcs) {
      expect(a.kind).toBe('arc');
      expect(a.span).toBeCloseTo(360 / SHRINE_SEGMENTS - 4, 6);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------------ route

class FakeHost implements EventVfxHost {
  next = 1;
  readonly live = new Map<number, string>();
  readonly spawned: { id: string; o: SpawnOpts; h: number }[] = [];
  readonly moves: [number, number, number][] = [];
  readonly stops: number[] = [];
  spawn(id: string, o: SpawnOpts = {}): number {
    const h = LOOPS.has(id) ? this.next++ : 0;
    this.spawned.push({ id, o: { ...o }, h });
    if (h !== 0) this.live.set(h, id);
    return h;
  }
  move(h: number, x: number, z: number): void {
    this.moves.push([h, x, z]);
  }
  stop(h: number): void {
    this.live.delete(h);
    this.stops.push(h);
  }
  alive(h: number): boolean {
    return this.live.has(h);
  }
  count(id: string): number {
    return this.spawned.filter((s) => s.id === id).length;
  }
  liveIds(): string[] {
    return [...this.live.values()].sort();
  }
}

function ev(kind: string, phase: RunEventEvent['phase'], id: number, x: number, z: number, player = -1, p = 0): SimEvent {
  return { t: 'runEvent', kind, phase, id, x, z, startAt: 100, endAt: 160, player, p };
}
function warn(metin: number, x: number, z: number, def = 'metin_a', great = false): SimEvent {
  return { t: 'metinWarn', metin, def, x, z, dur: 2.6, great };
}

function rig(src: RunEventSource | null = null): { host: FakeHost; vfx: RunEventVfx } {
  setRunEventSource(src);
  const host = new FakeHost();
  return { host, vfx: new RunEventVfx(host) };
}

describe('run-event specs: the pillar and the champion', () => {
  const pillar = EVENT_SPECS.find((s) => s.id === EVENT_PRESET_IDS.shrinePillar) as FxSpec;
  const half = (el: ParticleSpec): [number, number] => {
    const h = el.half as readonly (readonly number[])[];
    return [h[0]?.[1] as number, h[1]?.[1] as number];
  };

  it('the shrine pillar is a loop of its own with the foot ON the sigil centre: the screen quad of the fixed 55 degree camera, its bottom edge at (y, z) = (0, 0)', () => {
    expect(pillar.behavior).toBe('persistentAura');
    expect(pillar.size).toBe('mult');
    const els = pillar.elements as ParticleSpec[];
    expect(els.length).toBe(2);
    for (const el of els) {
      expect(el.billboard).toBe('screen');
      const [, hy] = half(el);
      const at = el.at as readonly [number, number, number];
      // the bottom edge of a camera-facing quad: `at` minus half height x the camera's up vector (0, cos pitch, -sin pitch) in the (y, z) plane
      const bottomY = at[1] - hy * Math.cos(CAMERA_PITCH);
      const bottomZ = at[2] + hy * Math.sin(CAMERA_PITCH);
      expect(Math.abs(bottomY), 'the bottom edge lies on the floor (never below it: the depth test would cut it)').toBeLessThan(0.02);
      expect(bottomY).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.abs(bottomZ), 'and on the sigil centre, not 2 m toward the camera').toBeLessThan(0.05);
    }
    // the ground spec carries no upright layer any more: the only 'screen' billboard of the shrine spec is the motes
    const shrine = EVENT_SPECS.find((s) => s.id === EVENT_PRESET_IDS.shrine) as FxSpec;
    expect((shrine.elements as ParticleSpec[]).filter((el) => el.billboard === 'screen').length).toBe(1);
  });

  it('the pillar is a soft gold column, not a needle: the sprite is the level-up pillar, wide enough (>= 0.9 m of the 341 x 512 sprite) and never brighter than display white', () => {
    for (const el of pillar.elements as ParticleSpec[]) {
      expect(artOf(el)).toEqual(['vfx_levelup_heal_pillar_cream']);
      const [hx, hy] = half(el);
      expect(hx / hy).toBeCloseTo(341 / 512, 2);
      expect(hx * 2 * 0.3, 'a column of ~0.3 of the sprite width').toBeGreaterThanOrEqual(0.9);
      if (el.blend === 'add') expect(el.clamp ?? 99).toBeLessThanOrEqual(1);
    }
  });

  it('the appearing flare plays at rank 0 only (a respawned loop sets rank 1); the low tier of the shrine is pale gold (no deep amber that reads as a telegraph)', () => {
    const shrine = EVENT_SPECS.find((s) => s.id === EVENT_PRESET_IDS.shrine) as FxSpec;
    const flare = shrine.elements.filter((el) => el.kind === 'particle' && (el as ParticleSpec).billboard === 'ground' && el.maxRank === 0);
    expect(flare.length).toBe(1);
    const rgba = [0, 0, 0, 0];
    for (const id of [EVENT_PRESET_IDS.shrine, EVENT_PRESET_IDS.shrineChannel]) {
      const spec = EVENT_SPECS.find((s) => s.id === id) as FxSpec;
      for (const el of spec.elements.filter((e) => (e.minTier ?? 0) === 0 && e.blend === 'alpha')) {
        evalColor(el.color as number[], 0.5, rgba);
        const [r, g, b] = rgba as [number, number, number, number];
        // the green share of the red: amber (0xb87410) is ~0.37 in linear light, pale gold (0xe8b030) ~0.52
        expect(g / r, `${id} ${el.kind}`).toBeGreaterThan(0.42);
        expect(b).toBeLessThan(g);
      }
    }
  });

  it('the champion ring has a breathing crest (medium and up, a ring that swells at one spot: never an expanding shockwave) and an alpha crown that survives the stone plaza', () => {
    const champ = EVENT_SPECS.find((s) => s.id === EVENT_PRESET_IDS.champion) as FxSpec;
    const els = champ.elements as ParticleSpec[];
    const breath = els.filter((el) => el.kind === 'particle' && el.life[1] === 2.4);
    expect(breath.length).toBe(1);
    expect(breath[0]?.minTier).toBe(1);
    expect(breath[0]?.scale).toBeUndefined();
    expect(els.filter((el) => artOf(el)[0] === 'vfx_ring_spiked_crown_a' && el.blend === 'alpha').length).toBe(1);
  });
});

describe('route: the Sky Sovereign shrine (bargain)', () => {
  it('announce spawns ONE shrine at the event point with the content radius; heartbeats and the active phase refresh, never respawn; the end removes it', () => {
    const { host, vfx } = rig({ shrineRadius: 3 });
    vfx.handle(ev('bargain', 'announce', 1, 12, -7));
    expect(host.count('ev.shrine')).toBe(1);
    expect(host.spawned[0]?.o).toMatchObject({ x: 12, z: -7, scale: 3 });
    for (let i = 0; i < 4; i++) {
      vfx.update(5);
      vfx.handle(ev('bargain', i === 0 ? 'active' : 'active', 1, 12, -7));
    }
    expect(host.count('ev.shrine')).toBe(1);
    expect(host.count('ev.shrinePillar')).toBe(1);
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
    expect(host.spawned.find((s) => s.id === 'ev.shrinePillar')?.o).toMatchObject({ x: 12, z: -7 });
    expect(vfx.liveCount).toBe(1);
    vfx.handle(ev('bargain', 'end', 1, 12, -7, -1, 1));
    expect(host.liveIds()).toEqual([]);
    expect(vfx.liveCount).toBe(0);
  });

  it('without a source the radius is the authored one', () => {
    const { host, vfx } = rig(null);
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    expect(host.spawned[0]?.o.scale).toBe(SHRINE_BASE);
  });

  it('a guest that joins mid-event is served by whatever event arrives first (a heartbeat, even a channel report)', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'channel', 7, 3, 4, 0, 0.5));
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrineChannel', 'ev.shrineChannel', 'ev.shrineChannel', 'ev.shrineChannel']);
    expect(vfx.stateOf(7)?.lit).toBe(4);
  });

  it('the channel ring FILLS with the progress: segment k stands once p >= (k + 1) / 8, turned by k x 45 deg, and the ring empties when the progress resets', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 5, 5));
    const lit = (): number => host.liveIds().filter((i) => i === 'ev.shrineChannel').length;
    const steps: [number, number][] = [[0, 0], [0.1, 0], [0.125, 1], [0.25, 2], [0.3, 2], [0.65, 5], [0.99, 7], [1, 8]];
    for (const [p, want] of steps) {
      vfx.handle(ev('bargain', 'channel', 1, 5, 5, 0, p));
      expect(lit(), `p ${p}`).toBe(want);
    }
    const rots = host.spawned.filter((s) => s.id === 'ev.shrineChannel').map((s) => s.o.rot as number);
    expect(rots.length).toBe(8);
    rots.forEach((r, k) => expect(r).toBeCloseTo((k * Math.PI * 2) / 8, 9));
    for (const s of host.spawned.filter((x) => x.id === 'ev.shrineChannel')) expect(s.o).toMatchObject({ x: 5, z: 5, scale: SHRINE_BASE });
    // the hero leaves: one p = 0 report and the whole ring is gone at once, the shrine stays, the pillar stands again
    vfx.handle(ev('bargain', 'channel', 1, 5, 5, 0, 0));
    expect(lit()).toBe(0);
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
    // it can fill again from nothing (no segment is spawned twice while it stands)
    vfx.handle(ev('bargain', 'channel', 1, 5, 5, 0, 0.25));
    expect(lit()).toBe(2);
    vfx.handle(ev('bargain', 'channel', 1, 5, 5, 0, 0.25));
    expect(lit()).toBe(2);
    expect(host.count('ev.shrineChannel')).toBe(8 + 2);
  });

  it('co-op: the ring shows the best channel of the party; a hero dropping out does not empty it while another still channels', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 0, 0.5));
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 1, 0.25));
    expect(vfx.stateOf(1)?.lit).toBe(4);
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 0, 0));
    expect(vfx.stateOf(1)?.lit).toBe(2);
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 1, 0));
    expect(vfx.stateOf(1)?.lit).toBe(0);
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
    // a player index out of the party range is ignored, not a crash
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 9, 0.5));
    expect(vfx.stateOf(1)?.lit).toBe(0);
  });

  it('a completed channel plays the claim ONCE and re-arms when the progress drops; the ring is full while it lasts', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 2, 3));
    vfx.handle(ev('bargain', 'channel', 1, 2, 3, 0, 0.9));
    expect(host.count('ev.shrineClaim')).toBe(0);
    vfx.handle(ev('bargain', 'channel', 1, 2, 3, 0, 1));
    vfx.handle(ev('bargain', 'channel', 1, 2, 3, 0, 1));
    expect(host.count('ev.shrineClaim')).toBe(1);
    expect(host.spawned.find((s) => s.id === 'ev.shrineClaim')?.o).toMatchObject({ x: 2, z: 3, scale: SHRINE_BASE });
    expect(vfx.stateOf(1)?.lit).toBe(8);
    vfx.handle(ev('bargain', 'channel', 1, 2, 3, 0, 0));
    vfx.handle(ev('bargain', 'channel', 1, 2, 3, 0, 1));
    expect(host.count('ev.shrineClaim')).toBe(2);
  });

  it('a dropped "left the shrine" message cannot leave the ring lit: a hero that stops reporting is reset after CHANNEL_STALE s', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 0, 0.5));
    expect(vfx.stateOf(1)?.lit).toBe(4);
    vfx.update(CHANNEL_STALE - 0.1);
    expect(vfx.stateOf(1)?.lit).toBe(4);
    // a report keeps it alive
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 0, 0.625));
    vfx.update(CHANNEL_STALE - 0.1);
    expect(vfx.stateOf(1)?.lit).toBe(5);
    vfx.update(0.2);
    expect(vfx.stateOf(1)?.lit).toBe(0);
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
  });

  it('an evicted loop (pool full, expired) is respawned by the liveness check while the event is up, the lit segments with it', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 0, 0.5));
    for (const h of [...host.live.keys()]) host.live.delete(h);
    vfx.update(LIVENESS_EVERY + 0.01);
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrineChannel', 'ev.shrineChannel', 'ev.shrineChannel', 'ev.shrineChannel']);
    expect(host.count('ev.shrine')).toBe(2);
    expect(host.count('ev.shrineChannel')).toBe(8);
  });

  it('no leak after the end, whatever stood: every handle is stopped, nothing is respawned afterwards, a late channel report of the dead event is not a new event', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'announce', 1, 0, 0));
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    vfx.handle(ev('bargain', 'channel', 1, 0, 0, 0, 1));
    expect(host.live.size).toBe(9);
    vfx.handle(ev('bargain', 'end', 1, 0, 0, -1, 1));
    expect(host.live.size).toBe(0);
    expect(vfx.liveCount).toBe(0);
    vfx.update(10);
    expect(host.live.size).toBe(0);
    // an 'end' for an id nobody knows is harmless
    vfx.handle(ev('bargain', 'end', 99, 0, 0));
    expect(host.live.size).toBe(0);
  });

  it('the pillar of light stands only while NO hero channels: it goes with the first progress, and stands again when the channel resets (a hero in the centre is never behind it)', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'announce', 1, 3, 4));
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
    vfx.handle(ev('bargain', 'channel', 1, 3, 4, 0, 0.06));
    expect(host.liveIds()).not.toContain('ev.shrinePillar');
    expect(host.liveIds()).toContain('ev.shrine');
    // heartbeats and repeated reports do not bring it back, and the liveness check does not either
    vfx.handle(ev('bargain', 'active', 1, 3, 4));
    vfx.handle(ev('bargain', 'channel', 1, 3, 4, 0, 0.3));
    vfx.update(LIVENESS_EVERY + 0.01);
    vfx.handle(ev('bargain', 'channel', 1, 3, 4, 0, 0.5));
    vfx.update(LIVENESS_EVERY + 0.01);
    expect(host.count('ev.shrinePillar')).toBe(1);
    expect(host.liveIds()).not.toContain('ev.shrinePillar');
    // another hero keeps it down while the first leaves
    vfx.handle(ev('bargain', 'channel', 1, 3, 4, 1, 0.1));
    vfx.handle(ev('bargain', 'channel', 1, 3, 4, 0, 0));
    expect(host.liveIds()).not.toContain('ev.shrinePillar');
    vfx.handle(ev('bargain', 'channel', 1, 3, 4, 1, 0));
    expect(host.liveIds()).toContain('ev.shrinePillar');
    expect(host.count('ev.shrinePillar')).toBe(2);
    // and a hero who stops reporting (the stale reset) brings it back too
    vfx.handle(ev('bargain', 'channel', 1, 3, 4, 0, 0.2));
    expect(host.liveIds()).not.toContain('ev.shrinePillar');
    vfx.update(CHANNEL_STALE + 0.1);
    expect(host.liveIds()).toContain('ev.shrinePillar');
    // the end takes every handle, the pillar included
    vfx.handle(ev('bargain', 'end', 1, 3, 4, -1, 1));
    expect(host.live.size).toBe(0);
  });

  it('an evicted pillar is respawned by the liveness check (only while it should stand); an evicted shrine loop respawns WITHOUT the appearing flare (rank 1)', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    expect(host.spawned.find((s) => s.id === 'ev.shrine')?.o.rank).toBe(0);
    host.live.clear();
    vfx.update(LIVENESS_EVERY + 0.01);
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
    const shrines = host.spawned.filter((s) => s.id === 'ev.shrine');
    expect(shrines.length).toBe(2);
    expect(shrines[1]?.o.rank).toBe(1);
  });

  it('CO-OP GUEST ORDER: the wire flushes the "end" ahead of the last "channel" reports of the same block; the dead event is not a new one (no ghost shrine for the rest of the run)', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 5, 5));
    vfx.handle(ev('bargain', 'channel', 1, 5, 5, 1, 0.9));
    expect(host.live.size).toBe(1 + 7);
    // the guest's decode order of the host's final tick (channel p = 1, channel p = 0, end): end -> channel(1) -> channel(0)
    vfx.handle(ev('bargain', 'end', 1, 5, 5, -1, 1));
    vfx.handle(ev('bargain', 'channel', 1, 5, 5, 1, 1));
    vfx.handle(ev('bargain', 'channel', 1, 5, 5, 1, 0));
    expect(vfx.liveCount).toBe(0);
    expect(host.live.size).toBe(0);
    expect(host.count('ev.shrineClaim'), 'no claim pop for the dead event').toBe(0);
    // 100 s later (the liveness check, EVENT_LOOP_LIFE): still nothing
    for (let i = 0; i < 400; i++) vfx.update(0.25);
    expect(host.live.size).toBe(0);
    expect(host.count('ev.shrine')).toBe(1);
    // a heartbeat of the dead event, or its announce, is ignored as well; a NEW event (a new id) is served
    vfx.handle(ev('bargain', 'announce', 1, 5, 5));
    vfx.handle(ev('bargain', 'active', 1, 5, 5));
    expect(host.live.size).toBe(0);
    vfx.handle(ev('bargain', 'active', 2, 30, 30));
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
  });

  it('the shrine that times out under a channel (p = 0 and the end in one block) leaves nothing, in the host order and in the guest order', () => {
    for (const order of [['channel', 'end'], ['end', 'channel']] as const) {
      const { host, vfx } = rig();
      vfx.handle(ev('bargain', 'active', 4, 0, 0));
      vfx.handle(ev('bargain', 'channel', 4, 0, 0, 0, 0.4));
      for (const ph of order) vfx.handle(ev('bargain', ph, 4, 0, 0, ph === 'end' ? -1 : 0, 0));
      expect(host.live.size, order.join()).toBe(0);
      vfx.update(5);
      expect(host.live.size, order.join()).toBe(0);
    }
  });

  it('the same through the REAL co-op wire (EventCollector -> flush -> decodeEvents): the last hero claims, the guest decodes end -> channel(1) -> channel(0), nothing stands afterwards', () => {
    const { host, vfx } = rig();
    const strings = new WireStrings();
    const collector = new EventCollector(strings);
    const base = { t: 'runEvent', kind: 'bargain', id: 1, x: 5, z: 5, startAt: 395, endAt: 455 } as const;
    const ship = (list: unknown[]): string[] => {
      collector.collect(list as never);
      const block = collector.flush();
      const bus = new EventBus();
      decodeEvents(new ByteReader(block.bytes), block.count, { bus, player: (i) => i, enemy: () => 0, str: (i) => strings.names[i] ?? '' });
      const order: string[] = [];
      for (const e of bus.list) {
        const r = e as RunEventEvent;
        order.push(r.phase === 'channel' ? `channel(${r.p.toFixed(2)})` : r.phase);
        vfx.handle(e);
      }
      return order;
    };
    ship([{ ...base, phase: 'active', player: -1, p: 0 }]);
    ship([{ ...base, phase: 'channel', player: 1, p: 0.9 }]);
    expect(vfx.liveCount).toBe(1);
    // the host's final tick (sim/runEvents.ts: onTick sends p = 1 then p = 0, then isDone -> finish -> 'end'), in HOST order
    const order = ship([
      { ...base, phase: 'channel', player: 1, p: 1 },
      { ...base, phase: 'channel', player: 1, p: 0 },
      { ...base, phase: 'end', player: -1, p: 1 },
    ]);
    expect(order, 'the guest sees the end first (priority 0 before 2)').toEqual(['end', 'channel(1.00)', 'channel(0.00)']);
    expect(vfx.liveCount).toBe(0);
    expect(host.live.size).toBe(0);
    for (let i = 0; i < 400; i++) vfx.update(0.25);
    expect(host.live.size).toBe(0);
  });

  it('events are keyed by id: two shrines live apart, ending one leaves the other', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    vfx.handle(ev('bargain', 'active', 2, 30, 30));
    expect(vfx.liveCount).toBe(2);
    vfx.handle(ev('bargain', 'end', 1, 0, 0));
    expect(host.liveIds()).toEqual(['ev.shrine', 'ev.shrinePillar']);
    expect(vfx.stateOf(2)).toBeDefined();
  });

  it('reset (run end / VfxSystem.clear) drops every entry and forgets the ended ids; the next run starts clean (its event ids start again)', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    vfx.reset();
    expect(vfx.liveCount).toBe(0);
    vfx.update(2);
    host.live.clear();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    expect(host.count('ev.shrine')).toBe(2);
    // an id that ended in the run before is a live event again in the next one
    vfx.handle(ev('bargain', 'end', 1, 0, 0, -1, 1));
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    expect(vfx.liveCount).toBe(0);
    vfx.reset();
    vfx.handle(ev('bargain', 'active', 1, 0, 0));
    expect(vfx.liveCount).toBe(1);
  });
});

describe('route: the Champion Hunt ring', () => {
  it('nothing at the announcement (no champion stands yet); the ring starts with the active phase on the champion, scale CHAMPION_BASE', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('championHunt', 'announce', 1, 40, 40));
    expect(host.spawned.length).toBe(0);
    vfx.handle(ev('championHunt', 'active', 1, 9, 11));
    expect(host.spawned.length).toBe(1);
    expect(host.spawned[0]).toMatchObject({ id: 'ev.champion', o: { x: 9, z: 11, scale: CHAMPION_BASE } });
    vfx.handle(ev('championHunt', 'active', 1, 9, 11));
    expect(host.count('ev.champion')).toBe(1);
  });

  it('the ring rides the live champion every frame; where the source finds none it follows the position of the latest event', () => {
    let at: { x: number; z: number } | null = { x: 20, z: 5 };
    const { host, vfx } = rig({
      champion: (_x, _z, out) => {
        if (at === null) return false;
        out.x = at.x;
        out.z = at.z;
        return true;
      },
    });
    vfx.handle(ev('championHunt', 'active', 1, 9, 11));
    const h = host.spawned[0]?.h as number;
    vfx.update(1 / 60);
    expect(host.moves.at(-1)).toEqual([h, 20, 5]);
    at = { x: 21.5, z: 5.5 };
    vfx.update(1 / 60);
    expect(host.moves.at(-1)).toEqual([h, 21.5, 5.5]);
    // the row is gone (the source finds none): the ring stays where it was, then follows the next event (the sim re-emits it every 3 m of movement)
    at = null;
    vfx.update(1 / 60);
    expect(host.moves.at(-1)).toEqual([h, 21.5, 5.5]);
    vfx.handle(ev('championHunt', 'active', 1, 30, -4));
    vfx.update(1 / 60);
    expect(host.moves.at(-1)).toEqual([h, 30, -4]);
  });

  it('the end (killed, burrowed, run over) removes the ring; nothing moves afterwards; an evicted ring is respawned on the champion while the hunt runs', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('championHunt', 'active', 1, 9, 11));
    host.live.clear();
    vfx.update(LIVENESS_EVERY + 0.01);
    expect(host.count('ev.champion')).toBe(2);
    expect(host.liveIds()).toEqual(['ev.champion']);
    const moves = host.moves.length;
    vfx.handle(ev('championHunt', 'end', 1, 9, 11, -1, 1));
    expect(host.liveIds()).toEqual([]);
    vfx.update(1);
    expect(host.moves.length).toBe(moves);
    expect(vfx.liveCount).toBe(0);
  });

  it('a hunt that could not start (the end arrives in the same tick) leaves nothing behind; a guest that decodes the end first, then the heartbeat, neither', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('championHunt', 'active', 1, 0, 0));
    vfx.handle(ev('championHunt', 'end', 1, 0, 0, -1, 0));
    expect(host.live.size).toBe(0);
    vfx.handle(ev('championHunt', 'active', 1, 3, 3));
    vfx.update(1);
    expect(host.live.size).toBe(0);
    expect(host.count('ev.champion')).toBe(1);
  });
});

describe('route: the Metin Rain marks', () => {
  it("every stone that falls while the rain is up gets a rune ring in its own colour at its landing spot; the stones of a natural fall and the great metin get none", () => {
    const { host, vfx } = rig({ rune: (def) => (def === 'metin_a' ? 0x44ccff : undefined) });
    vfx.handle(warn(1, 1, 1));
    expect(host.count('ev.rainMark')).toBe(0);
    vfx.handle(ev('metinRain', 'announce', 1, 0, 0));
    vfx.handle(warn(2, 1, 1));
    expect(host.count('ev.rainMark')).toBe(0);
    vfx.handle(ev('metinRain', 'active', 1, 0, 0));
    vfx.update(0.5);
    vfx.handle(warn(3, -8, -4, 'metin_a'));
    vfx.handle(warn(4, 8, -5, 'metin_b'));
    vfx.handle(warn(5, 1, 9, 'metin_a', true));
    const marks = host.spawned.filter((s) => s.id === 'ev.rainMark');
    expect(marks.length).toBe(2);
    expect(marks[0]?.o).toEqual({ x: -8, z: -4, scale: RAIN_MARK_BASE, color: 0x44ccff });
    expect(marks[1]?.o).toEqual({ x: 8, z: -5, scale: RAIN_MARK_BASE });
    // a repeated warning of the same stone does not double the ring
    vfx.handle(warn(3, -8, -4, 'metin_a'));
    expect(host.count('ev.rainMark')).toBe(2);
    // one-shots own no handle: nothing to leak, the rain keeps its entry until the end
    expect(host.live.size).toBe(0);
    expect(vfx.liveCount).toBe(1);
  });

  it("the window is the content's `within` + 1 s when the source gives it (a natural fall later in the rain is not a stone of it)", () => {
    const { host, vfx } = rig({ rainWithin: 3 });
    vfx.handle(ev('metinRain', 'active', 1, 0, 0));
    vfx.update(3.9);
    vfx.handle(warn(1, 0, 0));
    expect(host.count('ev.rainMark')).toBe(1);
    vfx.update(0.2);
    vfx.handle(warn(2, 0, 0));
    expect(host.count('ev.rainMark')).toBe(1);
  });

  it('only the stones of the rain: a warning RAIN_MARK_WINDOW s after the start is a natural fall; after the end none is marked', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('metinRain', 'active', 1, 0, 0));
    vfx.update(RAIN_MARK_WINDOW - 0.1);
    vfx.handle(warn(1, 0, 0));
    expect(host.count('ev.rainMark')).toBe(1);
    vfx.update(0.2);
    vfx.handle(warn(2, 0, 0));
    expect(host.count('ev.rainMark')).toBe(1);
    const again = rig();
    again.vfx.handle(ev('metinRain', 'active', 1, 0, 0));
    again.vfx.handle(ev('metinRain', 'end', 1, 0, 0, -1, 1));
    again.vfx.handle(warn(1, 0, 0));
    expect(again.host.count('ev.rainMark')).toBe(0);
    expect(again.vfx.liveCount).toBe(0);
  });
});

describe('route: other kinds and events', () => {
  it('Golden Hour and unknown kinds draw nothing; unrelated sim events are ignored', () => {
    const { host, vfx } = rig();
    vfx.handle(ev('goldenHour', 'announce', 1, 0, 0));
    vfx.handle(ev('goldenHour', 'active', 1, 0, 0));
    vfx.handle(ev('mystery', 'active', 2, 0, 0));
    vfx.handle({ t: 'shake', amount: 1, duration: 1 });
    vfx.update(3);
    expect(host.spawned.length).toBe(0);
    vfx.handle(ev('goldenHour', 'end', 1, 0, 0));
    expect(host.stops.length).toBe(0);
  });

  it('costs nothing while no event is up: update touches no host call', () => {
    const { host, vfx } = rig();
    for (let i = 0; i < 100; i++) vfx.update(1 / 60);
    expect(host.moves.length + host.spawned.length + host.stops.length).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ simFeed wiring

function world() {
  return createWorld(
    { zone: 'yeonmu', difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 3, meta: { stats: {} } } as Parameters<typeof createWorld>[0],
    content,
  );
}

describe('championLocator (app/simFeed.ts)', () => {
  it('finds the one Leader-flagged row, tracks it by id as it moves, and says false when it is gone or dying', () => {
    const w = world();
    const out = { x: 0, z: 0 };
    const find = championLocator(w);
    expect(find(0, 0, out)).toBe(false);
    const ordinary = spawnEnemy(w, 0, 3, 3, { tier: 2, spawnTime: 0 });
    expect(ordinary).toBeGreaterThanOrEqual(0);
    expect(find(0, 0, out)).toBe(false);
    const row = spawnEnemy(w, 0, 10, -4, { tier: 2, flags: EnemyFlag.Leader, spawnTime: 0 });
    expect(find(0, 0, out)).toBe(true);
    expect(out).toEqual({ x: 10, z: -4 });
    w.enemies.x[row] = 11;
    w.enemies.z[row] = -3;
    expect(find(0, 0, out)).toBe(true);
    expect(out).toEqual({ x: 11, z: -3 });
    w.enemies.state[row] = EnemyState.Dying;
    expect(find(0, 0, out)).toBe(false);
  });

  it('picks the Leader row nearest to the hint when there are several, and survives a swap-remove of the rows in front of it', () => {
    const w = world();
    const find = championLocator(w);
    const out = { x: 0, z: 0 };
    spawnEnemy(w, 0, 50, 50, { tier: 2, flags: EnemyFlag.Leader, spawnTime: 0 });
    const near = spawnEnemy(w, 0, 5, 5, { tier: 2, flags: EnemyFlag.Leader, spawnTime: 0 });
    expect(near).toBeGreaterThanOrEqual(0);
    expect(find(6, 6, out)).toBe(true);
    expect(out).toEqual({ x: 5, z: 5 });
    // rows in front of it die (the store keeps rows dense): the id still finds it
    const first = spawnEnemy(w, 0, 1, 1, { spawnTime: 0 });
    w.enemies.free(0);
    void first;
    expect(find(6, 6, out)).toBe(true);
    expect(out).toEqual({ x: 5, z: 5 });
  });

  it('runEventSource: the rune colour of a metin def, the shrine radius of the content, the locator', () => {
    const w = world();
    const src = runEventSource(w);
    const def = w.metinDefs[0];
    expect(def).toBeDefined();
    if (def === undefined) return;
    expect(src.rune?.(def.id)).toBe(parseInt(def.rune.replace('#', ''), 16));
    expect(src.rune?.('nope')).toBeUndefined();
    expect(src.shrineRadius).toBe(content.runEvents?.kinds.bargain.radius);
    expect(src.rainWithin).toBe(content.runEvents?.kinds.metinRain.within);
    expect(typeof src.champion).toBe('function');
  });
});
