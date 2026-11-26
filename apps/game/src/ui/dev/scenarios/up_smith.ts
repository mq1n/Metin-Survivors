// Gallery scenarios: the Benison Scroll (plan name: Blessing Scroll) at the blacksmith (MT-03, upgrade group A.meta-smith). Each state reshapes the lived-in
// warrior of the gallery profile (most gear owned, a few pieces refined) from the profile as it was when the first of these ran, so
// a state never stacks on the previous one, and loads it through the real `.msav` import path. The best owned weapon is the
// selected piece. `up-smith-reset` puts the original profile back for the scenarios that follow.
import type { ContentDB } from '../../../data/schema';
import { exportMsav, ownedPieces, type MetaService, type SaveData } from '../../../meta';
import type { GalleryCtx } from '../../gallery';
import { armoryClass } from '../../screens/armory/state';
import { oddsOpen, scrollWanted, selectedId } from '../../screens/armory/Blacksmith';
import { armoryTab, openView } from '../../view';
import { enrichArmory } from './armory-a';
import type { Scenario } from '../scenarioKit';

export const order = 57;

interface SmithState {
  /** the selected weapon's refinement level (the step it faces is +plus -> +plus+1) */
  plus: number;
  yeop: number;
  shards: number;
  /** the switch is on */
  scroll: boolean;
  /** the normal campaign is complete (the last zone cleared on Normal): what opens the scroll; false = it is locked */
  campaign: boolean;
  /** the ODDS sub-window is open (the odds table shows the scroll's chance and Yeop beside the plain ones once it is open) */
  odds?: boolean;
}

const pristine = new WeakMap<MetaService, SaveData>();

function original(meta: MetaService): SaveData {
  let s = pristine.get(meta);
  if (!s) {
    s = structuredClone(meta.save);
    pristine.set(meta, s);
  }
  return s;
}

/** The warrior's best weapon (highest tier) of `save`. */
function bestWeapon(save: SaveData, content: ContentDB): string | null {
  const weapons = ownedPieces(save, content, 'warrior').filter((p) => p.def.slot === 'weapon');
  weapons.sort((a, b) => b.def.tier - a.def.tier || (a.def.id < b.def.id ? -1 : 1));
  return weapons[0]?.def.id ?? null;
}

/** The normal campaign done (the last zone by order cleared on Normal) or not (no zone cleared on Normal at all). */
function setCampaign(save: SaveData, content: ContentDB, done: boolean): void {
  const zones = content.zones.slice().sort((a, b) => a.order - b.order);
  const last = zones[zones.length - 1];
  if (!last) return;
  for (const z of zones) {
    const cur = save.stats.zones[z.id] ?? {};
    if (done) {
      cur.normal = { runs: Math.max(1, cur.normal?.runs ?? 0), clears: Math.max(1, cur.normal?.clears ?? 0), bestScore: cur.normal?.bestScore ?? 0, bestTime: cur.normal?.bestTime ?? 0, bestLevel: cur.normal?.bestLevel ?? 0 };
    } else if (z.id === last.id && cur.normal) {
      cur.normal = { ...cur.normal, clears: 0 };
    }
    save.stats.zones[z.id] = cur;
  }
}

/** `base` with the best weapon at +plus, the bank filled and the campaign done or not, as the state says. */
export function smithProfile(base: SaveData, content: ContentDB, st: SmithState): { save: SaveData; weapon: string | null } {
  const save = structuredClone(base);
  setCampaign(save, content, st.campaign);
  const weapon = bestWeapon(save, content);
  const cs = save.classes.warrior;
  if (weapon) {
    if (st.plus > 0) cs.plus[weapon] = st.plus;
    else delete cs.plus[weapon];
  }
  save.bank.yeop = st.yeop;
  save.bank.shards = st.shards;
  return { save, weapon };
}

function load(g: GalleryCtx, save: SaveData): void {
  // the device settings stay as they are (the import would apply the file's)
  void g.meta.importMsav(exportMsav({ ...save, settings: structuredClone(g.meta.save.settings) }));
}

const smithWith = (id: string, label: string, st: SmithState): Scenario => ({
  id,
  label,
  run: (g) => {
    enrichArmory(g.meta, g.content, 'warrior');
    const { save, weapon } = smithProfile(original(g.meta), g.content, st);
    g.store.setScreen('menu');
    openView('armory', 'blacksmith');
    armoryTab.value = 'blacksmith';
    armoryClass.value = 'warrior';
    selectedId.value = weapon;
    scrollWanted.value = st.scroll;
    oddsOpen.value = st.odds === true;
    load(g, save);
  },
});

export const scenarios: Scenario[] = [
  // +4 -> +5 costs 5 500 Yeop and 8 shards: 20 shards pay 2 plain attempts, so the scroll is spare from 5 500 x (2 + 2) = 22 000 Yeop
  smithWith('up-smith-plain', 'Blacksmith · +4 -> +5, scroll available over spare Yeop (55% > 70%, 60 000 Yeop)', { plus: 4, yeop: 60_000, shards: 20, scroll: false, campaign: true }),
  smithWith('up-smith-scroll', 'Blacksmith · +4 -> +5 under the Benison Scroll (3x Yeop, 70%)', { plus: 4, yeop: 60_000, shards: 20, scroll: true, campaign: true }),
  // the wish is on and the bank pays the 16 500 price, but plain attempts still need that Yeop (reserve 22 000): "reserve", greyed, the wish is taken back
  smithWith('up-smith-reserve', 'Blacksmith · scroll wanted, 18 000 Yeop pays the price but not the 22 000 reserve (spare Yeop only; the wish is dropped)', { plus: 4, yeop: 18_000, shards: 20, scroll: true, campaign: true }),
  // the realistic late-meta bank (a warrior_b campaign end): +7 -> +8 costs 18 000 Yeop and 26 shards, 857 shards pay 32 plain attempts, so the scroll is spare
  // from 18 000 x (32 + 2) = 612 000 Yeop: the 595 506 Yeop still missing is far more than the bank holds, so the plate says "Plain attempts first" with no
  // number (the narrow container shows the charm chip alone; the numbers stay in the tooltip and the aria label)
  smithWith('up-smith-reserve-late', 'Blacksmith · late bank: +7 -> +8 at 16 494 Yeop / 857 shards, the reserve is far away (plain attempts first, no number)', { plus: 7, yeop: 16_494, shards: 857, scroll: true, campaign: true }),
  // no shards for a plain attempt (7 < 8): nothing waits on the Yeop, the scroll is short of its own 16 500 price
  smithWith('up-smith-short', 'Blacksmith · scroll wanted, no shards for a plain attempt and Yeop under the 3x price (the wish is dropped)', { plus: 4, yeop: 12_000, shards: 7, scroll: true, campaign: true }),
  smithWith('up-smith-capped', 'Blacksmith · +0 -> +1 is already certain (the scroll adds nothing)', { plus: 0, yeop: 60_000, shards: 20, scroll: true, campaign: true }),
  smithWith('up-smith-capcut', 'Blacksmith · +1 -> +2 (95% + 15 points is cut at 100%: +5 shown)', { plus: 1, yeop: 60_000, shards: 20, scroll: true, campaign: true }),
  smithWith('up-smith-locked', 'Blacksmith · normal campaign not complete: the scroll is greyed and opens after it', { plus: 4, yeop: 60_000, shards: 20, scroll: true, campaign: false }),
  smithWith('up-smith-odds', 'Blacksmith · ODDS sheet with the scroll on offer: its chance and Yeop beside the plain ones', { plus: 4, yeop: 60_000, shards: 20, scroll: false, campaign: true, odds: true }),
  smithWith('up-smith-odds-locked', 'Blacksmith · ODDS sheet while the scroll is locked: plain columns only', { plus: 4, yeop: 60_000, shards: 20, scroll: false, campaign: false, odds: true }),
  {
    id: 'up-smith-reset',
    label: 'Blacksmith · back to the gallery profile',
    run: (g) => {
      g.store.setScreen('menu');
      selectedId.value = null;
      scrollWanted.value = false;
      oddsOpen.value = false;
      load(g, original(g.meta));
    },
  },
];
