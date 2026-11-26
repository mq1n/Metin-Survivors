// Gallery scenarios of the upgrade work package group A.hud (HD-01: first-time hints and the "Show hints" setting; HD-02 / HD-03 add
// their states here later). Every state runs the REAL pipeline over the mock HUD: it resets the profile's hint list, then raises the sim
// event / HUD change that triggers the hint, and the plate comes through ui/hud/hints.ts + announce.ts. A hint waits for a free screen,
// so the plate that follows a banner (Metin falling, boss incoming) opens about 2.5 s after the state starts and stays up 6 s: capture
// with `--delay 4`. States:
//   upHintsLevelUp / upHintsMetin / upHintsMetinHard / upHintsAwaken / upHintsCorruption / upHintsChest / upHintsBoss   one plate each
//                      (the Metin one reads 1:30, the hard one 1:00; the boss one sits under the boss row of the tablet)
//   upHintsEssence     an essence offer opens, is taken (closes), then its plate
//   upHintsReroll      a level-up offer, one reroll spent (the HUD budget drops), the offer closes, then its plate
//   upHintsInterrupted a plate opens, a level-up offer opens over the HUD 1 s later and the plate is taken back (no text behind the
//                      offer, hintsSeen stays empty), the offer closes and the SAME plate returns for its full 6 s
//                      (capture at 1.6 s: plate; 3.5 s: offer only; 6.5 s: plate again)
//   upHintsOff         the corruption trigger with "Show hints" off: nothing shows
//   upHintsSettings / upHintsSettingsFresh   Settings > Graphics scrolled to the two new rows (some hints seen / none seen)
// `?hints=off` on the gallery URL (shot.ts --query hints=off) runs every state with "Show hints" off: the BEFORE half of a blind pair.
// HD-02 (recommended first hero) adds the hero select under a fresh and under a lived-in profile (the badge shows while the profile has 0 runs):
//   upHeroFirst         fresh profile, the default hero selected: the badge sits on the Shaman card, the record line still says "No runs yet"
//   upHeroFirstShaman   fresh profile, the Shaman selected: its record line carries the recommendation
//   upHeroVeteran       the lived-in gallery profile (runs > 0), the Shaman selected: no badge anywhere
// A fresh state wipes the gallery profile (`MetaService.resetProfile`, device settings kept); the state before it is kept once and put back
// by upHeroVeteran, so run that state after the fresh ones, or reload the page (shot.ts --fresh does).
// HD-03 (run-event banners, the final-boss card, the pact / event / affix hints). The event states run the REAL pipeline over the mock HUD:
// `playEvent` plays an event the way the sim and the HUD do (the HUD clock runs in 100 ms steps, the 'runEvent' events come at the announce
// and the start with a 5 s heartbeat, every HUD snapshot carries { kind, phase, left } like sim/hud.ts and the guest's mirror), and
// announce.ts builds the banner and its countdown from that. "Show hints" is OFF in them (the tip of the first event is its own state).
//   upEvMetinRain       Metin Rain announced: the metin banner in the zone's rune colour, "The stones fall in 00:0n" (capture --delay 1.5)
//   upEvChampionAnnounce  Champion Hunt announced: the danger plate "It arrives in 00:0n" (--delay 1.5)
//   upEvChampion        Champion Hunt running: the standing plate "Slay it before it escapes: 00:5n" counting down (--delay 3)
//   upEvChampionBoss    the same plate under a boss row of the tablet (no overlap: it is the last row)
//   upEvChampionWon     the hunt is won 4 s in: "Champion slain! Claim its chest" (--delay 5.5)
//   upEvChampionLost    the hunt runs out 3 s in: "The champion escaped" (--delay 4.5)
//   upEvGolden          Golden Hour running: the gold plate "Yeop x2, elites x2: 00:4n" (--delay 2)
//   upEvBargain         the Sky Sovereign's shrine: the info banner, held 6 s (--delay 1.5)
//   upEvFinal           the final boss spawns: the big card "The Great Metin falls: <boss> rises" under the gold final boss row (--delay 1)
//   upEvBandBoss        a band boss spawns: the smaller big-title card, for the blind pair against the final card
//   upHintsPact         a level-up offer with a pact card opens and closes: "Own <passive> at rank 4 to awaken <skill>."
//   upHintsEvent        the first running event with hints on: the plate, the tip over it for 6 s, the plate again
//   upHintsAffix        the first elite of band 1 with affixes switched on (they ship off): "Elites carry affixes ..."
import { DEFAULT_AFFIXES, type ContentDB } from '../../../data/schema';
import { settings } from '../../../engine/settings';
import { exportMsav, type SaveData } from '../../../meta';
import type { HudSnapshot } from '../../../sim/types';
import { HINT_IDS } from '../../hud/hints';
import { atlasOpen, buildOpen, meterOpen, miscOpen, minimapHidden } from '../../hud/hooks';
import { clearAnnouncements } from '../../hud/announce';
import { settingsTab } from '../../screens/Settings';
import { mockRequest } from '../mock';
import { inRun, openSub, restoreServices, type Scenario } from '../scenarioKit';

export const order = 85;

type G = Parameters<Scenario['run']>[0];

/** where the hero stands (a field position, as the other HUD states) */
const FIELD = { px: 47, pz: -58 } as const;

let timers: number[] = [];
let hardPatched: { had: boolean; value: number | undefined } | null = null;
/** the HUD clock of the event being played (an interval id) and the content's affixes before upHintsAffix switched them on */
let eventClock: number | undefined;
let affixPatched: { prev: ContentDB['affixes'] } | null = null;

/** The same start for every state: a fresh profile with hints on, normal difficulty, no plate, no timer of an earlier state. */
function fresh(g: G, over: { showHints?: boolean; hintsSeen?: string[] } = {}): void {
  for (const id of timers) window.clearTimeout(id);
  timers = [];
  if (hardPatched) {
    const hard = g.content.balance.hard as { awakenMul?: number };
    if (hardPatched.had) hard.awakenMul = hardPatched.value;
    else delete hard.awakenMul;
    hardPatched = null;
  }
  window.clearInterval(eventClock);
  eventClock = undefined;
  if (affixPatched) {
    g.content.affixes = affixPatched.prev;
    affixPatched = null;
  }
  g.store.select({ difficulty: 'normal' });
  const forcedOff = new URLSearchParams(location.search).get('hints') === 'off';
  settings.update({ showHints: forcedOff ? false : (over.showHints ?? true), hintsSeen: over.hintsSeen ?? [] });
  // The HUD stays mounted from one gallery state to the next, and so does the Hints controller with the plate it shows and its queue: a
  // 'runEnd' makes it drop both (and the feed forget its standing plate), then clearAnnouncements() empties the feed and re-opens the run
  // flag. Without it a state applied after another one showed that one's tip.
  g.events.emit({ t: 'runEnd', victory: false });
  clearAnnouncements();
  atlasOpen.value = false;
  minimapHidden.value = false;
  meterOpen.value = false;
  miscOpen.value = false;
  buildOpen.value = false;
}

const later = (ms: number, fn: () => void): void => void timers.push(window.setTimeout(fn, ms));

function patchHud(g: G, fn: (h: HudSnapshot) => Partial<HudSnapshot>): void {
  const h = g.store.hud.value;
  if (h) g.store.setHud({ ...h, ...fn(h) });
}

/** An in-run state whose HUD is quiet (no corruption yet) so the one trigger of the state is the only thing that happens. */
function quiet(g: G, opts: Parameters<typeof inRun>[1] = {}): void {
  inRun(g, { t: 215, ...opts });
  patchHud(g, () => ({ ...FIELD, corruption: 0.1, rerolls: 3, banishes: 1 }));
}

/** The lived-in gallery profile as it was before the first fresh state (taken only from a profile that has runs, never from a fresh one). */
let veteranSave: SaveData | null = null;

/** The hero select under a fresh profile (`fresh`) or the lived-in one, with the hero `classId` selected. */
function heroSelect(g: G, o: { fresh: boolean; classId: 'warrior' | 'shaman' }): void {
  if (!veteranSave && g.meta.save.stats.runs > 0) veteranSave = structuredClone(g.meta.save);
  if (o.fresh) {
    if (g.meta.save.stats.runs > 0) void g.meta.resetProfile();
  } else if (g.meta.save.stats.runs === 0 && veteranSave) {
    // the device settings stay as they are (the import would apply the file's)
    void g.meta.importMsav(exportMsav({ ...veteranSave, settings: structuredClone(g.meta.save.settings) }));
  }
  g.store.select(o.classId === 'shaman' ? { classId: 'shaman', doctrine: 'a', sex: 'f' } : { classId: 'warrior', doctrine: 'a', sex: 'm' });
  g.store.setScreen('heroSelect');
}

const metinId = (g: G): string => g.content.metins[0]?.id ?? '';

/**
 * Plays run event `kind` the way the sim and the HUD do. The HUD clock starts at `t0` and runs in 100 ms steps; the 'runEvent' events come at
 * the announce (`startAt` - 5 s) and at the start, with the sim's 5 s heartbeat; every HUD snapshot carries the event's { kind, phase, left }.
 * `end` ends the event at that clock second (p 1 = won, 0 = failed / out of time); the HUD shows its 'end' phase for 3 s, then nothing.
 */
function playEvent(g: G, o: { kind: string; t0: number; startAt: number; endAt: number; end?: { at: number; p: 0 | 1 } }): void {
  const lead = 5;
  let t = o.t0;
  let sent = '';
  let beat = -1e9;
  let endedAt = -1;
  const emit = (phase: string, p = 0): void =>
    g.events.emit({ t: 'runEvent', kind: o.kind, phase, id: 1, x: 0, z: 0, startAt: o.startAt, endAt: o.end ? Math.min(o.endAt, o.end.at) : o.endAt, player: -1, p });
  const step = (): void => {
    const over = o.end !== undefined && t >= o.end.at;
    const phase = over ? 'end' : t >= o.startAt ? 'active' : t >= o.startAt - lead ? 'announce' : null;
    if (phase !== null && (phase !== sent || (phase !== 'end' && t - beat >= 5))) {
      emit(phase, phase === 'end' ? (o.end as { p: number }).p : 0);
      sent = phase;
      beat = t;
      if (phase === 'end') endedAt = t;
    }
    const left = phase === 'announce' ? o.startAt - t : phase === 'active' ? o.endAt - t : 0;
    const shown = phase !== null && !(phase === 'end' && t - endedAt > 3);
    patchHud(g, () => ({ time: t, ...FIELD, runEvent: shown ? { kind: o.kind, phase: phase as 'announce' | 'active' | 'end', left: Math.max(0, left), x: 0, z: 0 } : null }));
    if (phase === 'end' && t - endedAt > 3) {
      window.clearInterval(eventClock);
      eventClock = undefined;
    }
    t += 0.1;
  };
  step();
  eventClock = window.setInterval(step, 100);
}

/** A run at second `t0` with hints off (the banners are the subject) and the event played from there. */
function eventState(g: G, o: Parameters<typeof playEvent>[1], opts: { boss?: boolean; hints?: boolean } = {}): void {
  fresh(g, { showHints: opts.hints ?? false });
  inRun(g, { t: o.t0, ...(opts.boss ? { boss: true } : {}) });
  playEvent(g, o);
}

const warn = (g: G, great = false): void =>
  g.events.emit({ t: 'metinWarn', metin: 1, def: metinId(g), x: 20, z: 5, dur: 3, great });

export const scenarios: Scenario[] = [
  {
    id: 'upHintsLevelUp',
    label: 'Hints · first level-up',
    run: (g) => {
      fresh(g);
      quiet(g);
      later(600, () => g.events.emit({ t: 'levelUp', player: 0, level: 2 }));
    },
  },
  {
    id: 'upHintsMetin',
    label: 'Hints · Metin falling (awakens in 1:30)',
    run: (g) => {
      fresh(g);
      quiet(g);
      later(600, () => warn(g));
    },
  },
  {
    id: 'upHintsMetinHard',
    label: 'Hints · Metin falling on hard (awakens in 1:00)',
    run: (g) => {
      fresh(g);
      // the shipped hard multipliers are all 1 today (the pacing work sets awakenMul .67): the state shows the number it will read
      const hard = g.content.balance.hard as { awakenMul?: number };
      hardPatched = { had: 'awakenMul' in hard, value: hard.awakenMul };
      hard.awakenMul = 0.67;
      g.store.select({ difficulty: 'hard' });
      quiet(g);
      later(600, () => warn(g));
    },
  },
  {
    id: 'upHintsAwaken',
    label: 'Hints · first awakening',
    run: (g) => {
      fresh(g);
      quiet(g);
      later(600, () => g.events.emit({ t: 'metinAwaken', metin: 1, def: metinId(g), x: 20, z: 5 }));
    },
  },
  {
    id: 'upHintsCorruption',
    label: 'Hints · corruption reaches 50 %',
    run: (g) => {
      fresh(g);
      quiet(g);
      later(600, () => patchHud(g, () => ({ corruption: 0.52 })));
    },
  },
  {
    id: 'upHintsChest',
    label: 'Hints · locked chest',
    run: (g) => {
      fresh(g);
      quiet(g);
      later(600, () => g.events.emit({ t: 'chestLocked', player: 0, cost: 120, yeop: 35 }));
    },
  },
  {
    id: 'upHintsBoss',
    label: 'Hints · boss arrival (under the boss row)',
    run: (g) => {
      fresh(g);
      quiet(g, { t: 372, boss: true });
      const b = g.content.bosses[0];
      later(600, () => g.events.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: b?.id ?? '', x: 18, z: -12, final: false }));
    },
  },
  {
    id: 'upHintsEssence',
    label: 'Hints · first essence offer (plate after the offer closes)',
    run: (g) => {
      fresh(g);
      quiet(g, { t: 372 });
      later(300, () => g.store.setSimModal(mockRequest('essence', g.content, { id: 41 })));
      later(1500, () => g.store.setSimModal(null));
    },
  },
  {
    id: 'upHintsReroll',
    label: 'Hints · first reroll (plate after the offer closes)',
    run: (g) => {
      fresh(g);
      quiet(g);
      later(300, () => g.store.setSimModal(mockRequest('levelUp', g.content, { id: 42, rerolls: 3 })));
      later(800, () => patchHud(g, () => ({ rerolls: 2 })));
      later(1500, () => g.store.setSimModal(null));
    },
  },
  {
    id: 'upHintsInterrupted',
    label: 'Hints · a level-up offer opens 1 s after the plate (plate pulled, returns after the offer)',
    run: (g) => {
      fresh(g);
      quiet(g);
      later(600, () => patchHud(g, () => ({ corruption: 0.52 })));
      later(2200, () => g.store.setSimModal(mockRequest('levelUp', g.content, { id: 43 })));
      later(5200, () => g.store.setSimModal(null));
    },
  },
  {
    id: 'upEvMetinRain',
    label: 'Run event · Metin Rain announced (rune-colour banner, countdown)',
    run: (g) => eventState(g, { kind: 'metinRain', t0: 389.5, startAt: 395, endAt: 470 }),
  },
  {
    id: 'upEvChampionAnnounce',
    label: 'Run event · Champion Hunt announced (danger plate, countdown)',
    run: (g) => eventState(g, { kind: 'championHunt', t0: 389.5, startAt: 395, endAt: 455 }),
  },
  {
    id: 'upEvChampion',
    label: 'Run event · Champion Hunt running (standing plate, 60 s countdown)',
    run: (g) => eventState(g, { kind: 'championHunt', t0: 394.4, startAt: 395, endAt: 455 }),
  },
  {
    id: 'upEvChampionBoss',
    label: 'Run event · Champion Hunt plate under a boss row',
    run: (g) => eventState(g, { kind: 'championHunt', t0: 394.4, startAt: 395, endAt: 455 }, { boss: true }),
  },
  {
    id: 'upEvChampionWon',
    label: 'Run event · Champion Hunt won (victory banner at +4 s)',
    run: (g) => eventState(g, { kind: 'championHunt', t0: 394.4, startAt: 395, endAt: 455, end: { at: 399, p: 1 } }),
  },
  {
    id: 'upEvChampionLost',
    label: 'Run event · Champion Hunt out of time (banner at +3 s)',
    run: (g) => eventState(g, { kind: 'championHunt', t0: 394.4, startAt: 395, endAt: 398, end: { at: 398, p: 0 } }),
  },
  {
    id: 'upEvGolden',
    label: 'Run event · Golden Hour running (gold plate, countdown)',
    run: (g) => eventState(g, { kind: 'goldenHour', t0: 394.4, startAt: 395, endAt: 440 }),
  },
  {
    id: 'upEvBargain',
    label: 'Run event · a Sky Sovereign shrine appeared (info banner)',
    run: (g) => eventState(g, { kind: 'bargain', t0: 394.4, startAt: 395, endAt: 470 }),
  },
  {
    id: 'upEvFinal',
    label: 'Final boss · the Great Metin falls, the boss rises (big card)',
    run: (g) => {
      fresh(g, { showHints: false });
      inRun(g, { t: 907, boss: true });
      patchHud(g, (h) => ({ ...FIELD, boss: h.boss ? { ...h.boss, final: true, phase: 0, hp: h.boss.hpMax, x: 0, z: 0 } : null }));
      const b = g.content.bosses[0];
      later(400, () => g.events.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: b?.id ?? '', x: 0, z: 0, final: true }));
    },
  },
  {
    id: 'upEvBandBoss',
    label: 'Band boss · the smaller big-title card (for the pair against the final card)',
    run: (g) => {
      fresh(g, { showHints: false });
      inRun(g, { t: 372, boss: true });
      patchHud(g, () => FIELD);
      const b = g.content.bosses[0];
      later(400, () => g.events.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: b?.id ?? '', x: 18, z: -12, final: false }));
    },
  },
  {
    id: 'upHintsPact',
    label: 'Hints · first offer with a pact card (plate after the offer closes)',
    run: (g) => {
      fresh(g);
      quiet(g);
      const req = mockRequest('levelUp', g.content, { id: 44 });
      const skill = g.content.skills.find((k) => req.cards.some((c) => c.id === k.id)) ?? g.content.skills[0];
      const passive = g.content.passives[0];
      const cards = req.cards.map((c, i) => (i === 0 && skill && passive ? { ...c, kind: 'skillUp' as const, id: skill.id, needs: passive.id } : c));
      later(300, () => g.store.setSimModal({ ...req, cards }));
      later(1500, () => g.store.setSimModal(null));
    },
  },
  {
    id: 'upHintsEvent',
    label: 'Hints · first run event (the plate, then the tip over it for 6 s, then the plate again)',
    run: (g) => eventState(g, { kind: 'championHunt', t0: 394.4, startAt: 395, endAt: 455 }, { hints: true }),
  },
  {
    id: 'upHintsAffix',
    label: 'Hints · first elite of band 1 with affixes on (they ship off: switched on for the state)',
    run: (g) => {
      fresh(g);
      affixPatched = { prev: g.content.affixes };
      g.content.affixes = { ...(g.content.affixes ?? DEFAULT_AFFIXES), enabled: true, fromBand: 1 };
      quiet(g, { t: 215 });
      later(600, () => g.events.emit({ t: 'enemySpawn', enemy: 1, type: 0, x: 8, z: 4, tier: 1, source: 5 }));
    },
  },
  {
    id: 'upHintsOff',
    label: 'Hints · "Show hints" off: corruption reaches 50 %, nothing shows',
    run: (g) => {
      fresh(g, { showHints: false });
      quiet(g);
      later(600, () => patchHud(g, () => ({ corruption: 0.7 })));
    },
  },
  {
    id: 'upHintsSettings',
    label: 'Settings · Graphics, hints (some seen)',
    run: (g) => {
      restoreServices(g);
      fresh(g, { hintsSeen: HINT_IDS.slice(0, 4) as string[] });
      settingsTab.value = 'graphics';
      openSub(g, 'settings');
      later(900, () => {
        const el = document.querySelector('.ms-set-body');
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
  },
  {
    id: 'upHintsSettingsFresh',
    label: 'Settings · Graphics, hints (none seen: Reset is disabled)',
    run: (g) => {
      restoreServices(g);
      fresh(g, { showHints: false });
      settingsTab.value = 'graphics';
      openSub(g, 'settings');
      later(900, () => {
        const el = document.querySelector('.ms-set-body');
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
  },
  {
    id: 'upHeroFirst',
    label: 'Hero select · fresh profile (Shaman card carries the first-run badge)',
    run: (g) => heroSelect(g, { fresh: true, classId: 'warrior' }),
  },
  {
    id: 'upHeroFirstShaman',
    label: 'Hero select · fresh profile, Shaman selected (record line recommends it)',
    run: (g) => heroSelect(g, { fresh: true, classId: 'shaman' }),
  },
  {
    id: 'upHeroVeteran',
    label: 'Hero select · lived-in profile, Shaman selected (no badge)',
    run: (g) => heroSelect(g, { fresh: false, classId: 'shaman' }),
  },
];
