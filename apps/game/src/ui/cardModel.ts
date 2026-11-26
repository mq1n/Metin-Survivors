// Card → display model (pure; shared by Level-Up, Metin Essence, Chest and Boss Reward). All text comes from content
// definitions (inline L10n) and i18n chrome keys; numbers are the sim's already-rarity-scaled rolled values.
import type { BehaviorKind, ContentDB, Element, PassiveDef, Rarity, SkillDef, StatMods, StoneDef, TrinketDef } from '../data/schema';
import { MAX_SKILL_RANK, resolvePacts } from '../data/schema';
import { fmtDec, fmtInt, fmtPct, t, tl, tn } from '../i18n/i18n';
import type { Card, HudSnapshot } from '../sim/types';
import { rankBand, type RankBand } from './assets';
import { formatStatLine, indexOf, rankLabel, skillDescription } from './content';
import { deps } from './env';
import { splitSkills } from './skillSlots';
import type { GlyphName } from './components/glyphs';
import type { IconKind } from './components/Icon';

export interface CardLineView {
  sign: string;
  amount: string;
  label: string;
  positive: boolean;
  /** the value before an upgrade ("+4%"): upgrade cards show `+4% → +6% crit chance` */
  from?: string;
  /** stat id (StatMods key / alias) the line is about: the card draws its gem icon (components/StatIcon) */
  stat?: string;
  /** a currency the line pays instead of a stat (OF-05: the Metin shard of a shards card): the card draws that currency object in the gem's place */
  currency?: 'shard';
}

/** One icon of a pact line: the passive a skill waits for, or an owned skill a passive moves toward its awakening. */
export interface PactIconView {
  id: string;
  icon: string;
  kind: 'skill' | 'passive';
  name: string;
}

/**
 * The pact line of a card (R1, OF-02), built from the card's `needs` / `pact` fields (sim/cards.ts) and the hero's HUD:
 * `needs` = a G2 skill card whose awakening still lacks its pact passive, `awakens` = a passive card that moves owned skills
 * toward their awakening, `ready` = an awakening card whose pact passive is held, `blocked` = a G2 skill card whose pact passive
 * can no longer be taken (every passive slot is used and the passive is not held), `warn` = a passive card that takes the last
 * passive slot while owned skills wait for another pact passive.
 */
export interface CardPactView {
  mode: 'needs' | 'awakens' | 'ready' | 'blocked' | 'warn';
  /** the sentence ("Awakens with Saddlecraft", "Pact: awakens Berserk, Dash", "Pact kept: Wrath of the Sky Sovereign") */
  text: string;
  /** the last-resort form of a very narrow card: the names alone ("Saddlecraft"), drawn after the chain mark */
  short: string;
  /** what the card moves: "Rank 1 of 2" (the pact passive is still short of the pact rank), "Keeps the pact", "Pact kept" */
  note?: string;
  /** a second line that is a warning, not a promise ("Last passive slot: Berserk, Dash stop at G2") */
  warn?: string;
  /** the warning on the last resort of a very narrow card: a count instead of the names ("Last slot: 2 skills stop at G2"), never a sentence cut in the middle */
  warnShort?: string;
  /** at most three icons; the sentence names them all */
  icons: PactIconView[];
  /** icons left out of `icons` (a passive that moves more than three skills) */
  more: number;
}

export interface CardModel {
  kind: Card['kind'];
  rarity: Rarity;
  title: string;
  /** kind label ("New skill", "Skill upgrade", "Soul pearl"…) */
  sub: string;
  icon: string;
  iconKind: IconKind;
  element?: Element;
  glyph?: GlyphName;
  /** a mark drawn over the icon plate (OF-05: the shard of a shards card on the yeop plate); the plate itself stays the painted tile */
  emblem?: 'shard';
  /** the word of the rarity row when it is not the rarity (OF-05: the Boon is always legendary, so its row says "Endless", a rarity label would suggest a rare drop) */
  rarityLabel?: string;
  slot?: string;
  /** rank row: from → to (from empty for brand-new items) */
  rankFrom?: string;
  rankTo?: string;
  /** skills only: rank index 0..7 of the card's NEW rank (1 2 3 M1 M2 G1 G2 P): drives the rank medal + the rank-band icon tile */
  rankIdx?: number;
  /** skills only: rank index of the rank held now (upgrade cards): the "from" medal */
  rankFromIdx?: number;
  /** a new item takes a slot: slot n of max (the card draws slot pips next to the footer text) */
  slotUse?: { n: number; max: number };
  /** NEW flag */
  isNew: boolean;
  awakening: boolean;
  /** plain description (new skill / passive / trinket / heal …) */
  desc?: string;
  /** upgrade cards: what the skill / passive is, as a dim line under the rolled lines (fills the card, helps the choice) */
  flavour?: string;
  lines: CardLineView[];
  footer?: string;
  /** "Replaces X (+2)" */
  replaces?: string;
  /** instant rewards (heal, yeop): the one-line note that sits in the rank row ("Instant. Uses no slot.") */
  instant?: string;
  /** lore / sub text of stones & trinkets */
  slotLabel?: string;
  /** awakening pact line (balance.pacts on only; absent = today's card) */
  pact?: CardPactView;
}

const NEW_KINDS: Card['kind'][] = ['newSkill', 'newPassive', 'stone', 'trinket'];

/**
 * Kinds whose base model carries no kind label (`sub` is empty): the bargain is still the A0-CARD stub (EV-03a gives it a face); shards and boon have
 * faces now (OF-05) and set their own `sub` in describeBase, so listing them here only keeps the base model of those two blank before the case runs.
 */
const PLAIN_KINDS: Card['kind'][] = ['shards', 'boon', 'bargain'];

/**
 * Whether a card is dealt face down in a boss reward (the hold-to-reveal of BossReward.tsx): a legendary card is a surprise and waits for
 * the hold. The Sky Sovereign's Boon is always legendary but never a surprise (it is the same card at every pick), so it is dealt face up:
 * a boss reward on a full build is a plain choice between known cards.
 */
export function cardStartsHidden(card: Pick<Card, 'kind' | 'rarity'>): boolean {
  return card.rarity === 'legendary' && card.kind !== 'boon';
}

function lineViews(card: Card): CardLineView[] {
  return card.lines.map((l) => ({ ...formatStatLine(l.stat, l.mode, l.value), stat: l.stat }));
}

function trinketSlotKey(slot: TrinketDef['slot']): string {
  return slot === 'earring' ? 'card.slot.earring' : slot === 'necklace' ? 'card.slot.necklace' : 'card.slot.bracelet';
}

/** A trinket-effect line: `+12% chain chance`, `0.6s stun duration` (absolute values carry no sign). */
function fx(amount: string, labelKey: string, signed = true, stat?: string): CardLineView {
  return { sign: signed ? '+' : '', amount, label: t(labelKey), positive: true, ...(stat ? { stat } : {}) };
}

/**
 * What a trinket gives at `rank`, computed the way `sim/stats.ts` applies it (chance / pct / amount / power / damage / regen
 * scale with rank, radius / duration do not, caps included). The sim's own card lines are a generic `perRank × rank` dump of
 * the effect parameters (unlabelled keys, durations and radii scaled by rank), so the card shows these instead.
 */
function trinketLines(def: TrinketDef, rank: number): CardLineView[] {
  const r = Math.max(1, rank);
  const k = (key: string, fallback: number): number => def.perRank[key] ?? fallback;
  const pct = (v: number): string => fmtPct(v, v < 0.1 ? 1 : 0);
  const sec = (v: number): string => t('trinket.unit.sec', { n: fmtDec(v, 1) });
  switch (def.effect) {
    case 'lifesteal':
      return [fx(pct(k('pct', 0.01) * r), 'stat.lifesteal', true, 'lifesteal')];
    case 'chainHit':
      return [fx(pct(Math.min(0.6, k('chance', 0.1) * r)), 'trinket.fx.chainChance', true, 'projectiles'), fx(pct(Math.min(1.5, k('damage', 0.5) * Math.max(1, r * 0.5 + 0.5))), 'trinket.fx.chainDamage', false, 'damage')];
    case 'stunChance':
      return [fx(pct(Math.min(0.5, k('chance', 0.03) * r)), 'trinket.fx.stunChance', true, 'resist'), fx(sec(k('duration', 0.5)), 'trinket.fx.stunDuration', false, 'duration')];
    case 'slowChance':
      return [
        fx(pct(Math.min(0.8, k('chance', 0.1) * r)), 'trinket.fx.slowChance', true, 'moveSpeed'),
        fx(pct(Math.min(0.7, k('power', 0.3) * Math.max(1, r * 0.5 + 0.5))), 'trinket.fx.slowPower', false, 'moveSpeed'),
        fx(sec(k('duration', 2)), 'trinket.fx.slowDuration', false, 'duration'),
      ];
    case 'poisonChance':
      return [
        fx(pct(Math.min(0.8, k('chance', 0.08) * r)), 'trinket.fx.poisonChance', true, 'luck'),
        fx(pct(k('power', 0.3) * r), 'trinket.fx.poisonPower', false, 'damage'),
        fx(sec(k('duration', 3)), 'trinket.fx.poisonDuration', false, 'duration'),
      ];
    case 'thorns':
      return [fx(pct(k('pct', 0.2) * r), 'trinket.fx.thorns', true, 'thorns')];
    case 'critBurst':
      return [fx(pct(k('damage', 0.2) * r), 'trinket.fx.burstDamage', true, 'critDamage'), fx(t('trinket.unit.m', { n: fmtDec(k('radius', 3), 1) }), 'trinket.fx.burstRadius', false, 'area')];
    case 'shield':
      return [fx(fmtDec(k('amount', 10) * r, 0), 'trinket.fx.shield', true, 'armor'), fx(t('trinket.unit.perSec', { n: fmtDec(k('regen', 0.5) * r, 1) }), 'trinket.fx.shieldRegen', true, 'regen')];
  }
}

/** Trinket lines at `rank`, each tagged with the value it had at `heldRank` when that differs (an upgrade card). */
function trinketUpgradeLines(def: TrinketDef, rank: number, heldRank: number): CardLineView[] {
  const before = trinketLines(def, heldRank);
  return trinketLines(def, rank).map((l, i) => {
    const b = before[i];
    return b && b.amount !== l.amount ? { ...l, from: `${b.sign}${b.amount}` } : l;
  });
}

/** A stone stat at `level`: the stone gives `perLevel × (level + 1)`; `vsRace:orc` style keys address nested stats. */
function stoneStatAt(def: StoneDef, stat: string, level: number): number | undefined {
  const [key, sub] = stat.split(':') as [keyof StatMods, string | undefined];
  const raw = def.perLevel[key];
  const v = sub === undefined ? raw : (raw as Record<string, number> | undefined)?.[sub];
  return typeof v === 'number' ? v * (level + 1) : undefined;
}

/** The card's rolled stone lines; an upgrade also carries what the stone gives at the level it holds now. */
function stoneLines(card: Card, def: StoneDef | undefined, heldLevel: number | undefined): CardLineView[] {
  const lines = lineViews(card);
  if (!def || heldLevel === undefined) return lines;
  return lines.map((l, i) => {
    const src = card.lines[i];
    const prev = src ? stoneStatAt(def, src.stat, heldLevel) : undefined;
    if (!src || prev === undefined) return l;
    const b = formatStatLine(src.stat, src.mode, prev);
    return b.amount !== l.amount ? { ...l, from: `${b.sign}${b.amount}` } : l;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Awakening pacts (R1, OF-01 / OF-02): the sim's rule is in sim/cards.ts (pactNeed); this is its display twin. A skill awakens
// (rank P) only while the passive balance.pacts.byBehavior[its behaviour] is held at rank >= balance.pacts.rank (capped at that
// passive's max rank). Pacts off (rank 0 / absent) = no pact line anywhere = today's cards and board.

/** The pact rules of this content; null = pacts off. */
export interface PactRules {
  rank: number;
  by: Partial<Record<BehaviorKind, string>>;
}

export function pactRules(content: ContentDB): PactRules | null {
  const p = resolvePacts(content.balance.pacts);
  return p.rank > 0 ? { rank: p.rank, by: p.byBehavior } : null;
}

/** The rank the pact passive must be held at: the pact rank, capped at the passive's own max rank. */
export function pactNeedRank(rules: PactRules, passive: PassiveDef | undefined): number {
  return Math.min(rules.rank, passive?.maxRank ?? rules.rank);
}

function passiveIcon(id: string, def: PassiveDef | undefined, name: string): PactIconView {
  return { id, icon: def?.icon ?? `icon_passive_${id}`, kind: 'passive', name };
}

/** The owned skills that stay at G2 when `card` (a new passive) takes the last passive slot: their pact passive is another one and is not held. */
function strandedSkills(card: Card, rules: PactRules, hud: HudSnapshot | null | undefined, content: ContentDB): PactIconView[] {
  if (!hud || card.kind !== 'newPassive' || hud.passives.length + 1 < content.balance.maxPassives) return [];
  const ix = indexOf(content);
  const out: PactIconView[] = [];
  for (const s of hud.skills) {
    const def = ix.skills.get(s.id);
    const passiveId = def ? rules.by[def.behavior] : undefined;
    if (!def || !passiveId || passiveId === card.id || s.awakened || s.rank >= MAX_SKILL_RANK) continue;
    if (hud.passives.some((p) => p.id === passiveId)) continue;
    out.push({ id: s.id, icon: s.icon || def.icon, kind: 'skill', name: tl(def.name) });
  }
  return out;
}

/** The pact line of a card, or undefined (pacts off, a card kind without one, or a ready label the HUD does not back up). */
function pactView(card: Card): CardPactView | undefined {
  const { content } = deps();
  const ix = indexOf(content);
  const hud = deps().store.hud.value;
  const rules = pactRules(content);
  if (card.kind === 'newSkill' || card.kind === 'skillUp') {
    const behavior = ix.skills.get(card.id)?.behavior;
    const passiveId = card.needs ?? (card.awakening && rules && behavior ? rules.by[behavior] : undefined);
    if (!passiveId) return undefined;
    const def = ix.passives.get(passiveId);
    const name = def ? tl(def.name) : passiveId;
    const icons = [passiveIcon(passiveId, def, name)];
    const have = hud?.passives.find((p) => p.id === passiveId)?.rank ?? 0;
    const need = rules ? pactNeedRank(rules, def) : 0;
    if (card.needs !== undefined) {
      // every passive slot is used and the passive is not one of them: no card will ever offer it, so the card does not promise it
      if (hud && have === 0 && hud.passives.length >= content.balance.maxPassives) return { mode: 'blocked', text: t('offers.pact.blocked', { name }), short: t('offers.pact.blockedShort', { name }), icons, more: 0 };
      // a card queued before the passive reached the pact rank: the pact is kept now
      const note = need > 0 ? (have >= need ? t('offers.board.kept') : have > 0 ? t('offers.pact.rankHave', { have, need }) : t('offers.pact.rankNeed', { need })) : undefined;
      return { mode: 'needs', text: t('offers.pact.needs', { name }), short: name, ...(note ? { note } : {}), icons, more: 0 };
    }
    // a ready awakening: only while the hero's HUD shows the passive held at the pact rank (a label never outranks the state)
    if (hud && have < need) return undefined;
    return { mode: 'ready', text: t('offers.pact.ready', { name }), short: name, icons, more: 0 };
  }
  if (card.kind === 'newPassive' || card.kind === 'passiveUp') {
    const stranded = rules ? strandedSkills(card, rules, hud, content) : [];
    const warn = stranded.length > 0 ? t(stranded.length > 1 ? 'offers.pact.lastSlot' : 'offers.pact.lastSlotOne', { names: stranded.map((i) => i.name).join(', ') }) : undefined;
    const warnShort = stranded.length > 0 ? tn('offers.pact.lastSlotShort', stranded.length) : undefined;
    const ids = card.pact?.awakens;
    if (!ids || ids.length === 0) {
      // not a pact passive, but it spends the slot a waiting skill needs: the warning stands alone
      return warn ? { mode: 'warn', text: warn, short: warnShort ?? warn, icons: stranded.slice(0, 3), more: Math.max(0, stranded.length - 3) } : undefined;
    }
    const all: PactIconView[] = ids.map((id) => {
      const def = ix.skills.get(id);
      return { id, icon: def?.icon ?? `icon_skill_${id}`, kind: 'skill', name: def ? tl(def.name) : id };
    });
    // how far the card moves the pact: the passive must reach the pact rank (capped at its own max rank); at or past it the card keeps the pact
    const need = rules ? pactNeedRank(rules, ix.passives.get(card.id)) : 0;
    const note = need > 0 ? (card.rank >= need ? t('offers.pact.completes') : t('offers.pact.rankHave', { have: card.rank, need })) : undefined;
    const names = all.map((i) => i.name).join(', ');
    return { mode: 'awakens', text: t('offers.pact.awakens', { names }), short: names, ...(note ? { note } : {}), ...(warn ? { warn, warnShort } : {}), icons: all.slice(0, 3), more: Math.max(0, all.length - 3) };
  }
  return undefined;
}

/**
 * How one owned skill stands with its pact passive: kept below G2, ready at G2, awakened, open (the passive is missing or held below
 * the pact rank) or blocked (the passive is not held and every passive slot is used: no card will offer it again).
 */
export type PactState = 'awakened' | 'ready' | 'kept' | 'open' | 'blocked';

export interface PactLinkView {
  skillId: string;
  skillIcon: string;
  skillName: string;
  skillRank: number;
  passiveId: string;
  passiveIcon: string;
  passiveName: string;
  /** the rank the hero holds the passive at (0 = not owned) and the rank the pact asks for */
  have: number;
  need: number;
  state: PactState;
  /** the state in words ("Awakened", "Pact kept", "Needs Saddlecraft, rank 1 of 2", "No passive slot left for Saddlecraft") */
  text: string;
}

/**
 * Every owned skill that has a pact passive, in HUD order, with its state (the build board draws one chain per link). Basic
 * attacks and ultimates follow their behaviour like any skill (sim/cards.ts). Empty while pacts are off.
 */
export function pactLinks(hud: Pick<HudSnapshot, 'skills' | 'passives'> | null | undefined): PactLinkView[] {
  if (!hud) return [];
  const { content } = deps();
  const rules = pactRules(content);
  if (!rules) return [];
  const ix = indexOf(content);
  const out: PactLinkView[] = [];
  for (const s of hud.skills) {
    const sdef = ix.skills.get(s.id);
    const passiveId = sdef ? rules.by[sdef.behavior] : undefined;
    if (!sdef || !passiveId) continue;
    const pdef = ix.passives.get(passiveId);
    const passiveName = pdef ? tl(pdef.name) : passiveId;
    const have = hud.passives.find((p) => p.id === passiveId)?.rank ?? 0;
    const need = pactNeedRank(rules, pdef);
    const met = have >= need;
    const full = hud.passives.length >= content.balance.maxPassives;
    const state: PactState = s.awakened || s.rank >= MAX_SKILL_RANK ? 'awakened' : met ? (s.rank >= MAX_SKILL_RANK - 1 ? 'ready' : 'kept') : have === 0 && full ? 'blocked' : 'open';
    const text =
      state === 'awakened'
        ? t('offers.board.awakened')
        : state === 'ready'
          ? t('offers.board.ready')
          : state === 'kept'
            ? t('offers.board.kept')
            : state === 'blocked'
              ? t('offers.board.blocked', { name: passiveName })
              : have > 0
                ? t('offers.board.needsPartial', { name: passiveName, have, need })
                : t('offers.board.needs', { name: passiveName, need });
    out.push({ skillId: s.id, skillIcon: s.icon || sdef.icon, skillName: tl(sdef.name), skillRank: s.rank, passiveId, passiveIcon: pdef?.icon ?? `icon_passive_${passiveId}`, passiveName, have, need, state, text });
  }
  return out;
}

/** The card's display model; a card of a pact-bearing kind also carries its pact line (OF-02). */
export function describeCard(card: Card): CardModel {
  const m = describeBase(card);
  const pact = pactView(card);
  return pact ? { ...m, pact } : m;
}

function describeBase(card: Card): CardModel {
  const { content } = deps();
  const ix = indexOf(content);
  const hud = deps().store.hud.value;
  const base: Omit<CardModel, 'title' | 'icon' | 'iconKind'> = {
    kind: card.kind,
    rarity: card.rarity,
    sub: PLAIN_KINDS.includes(card.kind) ? '' : t(`card.kind.${card.kind}`),
    isNew: NEW_KINDS.includes(card.kind),
    awakening: card.awakening,
    lines: card.kind === 'trinket' || card.kind === 'trinketUp' ? [] : lineViews(card),
  };
  switch (card.kind) {
    case 'newSkill':
    case 'skillUp': {
      const def: SkillDef | undefined = ix.skills.get(card.id);
      // slot use counts the actives only: the basic attack and talent ultimates take no slot (sim/cards.ts activeSlotCount)
      const slots = splitSkills(hud?.skills, (id) => ix.skills.get(id)?.kind).actives.length + (card.kind === 'newSkill' ? 1 : 0);
      return {
        ...base,
        title: def ? tl(def.name) : card.id,
        icon: def?.icon ?? `icon_skill_${card.id}`,
        iconKind: 'skill',
        ...(def ? { element: def.element } : {}),
        rankTo: rankLabel(card.rank),
        rankIdx: card.rank,
        ...(card.kind === 'skillUp' ? { rankFrom: rankLabel(Math.max(0, card.rank - 1)), rankFromIdx: Math.max(0, card.rank - 1) } : {}),
        ...(card.kind === 'newSkill' && def ? { desc: skillDescription(def) } : {}),
        ...(card.kind === 'skillUp' && def ? { flavour: skillDescription(def) } : {}),
        footer: card.kind === 'newSkill' ? t('card.takesSkillSlot', { n: slots, max: content.balance.maxActiveSkills }) : t('card.upgradesSkill'),
        ...(card.kind === 'newSkill' ? { slotUse: { n: slots, max: content.balance.maxActiveSkills } } : {}),
      };
    }
    case 'newPassive':
    case 'passiveUp': {
      const def: PassiveDef | undefined = ix.passives.get(card.id);
      const slots = (hud?.passives.length ?? 0) + (card.kind === 'newPassive' ? 1 : 0);
      return {
        ...base,
        title: def ? tl(def.name) : card.id,
        icon: def?.icon ?? `icon_passive_${card.id}`,
        iconKind: 'passive',
        rankTo: String(card.rank),
        ...(card.kind === 'passiveUp' ? { rankFrom: String(Math.max(0, card.rank - 1)) } : {}),
        ...(def && card.lines.length === 0 ? { desc: tl(def.desc) } : {}),
        ...(def && card.lines.length > 0 ? { flavour: tl(def.desc) } : {}),
        footer: card.kind === 'newPassive' ? t('card.takesPassiveSlot', { n: slots, max: content.balance.maxPassives }) : t('card.upgradesPassive'),
        ...(card.kind === 'newPassive' ? { slotUse: { n: slots, max: content.balance.maxPassives } } : {}),
      };
    }
    case 'stone':
    case 'stoneUp': {
      const def: StoneDef | undefined = ix.stones.get(card.id);
      const used = hud?.stones.filter(Boolean).length ?? 0;
      const rep = card.replaces;
      const held = hud?.stones[card.slot];
      const heldLevel = card.kind === 'stoneUp' && held?.id === card.id ? held.level : undefined;
      const repName = rep ? (ix.stones.get(rep.id) ? tl(ix.stones.get(rep.id)?.name) : rep.id) : '';
      return {
        ...base,
        title: def ? tl(def.name) : card.id,
        icon: def?.icon ?? `icon_stone_${card.id}`,
        iconKind: 'stone',
        ...(def ? { slot: def.slot } : {}),
        lines: stoneLines(card, def, heldLevel),
        rankTo: `+${card.rank}`,
        ...(card.kind === 'stoneUp' ? { rankFrom: `+${held?.id === card.id ? held.level : Math.max(0, card.rank - 1)}` } : {}),
        ...(def && card.lines.length === 0 ? { desc: tl(def.desc) } : {}),
        slotLabel: def ? t(def.slot === 'weapon' ? 'card.slot.weapon' : 'card.slot.armor') : '',
        ...(rep ? { replaces: t('card.replaces', { name: repName, level: rep.level }) } : {}),
        footer: rep ? undefined : card.kind === 'stone' ? t('card.takesStoneSlot', { n: used + 1, max: hud?.stones.length ?? 6 }) : t('card.upgradesStone'),
        ...(!rep && card.kind === 'stone' ? { slotUse: { n: used + 1, max: hud?.stones.length ?? 6 } } : {}),
      };
    }
    case 'trinket':
    case 'trinketUp': {
      const def: TrinketDef | undefined = ix.trinkets.get(card.id);
      const used = hud?.trinkets.filter(Boolean).length ?? 0;
      const rep = card.replaces;
      const held = hud?.trinkets[card.slot];
      const heldRank = card.kind === 'trinketUp' ? (held?.id === card.id ? held.rank : Math.max(0, card.rank - 1)) : undefined;
      const repDef = rep ? ix.trinkets.get(rep.id) : undefined;
      return {
        ...base,
        title: def ? tl(def.name) : card.id,
        icon: def?.icon ?? `icon_trinket_${card.id}`,
        iconKind: 'trinket',
        ...(def ? { slot: def.slot, lines: heldRank === undefined ? trinketLines(def, card.rank) : trinketUpgradeLines(def, card.rank, heldRank) } : {}),
        rankTo: String(card.rank),
        ...(card.kind === 'trinketUp' ? { rankFrom: String(held?.id === card.id ? held.rank : Math.max(0, card.rank - 1)) } : {}),
        ...(def ? { desc: tl(def.desc) } : {}),
        slotLabel: def ? t(trinketSlotKey(def.slot)) : '',
        ...(rep ? { replaces: t('card.replacesTrinket', { name: repDef ? tl(repDef.name) : rep.id, level: rep.level }) } : {}),
        footer: rep ? undefined : card.kind === 'trinket' ? t('card.takesTrinketSlot', { n: used + 1, max: hud?.trinkets.length ?? 3 }) : t('card.upgradesTrinket'),
        ...(!rep && card.kind === 'trinket' ? { slotUse: { n: used + 1, max: hud?.trinkets.length ?? 3 } } : {}),
      };
    }
    case 'heal':
      // one big number well ("+30%  max HP restored") instead of a sentence; the sentence stays as the aria / flavour text
      return {
        ...base,
        title: t('card.kind.heal'),
        sub: '',
        icon: 'icon_card_heal',
        iconKind: 'misc',
        glyph: 'heart',
        element: 'holy',
        lines: [{ sign: '+', amount: fmtPct(card.amount), label: t('card.healLine'), positive: true, stat: 'heal' }],
        flavour: t('card.healFlavour'),
        instant: t('card.instant'),
        isNew: false,
      };
    case 'yeop':
      return {
        ...base,
        title: t('card.kind.yeop'),
        sub: '',
        icon: 'icon_card_yeop',
        iconKind: 'misc',
        glyph: 'coin',
        element: 'holy',
        lines: [{ sign: '+', amount: fmtInt(card.amount), label: t('card.yeopLine'), positive: true, stat: 'yeopGain' }],
        flavour: t('card.yeopFlavour'),
        instant: t('card.instant'),
        isNew: false,
      };
    case 'shards':
      // Metin shards (R6): the yeop plate with a shard laid over its coins, one big number of the shards banked at the run's end
      return {
        ...base,
        title: t('offers.card.shards.title'),
        sub: '',
        icon: 'icon_card_yeop',
        iconKind: 'misc',
        glyph: 'shard',
        element: 'fire',
        emblem: 'shard',
        lines: [{ sign: '+', amount: fmtInt(card.amount), label: t('offers.card.shards.line'), positive: true, currency: 'shard' }],
        flavour: t('offers.card.shards.flavour'),
        instant: t('offers.card.shards.note'),
        isNew: false,
      };
    case 'boon': {
      // the Sky Sovereign's Boon (R6): a stack. `rank` = the stack it becomes, `lines` = what ONE pick adds; the rank row counts the stack
      // (3 -> 4) and every line shows the total it brings (+9% -> +12%), the way an upgrade card does
      const n = Math.max(1, Math.round(card.rank));
      const lines: CardLineView[] = card.lines.map((l) => {
        const to = formatStatLine(l.stat, l.mode, l.value * n);
        const from = n > 1 ? formatStatLine(l.stat, l.mode, l.value * (n - 1)) : undefined;
        return { ...to, stat: l.stat, ...(from ? { from: `${from.sign}${from.amount}` } : {}) };
      });
      return {
        ...base,
        title: t('offers.card.boon.title'),
        sub: t('offers.card.boon.sub'),
        rarityLabel: t('offers.card.boon.tag'),
        icon: 'icon_passive_sovereign_wrath', // the painted dragon head of the Sky Sovereign, laid in gold by card.css (.ms-card--boon); no new raster
        iconKind: 'misc',
        glyph: 'dragon',
        element: 'holy',
        rankFrom: String(n - 1),
        rankTo: String(n),
        lines,
        flavour: t('offers.card.boon.flavour'),
        footer: t('offers.card.boon.footer'),
        isNew: false,
      };
    }
    case 'bargain':
    default:
      // A0-CARD stub: the bargain card (EV-03a) has no face yet
      return { ...base, title: card.id, icon: card.id, iconKind: 'misc' };
  }
}

/** Rank band of the card's icon light: skills by their new rank, passives by their level (1-2 n, 3 m, 4 g, 5 p), awakenings p. */
export function bandOf(m: Pick<CardModel, 'awakening' | 'rankIdx' | 'iconKind' | 'rankTo'>): RankBand {
  if (m.awakening) return 'p';
  if (m.rankIdx !== undefined) return rankBand(m.rankIdx);
  if (m.iconKind === 'passive') {
    const lv = Number(m.rankTo);
    return lv >= 5 ? 'p' : lv >= 4 ? 'g' : lv >= 3 ? 'm' : 'n';
  }
  return 'n';
}
