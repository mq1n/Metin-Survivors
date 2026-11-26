// Gallery scenarios: in-run HUD (owner: B5 hud). Quiet mid-run frame, animated ticker, boss fight, announcement feed, low
// health, the first seconds of a run (almost nothing owned yet), the region-map overlay, and a crowd of off-screen pointers.
import type { HudSnapshot } from '../../../sim/types';
import { atlasOpen, buildOpen, meterOpen, miscOpen, minimapHidden } from '../../hud/hooks';
import { inRun, type Scenario } from '../scenarioKit';

export const order = 80;

type G = Parameters<Scenario['run']>[0];

/** Every HUD scenario starts from the same UI state (map shown, atlas + meter closed). */
function fresh(): void {
  atlasOpen.value = false;
  minimapHidden.value = false;
  meterOpen.value = false;
  miscOpen.value = false;
  buildOpen.value = false;
}

/** Patches the snapshot the mock ticker pushed (only valid for non-animated scenarios: the ticker would overwrite it). */
function patch(g: G, fn: (h: HudSnapshot) => Partial<HudSnapshot>): void {
  const h = g.store.hud.value;
  if (h) g.store.setHud({ ...h, ...fn(h) });
}

/** The hero stands out in the field (not on the spawn plaza): a real position readout and a map window with terrain. */
const FIELD = { px: 47, pz: -58 } as const;

/** One skill mid-cooldown with an off-axis wedge (a clock sweep: 0.5 would read as a flat vertical wipe). */
function cooling(h: HudSnapshot, slot = 2, frac = 0.64): Partial<HudSnapshot> {
  // `cdLeft` = seconds left (HudSkillSlot): the countdown number of the slot
  return { skills: h.skills.map((s, i) => (i === slot ? { ...s, cooldown: frac, cdLeft: Math.round(frac * 65) / 10 } : s)) };
}
let announceTimers: number[] = [];

export const scenarios: Scenario[] = [
  {
    id: 'hud',
    label: 'HUD',
    run: (g) => {
      fresh();
      inRun(g, { t: 215 });
      patch(g, (h) => ({ ...FIELD, ...cooling(h) }));
    },
  },
  {
    id: 'hud-anim',
    label: 'HUD (animated)',
    run: (g) => {
      fresh();
      inRun(g, { t: 215, anim: true });
    },
  },
  {
    id: 'hud-boss',
    label: 'HUD · boss',
    run: (g) => {
      fresh();
      inRun(g, { t: 372, boss: true });
      patch(g, (h) => ({ ...FIELD, ...cooling(h) }));
    },
  },
  {
    id: 'hud-boss-rage',
    label: 'HUD · boss enraged, low health',
    run: (g) => {
      fresh();
      inRun(g, { t: 640, boss: true, hpFrac: 0.17 });
      patch(g, (h) => ({ boss: h.boss ? { ...h.boss, hp: h.boss.hpMax * 0.23, phase: 2, enraged: true, final: true } : null, shield: 0, ...FIELD }));
    },
  },
  {
    id: 'hud-announce',
    label: 'HUD · announcements',
    run: (g) => {
      fresh();
      inRun(g, { t: 241 });
      patch(g, () => FIELD);
      const b = g.content.bosses[0];
      // a re-run of the scenario (language switch, picker) must not stack a second banner; the feed shows ONE plate at a time
      for (const id of announceTimers) window.clearTimeout(id);
      announceTimers = [window.setTimeout(() => g.events.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: b?.id ?? '', x: 0, z: 0, final: false }), 300)];
    },
  },
  {
    id: 'hud-announce-metin',
    label: 'HUD · Metin banner',
    run: (g) => {
      fresh();
      inRun(g, { t: 241 });
      patch(g, () => FIELD);
      const m = g.content.metins[0];
      for (const id of announceTimers) window.clearTimeout(id);
      announceTimers = [window.setTimeout(() => g.events.emit({ t: 'metinWarn', metin: 1, def: m?.id ?? '', x: 20, z: 5, dur: 3, great: true }), 300)];
    },
  },
  {
    id: 'hud-lowhp',
    label: 'HUD · low health',
    run: (g) => {
      fresh();
      inRun(g, { t: 215, hpFrac: 0.14 });
      patch(g, () => ({ shield: 0, ...FIELD }));
    },
  },
  {
    id: 'hud-early',
    label: 'HUD · first seconds of a run',
    run: (g) => {
      fresh();
      inRun(g, { t: 14 });
      patch(g, (h) => ({
        level: 1,
        xp: 14,
        xpNext: 40,
        hp: h.hpMax,
        shield: 0,
        ...FIELD,
        kills: 3,
        yeop: 12,
        shards: 0,
        corruption: 0,
        skills: h.skills.slice(0, 2).map((s) => ({ ...s, rank: 0, awakened: false, cooldown: 0 })),
        passives: [],
        stones: [null, null, null, null, null, null],
        trinkets: [null, null, null],
        metins: [],
        dmg: [],
        dps: 0,
      }));
    },
  },
  {
    id: 'hud-map',
    label: 'HUD · region map',
    run: (g) => {
      fresh();
      inRun(g, { t: 215 });
      patch(g, () => FIELD);
      atlasOpen.value = true;
    },
  },
  {
    id: 'hud-build',
    label: 'HUD · build board open',
    run: (g) => {
      fresh();
      buildOpen.value = true;
      inRun(g, { t: 215 });
      patch(g, (h) => ({ ...FIELD, ...cooling(h) }));
    },
  },
  {
    id: 'hud-meter',
    label: 'HUD · damage meter open',
    run: (g) => {
      fresh();
      meterOpen.value = true;
      inRun(g, { t: 215 });
      patch(g, () => FIELD);
    },
  },
  {
    id: 'hud-arrows',
    label: 'HUD · off-screen pointers on every side',
    run: (g) => {
      fresh();
      inRun(g, { t: 372, boss: true });
      patch(g, (h) => ({
        boss: h.boss ? { ...h.boss, x: 0, z: -60 } : null,
        metins: [
          { id: 1, x: 60, z: -30, awakened: false, hpFrac: 0.8, rune: '#5dff9a' },
          { id: 2, x: -50, z: -26, awakened: true, hpFrac: 0.4, rune: '#ff9a2e' },
          { id: 3, x: 40, z: 40, awakened: false, hpFrac: 1, rune: '#7ab8ff' },
          { id: 4, x: -8, z: 55, awakened: false, hpFrac: 1, rune: '#d070ff' },
          { id: 5, x: 70, z: 6, awakened: false, hpFrac: 1, rune: '#ffd36a' },
        ],
      }));
    },
  },
  {
    id: 'hud-map-hidden',
    label: 'HUD · minimap folded away',
    run: (g) => {
      fresh();
      minimapHidden.value = true;
      inRun(g, { t: 215 });
    },
  },
];
