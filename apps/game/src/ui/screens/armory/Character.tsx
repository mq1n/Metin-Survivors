// Armory · Character: the equipment paper-doll (r2). Eight octagon cells packed in two columns around a full-body hero
// standing on a lit dais (painted pose in the gallery, the live 3D hero in the app); each cell carries tier gem sockets and a
// +N numeral, the details live in a dark tooltip. Plus the slot picker for owned pieces, the loadout preview controls
// (doctrine / empire / look) and the derived-stats sheet with source breakdowns.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ClassDef, ContentDB, DoctrineKey, EmpireId, GearDef, GearSlot, Sex, StatMods } from '../../../data/schema';
import { fmtDec, fmtInt, fmtPct, t, tl } from '../../../i18n/i18n';
import { availablePoints, collectionProgress, computeMetaBonusDetail, equippedPieces, gearStats, ownedPieces, talentCap, type OwnedPiece } from '../../../meta';
import { portraitFaceUrl, portraitUrl, texUrl } from '../../assets';
import { sfx } from '../../audio';
import { Button } from '../../components/Button';
import { Glyph } from '../../components/glyphs';
import { CLASS_COLOR, ClassEmblem, EMPIRE_COLOR, EmpireEmblem, slotGlyph } from '../../components/Icon';
import { useScrollFade } from '../../components/ScrollFade';
import { IconSlot } from '../../components/Slot';
import { StatIcon, UiGlyph } from '../../components/StatIcon';
import { StatWell } from '../../components/StatWell';
import { TipBody, tipProps } from '../../components/Tooltip';
import { indexOf, statLabel, statModRows } from '../../content';
import { deps, type HeroPreviewHandle, type HeroPreviewSelection } from '../../env';
import { buildTip, gearRarity } from '../../itemTips';
import { useKeys } from '../../nav';
import { armoryTab, metaSave, pushToast } from '../../view';
import { armoryClass, armoryDoctrine, armoryEmpire, armoryPicked, armorySex } from './state';
import { layout } from '../../layout';
import { attachTurntable } from '../heroTurn';
import { Plate } from './Art';
import { gearSourceRows } from './Collection';
import { Win, navProps } from './Win';
import './armory-chr.css';

const LEFT_SLOTS: readonly GearSlot[] = ['helmet', 'armor', 'weapon', 'shield'];
const RIGHT_SLOTS: readonly GearSlot[] = ['earrings', 'necklace', 'bracelet', 'shoes'];
const EMPIRES: readonly EmpireId[] = ['saehwa', 'chowon', 'jihae'];

// ---------------------------------------------------------------------------------------------------------------
// Derived stats

type NumKey = Exclude<keyof StatMods, 'vsRace' | 'resist'>;
type SrcKey = 'base' | 'empire' | 'talents' | 'gear';
const SRC_ORDER: readonly SrcKey[] = ['base', 'empire', 'talents', 'gear'];
const PCT_KEYS: Record<string, true> = {
  maxHpPct: true, moveSpeed: true, damage: true, critChance: true, critDamage: true, cooldown: true, area: true, duration: true,
  projSpeed: true, xpGain: true, yeopGain: true, pickupRadius: true, luck: true, lifesteal: true, attackSpeed: true,
  evasion: true, thorns: true, vsBoss: true,
};

interface TipRow {
  label: string;
  value: string;
  bad?: boolean;
}

interface StatLine {
  id: string;
  /** StatIcon id (StatMods key or alias) */
  stat: string;
  label: string;
  value: string;
  sub?: string;
  /** a non-base source (empire / talents / gear) contributes */
  hot: boolean;
  /** the stat sums to nothing (a +0% row): shown dim */
  zero?: boolean;
  tip: TipRow[];
  note?: string;
}

interface StatGroup {
  id: 'survival' | 'offense' | 'utility';
  lines: StatLine[];
}

function fmtMod(key: NumKey, v: number): string {
  const mag = Math.abs(v);
  const amount = PCT_KEYS[key] === true ? fmtPct(mag, mag < 0.1 ? 1 : 0) : fmtDec(mag, mag < 10 ? 1 : 0);
  const negative = key === 'cooldown' ? v > 0 : v < 0;
  return `${negative ? '−' : '+'}${amount}`;
}

function buildStats(content: ContentDB, cls: ClassDef, classId: ClassDef['id'], doctrine: DoctrineKey, empire: EmpireId): StatGroup[] {
  const detail = computeMetaBonusDetail(deps().meta.save, content, { classId, doctrine, empire });
  const { maxHp: baseHp, armor: baseArmor, moveSpeed: baseSpeed, ...baseMods } = cls.base;
  const parts: Record<SrcKey, StatMods> = { base: baseMods, empire: detail.breakdown.empire, talents: detail.breakdown.talents, gear: detail.breakdown.gear };
  const bal = content.balance;
  const part = (src: SrcKey, k: NumKey): number => (parts[src][k] as number | undefined) ?? 0;
  const sum = (k: NumKey): number => SRC_ORDER.reduce((s, src) => s + part(src, k), 0);
  const hot = (...keys: NumKey[]): boolean => keys.some((k) => part('empire', k) !== 0 || part('talents', k) !== 0 || part('gear', k) !== 0);
  const sources = (keys: NumKey[]): TipRow[] => {
    const rows: TipRow[] = [];
    for (const k of keys) {
      for (const src of SRC_ORDER) {
        const v = part(src, k);
        if (v === 0) continue;
        rows.push({ label: keys.length > 1 ? `${t(`armory.src.${src}`)} · ${statLabel(k)}` : t(`armory.src.${src}`), value: fmtMod(k, v), bad: k === 'cooldown' ? v < 0 : v < 0 });
      }
    }
    return rows;
  };
  const total = (value: string): TipRow => ({ label: t('armory.src.total'), value });

  // survival
  const hp = Math.max(1, (baseHp + sum('maxHp')) * (1 + sum('maxHpPct')));
  const armor = Math.max(0, baseArmor + sum('armor'));
  const dr = armor / (armor + bal.armorK);
  const regen = Math.max(0, sum('regen'));
  const evasion = Math.min(bal.caps.evasion, Math.max(0, sum('evasion')));
  const lifesteal = Math.min(bal.caps.lifesteal, Math.max(0, sum('lifesteal')));
  const survival: StatLine[] = [
    { id: 'hp', stat: 'maxHp', label: t('armory.stat.maxHp'), value: fmtInt(hp), hot: hot('maxHp', 'maxHpPct'), tip: [{ label: t('armory.src.base'), value: fmtInt(baseHp) }, ...sources(['maxHp', 'maxHpPct']), total(fmtInt(hp))] },
    { id: 'armor', stat: 'armor', label: t('stat.armor'), value: fmtInt(armor), sub: `−${fmtPct(dr, 1)}`, hot: hot('armor'), tip: [{ label: t('armory.src.base'), value: fmtInt(baseArmor) }, ...sources(['armor']), total(fmtInt(armor)), { label: t('armory.stat.reduction'), value: `−${fmtPct(dr, 1)}` }], note: t('armory.stat.armorNote', { k: fmtInt(bal.armorK) }) },
    { id: 'regen', stat: 'regen', zero: regen === 0, label: t('stat.regen'), value: `${fmtDec(regen, 1)} ${t('armory.unit.perSec')}`, hot: hot('regen'), tip: [...sources(['regen']), total(`${fmtDec(regen, 1)} ${t('armory.unit.perSec')}`)] },
    { id: 'lifesteal', stat: 'lifesteal', zero: lifesteal === 0, label: t('stat.lifesteal'), value: fmtPct(lifesteal, 1), hot: hot('lifesteal'), tip: [...sources(['lifesteal']), total(fmtPct(lifesteal, 1))], ...(sum('lifesteal') >= bal.caps.lifesteal ? { note: t('armory.stat.capped', { v: fmtPct(bal.caps.lifesteal, 0) }) } : {}) },
    { id: 'evasion', stat: 'evasion', zero: evasion === 0, label: t('stat.evasion'), value: fmtPct(evasion, 1), hot: hot('evasion'), tip: [...sources(['evasion']), total(fmtPct(evasion, 1))], ...(sum('evasion') >= bal.caps.evasion ? { note: t('armory.stat.capped', { v: fmtPct(bal.caps.evasion, 0) }) } : {}) },
  ];
  const thorns = Math.max(0, sum('thorns'));
  if (thorns > 0) survival.push({ id: 'thorns', stat: 'thorns', label: t('stat.thorns'), value: fmtPct(thorns, 1), hot: hot('thorns'), tip: [...sources(['thorns']), total(fmtPct(thorns, 1))] });
  const revives = Math.max(0, Math.floor(sum('revives') + 1e-6));
  if (revives > 0) survival.push({ id: 'revives', stat: 'revives', label: t('stat.revives'), value: fmtInt(revives), hot: hot('revives'), tip: [...sources(['revives']), total(fmtInt(revives))] });
  const resists: Record<string, number> = {};
  const vsRace: Record<string, number> = {};
  for (const src of SRC_ORDER) {
    for (const [el, v] of Object.entries(parts[src].resist ?? {})) resists[el] = (resists[el] ?? 0) + (v ?? 0);
    for (const [race, v] of Object.entries(parts[src].vsRace ?? {})) vsRace[race] = (vsRace[race] ?? 0) + (v ?? 0);
  }
  for (const [el, v] of Object.entries(resists)) {
    if (v === 0) continue;
    const shown = Math.min(0.75, Math.max(-1, v));
    survival.push({ id: `res_${el}`, stat: 'resist', label: t('stat.resist', { element: t(`element.${el}`) }), value: `${shown < 0 ? '−' : '+'}${fmtPct(Math.abs(shown), 0)}`, hot: true, tip: [{ label: t('armory.src.total'), value: fmtPct(shown, 0) }] });
  }

  // offense
  const critChance = Math.min(bal.caps.critChance, Math.max(0, sum('critChance')));
  const critMul = Math.max(1, 1.5 + sum('critDamage'));
  const cdr = Math.min(bal.caps.cooldown, Math.max(0, sum('cooldown')));
  const offense: StatLine[] = [
    { id: 'damage', stat: 'damage', zero: sum('damage') === 0, label: t('stat.damage'), value: fmtMod('damage', sum('damage')), hot: hot('damage'), tip: [...sources(['damage']), total(fmtMod('damage', sum('damage')))] },
    { id: 'crit', stat: 'critChance', zero: critChance === 0, label: t('stat.critChance'), value: fmtPct(critChance, 1), hot: hot('critChance'), tip: [...sources(['critChance']), total(fmtPct(critChance, 1))], ...(sum('critChance') >= bal.caps.critChance ? { note: t('armory.stat.capped', { v: fmtPct(bal.caps.critChance, 0) }) } : {}) },
    { id: 'critDmg', stat: 'critDamage', label: t('stat.critDamage'), value: fmtPct(critMul, 0), hot: hot('critDamage'), tip: [{ label: t('armory.src.base'), value: fmtPct(1.5, 0) }, ...sources(['critDamage']), total(fmtPct(critMul, 0))] },
    { id: 'cooldown', stat: 'cooldown', zero: cdr === 0, label: t('stat.cooldown'), value: `−${fmtPct(cdr, 1)}`, hot: hot('cooldown'), tip: [...sources(['cooldown']), total(`−${fmtPct(cdr, 1)}`)], ...(sum('cooldown') >= bal.caps.cooldown ? { note: t('armory.stat.capped', { v: fmtPct(bal.caps.cooldown, 0) }) } : {}) },
    { id: 'area', stat: 'area', zero: sum('area') === 0, label: t('stat.area'), value: fmtMod('area', sum('area')), hot: hot('area'), tip: [...sources(['area']), total(fmtMod('area', sum('area')))] },
  ];
  for (const key of ['attackSpeed', 'duration', 'projSpeed', 'vsBoss'] as const) {
    const v = sum(key);
    if (v !== 0) offense.push({ id: key, stat: key, label: statLabel(key), value: fmtMod(key, v), hot: hot(key), tip: [...sources([key]), total(fmtMod(key, v))] });
  }
  for (const key of ['projectiles', 'pierce'] as const) {
    const v = Math.floor(sum(key) + 1e-6);
    if (v > 0) offense.push({ id: key, stat: key, label: statLabel(key), value: `+${fmtInt(v)}`, hot: hot(key), tip: [...sources([key]), total(`+${fmtInt(v)}`)] });
  }
  for (const [race, v] of Object.entries(vsRace)) {
    if (v !== 0) offense.push({ id: `race_${race}`, stat: 'vsRace', label: t('stat.vsRace', { race: t(`race.${race}`) }), value: `${v < 0 ? '−' : '+'}${fmtPct(Math.abs(v), 0)}`, hot: true, tip: [{ label: t('armory.src.total'), value: fmtPct(v, 0) }] });
  }

  // utility
  const speed = Math.max(1.5, baseSpeed * (1 + sum('moveSpeed')));
  const utility: StatLine[] = [
    { id: 'speed', stat: 'moveSpeed', label: t('stat.moveSpeed'), value: `${fmtDec(speed, 1)} ${t('stat.speedUnit')}`, hot: hot('moveSpeed'), tip: [{ label: t('armory.src.base'), value: `${fmtDec(baseSpeed, 1)} ${t('stat.speedUnit')}` }, ...sources(['moveSpeed']), total(`${fmtDec(speed, 1)} ${t('stat.speedUnit')}`)] },
    { id: 'luck', stat: 'luck', zero: sum('luck') === 0, label: t('stat.luck'), value: fmtMod('luck', sum('luck')), hot: hot('luck'), tip: [...sources(['luck']), total(fmtMod('luck', sum('luck')))], note: t('armory.stat.luckNote') },
    { id: 'xp', stat: 'xpGain', zero: sum('xpGain') === 0, label: t('stat.xpGain'), value: fmtMod('xpGain', sum('xpGain')), hot: hot('xpGain'), tip: [...sources(['xpGain']), total(fmtMod('xpGain', sum('xpGain')))] },
    { id: 'yeop', stat: 'yeopGain', zero: sum('yeopGain') === 0, label: t('stat.yeopGain'), value: fmtMod('yeopGain', sum('yeopGain')), hot: hot('yeopGain'), tip: [...sources(['yeopGain']), total(fmtMod('yeopGain', sum('yeopGain')))] },
  ];
  const pickup = sum('pickupRadius');
  if (pickup !== 0) utility.push({ id: 'pickup', stat: 'pickupRadius', label: statLabel('pickupRadius'), value: fmtMod('pickupRadius', pickup), hot: hot('pickupRadius'), tip: [...sources(['pickupRadius']), total(fmtMod('pickupRadius', pickup))] });

  return [
    { id: 'survival', lines: survival },
    { id: 'offense', lines: offense },
    { id: 'utility', lines: utility },
  ];
}

function DoctrineCard({ cls, doctrine }: { cls: ClassDef; doctrine: DoctrineKey }): JSX.Element | null {
  const ix = indexOf();
  const d = cls.doctrines.find((x) => x.id === doctrine) ?? cls.doctrines[0];
  if (!d) return null;
  const skills = [
    { role: t('armory.ctl.basicShort'), def: ix.skills.get(d.basic) },
    { role: t('armory.ctl.starterShort'), def: ix.skills.get(d.starter) },
  ];
  return (
    <div class="ms-chr-doctrine">
      <div class="ms-chr-doctrine-head">
        <span class="ms-eyebrow">{t('armory.ctl.doctrine')}</span>
        <b class="ms-head ms-chr-doctrine-name">{tl(d.name)}</b>
      </div>
      <p class="ms-lore ms-chr-doctrine-lore">{tl(d.desc)}</p>
      <div class="ms-chr-doctrine-skills">
        {skills.map(
          (s) =>
            s.def && (
              <div class="ms-chr-doctrine-skill" key={s.def.id} {...navProps()} {...tipProps(() => (s.def ? buildTip({ type: 'skill', id: s.def.id }) : <div />))}>
                <IconSlot size="sm" icon={s.def.icon} kind="skill" element={s.def.element} />
                <span>
                  <small>{s.role}</small>
                  <b>{tl(s.def.name)}</b>
                </span>
              </div>
            ),
        )}
      </div>
    </div>
  );
}

function IdPlate({ cls, doctrine, classId, sex, points, owned, total }: { cls: ClassDef; doctrine: DoctrineKey; classId: ClassDef['id']; sex: Sex; points: number; owned: number; total: number }): JSX.Element {
  const face = portraitFaceUrl(classId, sex);
  const d = cls.doctrines.find((x) => x.id === doctrine) ?? cls.doctrines[0];
  const go = (): void => {
    sfx('click');
    armoryTab.value = 'talents';
  };
  return (
    <div class="ms-chr-id" style={{ '--cc': CLASS_COLOR[classId] } as JSX.CSSProperties}>
      <span class="ms-chr-id-face">{face ? <span class="ms-chr-id-art" style={{ backgroundImage: `url("${face}")` }} /> : <ClassEmblem classId={classId} size="100%" />}</span>
      <div class="ms-chr-id-name">
        <b class="ms-title ms-chr-id-class">{tl(cls.name)}</b>
        <span class="ms-eyebrow">{d ? tl(d.name) : ''}</span>
      </div>
      <div class="ms-chr-id-wells">
        <StatWell layout="stack" size="md" label={t('armory.stats.collected')} value={`${fmtInt(owned)}/${fmtInt(total)}`} />
        {points > 0 ? (
          <button type="button" class="ms-chr-id-points" data-nav="" onClick={go} aria-label={t('armory.points', { n: points })} {...tipProps(() => <TipBody title={t('armory.talentPoints')} body={t('armory.points', { n: points })} />)}>
            <StatWell layout="stack" size="md" tone="gold" label={t('armory.stats.points')} value={fmtInt(points)} />
            <span class="ms-chr-id-goto" aria-hidden="true">
              <Glyph name="star" />
            </span>
            <span class="ms-hit" aria-hidden="true" />
          </button>
        ) : (
          <StatWell layout="stack" size="md" label={t('armory.stats.points')} value="0" />
        )}
      </div>
    </div>
  );
}


function StatCell({ l }: { l: StatLine }): JSX.Element {
  return (
    <div class={`ms-chr-stat ${l.hot ? 'is-hot' : ''} ${l.zero ? 'is-zero' : ''}`} {...navProps()} {...tipProps(() => <TipBody title={l.label} rows={l.tip} {...(l.note ? { body: l.note } : {})} />)}>
      <StatIcon stat={l.stat} size="var(--chr-ico, 2.6rem)" class="ms-chr-stat-ico" dim={l.zero === true} />
      <span class={`ms-well ms-well--sm ms-chr-stat-well ${l.hot ? 'ms-well--gold' : ''}`}>
        <span class="ms-chr-stat-label">
          <span class="ms-chr-stat-name">{l.label}</span>
          {l.sub && <small class="ms-chr-stat-sub ms-num">{l.sub}</small>}
        </span>
        <b class="ms-well-value ms-num">{l.value}</b>
      </span>
    </div>
  );
}

function StatsWindow({ groups, cls, doctrine, classId, sex, points, owned, total, loadout }: { groups: StatGroup[]; cls: ClassDef; doctrine: DoctrineKey; classId: ClassDef['id']; sex: Sex; points: number; owned: number; total: number; loadout?: JSX.Element }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useScrollFade(ref);
  
  const order: StatGroup['id'][] = ['survival', 'offense', 'utility'];
  const lines = order.flatMap((id) => groups.find((g) => g.id === id)?.lines ?? []);
  return (
    <Win class="ms-chr-stats" title={t('armory.stats.title')} bodyClass="ms-chr-stats-win">
      <div class="ms-chr-stats-body ms-scroll" ref={ref}>
        <IdPlate cls={cls} doctrine={doctrine} classId={classId} sex={sex} points={points} owned={owned} total={total} />
        <div class="ms-chr-grid" role="list">
          {lines.map((l) => (
            <StatCell key={l.id} l={l} />
          ))}
        </div>
        <div class="ms-chr-lower">
          <DoctrineCard cls={cls} doctrine={doctrine} />
          {loadout && <div class="ms-chr-loadout-in">{loadout}</div>}
        </div>
      </div>
      <p class="ms-chr-stats-foot">{t('armory.stats.foot')}</p>
    </Win>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Hero stage

function HeroPreview({ sel }: { sel: HeroPreviewSelection }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<HeroPreviewHandle | null>(null);
  const first = useRef(true);
  const latest = useRef(sel);
  latest.current = sel;
  useEffect(() => {
    const hook = deps().heroPreview;
    const el = ref.current;
    if (!hook || !el) return undefined;
    // heroPreview spins forever: the hero-select turntable adapter holds the figure front-on (3/4) with a slow sway
    handle.current = attachTurntable(el, hook.mount(el, latest.current), latest.current);
    return () => {
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    handle.current?.update(sel);
  }, [sel.classId, sel.sex, sel.doctrine, sel.empire, sel.armorTier]);
  return <div class="ms-chr-preview" ref={ref} />;
}

interface SlotCardProps {
  slot: GearSlot;
  piece: OwnedPiece | undefined;
  side: 'left' | 'right';
  active: boolean;
  index: number;
  /** the live inspector under the doll shows the piece: no popup tooltip then (a long-press tip stays on touch) */
  inspect: boolean;
  onPick: () => void;
  onHover: (slot: GearSlot | null) => void;
}


const GEM_SOCKETS = 4;

/** the painted bronze socket bay behind every cell (uk_armory_a_socket); CSS draws a stand-in bay while it is not shipped */
const SOCKET_TEX = 'uk_armory_a_socket';

/**
 * One equipment cell of the paper-doll lattice: an octagon bay (rarity rim) that shares its edges with the next cell, the tier gem
 * sockets bottom-left and a bare white +N numeral bottom-right. The name and stats are in the inspector under the doll.
 */
function DollCell({ slot, piece, side, active, index, inspect, onPick, onHover }: SlotCardProps): JSX.Element {
  const def = piece?.def;
  const rarity = def ? gearRarity(def.tier) : undefined;
  const kind = t(`gear.slot.${slot}`);
  const tier = def?.tier ?? 0;
  const plus = piece?.plus ?? 0;
  const sock = texUrl(SOCKET_TEX);
  const tip =
    inspect && !layout.value.touch
      ? {}
      : tipProps(
          () => (piece && def ? buildTip({ type: 'gear', id: def.id, plus: piece.plus }) : <TipBody title={kind} body={t('armory.slot.emptyTip')} />),
          rarity ? { rarity } : {},
        );
  const { onPointerEnter: tipEnter, onPointerLeave: tipLeave, onFocus: tipFocus, onBlur: tipBlur, ...tipRest } = tip as Partial<ReturnType<typeof tipProps>>;
  return (
    <button
      type="button"
      class={`ms-chr-cell ms-chr-cell--${side} ${piece ? 'is-filled' : 'is-empty'} ${active ? 'is-active' : ''} ${sock ? 'has-sock' : ''} ${rarity ? `ms-r-${rarity}` : ''}`}
      style={{ '--i': index, ...(sock ? { '--tex-sock': `url("${sock}")` } : {}) } as JSX.CSSProperties}
      data-nav=""
      aria-pressed={active}
      aria-label={`${kind}: ${def ? tl(def.name) : t('armory.slot.emptyShort')}`}
      onClick={onPick}
      {...tipRest}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHover(slot);
        tipEnter?.(e);
      }}
      onPointerLeave={() => {
        onHover(null);
        tipLeave?.();
      }}
      onFocus={(e) => {
        onHover(slot);
        tipFocus?.(e);
      }}
      onBlur={() => {
        onHover(null);
        tipBlur?.();
      }}
    >
      <span class="ms-chr-cell-art">
        <IconSlot
          size="lg"
          slot={slot}
          ghost={slotGlyph(slot)}
          {...(def ? { icon: def.icon, kind: 'gear' as const, rarity: gearRarity(def.tier) } : {})}
          selected={active}
        />
        {def && (
          <span class="ms-chr-gems" aria-hidden="true">
            {Array.from({ length: GEM_SOCKETS }, (_, i) => (
              <i key={i} class={i < tier ? 'is-lit' : ''} />
            ))}
          </span>
        )}
        {plus > 0 && <b class="ms-chr-plus ms-num">+{plus}</b>}
      </span>
    </button>
  );
}

/**
 * The inspector under the doll: the dark translucent item tooltip of the piece under the pointer / keyboard focus (else the picked
 * slot, else the weapon), always on screen so the cells need no captions (T9: coloured lines, rarity-coloured title).
 */
function Inspector({ slot, piece }: { slot: GearSlot; piece: OwnedPiece | undefined }): JSX.Element {
  const def = piece?.def;
  const rarity = def ? gearRarity(def.tier) : undefined;
  const rows = def && piece ? statModRows(gearStats(def, piece.plus)) : [];
  const src = def ? gearSourceRows(def) : [];
  return (
    <div class={`ms-chr-insp ${rarity ? `ms-r-${rarity}` : 'is-empty'}`} aria-live="polite">
      <span class="ms-chr-insp-ico">
        <IconSlot size="lg" slot={slot} ghost={slotGlyph(slot)} {...(def ? { icon: def.icon, kind: 'gear' as const, rarity: gearRarity(def.tier) } : {})} />
      </span>
      <div class="ms-chr-insp-main">
        <b class="ms-chr-insp-name ms-rc">{def && piece ? `${tl(def.name)}${piece.plus > 0 ? ` +${piece.plus}` : ''}` : t(`gear.slot.${slot}`)}</b>
        <span class="ms-chr-insp-sub">{def ? `${t(`gear.slot.${slot}`)} · ${t('gear.tier', { n: def.tier })}` : t('armory.slot.emptyShort')}</span>
        {def ? (
          <ul class="ms-chr-insp-rows">
            {rows.slice(0, 4).map((r) => (
              <li key={r.label} class={r.positive ? '' : 'is-bad'}>
                <span>{r.label}</span>
                <b class="ms-num">{r.value}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p class="ms-chr-insp-empty">{t('armory.slot.emptyTip')}</p>
        )}
      </div>
      {def && (
        <dl class="ms-chr-insp-src">
          {src.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function PieceRow({ piece, onEquip }: { piece: OwnedPiece; onEquip: () => void }): JSX.Element {
  const def = piece.def;
  const rarity = gearRarity(def.tier);
  const rows = statModRows(gearStats(def, piece.plus)).slice(0, 3);
  return (
    <button
      type="button"
      class={`ms-chr-piece ms-r-${rarity} ${piece.equipped ? 'is-equipped' : ''}`}
      data-nav=""
      onClick={onEquip}
      {...tipProps(() => buildTip({ type: 'gear', id: def.id, plus: piece.plus }), { rarity })}
    >
      <IconSlot size="sm" icon={def.icon} kind="gear" slot={def.slot} rarity={rarity} {...(piece.plus > 0 ? { badge: `+${piece.plus}` } : {})} />
      <span class="ms-chr-piece-text">
        <b class="ms-rc">{tl(def.name)}</b>
        <small>{rows.map((r) => `${r.value} ${r.label}`).join(' · ')}</small>
      </span>
      <span class="ms-chr-piece-tier ms-num">{t('gear.tier', { n: def.tier })}</span>
      {piece.equipped && (
        <span class="ms-chr-piece-eq">
          <UiGlyph name="check" tone="gold" flat /> {t('common.equipped')}
        </span>
      )}
    </button>
  );
}

function SlotPicker({ slot, classId, onClose }: { slot: GearSlot; classId: ClassDef['id']; onClose: () => void }): JSX.Element {
  const { meta, content } = deps();
  const save = metaSave().value;
  const owned = ownedPieces(save, content, classId).filter((p) => p.def.slot === slot);
  const total = content.gear.filter((g) => g.slot === slot && g.classes.includes(classId)).length;
  const equipped = owned.find((p) => p.equipped);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  useKeys((a) => {
    if (a.kind === 'cancel') {
      sfx('close');
      onClose();
      return true;
    }
    return false;
  });
  const equip = (def: GearDef): void => {
    if (equipped?.def.id === def.id) return;
    const r = meta.equip(classId, def.id);
    if (r.ok) sfx('equip');
    else pushToast(t('armory.error'), 'bad');
  };
  return (
    <Win
      class={`ms-chr-picker ms-anim-scale${owned.length <= 2 ? ' ms-chr-picker--few' : ''}`}
      role="dialog"
      aria-label={t(`gear.slot.${slot}`)}
      title={
        <>
          {t(`gear.slot.${slot}`)}{' '}
          <span class="ms-chr-picker-count ms-num">
            {fmtInt(owned.length)} / {fmtInt(total)}
          </span>
        </>
      }
      icon={<Glyph name={slotGlyph(slot)} />}
      onClose={onClose}
      closeLabel={t('common.close')}
      bodyClass="ms-chr-picker-body"
    >
      <div class="ms-chr-picker-list ms-scroll" ref={listRef}>
        {owned.length === 0 ? (
          <div class="ms-chr-picker-none">
            <Glyph name="lock" />
            <p>{t('armory.picker.none')}</p>
            <Button variant="wood" size="small" onClick={() => (armoryTab.value = 'drops')}>
              {t('armory.picker.whereDrops')}
            </Button>
          </div>
        ) : (
          owned.map((p) => <PieceRow key={p.def.id} piece={p} onEquip={() => equip(p.def)} />)
        )}
      </div>
      {equipped && (
        <div class="ms-chr-picker-foot">
          <Button
            variant="wood"
            size="small"
            block
            sound="back"
            onClick={() => {
              meta.unequip(classId, slot);
            }}
          >
            {t('armory.picker.unequip')}
          </Button>
        </div>
      )}
      {owned.length > 0 && total > owned.length && <p class="ms-chr-picker-more">{t('armory.picker.more', { n: total - owned.length })}</p>}
    </Win>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Loadout controls

function Loadout({ cls, doctrine, empire, sex }: { cls: ClassDef; doctrine: DoctrineKey; empire: EmpireId; sex: Sex }): JSX.Element {
  const ix = indexOf();
  return (
    <div class="ms-chr-loadout">
      <div class="ms-chr-ctl">
        <span class="ms-chr-ctl-label">{t('armory.ctl.doctrine')}</span>
        <div class="ms-chr-togs" role="radiogroup" aria-label={t('armory.ctl.doctrine')}>
          {cls.doctrines.map((d) => (
            <Plate
              key={d.id}
              on={d.id === doctrine}
              onClick={() => {
                if (d.id !== doctrine) {
                  sfx('tab');
                  armoryDoctrine.value = d.id;
                }
              }}
              {...tipProps(() => {
                const basic = ix.skills.get(d.basic);
                const starter = ix.skills.get(d.starter);
                return <TipBody title={tl(d.name)} sub={basic ? t('armory.ctl.basic', { skill: tl(basic.name) }) : undefined} body={tl(d.desc)} {...(starter ? { foot: t('armory.ctl.starter', { skill: tl(starter.name) }) } : {})} />;
              })}
            >
              <span class="ms-chr-doctrine-key">{d.id.toUpperCase()}</span> {tl(d.name)}
            </Plate>
          ))}
        </div>
      </div>

      <div class="ms-chr-ctl">
        <span class="ms-chr-ctl-label">{t('armory.ctl.empire')}</span>
        <div class="ms-chr-togs ms-chr-empires" role="radiogroup" aria-label={t('armory.ctl.empire')}>
          {EMPIRES.map((id) => {
            const def = ix.empires.get(id);
            return (
              <Plate
                key={id}
                on={id === empire}
                class="ms-chr-empire"
                style={{ '--ec': EMPIRE_COLOR[id] } as JSX.CSSProperties}
                onClick={() => {
                  if (id !== empire) {
                    sfx('tab');
                    armoryEmpire.value = id;
                  }
                }}
                {...tipProps(() => (def ? <TipBody title={tl(def.name)} body={tl(def.desc)} rows={statModRows(def.bonus).map((r) => ({ label: r.label, value: r.value, bad: !r.positive }))} /> : <TipBody title={id} />))}
              >
                <EmpireEmblem empire={id} size="1.3rem" />
                <span class="ms-chr-empire-name">{def ? tl(def.name) : id}</span>
              </Plate>
            );
          })}
        </div>
      </div>

      {cls.sexes.length > 1 && (
        <div class="ms-chr-ctl">
          <span class="ms-chr-ctl-label">{t('armory.ctl.look')}</span>
          <div class="ms-chr-togs" role="radiogroup" aria-label={t('armory.ctl.look')}>
            {cls.sexes.map((s) => (
              <Plate
                key={s}
                on={s === sex}
                onClick={() => {
                  if (s !== sex) {
                    sfx('tab');
                    armorySex.value = s;
                  }
                }}
              >
                {t(`armory.sex.${s}`)}
              </Plate>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tab

export function CharacterTab(): JSX.Element | null {
  const { content } = deps();
  const ix = indexOf();
  const save = metaSave().value;
  const classId = armoryClass.value;
  const doctrine = armoryDoctrine.value;
  const empire = armoryEmpire.value;
  const cls = ix.classes.get(classId);
  const picked = armoryPicked.value;
  const setPicked = (v: GearSlot | null | ((cur: GearSlot | null) => GearSlot | null)): void => {
    armoryPicked.value = typeof v === 'function' ? v(armoryPicked.peek()) : v;
  };
  const lastClass = useRef(classId);
  const [hov, setHov] = useState<GearSlot | null>(null);
  useEffect(() => {
    if (lastClass.current !== classId) {
      lastClass.current = classId;
      setPicked(null);
    }
  }, [classId]);
  if (!cls) return null;

  const sex: Sex = cls.sexes.includes(armorySex.value) ? armorySex.value : (cls.sexes[0] ?? 'm');
  const equipped = equippedPieces(save, content, classId);
  const bySlot = new Map<GearSlot, OwnedPiece>(equipped.map((p) => [p.def.slot, p]));
  const armorTier = Math.max(0, (bySlot.get('armor')?.def.tier ?? 1) - 1);
  const groups = buildStats(content, cls, classId, doctrine, empire);
  const art = portraitUrl(classId, sex);
  // full-body painted pose (the hero-select cut-outs) stands on the dais where the live 3D hero is not available
  const pose = texUrl(`uk_hero_select_pose_${classId}_${sex}`) ?? texUrl(`uk_hero_select_pose_${classId}_m`);
  const doctrineDef = cls.doctrines.find((d) => d.id === doctrine) ?? cls.doctrines[0];
  const points = availablePoints(save.classes[classId], talentCap(save));
  const progress = collectionProgress(save, content, classId);
  const hasPreview = deps().heroPreview !== undefined;
  const stageTex = texUrl('uk_armory_a_stage');
  const plateTex = texUrl('uk_armory_a_nameplate');
  const color = CLASS_COLOR[classId];
  const tier = layout.value.tier;
  const phoneP = tier === 'phone-p';
  // landscape phone: no room for the inspector, the cells keep the full height; the loadout sits in the stats column
  const phoneL = tier === 'phone-l';
  const inspect = !phoneL;
  const loadout = <Loadout cls={cls} doctrine={doctrine} empire={empire} sex={sex} />;
  const shown: GearSlot = hov ?? picked ?? 'weapon';

  const toggle = (slot: GearSlot): void => {
    sfx('click');
    setPicked((cur) => (cur === slot ? null : slot));
  };
  const cell = (s: GearSlot, i: number, side: 'left' | 'right'): JSX.Element => <DollCell key={s} slot={s} piece={bySlot.get(s)} side={side} active={picked === s} index={i} inspect={inspect} onPick={() => toggle(s)} onHover={setHov} />;

  return (
    <div class={`ms-chr ms-chr--${tier}`}>
      <Win class="ms-chr-equip" title={t('armory.equip.title')} bodyClass="ms-chr-equip-win" style={{ '--cc': color } as JSX.CSSProperties}>
        <div class="ms-chr-doll">
          <div class="ms-chr-lat">
            <div class="ms-chr-col ms-chr-col--left">{LEFT_SLOTS.map((s, i) => cell(s, i, 'left'))}</div>

            <div class="ms-chr-stage">
              <div class="ms-chr-hero">
                <div class={`ms-chr-set ${stageTex ? 'has-tex' : ''}`} style={stageTex ? ({ '--tex-stage': `url("${stageTex}")` } as JSX.CSSProperties) : undefined}>
                  <div class="ms-chr-ray" aria-hidden="true" />
                  <div class="ms-chr-dais" aria-hidden="true" />
                  <div class="ms-chr-hero-glow" aria-hidden="true" />
                  {!hasPreview &&
                    (pose ? (
                      <span class="ms-chr-figure" key={`${classId}-${sex}`}>
                        <i class="ms-chr-shadow" aria-hidden="true" />
                        <img class="ms-chr-pose" src={pose} alt="" draggable={false} decoding="async" />
                      </span>
                    ) : art ? (
                      <div class="ms-chr-portrait" key={`${classId}-${sex}`} style={{ backgroundImage: `url("${art}")` }} />
                    ) : (
                      <div class="ms-chr-portrait-emblem">
                        <ClassEmblem classId={classId} size="9rem" />
                      </div>
                    ))}
                </div>
                {hasPreview && <HeroPreview sel={{ classId, sex, doctrine, empire, armorTier }} />}
                {hasPreview && <span class="ms-chr-drag ms-fine">{t('armory.ctl.drag')}</span>}
              </div>
              <div class={`ms-chr-nameplate ${plateTex ? 'has-plate' : ''}`} style={plateTex ? ({ '--tex-nameplate': `url("${plateTex}")` } as JSX.CSSProperties) : undefined}>
                <span class="ms-eyebrow">{doctrineDef ? tl(doctrineDef.name) : ''}</span>
                <h2 class="ms-title ms-chr-name">{tl(cls.name)}</h2>
              </div>
            </div>

            <div class="ms-chr-col ms-chr-col--right">{RIGHT_SLOTS.map((s, i) => cell(s, i + 4, 'right'))}</div>
          </div>
          {picked && <SlotPicker key={picked} slot={picked} classId={classId} onClose={() => setPicked(null)} />}
        </div>
        {inspect && <Inspector slot={shown} piece={bySlot.get(shown)} />}
        {phoneP && loadout}
      </Win>

      <StatsWindow groups={groups} cls={cls} doctrine={doctrine} classId={classId} sex={sex} points={points} owned={progress.owned} total={progress.total} {...(phoneP ? {} : { loadout })} />
    </div>
  );
}
