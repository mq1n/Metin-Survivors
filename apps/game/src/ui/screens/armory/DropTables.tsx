// Armory · Drop Tables: for the viewed class, where every gear piece drops — per zone, per boss (in encounter order), then
// the zone-level pieces — with the per-roll chance (hard mode scales it), tier colour and owned marks. Kit v1: a zone list
// window beside a drop window; every boss is a crest + a row of octagon sockets that fills the width.
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { Difficulty, GearDef } from '../../../data/schema';
import { fmtDec, fmtInt, fmtPct, fmtTime, t, tl } from '../../../i18n/i18n';
import { PITY_GUARANTEE, dropTableFor, zoneStatuses, type DropTableEntry, type DropTableSection, type ZoneStatus } from '../../../meta';
import { iconUrl, texUrl, zoneArtUrl } from '../../assets';
import { sfx } from '../../audio';
import { useScrollFade } from '../../components/ScrollFade';
import { IconSlot } from '../../components/Slot';
import { StatWell } from '../../components/StatWell';
import { UiGlyph } from '../../components/StatIcon';
import { TipBody, tipProps } from '../../components/Tooltip';
import { enemyName, indexOf, zoneName } from '../../content';
import { deps } from '../../env';
import { buildTip, gearRarity } from '../../itemTips';
import { layout } from '../../layout';
import { metaSave } from '../../view';
import { armoryClass, armoryDropZone } from './state';
import { ArmGauge } from './ArmGauge';
import { BeastFace, DataStrip, Plate, type StripItem } from './Art';
import { Win, navProps } from './Win';
import './armory-drp.css';

function counts(sections: DropTableSection[], zone: string): { owned: number; total: number } {
  let owned = 0;
  let total = 0;
  for (const s of sections) {
    if (s.zone !== zone) continue;
    for (const e of s.entries) {
      total++;
      if (e.owned) owned++;
    }
  }
  return { owned, total };
}

function ZoneButton({ st, active, owned, total, index, onPick }: { st: ZoneStatus; active: boolean; owned: number; total: number; index: number; onPick: () => void }): JSX.Element {
  const zone = st.zone;
  const rarity = gearRarity(zone.gearTier);
  const art = zoneArtUrl(zone);
  const req = st.requirement;
  return (
    <button
      type="button"
      class={`ms-drp-zone ms-plate ms-r-${rarity} ${active ? 'is-active' : ''} ${st.unlocked ? '' : 'is-locked'}`}
      style={{ '--i': index, ...(art ? { '--art': `url("${art}")` } : {}) } as JSX.CSSProperties}
      data-nav=""
      aria-pressed={active}
      onClick={onPick}
      {...tipProps(() => (
        <TipBody
          title={tl(zone.name)}
          sub={tl(zone.subtitle)}
          rows={[
            { label: t('armory.drops.tier'), value: t('gear.tier', { n: zone.gearTier }) },
            { label: t('armory.piecesLabel'), value: `${fmtInt(owned)} / ${fmtInt(total)}` },
            { label: t('armory.drops.levels'), value: `${zone.levelRange[0]}–${zone.levelRange[1]}` },
          ]}
          {...(!st.unlocked && req ? { foot: t(req.difficulty === 'hard' ? 'armory.drops.requiresHard' : 'armory.drops.requires', { zone: zoneName(req.zone) }) } : {})}
        />
      ))}
    >
      <span class="ms-drp-zone-art" aria-hidden="true" />
      <span class="ms-drp-zone-name ms-head">{tl(zone.name)}</span>
      <span class="ms-drp-zone-meta">
        <b class="ms-rc">{t('gear.tier', { n: zone.gearTier })}</b>
        <span class="ms-num">
          {fmtInt(owned)}/{fmtInt(total)}
        </span>
        {!st.unlocked && <UiGlyph name="lock" tone="pewter" flat title={t('common.locked')} />}
      </span>
    </button>
  );
}

function PieceTile({ entry }: { entry: DropTableEntry }): JSX.Element {
  const save = metaSave().value;
  const def: GearDef = entry.def;
  const rarity = gearRarity(def.tier);
  const plus = save.classes[armoryClass.value].plus[def.id] ?? 0;
  const sock = texUrl('uk_armory_a_socket');
  return (
    <div
      class={`ms-drp-piece ms-r-${rarity} ${entry.owned ? 'is-owned' : ''} ${sock ? 'has-sock' : ''}`}
      style={sock ? ({ '--tex-sock': `url("${sock}")` } as JSX.CSSProperties) : undefined}
      {...navProps()}
      {...tipProps(
        () => (
          <>
            {buildTip({ type: 'gear', id: def.id, plus: entry.owned ? plus : 0 })}
            <div class="ms-tip-sub" style={{ marginTop: '0.5rem' }}>
              {entry.owned ? t('armory.drops.owned') : t('armory.drops.notYet')}
            </div>
          </>
        ),
        { rarity },
      )}
    >
      <span class="ms-drp-piece-cell">
        <IconSlot size="lg" icon={def.icon} kind="gear" slot={def.slot} rarity={rarity} locked={!entry.owned} class="ms-col-tile" />
        {entry.owned && (
          <span class="ms-drp-tick" aria-label={t('armory.drops.owned')}>
            <UiGlyph name="check" tone="gold" flat />
          </span>
        )}
      </span>
      <span class="ms-drp-piece-text">
        <b class="ms-rc">{tl(def.name)}</b>
        <small>{t(`gear.slot.${def.slot}`)}</small>
        <span class="ms-drp-piece-foot">
          <StatWell size="sm" value={fmtPct(entry.chance, 0)} class="ms-drp-chance" />
          <span class={entry.owned ? 'ms-drp-owned' : 'ms-drp-notyet'}>{entry.owned ? t('armory.drops.owned') : t('armory.drops.notYet')}</span>
        </span>
      </span>
    </div>
  );
}

function stripFor(at: number | undefined, final: boolean, isBoss: boolean, kills: number, owned: number, total: number): StripItem[] {
  const out: StripItem[] = [];
  if (at !== undefined) out.push({ key: 'at', icon: <UiGlyph name="clock" tone="pewter" flat />, text: fmtTime(at), num: true });
  if (final) out.push({ key: 'final', icon: <UiGlyph name="crown" tone="gold" flat />, text: t('armory.drops.final'), tone: 'gold' });
  if (isBoss) out.push({ key: 'kills', icon: <UiGlyph name="skull" tone={kills > 0 ? 'gold' : 'pewter'} flat />, text: kills > 0 ? t('armory.drops.defeated', { n: fmtInt(kills) }) : t('armory.drops.notDefeated'), tone: kills > 0 ? 'gold' : 'dim' });
  out.push({ key: 'owned', icon: <UiGlyph name="chest" tone="bronze" flat />, text: `${fmtInt(owned)}/${fmtInt(total)}`, num: true });
  return out;
}

function BossSection({ section, index }: { section: DropTableSection; index: number }): JSX.Element {
  const ix = indexOf();
  const save = metaSave().value;
  const zone = ix.zones.get(section.zone);
  const isBoss = section.kind === 'boss';
  const boss = isBoss ? ix.bosses.get(section.key) : undefined;
  const encounter = zone && isBoss ? (zone.bosses.find((b) => b.boss === section.key) ?? (zone.final.boss === section.key ? zone.final : undefined)) : undefined;
  const final = zone !== undefined && isBoss && zone.final.boss === section.key;
  const kills = isBoss ? (save.stats.bossKills[section.key] ?? 0) : 0;
  const rarity = gearRarity(zone?.gearTier ?? 1);
  const owned = section.entries.filter((e) => e.owned).length;
  const portrait = isBoss && iconUrl(`icon_enemy_${section.key}`) !== null;
  return (
    <article class={`ms-drp-boss ms-tray ms-r-${rarity} ${final ? 'is-final' : ''}`} style={{ '--i': index } as JSX.CSSProperties}>
      <header class="ms-drp-boss-head">
        {portrait ? (
          <IconSlot size="xl" icon={`icon_enemy_${section.key}`} kind="misc" rarity={rarity} class="ms-drp-portrait" />
        ) : (
          <BeastFace
            size="lg"
            rarity={rarity}
            class="ms-drp-face"
            fallback={<UiGlyph name={isBoss ? (final ? 'crown' : 'skull') : 'chest'} tone={isBoss ? (final ? 'gold' : 'crimson') : 'bronze'} />}
          />
        )}
        <div class="ms-drp-boss-id">
          <h3 class="ms-head ms-rc">{isBoss ? enemyName(section.key) : t('armory.drops.zoneLoot')}</h3>
          <p class="ms-drp-boss-sub">{isBoss ? (boss ? tl(boss.title) : '') : t('armory.drops.zoneLootSub')}</p>
          <DataStrip class="ms-drp-boss-tags" items={stripFor(encounter?.at, final, isBoss, kills, owned, section.entries.length)} />
        </div>
      </header>
      <div class="ms-drp-pieces">
        {section.entries.map((e) => (
          <PieceTile key={e.def.id} entry={e} />
        ))}
      </div>
    </article>
  );
}

export function DropTablesTab(): JSX.Element {
  const { content } = deps();
  const save = metaSave().value;
  const classId = armoryClass.value;
  const [diff, setDiff] = useState<Difficulty>('normal');
  const statuses = zoneStatuses(save, content);
  const focus = armoryDropZone.value;
  const selected = statuses.find((s) => s.zone.id === focus) ?? statuses[0];
  const sections = dropTableFor(save, content, classId, diff);
  const mine = selected ? sections.filter((s) => s.zone === selected.zone.id) : [];
  const reward = content.balance.hard.reward;
  const pity = save.classes[classId].pity;
  const art = selected ? zoneArtUrl(selected.zone) : null;
  const zone = selected?.zone;
  const zonesRef = useRef<HTMLDivElement>(null);
  // phone portrait: the zone strip swipes sideways; every other tier (landscape phone) scrolls the column
  useScrollFade(zonesRef, { axis: layout.value.portrait ? 'x' : 'y' });
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);

  return (
    <div class="ms-drp">
      <Win class="ms-drp-side" title={t('armory.drops.zonesTitle')} bodyClass="ms-drp-side-win">
        <div class="ms-drp-mode" role="radiogroup" aria-label={t('armory.drops.modeTitle')}>
          <Plate on={diff === 'normal'} onClick={() => setDiff('normal')}>
            {t('armory.drops.normal')}
          </Plate>
          <Plate on={diff === 'hard'} onClick={() => setDiff('hard')}>
            {t('armory.drops.hard', { x: fmtDec(reward, 1) })}
          </Plate>
        </div>
        <div class="ms-drp-zones ms-scroll" ref={zonesRef}>
          {statuses.map((st, i) => {
            const c = counts(sections, st.zone.id);
            return (
              <ZoneButton
                key={st.zone.id}
                st={st}
                active={st.zone.id === selected?.zone.id}
                owned={c.owned}
                total={c.total}
                index={i}
                onPick={() => {
                  sfx('tab');
                  armoryDropZone.value = st.zone.id;
                }}
              />
            );
          })}
        </div>
        <div class="ms-drp-pity" {...tipProps(() => <TipBody title={t('armory.drops.pityTitle')} body={t('armory.drops.pityTip', { n: PITY_GUARANTEE })} />)}>
          <span class="ms-drp-pity-head">
            <span class="ms-eyebrow">{t('armory.drops.pityTitle')}</span>
            <small class="ms-num">
              {fmtInt(Math.min(pity, PITY_GUARANTEE))} / {fmtInt(PITY_GUARANTEE)}
            </small>
          </span>
          <ArmGauge kind="gold" ch="0.8rem" value={Math.min(1, pity / PITY_GUARANTEE)} ticks={PITY_GUARANTEE} title={`${fmtInt(Math.min(pity, PITY_GUARANTEE))} / ${fmtInt(PITY_GUARANTEE)}`} />
        </div>
      </Win>

      <Win class="ms-drp-main" title={t('armory.tab.drops')} bodyClass="ms-drp-main-win">
        <div class="ms-drp-view" key={selected?.zone.id ?? 'none'}>
          {zone && (
            <div class={`ms-drp-banner ms-r-${gearRarity(zone.gearTier)}`} style={art ? ({ '--art': `url("${art}")` } as JSX.CSSProperties) : undefined}>
              <div class="ms-drp-banner-text">
                <span class="ms-eyebrow">{t('armory.drops.zoneEyebrow', { n: zone.order })}</span>
                <h2 class="ms-title">{tl(zone.name)}</h2>
                <p>{tl(zone.subtitle)}</p>
              </div>
              <DataStrip
                class="ms-drp-banner-tags"
                items={[
                  { key: 'tier', text: t('gear.tier', { n: zone.gearTier }), cls: `ms-r-${gearRarity(zone.gearTier)} ms-rc` },
                  { key: 'rew', text: t('armory.drops.reward', { x: diff === 'hard' ? fmtDec(reward, 1) : '1' }), tone: 'gold', num: true },
                  ...(selected && !selected.unlocked ? [{ key: 'lock', icon: <UiGlyph name="lock" tone="crimson" flat />, text: t('common.locked'), tone: 'red' as const }] : []),
                ]}
              />
            </div>
          )}
          <div class="ms-drp-list ms-scroll" ref={listRef}>
            <p class="ms-drp-intro">{t('armory.drops.intro')}</p>
            {mine.length === 0 ? <p class="ms-muted ms-drp-empty">{t('armory.drops.empty')}</p> : mine.map((s, i) => <BossSection key={`${s.kind}-${s.key}`} section={s} index={i} />)}
          </div>
        </div>
      </Win>
    </div>
  );
}
