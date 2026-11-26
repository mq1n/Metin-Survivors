// Gallery scenarios of the upgrade work package group A.offers-ui (OF-02: pacts on the cards and on the build board; OF-05: the shard
// and boon cards, mixed boss rewards and 4-card chests, listed after the pact states below).
// The pact states are DERIVED, never written by hand: the pact rules are read once per scenario run from the content's balance.pacts
// (`resolvePacts`), the hero's HUD is built from the standing each skill is meant to show (its pact passive held at the pact rank, one
// rank short of it, or missing) and every mock card is made the way sim/cards.ts makes it from that HUD (`needs` on the card that takes a
// skill to G2 while its pact passive is short, `pact.awakens` on a passive card = the held skills below P that wait for it). So the cards,
// the build bar, the long-press tooltips and the board always name the same partner and the same progress, whatever balance.pacts says.
// Pact states:
//   upOffersPacts       level-up, 4 cards: a G1 skill that still needs its passive (the card that takes it to G2), the pact passive one rank short
//                       (it keeps the pact), a ready awakening card, a plain card for contrast
//   upOffersPactsLong   level-up, 3 cards: the passive that three owned skills wait for (three icons, "Wrath of the Sky Sovereign"), a G2 card that needs a
//                       passive with a long name (Berserk: "Boon of the Sky Sovereign") and one that needs a short name (Swordlight Ring: "Sovereign Eyes")
//   upOffersPactsChest / upOffersPactsBoss   the three cards of upOffersPactsChest3 in the chest and boss-reward layouts (other modals that show CardView)
//   upOffersPactsChest3 chest, 3 cards: a needs card, the pact passive with the longest name (a two-line title), a ready awakening
//   upOffersBuild       HUD with the build board open: every pact state (kept, ready at G2, awakened, passive missing, passive held one rank short)
//   upOffersPactsMix    level-up, 4 cards: two needs cards, a ready awakening and a passive whose name wraps to two lines (the narrow-column
//                       stress test of the pact slab: 0 clipped rows at 844x390)
//   upOffersPactsSlot   level-up, 3 cards with five of six passive slots used: a pact passive that takes the last slot (and strands the other
//                       waiting skills), a plain passive that does the same (the warning stands alone), the pact passive of another skill
//   upOffersPactsFull   level-up with every passive slot used and no waiting skill's passive among them: the G2 card that waits says so ("No passive
//                       slot left"), a plain skill card, a passive upgrade of a pact that is kept
//   upOffersBuildFull   the build board of that run: the blocked pacts as dim broken chains next to the open and the kept ones
//   upOffersBuildMeter  the board of upOffersBuild with the damage-meter table open under the corruption gauge (meterOpen is a persisted preference):
//                       the board stops under the table, never over the gauge or the minimap (BuildBoard.tsx useBoardRoom)
// OF-05 states (the overflow cards of OF-03, the boss milestone of OF-04, the 4-card chest of balance.chest.cards = 4):
//   upOffersShards     level-up: a skill upgrade, a passive, a shards card (rare, +2: the shipped balance.overflow.shardsByRarity [1, 1, 2, 3, 4])
//   upOffersBoon       level-up: the first Sky Sovereign's Boon (stack 1) next to a shards card and a heal
//   upOffersOverflow   level-up of a full build: heal, a stacked Boon (stack 6), shards (legendary, +4)
//   upOffersShards4    level-up, 4 cards: the shards card at four rarities of one pool (common +1, uncommon +1, epic +3, legendary +4)
//   upOffersBargain    level-up: the bargain card keeps the plain A0-CARD stub until EV-03a gives it a face
//   upOffersBossMixed  boss reward: a rank-up skill card, a stone and a trinket (epic, face up)
//   upOffersBossAwaken boss reward: the awakening card (legendary, face down), a stone, a trinket (legendary, face down)
//   upOffersChest4     chest, 4 cards: skill rank-up, passive, stone, trinket (+ the rarity ledger of four)
//   upOffersChest4Boss the free boss chest with 4 cards
//   upOffersChest4Flow chest, 4 cards of the overflow kinds (heal, boon, shards, yeop) with the longest titles
//   upOffersChestDry   chest on a dry build: the 2 cards of OF-03 (Boon, shards), no filler
//   upOffersBossDry    boss reward on a full build (chest.bossMilestone on): an epic essence card (a stone) and the Boon. The milestone never deals shards
//                      (sim/cards.ts MILESTONE_NO_FILLER); the Boon is a known card: it is never turned face down
//   upOffersBossBoon   boss reward on a full build with no stone or trinket left to take: the Boon alone (1 card)
//   upOffersEssenceDry layout test of two overflow cards (Boon + shards) in the Metin essence modal, which draws the same CardView. The shipped
//                      content never deals this offer (an essence offer always finds a stone to add or replace)
import { MAX_SKILL_RANK, RARITY_MULT, resolvePacts } from '../../../data/schema';
import type { ContentDB, SkillDef } from '../../../data/schema';
import { modsToLines } from '../../../sim/cards';
import type { Card, HudSnapshot } from '../../../sim/types';
import { buildOpen, meterOpen, miscOpen, minimapHidden, atlasOpen } from '../../hud/hooks';
import { mockHud, mockRequest } from '../mock';
import { inRun, type Scenario } from '../scenarioKit';

export const order = 95;

type G = Parameters<Scenario['run']>[0];

const blank = (over: Partial<Card>): Card => ({
  kind: 'newSkill',
  id: '',
  rarity: 'common',
  rank: 0,
  maxRank: 7,
  awakening: false,
  lines: [],
  amount: 0,
  slot: -1,
  replaces: null,
  ...over,
});

/** The hero a pact scenario plays: warrior, doctrine a (plus Mountain Splitter in the wide profile). */
const SKILLS = {
  basic: 'sword_arc', // meleeArc
  cut: 'lightning_trio', // meleeArc
  splitter: 'mountain_splitter', // meleeArc
  spin: 'bladewheel', // spinAura
  berserk: 'warfever', // selfBuff
  aura: 'swordlight_ring', // persistentAura
  dash: 'spearhead', // dash
  leap: 'giant_leap', // leap
} as const;

function skillSlot(content: ContentDB, id: string, rank: number, over: Partial<HudSnapshot['skills'][number]> = {}): HudSnapshot['skills'][number] {
  const def: SkillDef | undefined = content.skills.find((s) => s.id === id);
  return { id, icon: def?.icon ?? '', rank, cooldown: 0, cdLeft: 0, basic: false, awakened: rank >= MAX_SKILL_RANK, ...over };
}

function passiveSlot(content: ContentDB, id: string, rank: number): HudSnapshot['passives'][number] {
  const def = content.passives.find((p) => p.id === id);
  return { id, icon: def?.icon ?? '', rank, maxRank: def?.maxRank ?? 5 };
}

// ---- the pact rules, read from the content ---------------------------------------------------------------------------------------

/** balance.pacts as the sim reads it (resolvePacts): the pact passive of a skill and the rank it must be held at. */
interface Pacts {
  /** balance.pacts.byBehavior[the skill's behaviour]; undefined = pacts off or no pact passive */
  partner(skillId: string): string | undefined;
  /** the pact rank capped at the passive's own max rank (sim/cards.ts pactNeed) */
  need(passiveId: string): number;
}

function pactsOf(c: ContentDB): Pacts {
  const p = resolvePacts(c.balance.pacts);
  const skill = new Map(c.skills.map((s) => [s.id, s]));
  const pass = new Map(c.passives.map((x) => [x.id, x]));
  return {
    partner: (id) => {
      const d = skill.get(id);
      return p.rank > 0 && d ? p.byBehavior[d.behavior] : undefined;
    },
    need: (pid) => Math.min(p.rank, pass.get(pid)?.maxRank ?? p.rank),
  };
}

/** How the hero stands with the pact passive of a skill: held at the pact rank, one rank short of it, or not held. */
type Stand = 'held' | 'partial' | 'missing';
interface Role {
  id: string;
  rank: number;
  stand: Stand;
  basic?: boolean;
}
/** The skills a scenario's hero holds and the number of passive slots in use (the pact passives that are held, then fillers that no held skill waits for). */
interface Profile {
  roles: Role[];
  slots: number;
}

const role = (id: string, rank: number, stand: Stand, basic = false): Role => ({ id, rank, stand, ...(basic ? { basic } : {}) });

/**
 * The default run: the basic attack and Lightning Trio (G2) with their passive held (kept / ready), Bladewheel awakened, Berserk at G1 and
 * Swordlight Ring at G2 waiting for passives that are not held, Dash with its passive one rank short, Giant's Leap far from G2.
 */
const DEFAULT: Profile = {
  roles: [
    role(SKILLS.basic, 4, 'held', true),
    role(SKILLS.cut, 6, 'held'),
    role(SKILLS.spin, 7, 'held'),
    role(SKILLS.berserk, 5, 'missing'),
    role(SKILLS.aura, 6, 'missing'),
    role(SKILLS.dash, 4, 'partial'),
    role(SKILLS.leap, 2, 'missing'),
  ],
  slots: 4,
};
/** Nothing is held: three meleeArc skills wait for one passive, three skills stand at G1 (the longest pact lines). */
const WIDE: Profile = {
  roles: [
    role(SKILLS.basic, 4, 'missing', true),
    role(SKILLS.cut, 5, 'missing'),
    role(SKILLS.splitter, 3, 'missing'),
    role(SKILLS.berserk, 5, 'missing'),
    role(SKILLS.aura, 5, 'missing'),
    role(SKILLS.dash, 4, 'missing'),
    role(SKILLS.leap, 2, 'missing'),
  ],
  slots: 2,
};
/** Two skills at G1 waiting (two needs cards in one offer), the rest as the default run. */
const MIX: Profile = {
  roles: [
    role(SKILLS.basic, 4, 'held', true),
    role(SKILLS.cut, 6, 'held'),
    role(SKILLS.spin, 7, 'held'),
    role(SKILLS.berserk, 5, 'missing'),
    role(SKILLS.aura, 3, 'missing'),
    role(SKILLS.dash, 4, 'partial'),
    role(SKILLS.leap, 5, 'missing'),
  ],
  slots: 4,
};
/** Five of six passive slots used by the held pact passives and fillers: every skill that waits has one slot left to hope for. */
const FIVE: Profile = { roles: DEFAULT.roles.map((r) => (r.id === SKILLS.dash ? role(r.id, r.rank, 'missing') : r)), slots: 5 };
/** All six slots used: the waiting skills cannot get their passive any more. */
const FULL: Profile = { ...FIVE, slots: 6 };

/** Passives that fill slots in the scenarios, in order; one is skipped when a skill of the profile waits for it (a filler is never a pact passive of the hero). */
const FILLERS = ['sanctified_mail', 'marshals_voice', 'blood_oath', 'fortunes_favour', 'thorned_hide', 'ghostly_grasp', 'magpie_gloves'];

/** The HUD skills of a profile and the passives its hero holds (the pact passives at their standing, then fillers up to `slots`). */
function standing(c: ContentDB, prof: Profile): Pick<HudSnapshot, 'skills' | 'passives'> {
  const pacts = pactsOf(c);
  const want = new Map<string, number>();
  const partners = new Set<string>();
  for (const r of prof.roles) {
    const pid = pacts.partner(r.id);
    if (!pid) continue;
    partners.add(pid);
    const need = pacts.need(pid);
    const rank = r.stand === 'held' ? need : r.stand === 'partial' ? Math.max(1, need - 1) : 0;
    want.set(pid, Math.max(want.get(pid) ?? 0, rank));
  }
  const held: [string, number][] = [...want].filter(([, rank]) => rank > 0);
  for (const id of FILLERS) {
    if (held.length >= prof.slots) break;
    if (!partners.has(id) && c.passives.some((p) => p.id === id)) held.push([id, 2]);
  }
  return {
    skills: prof.roles.map((r) => skillSlot(c, r.id, r.rank, r.basic ? { basic: true } : {})),
    passives: held.map(([id, rank]) => passiveSlot(c, id, rank)),
  };
}

function pactHud(g: G, t: number, prof: Profile): HudSnapshot {
  return { ...mockHud(g.content, t, { classId: 'warrior', doctrine: 'a' }), ...standing(g.content, prof) };
}

function putHud(g: G, t = 215, prof: Profile = DEFAULT): HudSnapshot {
  const hud = { ...pactHud(g, t, prof), px: 47, pz: -58 };
  g.store.setHud(hud);
  return hud;
}

// ---- cards made the way the sim makes them, from the HUD ----------------------------------------------------------------------

const SKILL_LINES: Card['lines'] = [{ stat: 'damage', mode: 'pct', value: 0.21 }, { stat: 'duration', mode: 'pct', value: 0.12 }];
const AWAKEN_LINES: Card['lines'] = [{ stat: 'damage', mode: 'pct', value: 0.78 }, { stat: 'area', mode: 'pct', value: 0.26 }];

interface Kit {
  /** the rank-up card of a held skill (sim/cards.ts skillUpCard): `needs` on the card that takes it to G2 while its pact passive is short, the awakening on the card to P */
  skillUp(id: string, rarity: Card['rarity'], lines?: Card['lines']): Card;
  /** the card of a passive (a new one, or the next rank of a held one): `pact.awakens` = the held skills below P that wait for it (sim/cards.ts pactAwakens) */
  passive(id: string, rarity: Card['rarity']): Card;
  /** the pact passive of a skill */
  partnerOf(skillId: string): string;
}

function kitOf(c: ContentDB, hud: HudSnapshot): Kit {
  const pacts = pactsOf(c);
  const heldRank = (pid: string): number => hud.passives.find((p) => p.id === pid)?.rank ?? 0;
  const unmet = (skillId: string): string | undefined => {
    const pid = pacts.partner(skillId);
    return pid !== undefined && heldRank(pid) < pacts.need(pid) ? pid : undefined;
  };
  return {
    skillUp(id, rarity, lines) {
      const rank = (hud.skills.find((s) => s.id === id)?.rank ?? 0) + 1;
      const card = blank({ kind: 'skillUp', id, rarity, rank, awakening: rank >= MAX_SKILL_RANK, lines: lines ?? (rank >= MAX_SKILL_RANK ? AWAKEN_LINES : SKILL_LINES) });
      const need = unmet(id);
      if (rank === MAX_SKILL_RANK - 1 && need !== undefined) card.needs = need;
      return card;
    },
    passive(id, rarity) {
      const def = c.passives.find((p) => p.id === id);
      const held = heldRank(id);
      const card = blank({
        kind: held > 0 ? 'passiveUp' : 'newPassive',
        id,
        rarity,
        rank: held + 1,
        maxRank: def?.maxRank ?? 5,
        lines: def ? modsToLines(def.perRank, RARITY_MULT[rarity]) : [],
      });
      const awakens = hud.skills.filter((s) => s.rank < MAX_SKILL_RANK && pacts.partner(s.id) === id && unmet(s.id) !== undefined).map((s) => s.id);
      if (awakens.length > 0) card.pact = { awakens };
      return card;
    },
    partnerOf: (skillId) => pacts.partner(skillId) ?? '',
  };
}

type Make = (k: Kit, c: ContentDB) => Card[];

/** Level-up with the pact HUD behind it (the build bar of the modal reads the same skills / passives). */
function levelUp(g: G, make: Make, level = 18, prof: Profile = DEFAULT): void {
  inRun(g, { t: 215 });
  const hud = putHud(g, 215, prof);
  g.store.setSimModal(mockRequest('levelUp', g.content, { classId: 'warrior', doctrine: 'a', cards: make(kitOf(g.content, hud), g.content), level, rerolls: 2, banishes: 1, skips: 1 }));
}

const heal = (): Card => blank({ kind: 'heal', rarity: 'common', amount: 0.3 });

/** A needs card, the passive one rank short (it keeps the pact), a ready awakening, a plain card. */
const pactCards: Make = (k) => [k.skillUp(SKILLS.berserk, 'epic'), k.passive(k.partnerOf(SKILLS.dash), 'rare'), k.skillUp(SKILLS.cut, 'legendary'), heal()];
/** The three cards of a chest / boss reward: a needs card, the pact passive with the longest name (a two-line title), a ready awakening. */
const pactCards3: Make = (k) => [k.skillUp(SKILLS.berserk, 'epic'), k.passive(k.partnerOf(SKILLS.berserk), 'rare'), k.skillUp(SKILLS.cut, 'legendary')];
/** The passive three owned skills wait for (Wrath of the Sky Sovereign), a G2 card that needs a long name (Boon of the Sky Sovereign) and one that needs a short name (Sovereign Eyes). */
const longCards: Make = (k) => [k.passive(k.partnerOf(SKILLS.basic), 'uncommon'), k.skillUp(SKILLS.berserk, 'rare'), k.skillUp(SKILLS.aura, 'epic')];
/** Two needs cards, a ready awakening and a passive whose name wraps to two lines: every body of the row is lowered by the long name. */
const mixCards: Make = (k) => [k.skillUp(SKILLS.leap, 'rare'), k.skillUp(SKILLS.cut, 'legendary'), k.passive(k.partnerOf(SKILLS.berserk), 'epic'), k.skillUp(SKILLS.berserk, 'epic')];
/** Five of six passive slots used: the pact passive of a waiting skill, a plain passive, the pact passive of another waiting skill - each takes the last slot. */
const slotCards: Make = (k) => [k.passive(k.partnerOf(SKILLS.dash), 'epic'), k.passive('fortunes_favour', 'rare'), k.passive(k.partnerOf(SKILLS.berserk), 'rare')];
/** Every passive slot used and none of them a waiting skill's passive: the G2 card that waits cannot keep its pact any more. */
const fullCards: Make = (k) => [k.skillUp(SKILLS.berserk, 'epic'), k.skillUp(SKILLS.dash, 'rare', [{ stat: 'damage', mode: 'pct', value: 0.12 }]), k.passive(k.partnerOf(SKILLS.cut), 'uncommon')];

function fresh(): void {
  atlasOpen.value = false;
  minimapHidden.value = false;
  meterOpen.value = false;
  miscOpen.value = false;
  buildOpen.value = false;
}

// ---- OF-05: the overflow cards, mixed boss rewards and 4-card chests ----------------------------------------------------------

/** What one Boon pick adds (balance.overflow defaults: +3 % damage, +2 % max HP) and the stack the card makes: `rank` = boons held + 1. */
const boon = (rank: number): Card =>
  blank({ kind: 'boon', rarity: 'legendary', rank, maxRank: 0, lines: [{ stat: 'damage', mode: 'pct', value: 0.03 }, { stat: 'maxHpPct', mode: 'pct', value: 0.02 }] });
/** balance.overflow.shardsByRarity as shipped: common .. legendary (the gallery never shows an amount the shipped content cannot deal) */
const SHARDS_BY_RARITY = [1, 1, 2, 3, 4] as const;
const RARITY_ORDER: Card['rarity'][] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const shards = (rarity: Card['rarity']): Card => blank({ kind: 'shards', rarity, rank: 0, maxRank: 0, amount: SHARDS_BY_RARITY[Math.max(0, RARITY_ORDER.indexOf(rarity))] ?? 1 });

/** A stone / trinket of the real content (the first of the slot kind asked for), so the mixed rewards show real art and slot rows. */
function stoneOf(c: ContentDB, n: number): string {
  return c.stones[n % Math.max(1, c.stones.length)]?.id ?? '';
}
function trinketOf(c: ContentDB, n: number): string {
  return c.trinkets[n % Math.max(1, c.trinkets.length)]?.id ?? '';
}

/** The boss milestone of OF-04: a rank-up (or the awakening), one essence card, one epic+ level-up card. */
const bossCards = (k: Kit, c: ContentDB, legendary: boolean): Card[] => [
  legendary ? k.skillUp(SKILLS.cut, 'legendary') : k.skillUp(SKILLS.berserk, 'epic'),
  blank({ kind: 'stone', id: stoneOf(c, 2), rarity: 'epic', rank: 2, maxRank: 4, slot: 2, lines: [{ stat: 'critChance', mode: 'pct', value: 0.06 }, { stat: 'attackSpeed', mode: 'pct', value: 0.04 }] }),
  blank({ kind: 'trinket', id: trinketOf(c, 0), rarity: legendary ? 'legendary' : 'epic', rank: 3, maxRank: 5, slot: 0, lines: [{ stat: 'pct', mode: 'pct', value: 0.024 }] }),
];

/** Four cards of four kinds (a chest with balance.chest.cards = 4). */
const chestFour = (k: Kit, c: ContentDB): Card[] => [
  k.skillUp(SKILLS.berserk, 'rare'),
  k.passive(k.partnerOf(SKILLS.aura), 'epic'),
  blank({ kind: 'stone', id: stoneOf(c, 1), rarity: 'epic', rank: 1, maxRank: 4, slot: 1, lines: [{ stat: 'critChance', mode: 'pct', value: 0.05 }, { stat: 'attackSpeed', mode: 'pct', value: 0.04 }] }),
  blank({ kind: 'trinket', id: trinketOf(c, 1), rarity: 'rare', rank: 2, maxRank: 5, slot: 1, lines: [{ stat: 'pct', mode: 'pct', value: 0.024 }] }),
];

function chestRun(g: G, make: Make, free: boolean): void {
  inRun(g, { t: free ? 372 : 215 });
  const hud = putHud(g, free ? 372 : 215);
  g.store.setSimModal(mockRequest('chest', g.content, { cards: make(kitOf(g.content, hud), g.content), free, rerolls: 3, banishes: 1, skips: 2, canReroll: false, canBanish: false, canSkip: false }));
}

function bossRun(g: G, make: Make): void {
  inRun(g, { t: 372 });
  const hud = putHud(g, 372);
  g.store.setSimModal(
    mockRequest('bossReward', g.content, {
      cards: make(kitOf(g.content, hud), g.content),
      source: g.content.bosses[1]?.id ?? g.content.bosses[0]?.id ?? '',
      rerolls: 3,
      banishes: 1,
      skips: 2,
      canReroll: false,
      canBanish: false,
      canSkip: false,
    }),
  );
}

function boardRun(g: G, prof: Profile, meter = false): void {
  fresh();
  buildOpen.value = true;
  meterOpen.value = meter;
  inRun(g, { t: 215 });
  putHud(g, 215, prof);
}

export const scenarios: Scenario[] = [
  { id: 'upOffersPacts', label: 'Offers · pact cards (needs / pact / ready)', run: (g) => levelUp(g, pactCards) },
  { id: 'upOffersPactsLong', label: 'Offers · pact cards (long names)', run: (g) => levelUp(g, longCards, 24, WIDE) },
  { id: 'upOffersPactsChest', label: 'Offers · pact cards in a chest', run: (g) => chestRun(g, pactCards3, false) },
  { id: 'upOffersPactsChest3', label: 'Offers · pact cards in a 3-card chest (needs + ready + a two-line name)', run: (g) => chestRun(g, pactCards3, true) },
  { id: 'upOffersPactsBoss', label: 'Offers · pact cards as a boss reward', run: (g) => bossRun(g, pactCards3) },
  { id: 'upOffersBuild', label: 'Offers · build board with pact links', run: (g) => boardRun(g, DEFAULT) },
  { id: 'upOffersPactsMix', label: 'Offers · pact cards, 4 cards with a two-line name', run: (g) => levelUp(g, mixCards, 30, MIX) },
  { id: 'upOffersPactsSlot', label: 'Offers · last passive slot warning', run: (g) => levelUp(g, slotCards, 33, FIVE) },
  { id: 'upOffersPactsFull', label: 'Offers · pact that can no longer be kept (no passive slot left)', run: (g) => levelUp(g, fullCards, 41, FULL) },
  { id: 'upOffersBuildFull', label: 'Offers · build board with blocked pacts', run: (g) => boardRun(g, FULL) },
  { id: 'upOffersBuildMeter', label: 'Offers · build board with the damage meter open', run: (g) => boardRun(g, DEFAULT, true) },
  { id: 'upOffersShards', label: 'Offers · shards card', run: (g) => levelUp(g, (k) => [k.skillUp(SKILLS.berserk, 'epic'), k.passive(k.partnerOf(SKILLS.dash), 'rare'), shards('rare')]) },
  { id: 'upOffersBoon', label: 'Offers · first Boon card', run: (g) => levelUp(g, () => [boon(1), shards('uncommon'), heal()]) },
  { id: 'upOffersOverflow', label: 'Offers · full build (heal, Boon x6, shards)', run: (g) => levelUp(g, () => [heal(), boon(6), shards('legendary')], 52) },
  {
    id: 'upOffersShards4',
    label: 'Offers · shards at four rarities (4 cards)',
    run: (g) => levelUp(g, () => [shards('common'), shards('uncommon'), shards('epic'), shards('legendary')], 61),
  },
  { id: 'upOffersBargain', label: 'Offers · bargain stub (EV-03a gives it a face)', run: (g) => levelUp(g, () => [blank({ kind: 'bargain', rarity: 'epic', bargain: { boon: 'x', curse: 'y' } }), boon(2), shards('rare')]) },
  { id: 'upOffersBossMixed', label: 'Offers · boss reward, mixed kinds (epic)', run: (g) => bossRun(g, (k, c) => bossCards(k, c, false)) },
  { id: 'upOffersBossAwaken', label: 'Offers · boss reward, awakening + essence (legendary face down)', run: (g) => bossRun(g, (k, c) => bossCards(k, c, true)) },
  { id: 'upOffersChest4', label: 'Offers · chest with 4 cards', run: (g) => chestRun(g, chestFour, false) },
  { id: 'upOffersChest4Boss', label: 'Offers · boss chest with 4 cards', run: (g) => chestRun(g, chestFour, true) },
  { id: 'upOffersChestDry', label: 'Offers · chest on a dry build (2 cards)', run: (g) => chestRun(g, () => [boon(4), shards('rare')], false) },
  // the boss milestone on a full build (balance.chest.bossMilestone, shipped on): an epic stone / trinket and the Boon, never shards (MILESTONE_NO_FILLER)
  { id: 'upOffersBossDry', label: 'Offers · boss reward on a full build (essence + Boon)', run: (g) => bossRun(g, (k, c) => [bossCards(k, c, false)[1] as Card, boon(4)]) },
  { id: 'upOffersBossBoon', label: 'Offers · boss reward with nothing left to take (the Boon alone)', run: (g) => bossRun(g, () => [boon(4)]) },
  {
    id: 'upOffersEssenceDry',
    label: 'Offers · layout test: Boon + shards in the Metin essence modal (2 cards)',
    run: (g) => {
      inRun(g, { t: 372 });
      putHud(g, 372);
      g.store.setSimModal(mockRequest('essence', g.content, { cards: [boon(2), shards('epic')], source: g.content.metins[0]?.id ?? '', awakened: false, rerolls: 2, banishes: 1, skips: 1, canBanish: false }));
    },
  },
  {
    id: 'upOffersChest4Flow',
    label: 'Offers · chest with 4 overflow cards',
    run: (g) => chestRun(g, () => [blank({ kind: 'heal', rarity: 'rare', amount: 0.3 }), boon(12), shards('epic'), blank({ kind: 'yeop', rarity: 'uncommon', amount: 1840 })], false),
  },
];
