// Tooltip bodies for content items (skills, passives, spirit stones, trinkets, gear). Used by the HUD, Level-Up, the
// Armory and the run modals through `tipProps(() => buildTip(subject))`.
import type { JSX } from 'preact';
import type { Rarity } from '../data/schema';
import { fmtDec, fmtInt, t, tl } from '../i18n/i18n';
import { gearStats } from '../meta/gear';
import { indexOf, rankLabel, skillDescription, statModRows } from './content';
import { TipBody } from './components/Tooltip';

export type TipSubject =
  | { type: 'skill'; id: string; rank?: number }
  | { type: 'passive'; id: string; rank?: number }
  | { type: 'stone'; id: string; level?: number }
  | { type: 'trinket'; id: string; rank?: number }
  | { type: 'gear'; id: string; plus?: number };

export function buildTip(s: TipSubject): JSX.Element {
  const ix = indexOf();
  switch (s.type) {
    case 'skill': {
      const def = ix.skills.get(s.id);
      if (!def) return <TipBody title={s.id} />;
      const p = def.params;
      const rows: { label: string; value: string; tone: 'info' }[] = [];
      if (p.damage > 0) rows.push({ label: t('stat.damage'), value: fmtInt(p.damage), tone: 'info' });
      if (p.cooldown > 0) rows.push({ label: t('stat.cooldown'), value: `${fmtDec(p.cooldown, 1)} s`, tone: 'info' });
      if (p.area > 0) rows.push({ label: t('stat.area'), value: `${fmtDec(p.area, 1)} m`, tone: 'info' });
      if (p.count > 1) rows.push({ label: t('stat.count'), value: fmtInt(p.count), tone: 'info' });
      return (
        <TipBody
          title={tl(def.name)}
          sub={`${t(`element.${def.element}`)}${s.rank !== undefined ? ` · ${t('rank.label')} ${rankLabel(s.rank)}` : ''}`}
          body={skillDescription(def)}
          rows={rows}
          lore={s.rank !== undefined && s.rank >= 7 ? tl(def.awaken.desc) : `${t('rank.awakening')}: ${tl(def.awaken.desc)}`}
        />
      );
    }
    case 'passive': {
      const def = ix.passives.get(s.id);
      if (!def) return <TipBody title={s.id} />;
      const rank = s.rank ?? 1;
      return <TipBody title={tl(def.name)} sub={`${t('common.rank', { n: rank })} / ${def.maxRank}`} body={tl(def.desc)} rows={statModRows(def.perRank, rank).map((r) => ({ label: r.label, value: r.value, bad: !r.positive }))} />;
    }
    case 'stone': {
      const def = ix.stones.get(s.id);
      if (!def) return <TipBody title={s.id} />;
      const lvl = s.level ?? 0;
      return <TipBody title={`${tl(def.name)} +${lvl}`} sub={t(def.slot === 'weapon' ? 'card.slot.weapon' : 'card.slot.armor')} body={tl(def.desc)} rows={statModRows(def.perLevel, Math.max(1, lvl + 1)).map((r) => ({ label: r.label, value: r.value, bad: !r.positive }))} />;
    }
    case 'trinket': {
      const def = ix.trinkets.get(s.id);
      if (!def) return <TipBody title={s.id} />;
      const rank = s.rank ?? 1;
      return (
        <TipBody
          title={tl(def.name)}
          sub={`${t(def.slot === 'earring' ? 'card.slot.earring' : def.slot === 'necklace' ? 'card.slot.necklace' : 'card.slot.bracelet')} · ${t('common.rank', { n: rank })} / ${def.maxRank}`}
          body={tl(def.desc)}
        />
      );
    }
    case 'gear': {
      const def = ix.gear.get(s.id);
      if (!def) return <TipBody title={s.id} />;
      const plus = s.plus ?? 0;
      return (
        <TipBody
          title={`${tl(def.name)}${plus > 0 ? ` +${plus}` : ''}`}
          sub={t(`gear.slot.${def.slot}`)}
          rows={statModRows(gearStats(def, plus)).map((r) => ({ label: r.label, value: r.value, bad: !r.positive }))}
        />
      );
    }
  }
}

export const GEAR_RARITY_BY_TIER: Record<number, Rarity> = { 0: 'common', 1: 'uncommon', 2: 'rare', 3: 'epic', 4: 'legendary' };

/** Gear tier → rarity colour (tier 1 iron … tier 4 dragon-gilded). */
export function gearRarity(tier: number): Rarity {
  return GEAR_RARITY_BY_TIER[Math.max(0, Math.min(4, tier))] ?? 'common';
}
