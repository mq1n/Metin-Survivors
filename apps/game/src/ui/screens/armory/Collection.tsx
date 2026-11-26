// Armory · Collection: the collection log for the viewed class as an inventory lattice: one row per gear tier (a tier plate with
// its zone and tube), one column per slot, octagon bays that share their edges (round 3; it used to be sparse table cells).
// Owned pieces are lit with their rarity rim (click = equip); pieces still out there stay readable at ~40 % brightness and open
// the drop table of the zone they come from. Phone portrait stacks one 5-wide lattice block per tier.
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { ClassId, GearDef, GearSlot, Rarity } from '../../../data/schema';
import { GEAR_SLOTS } from '../../../data/schema';
import { fmtInt, fmtPct, t, tl } from '../../../i18n/i18n';
import { collectablePieces, collectionProgress, ownedPieces, type OwnedPiece } from '../../../meta';
import { texUrl } from '../../assets';
import { sfx } from '../../audio';
import { UiGlyph } from '../../components/StatIcon';
import { useScrollFade } from '../../components/ScrollFade';
import { IconSlot } from '../../components/Slot';
import { StatWell } from '../../components/StatWell';
import { TipBody, tipProps } from '../../components/Tooltip';
import { enemyName, indexOf, zoneName } from '../../content';
import { deps } from '../../env';
import { buildTip, gearRarity } from '../../itemTips';
import { armoryTab, metaSave, pushToast } from '../../view';
import { armoryClass, armoryDropZone } from './state';
import { ArmGauge, type ArmGaugeKind } from './ArmGauge';
import { Win } from './Win';
import './armory-coll.css';

/** Tooltip rows telling where a piece comes from: boss, zone, per-roll chance. */
export function gearSourceRows(def: GearDef): { label: string; value: string }[] {
  const { boss, zone, chance } = def.source;
  return [
    boss ? { label: t('armory.src.boss'), value: enemyName(boss) } : { label: t('armory.src.source'), value: t('armory.src.zoneLoot') },
    { label: t('armory.src.zone'), value: zoneName(zone) },
    { label: t('armory.src.chance'), value: fmtPct(chance, 0) },
  ];
}

/** Jumps to the Drop Tables tab focused on the zone a piece drops in. */
export function showDrops(zone: string): void {
  sfx('click');
  armoryDropZone.value = zone;
  armoryTab.value = 'drops';
}

interface CellProps {
  def: GearDef;
  owned: OwnedPiece | undefined;
  classId: ClassId;
  index: number;
}

/** One lattice cell: an octagon bay holding the piece; a bare white +N numeral bottom-right, a gold tick for the worn piece. */
function LogCell({ def, owned, classId, index }: CellProps): JSX.Element {
  const rarity = gearRarity(def.tier);
  const equipped = owned?.equipped === true;
  const plus = owned?.plus ?? 0;
  const sock = texUrl('uk_armory_a_socket');
  const onClick = (): void => {
    if (!owned) {
      showDrops(def.source.zone);
      return;
    }
    if (equipped) return;
    const r = deps().meta.equip(classId, def.id);
    if (r.ok) sfx('equip');
    else pushToast(t('armory.error'), 'bad');
  };
  return (
    <button
      type="button"
      class={`ms-col-cell ms-r-${rarity} ${owned ? 'is-owned' : 'is-locked'} ${equipped ? 'is-eq' : ''} ${sock ? 'has-sock' : ''}`}
      style={{ '--i': index, ...(sock ? { '--tex-sock': `url("${sock}")` } : {}) } as JSX.CSSProperties}
      data-nav=""
      aria-label={`${tl(def.name)}${owned ? '' : ` (${t('armory.drops.notYet')})`}`}
      onClick={onClick}
      {...tipProps(
        () =>
          owned ? (
            <>
              {buildTip({ type: 'gear', id: def.id, plus: owned.plus })}
              <div class="ms-tip-sub" style={{ marginTop: '0.5rem' }}>
                {equipped ? t('armory.tip.equipped') : t('armory.tip.equipHint')}
              </div>
            </>
          ) : (
            <TipBody title={tl(def.name)} sub={`${t(`gear.slot.${def.slot}`)} · ${t('gear.tier', { n: def.tier })}`} body={t('armory.tip.notOwned')} rows={gearSourceRows(def)} foot={t('armory.tip.lockedHint')} />
          ),
        { rarity },
      )}
    >
      <span class="ms-col-art">
        <IconSlot size="lg" icon={def.icon} kind="gear" slot={def.slot} rarity={rarity} locked={!owned} selected={equipped} class="ms-col-tile" />
        {plus > 0 && <b class="ms-col-plus ms-num">+{plus}</b>}
        {equipped && (
          <i class="ms-col-tick" aria-hidden="true">
            <UiGlyph name="check" tone="gold" flat />
          </i>
        )}
      </span>
    </button>
  );
}

/** tier colour -> painted liquid (gold / red / blue) plus a hue turn done in CSS (`.ms-col-th.ms-r-<rarity>`) */
const TIER_LIQUID: Record<string, ArmGaugeKind> = { common: 'gold', uncommon: 'gold', rare: 'blue', epic: 'blue', legendary: 'gold' };

function TierHead({ tier, zone, owned, total, rarity }: { tier: number; zone: string; owned: number; total: number; rarity: Rarity }): JSX.Element {
  return (
    <div class={`ms-col-th ms-plate ms-r-${rarity}`} {...tipProps(() => <TipBody title={t('gear.tier', { n: tier })} sub={zone} rows={[{ label: t('armory.piecesLabel'), value: `${fmtInt(owned)} / ${fmtInt(total)}` }]} />)}>
      <div class="ms-col-th-top">
        <b class="ms-head ms-rc">{t('gear.tier', { n: tier })}</b>
        <span class="ms-col-th-count ms-num">
          {fmtInt(owned)}/{fmtInt(total)}
        </span>
      </div>
      <span class="ms-col-th-zone">{zone}</span>
      <ArmGauge kind={TIER_LIQUID[rarity] ?? 'gold'} ch="0.5rem" value={total > 0 ? owned / total : 0} class="ms-col-th-bar" title={`${fmtInt(owned)} / ${fmtInt(total)}`} />
    </div>
  );
}

/** the closing strip when every piece is found: the laurel plate, the sentence and three number wells */
function Done({ pieces, owned, total }: { pieces: GearDef[]; owned: Map<string, OwnedPiece>; total: number }): JSX.Element {
  const sealTex = texUrl('uk_online_rank_plates');
  let sum = 0;
  let best: { def: GearDef; plus: number } | undefined;
  for (const g of pieces) {
    const p = owned.get(g.id);
    if (!p) continue;
    sum += p.plus;
    if (!best || p.plus > best.plus) best = { def: g, plus: p.plus };
  }
  return (
    <div class="ms-coll-done ms-anim-scale">
      <i class="ms-coll-seal" aria-hidden="true" style={sealTex ? ({ '--tex-seal': `url("${sealTex}")` } as JSX.CSSProperties) : undefined} />
      <div class="ms-coll-done-text">
        <p>
          <UiGlyph name="crown" tone="gold" flat /> {t('armory.coll.complete')}
        </p>
        <div class="ms-coll-done-wells">
          <StatWell layout="stack" size="md" label={t('armory.piecesLabel')} value={`${fmtInt(owned.size)} / ${fmtInt(total)}`} tone="gold" />
          <StatWell layout="stack" size="md" label={t('armory.coll.refined')} value={`+${fmtInt(sum)}`} />
          {best && best.plus > 0 && <StatWell layout="stack" size="md" label={t('armory.coll.best')} value={`+${fmtInt(best.plus)}`} title={tl(best.def.name)} />}
        </div>
      </div>
    </div>
  );
}

export function CollectionTab(): JSX.Element {
  const { content } = deps();
  const ix = indexOf();
  const save = metaSave().value;
  const classId = armoryClass.value;
  const all = collectablePieces(content, classId);
  const owned = new Map(ownedPieces(save, content, classId).map((p) => [p.def.id, p]));
  const progress = collectionProgress(save, content, classId);
  const tiers = [...new Set(all.map((g) => g.tier))].sort((a, b) => a - b);
  const slotOrder = (s: GearSlot): number => GEAR_SLOTS.indexOf(s);
  const missing = all.filter((g) => !owned.has(g.id)).sort((a, b) => a.tier - b.tier || slotOrder(a.slot) - slotOrder(b.slot));
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  const gridRef = useRef<HTMLDivElement>(null);
  useScrollFade(gridRef);

  // columns = the gear slots that exist for this class (a slot with two pieces per tier, such as the weapons, gets two columns)
  const byTier = tiers.map((tier) => all.filter((g) => g.tier === tier).sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot)));
  const cols = GEAR_SLOTS.map((slot) => ({ slot, n: Math.max(0, ...byTier.map((list) => list.filter((g) => g.slot === slot).length)) })).filter((c) => c.n > 0);
  const ncols = cols.reduce((a, c) => a + c.n, 0);
  let k = 0;

  return (
    <div class={`ms-coll ${missing.length === 0 ? 'is-complete' : ''}`}>
      <Win class="ms-coll-log" title={t('armory.coll.title')} bodyClass="ms-coll-log-win">
        <div class="ms-coll-scroll ms-scroll" ref={gridRef}>
          <div class="ms-coll-lat" style={{ '--nc': ncols, '--nt': tiers.length } as JSX.CSSProperties}>
            <div class="ms-col-heads" aria-hidden="true">
              <span class="ms-col-corner" />
              <span class="ms-col-slots">
                {cols.map((c) => (
                  <span key={c.slot} class="ms-col-sh" style={{ gridColumn: `span ${c.n}` }} title={t(`gear.slot.${c.slot}`)}>
                    {t(`gear.slotShort.${c.slot}`)}
                  </span>
                ))}
              </span>
            </div>
            {tiers.map((tier, ti) => {
              const list = byTier[ti] ?? [];
              const zone = ix.zonesOrdered.find((z) => z.gearTier === tier);
              return (
                <div class="ms-col-row" key={tier}>
                  <TierHead tier={tier} zone={zone ? tl(zone.name) : ''} owned={list.filter((g) => owned.has(g.id)).length} total={list.length} rarity={gearRarity(tier)} />
                  <div class="ms-col-cells">
                    {cols.flatMap((c) => {
                      const mine = list.filter((g) => g.slot === c.slot);
                      return Array.from({ length: c.n }, (_, i) => {
                        const g = mine[i];
                        k += 1;
                        return g ? <LogCell key={g.id} def={g} owned={owned.get(g.id)} classId={classId} index={k} /> : <span key={`${c.slot}-${i}`} class="ms-col-void" aria-hidden="true" />;
                      });
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div class="ms-coll-foot">
          <p class="ms-coll-hint">
            <span class="ms-hover-only">{t('armory.coll.hint')}</span>
            <span class="ms-touch-only">{t('armory.coll.hintTouch')}</span>
          </p>
          <div class="ms-coll-total">
            <ArmGauge kind="gold" ch="1.05rem" value={progress.total > 0 ? progress.owned / progress.total : 0} label={`${fmtInt(progress.owned)} / ${fmtInt(progress.total)}`} ticks={tiers.length * 2} title={`${fmtInt(progress.owned)} / ${fmtInt(progress.total)}`} />
          </div>
        </div>
      </Win>

      <Win class="ms-coll-todo" title={missing.length === 0 ? t('armory.coll.doneTitle') : t('armory.coll.stillTitle')} bodyClass="ms-coll-todo-win">
        {missing.length === 0 ? (
          <Done pieces={all} owned={owned} total={progress.total} />
        ) : (
          <>
            <p class="ms-coll-todo-count">{t('armory.coll.stillCount', { n: fmtInt(missing.length) })}</p>
            <div class="ms-coll-todo-list ms-scroll" ref={listRef}>
              {missing.map((g, i) => {
                const rarity = gearRarity(g.tier);
                return (
                  <button
                    key={g.id}
                    type="button"
                    class={`ms-coll-todo-row ms-plate ms-r-${rarity}`}
                    style={{ '--i': Math.min(i, 12) } as JSX.CSSProperties}
                    data-nav=""
                    onClick={() => showDrops(g.source.zone)}
                    {...tipProps(() => <TipBody title={tl(g.name)} sub={`${t(`gear.slot.${g.slot}`)} · ${t('gear.tier', { n: g.tier })}`} rows={gearSourceRows(g)} foot={t('armory.tip.lockedHint')} />, { rarity })}
                  >
                    <IconSlot size="sm" icon={g.icon} kind="gear" slot={g.slot} locked class="ms-col-tile is-locked" />
                    <span class="ms-coll-todo-text">
                      <b class="ms-rc">{tl(g.name)}</b>
                      <small>
                        {g.source.boss ? enemyName(g.source.boss) : t('armory.src.zoneLoot')} · {zoneName(g.source.zone)}
                      </small>
                    </span>
                    <StatWell size="sm" value={fmtPct(g.source.chance, 0)} class="ms-coll-todo-chance" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Win>
    </div>
  );
}
