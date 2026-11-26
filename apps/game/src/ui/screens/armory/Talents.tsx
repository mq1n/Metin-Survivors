
// nodes with a grade chain 1 > 2 > 3 and a level numeral, carved prerequisite lines, engraved milestone plates, painted tube
// gauges), plus the talent-point board (XP gauge, earned / spent / cap wells, respec, controls). Wells use the pebbled granite
// tile (never the lattice); the spend / refund marks are bevelled lacquer plates beside the node, not stamps over its art. Allocation goes through
// MetaService (`allocateTalent` / `refundTalent` / `respecTalents`); everything shown is derived from `treeView`.
// Layout is decided by the pane width (container queries in talents.css): three boards wide, one tree + points board at
// tablet / phone landscape (tree tabs), one stacked column in portrait.
import { signal } from '@preact/signals';
import { Fragment, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ClassId, DoctrineKey, Element, SkillDef, StatMods, TalentNode } from '../../../data/schema';
import { fmtDec, fmtInt, lang, t, tl } from '../../../i18n/i18n';
import { addStatMods, availablePoints, earnedPoints, pointsForXp, spentTotal, talentCap, talentCapView, talentProgress, treeView, type MilestoneView, type NodeView, type RowView, type TreeView } from '../../../meta';
import { iconForm, portraitUrl } from '../../assets';
import { Button, Tabs } from '../../components/Button';
import { Segmented } from '../../components/Controls';
import { Glyph, type GlyphName } from '../../components/glyphs';
import { CLASS_COLOR, ClassEmblem, IconArt, pickGlyph } from '../../components/Icon';
import { Confirm } from '../../components/Modal';
import { KitCtx } from '../../components/Panel';
import { Counter, KeyHint } from '../../components/Slot';
import { StatIcon } from '../../components/StatIcon';
import { StatWell } from '../../components/StatWell';
import { TitleBar } from '../../components/TitleBar';
import { hideTip, tipProps, TipBody } from '../../components/Tooltip';
import { Burst } from '../../components/UiFx';
import { className, indexOf, skillDescription, skillName, statModRows, zoneName } from '../../content';
import { deps } from '../../env';
import { layout } from '../../layout';
import { sfx } from '../../audio';
import { useKeys } from '../../nav';
import { metaSave, pushToast } from '../../view';
import { ArmGauge, useArmTex } from './ArmGauge';
import { chainState } from './refine';
import { armoryClass, armoryDoctrine, armorySex } from './state';
import './talents.css';

const KEYS: readonly DoctrineKey[] = ['a', 'b'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

type Mode = 'add' | 'refund';
/** touch "tap mode" (spend / refund); desktop uses click / right-click / Shift-click */
const tapMode = signal<Mode>('add');
/** which tree the one-tree layouts show (null = the doctrine in use) */
const shownTree = signal<DoctrineKey | null>(null);

// ---------------------------------------------------------------------------------------------------------------
// Node art: the painted `icon_talent_*` when the manifest has it, otherwise a tile that matches what the talent does.

const STAT_ART: Record<string, [GlyphName, Element]> = {
  maxHpPct: ['heart', 'holy'],
  maxHp: ['heart', 'holy'],
  regen: ['heart', 'poison'],
  damage: ['sword', 'physical'],
  armor: ['shield', 'physical'],
  luck: ['eye', 'holy'],
  yeopGain: ['coin', 'holy'],
  critChance: ['fist', 'fire'],
  critDamage: ['fist', 'fire'],
  cooldown: ['clock', 'ice'],
  xpGain: ['star', 'wind'],
  evasion: ['wind', 'wind'],
  moveSpeed: ['boot', 'wind'],
  projSpeed: ['bow', 'lightning'],
  pickupRadius: ['ring', 'holy'],
  lifesteal: ['drop', 'dark'],
  attackSpeed: ['bolt', 'lightning'],
};

const EFFECT_ART: Record<string, [GlyphName, Element]> = {
  rerolls: ['orb', 'holy'],
  banishes: ['skull', 'dark'],
  skips: ['wind', 'wind'],
  startLevel: ['crown', 'holy'],
};

function nodeArt(node: TalentNode): { glyph: GlyphName; element: Element } {
  const eff = node.effect;
  if (eff) {
    const [kind, ref] = eff.kind.split(':');
    if (kind === 'skillMod' && ref) {
      const sk = indexOf().skills.get(ref);
      const p = pickGlyph(ref, 'skill');
      return { glyph: p.glyph, element: sk?.element ?? p.element };
    }
    const e = kind ? EFFECT_ART[kind] : undefined;
    if (e) return { glyph: e[0], element: e[1] };
  }
  const stat = Object.keys(node.perPoint ?? {})[0];
  const s = stat ? STAT_ART[stat] : undefined;
  if (s) return { glyph: s[0], element: s[1] };
  return pickGlyph(node.icon, 'talent');
}

// ---------------------------------------------------------------------------------------------------------------
// Tooltips (components, so they re-render live when the save changes while the tip is open)

function NodeTip({ classId, dk, nodeId }: { classId: ClassId; dk: DoctrineKey; nodeId: string }): JSX.Element {
  const { content } = deps();
  const save = metaSave().value;
  lang.value;
  const cs = save.classes[classId];
  const view = treeView(content, cs, classId, dk, talentCap(save));
  const nv = view?.nodes.find((n) => n.node.id === nodeId);
  if (!view || !nv) return <TipBody title={nodeId} />;
  const n = nv.node;
  const per = n.perPoint ? statModRows(n.perPoint) : [];
  const total = nv.points > 0 && n.perPoint ? statModRows(n.perPoint, nv.points) : [];
  const row = view.rows.find((r) => r.row === n.row);
  const touch = layout.value.touch;
  let status: { tone: 'good' | 'bad' | 'dim'; text: string } | null = null;
  if (nv.state === 'rowLocked' && row) status = { tone: 'bad', text: t('talents.node.rowLocked', { n: Math.max(1, row.needed - row.have) }) };
  else if (nv.state === 'requiresLocked' && n.requires) status = { tone: 'bad', text: t('talents.node.requires', { name: nodeName(view, n.requires) }) };
  else if (nv.state === 'noPoints') status = { tone: 'bad', text: t('talents.node.noPoints') };
  else if (nv.state === 'maxed') status = { tone: 'good', text: t('talents.node.maxed') };
  else status = { tone: 'good', text: t('talents.node.canSpend') };
  return (
    <>
      <div class="ms-tip-title">{tl(n.name)}</div>
      <div class="ms-tip-sub">
        {t('talents.node.rank', { n: nv.points, max: n.max })}
        {row ? ` · ${t('talents.row.label', { n: row.rank + 1 })}` : ''}
      </div>
      <div class="ms-tip-body">{tl(n.desc)}</div>
      {per.length > 0 && (
        <div class="ms-tip-rows">
          <div class="tal-tip-h">{t('talents.node.perPoint')}</div>
          {per.map((r, i) => (
            <div class="ms-tip-row" key={i}>
              <span>{r.label}</span>
              <b class={r.positive ? '' : 'is-bad'}>{r.value}</b>
            </div>
          ))}
        </div>
      )}
      {total.length > 0 && (
        <div class="ms-tip-rows">
          <div class="tal-tip-h">{t('talents.node.atRank')}</div>
          {total.map((r, i) => (
            <div class="ms-tip-row" key={i}>
              <span>{r.label}</span>
              <b class={r.positive ? '' : 'is-bad'}>{r.value}</b>
            </div>
          ))}
        </div>
      )}
      {status && <div class={`tal-tip-status is-${status.tone}`}>{status.text}</div>}
      {nv.points > 0 && !nv.canRefund && <div class="tal-tip-status is-bad">{t('talents.node.refundBlocked')}</div>}
      {nv.canRefund && <div class="tal-tip-status is-dim">{touch ? t('talents.node.canRefundTouch') : t('talents.node.canRefund')}</div>}
    </>
  );
}

function nodeName(view: TreeView, id: string): string {
  const n = view.nodes.find((x) => x.node.id === id);
  return n ? tl(n.node.name) : id;
}

function RowTip({ row }: { row: RowView }): JSX.Element {
  lang.value;
  const n = row.rank + 1;
  return (
    <TipBody
      title={t('talents.row.label', { n })}
      body={row.needed === 0 ? t('talents.row.tipFirst') : row.unlocked ? t('talents.row.tipOpen', { n }) : t('talents.row.tipLocked', { n, needed: row.needed, have: row.have })}
    />
  );
}

function MilestoneTip({ m, def, missing }: { m: MilestoneView; def: SkillDef | undefined; missing: number }): JSX.Element {
  lang.value;
  const rows: { label: string; value: string }[] = [];
  if (def) {
    const p = def.params;
    if (p.damage > 0) rows.push({ label: t('stat.damage'), value: fmtInt(p.damage) });
    if (p.cooldown > 0) rows.push({ label: t('stat.cooldown'), value: `${fmtDec(p.cooldown, 1)} s` });
  }
  return (
    <>
      <div class="ms-tip-title">{def ? tl(def.name) : t('talents.mile.at', { n: m.at })}</div>
      <div class="ms-tip-sub">{`${t('talents.mile.at', { n: m.at })}${def ? ` · ${t(`element.${def.element}`)}` : ''}`}</div>
      <div class="ms-tip-body">{m.effect ? tl(m.effect) : def ? skillDescription(def) : ''}</div>
      {rows.length > 0 && (
        <div class="ms-tip-rows">
          {rows.map((r, i) => (
            <div class="ms-tip-row" key={i}>
              <span>{r.label}</span>
              <b>{r.value}</b>
            </div>
          ))}
        </div>
      )}
      <div class={`tal-tip-status is-${m.reached ? 'good' : 'bad'}`}>{m.reached ? t('talents.mile.tipReached') : t('talents.mile.tipLocked', { n: missing })}</div>
    </>
  );
}

/** carved plus / minus of the spend / refund plates */
function PlusMark(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.5 1.1h3v3.4h3.4v3H7.5v3.4h-3V7.5H1.1v-3h3.4z" />
    </svg>
  );
}
function MinusMark(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.2 4.5h9.6v3H1.2z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Node: an octagon socket of the kit (ms-slot--k) whose rim follows the grade 1 > 2 > 3, a chain of three grade pips
// straddling its lower edge, the level numeral bottom-right and a bevelled lacquer "+" plate on its corner while a point can be spent.

interface NodeProps {
  classId: ClassId;
  dk: DoctrineKey;
  nv: NodeView;
  act: (dk: DoctrineKey, nodeId: string, refund: boolean, el: HTMLElement | null) => void;
  col: number;
  rowIndex: number;
}

const POP: Keyframe[] = [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.4 }, { transform: 'scale(1)' }];

function TalentNodeBtn({ classId, dk, nv, act, col, rowIndex }: NodeProps): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const prev = useRef(nv.points);
  const lp = useRef<{ timer?: number; fired: number }>({ fired: -1e9 });
  const [burst, setBurst] = useState(0);
  const n = nv.node;
  const art = nodeArt(n);

  useEffect(() => {
    if (nv.points > prev.current) {
      setBurst((b) => b + 1);
      ref.current?.animate(POP, { duration: 380, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.3)' });
    }
    prev.current = nv.points;
  }, [nv.points]);
  useEffect(() => () => window.clearTimeout(lp.current.timer), []);

  const tp = tipProps(() => <NodeTip classId={classId} dk={dk} nodeId={n.id} />);
  const locked = nv.state === 'rowLocked' || nv.state === 'requiresLocked';
  const maxed = nv.state === 'maxed';
  const refundMode = tapMode.value === 'refund';
  const cancelLp = (): void => window.clearTimeout(lp.current.timer);
  const form = iconForm(n.icon) ?? 'legacy';
  const chain = chainState(nv.points, n.max, nv.state === 'available');
  const cls = [
    'ms-slot',
    'ms-slot--k',
    `ms-slot--${form}`,
    locked ? 'ms-slot--locked' : '',
    'tal-node',
    `tal-node--${nv.state}`,
    `tal-g${Math.min(nv.points, 3)}`,
    nv.points > 0 ? 'is-ranked' : '',
    refundMode ? (nv.canRefund ? 'is-refundable' : 'is-inert') : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div class="tal-cell" style={{ gridRow: rowIndex + 1, gridColumn: col + 2, '--i': rowIndex * 3 + col } as JSX.CSSProperties}>
      <button
        ref={ref}
        type="button"
        class={cls}
        data-nav=""
        data-tree={dk}
        data-node={n.id}
        aria-label={t('talents.node.aria', { name: tl(n.name), n: nv.points, max: n.max })}
        {...tp}
        onPointerDown={(e) => {
          tp.onPointerDown(e);
          if (e.pointerType !== 'mouse' && nv.canRefund) {
            cancelLp();
            lp.current.timer = window.setTimeout(() => {
              lp.current.fired = performance.now();
              hideTip();
              act(dk, n.id, true, ref.current);
            }, 650);
          }
        }}
        onPointerUp={(e) => {
          tp.onPointerUp(e);
          cancelLp();
        }}
        onPointerCancel={() => {
          tp.onPointerCancel();
          cancelLp();
        }}
        onPointerLeave={() => {
          tp.onPointerLeave();
          cancelLp();
        }}
        onClick={(e) => {
          if (performance.now() - lp.current.fired < 800) return;
          act(dk, n.id, tapMode.value === 'refund' || e.shiftKey, ref.current);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (performance.now() - lp.current.fired < 1000) return;
          act(dk, n.id, true, ref.current);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '-' || e.key === '_') {
            e.preventDefault();
            e.stopPropagation();
            act(dk, n.id, true, ref.current);
          }
        }}
      >
        <span class="ms-slot-fx">
          <span class="ms-slot-frame ms-plate">
            <span class="ms-slot-art">
              <IconArt id={n.icon} kind="talent" glyph={art.glyph} element={art.element} alt={tl(n.name)} />
            </span>
          </span>
        </span>
        {locked && (
          <span class="ms-slot-lock" aria-hidden="true">
            <Glyph name={nv.state === 'requiresLocked' ? 'link' : 'lock'} />
          </span>
        )}
        {nv.points > 0 && (
          <span class={`tal-lv ${maxed ? 'is-max' : ''}`} aria-hidden="true">
            {nv.points}
          </span>
        )}
        {refundMode && nv.canRefund && (
          <span class="tal-minus ms-plate" aria-hidden="true">
            <MinusMark />
          </span>
        )}
        {!refundMode && nv.state === 'available' && (
          <span class="tal-plus ms-plate" aria-hidden="true">
            <PlusMark />
          </span>
        )}
      </button>
      <span class={`tal-chain ${maxed ? 'is-max' : ''}`} aria-hidden="true">
        {Array.from({ length: n.max }, (_, i) => (
          <Fragment key={i}>
            <i class={`tal-pip tal-pip--${i + 1} ${i < chain.lit ? 'is-on' : ''} ${i === chain.next ? 'is-next' : ''}`} />
            {i < n.max - 1 && <b class={`tal-arr ${i + 1 < nv.points ? 'is-on' : ''}`} />}
          </Fragment>
        ))}
      </span>
      {burst > 0 && <Burst key={burst} play={burst} tone="gold" scale={0.5} sparks={20} halo={false} class="tal-burst" />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Row rail (gate) · milestone

function RowRail({ row, index }: { row: RowView; index: number }): JSX.Element {
  const prevOpen = useRef(row.unlocked);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (row.unlocked && !prevOpen.current) setFlash((n) => n + 1);
    prevOpen.current = row.unlocked;
  }, [row.unlocked]);
  const frac = row.needed > 0 ? Math.min(1, row.have / row.needed) : 1;
  return (
    <div class={`tal-rail ${row.unlocked ? 'is-open' : 'is-locked'}`} style={{ gridRow: index + 1, gridColumn: 1 }} {...tipProps(() => <RowTip row={row} />)}>
      <span class="tal-rail-num ms-plate">{ROMAN[index] ?? index + 1}</span>
      {row.unlocked ? (
        <span class="tal-rail-state">{t('talents.row.open')}</span>
      ) : (
        <>
          <span class="tal-rail-state">
            <Glyph name="lock" />
            {t('talents.row.need', { have: row.have, needed: row.needed })}
          </span>
          <ArmGauge thin kind="gold" ch="0.5rem" value={frac} class="tal-rail-gauge" />
        </>
      )}
      {flash > 0 && <span key={flash} class="tal-rail-flash" />}
    </div>
  );
}

/** An engraved milestone plate: octagon socket with the unlocked skill, "N points", the skill name, a thin gauge. */
function Milestone({ m, spent }: { m: MilestoneView; spent: number }): JSX.Element {
  const def = m.skill ? indexOf().skills.get(m.skill) : undefined;
  const missing = Math.max(0, m.at - spent);
  const frac = Math.min(1, spent / m.at);
  const name = def ? tl(def.name) : m.skill ? skillName(m.skill) : m.effect ? tl(m.effect) : '';
  return (
    <button type="button" class={`tal-plate ms-plate ${m.reached ? 'is-reached' : ''}`} data-nav="" {...tipProps(() => <MilestoneTip m={m} def={def} missing={missing} />)}>
      <i class="tal-plate-orn" aria-hidden="true" />
      <span class={`tal-plate-slot ms-slot ms-slot--k ms-slot--${iconForm(def?.icon ?? `milestone_${m.at}`) ?? 'legacy'} ${m.reached ? 'ms-r-legendary' : 'ms-slot--locked'}`}>
        <span class="ms-slot-fx">
          <span class="ms-slot-frame ms-plate">
            <span class="ms-slot-art">
              <IconArt id={def?.icon ?? `milestone_${m.at}`} kind="skill" {...(def ? { element: def.element } : {})} alt={name} />
            </span>
          </span>
        </span>
        {!m.reached && (
          <span class="ms-slot-lock" aria-hidden="true">
            <Glyph name="lock" />
          </span>
        )}
      </span>
      <span class="tal-plate-txt">
        <span class="tal-plate-at">
          <span class="tal-at-full">{t('talents.mile.at', { n: m.at })}</span>
          <span class="tal-at-short">{t('talents.mile.short', { n: m.at })}</span>
        </span>
        <span class="tal-plate-name">{name}</span>
        <span class="tal-plate-state">{m.reached ? t('talents.mile.reached') : t('talents.mile.more', { n: missing })}</span>
        <ArmGauge kind="gold" ch="0.62rem" value={frac} class="tal-plate-gauge" />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tree board

interface TreePanelProps {
  classId: ClassId;
  dk: DoctrineKey;
  view: TreeView;
  active: boolean;
  doctrineName: string;
  emblem: GlyphName;
  act: NodeProps['act'];
  onReset: (dk: DoctrineKey) => void;
  avail: number;
  shown: boolean;
  /** the tree tabs again, shown inside the strip on phones in landscape (the tab row above is hidden there) */
  sw: JSX.Element;
}

function TreePanel({ classId, dk, view, active, doctrineName, emblem, act, onReset, avail, shown, sw }: TreePanelProps): JSX.Element {
  const rankOf = new Map(view.rows.map((r, i) => [r.row, i]));
  const byId = new Map(view.nodes.map((n) => [n.node.id, n]));
  const edges = view.nodes
    .filter((n) => n.node.requires !== undefined)
    .map((n) => {
      const from = byId.get(n.node.requires as string);
      if (!from) return null;
      return {
        id: n.node.id,
        x1: from.node.col + 0.5,
        y1: (rankOf.get(from.node.row) ?? 0) + 0.5,
        x2: n.node.col + 0.5,
        y2: (rankOf.get(n.node.row) ?? 0) + 0.5,
        on: from.points > 0,
        lit: from.points > 0 && n.points > 0,
        wait: n.state === 'requiresLocked',
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const rowsN = view.rows.length;
  const style: Record<string, string> = { '--tc': CLASS_COLOR[classId], '--rows': String(rowsN) };

  return (
    <KitCtx.Provider value={true}>
      <section class={`tal-tree ms-board ms-kit ${active ? 'is-active' : ''} ${shown ? 'is-shown' : ''}`} style={style as JSX.CSSProperties} data-tree-panel={dk}>
        <TitleBar small icon={<Glyph name={emblem} />}>
          {tl(view.tree.name)}
        </TitleBar>
        <div class="tal-tree-in">
          <div class="tal-strip ms-sunken ms-sunken--plain">
            <span class="tal-strip-l">
              <span class={`tal-use ${active ? 'is-on' : ''}`} {...tipProps(() => <TipBody title={doctrineName} body={t(active ? 'talents.tree.activeTip' : 'talents.tree.idleTip')} />)}>
                <i class="tal-gem" aria-hidden="true" />
                <span class="tal-use-w">{active ? t('talents.tree.active') : t('talents.tree.idle')}</span>
              </span>
              <span class="tal-spent">{t('talents.tree.spent', { n: view.spent })}</span>
            </span>
            <span class="tal-tree-sw">{sw}</span>
            <span class="tal-mode-inline">
              <ModeSwitch />
            </span>
            <span class="tal-strip-r">
              <span class={`tal-avail-chip ${avail > 0 ? 'has' : ''}`} {...tipProps(() => <TipBody title={t('talents.toSpend')} />)}>
                <StatWell size="sm" value={fmtInt(avail)} icon={<Glyph name="star" />} tone={avail > 0 ? 'gold' : 'neutral'} />
              </span>
              <Button variant="wood" size="small" class="tal-reset" disabled={view.spent === 0} title={view.spent === 0 ? t('talents.reset.none') : undefined} sound="back" onClick={() => onReset(dk)}>
                <span class="tal-lbl-full">{t('talents.tree.reset')}</span>
                <span class="tal-lbl-short">{t('talents.tree.resetShort')}</span>
              </Button>
            </span>
          </div>

          <div class="tal-field ms-sunken ms-sunken--framed ms-scroll ms-edgefade">
            <div class="tal-grid" style={{ gridTemplateRows: `repeat(${rowsN}, minmax(calc(var(--tn) + 1.9rem), 1fr))` }}>
              {view.rows.map((row, i) => (
                <div key={`b${row.row}`} class={`tal-band ${row.unlocked ? 'is-open' : 'is-locked'}`} style={{ gridRow: i + 1, gridColumn: '1 / -1' }} />
              ))}
              <svg class="tal-links" viewBox={`0 0 3 ${rowsN}`} preserveAspectRatio="none" aria-hidden="true">
                {edges.map((e) => (
                  <Fragment key={e.id}>
                    <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} class="tal-link-groove" />
                    <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} class={`tal-link ${e.on ? 'is-on' : ''} ${e.lit ? 'is-lit' : ''} ${e.wait ? 'is-wait' : ''}`} />
                  </Fragment>
                ))}
              </svg>
              {view.rows.map((row, i) => (
                <RowRail key={`r${row.row}`} row={row} index={i} />
              ))}
              {view.nodes.map((nv) => (
                <TalentNodeBtn key={nv.node.id} classId={classId} dk={dk} nv={nv} act={act} col={nv.node.col} rowIndex={rankOf.get(nv.node.row) ?? nv.node.row} />
              ))}
            </div>
          </div>

          <footer class="tal-miles" aria-label={t('talents.mile.heading')}>
            {view.milestones.map((m) => (
              <Milestone key={m.at} m={m} spent={view.spent} />
            ))}
          </footer>
        </div>
      </section>
    </KitCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Side board

/** An unlocked milestone skill: a small octagon socket with its icon and the name (replaces the flat gold chip). */
function SkillRow({ m }: { m: MilestoneView }): JSX.Element {
  const def = m.skill ? indexOf().skills.get(m.skill) : undefined;
  const id = def?.icon ?? `milestone_${m.at}`;
  const name = m.skill ? skillName(m.skill) : '';
  return (
    <div class="tal-sk">
      <span class={`tal-sk-slot ms-slot ms-slot--k ms-slot--${iconForm(id) ?? 'legacy'} ms-r-legendary`}>
        <span class="ms-slot-fx">
          <span class="ms-slot-frame ms-plate">
            <span class="ms-slot-art">
              <IconArt id={id} kind="skill" {...(def ? { element: def.element } : {})} alt={name} />
            </span>
          </span>
        </span>
      </span>
      <span class="tal-sk-n">{name}</span>
    </div>
  );
}

/** What the points spent in the tree of the chosen doctrine give right now (summed stat nodes + unlocked skills). */
function Bonuses({ view }: { view: TreeView }): JSX.Element {
  lang.value;
  const mods: StatMods = {};
  for (const nv of view.nodes) addStatMods(mods, nv.node.perPoint, nv.points);
  const rows = Object.keys(mods).flatMap((key) => {
    const r = statModRows({ [key]: (mods as Record<string, unknown>)[key] } as StatMods)[0];
    return r ? [{ key, ...r }] : [];
  });
  const skills = view.milestones.filter((m) => m.reached && m.skill);
  return (
    <div class="tal-bonus">
      <div class="tal-block-h">{t('talents.bonus.title', { tree: tl(view.tree.name) })}</div>
      {rows.length === 0 && skills.length === 0 && <p class="tal-text tal-text--dim">{t('talents.bonus.none')}</p>}
      {rows.map((r) => (
        <div class="tal-bonus-row" key={r.key}>
          <StatIcon stat={r.key} size="1.35rem" />
          <span>{r.label}</span>
          <b class={r.positive ? '' : 'is-bad'}>{r.value}</b>
        </div>
      ))}
      {skills.length > 0 && (
        <div class="tal-bonus-skills">
          <span class="tal-bonus-sk-l">{t('talents.bonus.skills')}</span>
          {skills.map((m) => (
            <SkillRow key={m.at} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function HintRows(): JSX.Element {
  lang.value;
  return (
    <>
      <div class="tal-hint">
        <span class="tal-hint-k">
          <KeyHint k={t('talents.key.click')} />
          <KeyHint k="Enter" />
        </span>
        <span>{t('talents.hint.spend')}</span>
      </div>
      <div class="tal-hint">
        <span class="tal-hint-k">
          <KeyHint k={t('talents.key.rclick')} />
          <KeyHint k="⌫" />
        </span>
        <span>{t('talents.hint.refund')}</span>
      </div>
      <div class="tal-hint">
        <span class="tal-hint-k">
          <KeyHint k="←" />
          <KeyHint k="↑" />
          <KeyHint k="↓" />
          <KeyHint k="→" />
        </span>
        <span>{t('talents.hint.move')}</span>
      </div>
    </>
  );
}

function HelpTip(): JSX.Element {
  lang.value;
  return (
    <>
      <div class="ms-tip-title">{t('talents.help.title')}</div>
      <div class="ms-tip-body">{t('talents.explain')}</div>
      <div class="ms-tip-body tal-tip-dim">{t('talents.rules')}</div>
      <div class="tal-tip-hints">
        <HintRows />
      </div>
    </>
  );
}

function SidePanel({ classId, spentByTree, onResetAll, activeView }: { classId: ClassId; spentByTree: [number, number]; onResetAll: () => void; activeView: TreeView | null }): JSX.Element {
  const save = metaSave().value;
  lang.value;
  const cs = save.classes[classId];
  // the cap is the profile's: 40, +2 per zone cleared on Hard (MT-02); XP above it waits and is paid when the cap rises
  const capV = talentCapView(save, deps().content);
  const prog = talentProgress(cs.xp, capV.cap);
  const avail = availablePoints(cs, capV.cap);
  const earned = earnedPoints(cs, capV.cap);
  const waiting = Math.max(0, pointsForXp(cs.xp, capV.max) - earned);
  const spent = spentTotal(cs);
  const portrait = portraitUrl(classId, armorySex.value);
  const classDef = indexOf().classes.get(classId);
  const chosen = armoryDoctrine.value;
  const doctrineDef = classDef?.doctrines.find((d) => d.id === chosen);
  const need = prog.next === null ? 0 : prog.next - prog.floor;
  const [flash, setFlash] = useState(0);
  const lastEarned = useRef(earned);
  useEffect(() => {
    if (earned > lastEarned.current) setFlash((n) => n + 1);
    lastEarned.current = earned;
  }, [earned]);

  return (
    <KitCtx.Provider value={true}>
      <aside class="tal-side ms-board ms-kit" style={{ '--tc': CLASS_COLOR[classId] } as JSX.CSSProperties}>
        <TitleBar small>{t('talents.panel.title')}</TitleBar>
        <button type="button" class="tal-help ms-capbtn" data-nav="" aria-label={t('talents.help.title')} {...tipProps(() => <HelpTip />)}>
          ?<span class="ms-hit" aria-hidden="true" />
        </button>
        <div class="tal-side-scroll ms-scroll ms-edgefade">
          <div class="tal-id">
            <span class="tal-portrait-box ms-sunken ms-sunken--framed">
              <span class="tal-portrait" style={portrait ? { backgroundImage: `url("${portrait}")` } : undefined}>
                {!portrait && <ClassEmblem classId={classId} size="3.4rem" />}
              </span>
            </span>
            <div class="tal-id-t">
              <div class="tal-class">{className(classId)}</div>
              {doctrineDef && (
                <div class="tal-doct ms-sunken ms-sunken--plain" {...tipProps(() => <TipBody title={tl(doctrineDef.name)} body={t('talents.doctrine.note')} />)}>
                  <span class="tal-doct-l">{t('talents.doctrine.label')}</span>
                  <span class="tal-doct-n">{tl(doctrineDef.name)}</span>
                </div>
              )}
            </div>
          </div>

          <div class={`tal-avail ${avail > 0 ? 'has' : ''}`}>
            <StatWell size="hero" tone={avail > 0 ? 'gold' : 'neutral'} value={<Counter value={avail} format={fmtInt} ms={420} />} />
            <span class="tal-avail-t">
              <span class="tal-avail-l">{t('talents.toSpend')}</span>
              <span class="tal-avail-sub">{t('talents.spentOf', { spent: fmtInt(spent), earned: fmtInt(earned) })}</span>
            </span>
          </div>

          <div class="tal-stats">
            <StatWell layout="stack" size="md" label={t('talents.earned')} value={fmtInt(earned)} />
            <span {...tipProps(() => <TipBody title={t('talents.spent')} body={classDef ? classDef.doctrines.map((d, i) => `${tl(d.name)}: ${fmtInt(spentByTree[i] ?? 0)}`).join(' · ') : ''} />)}>
              <StatWell layout="stack" size="md" label={t('talents.spent')} value={fmtInt(spent)} />
            </span>
            <span {...tipProps(() => <TipBody title={t('talents.cap')} body={t('talents.cap.pool', { cap: capV.cap, max: capV.max })} />)}>
              <StatWell layout="stack" size="md" label={t('talents.cap')} value={fmtInt(capV.cap)} />
            </span>
          </div>

          <div class={`tal-cap ms-sunken ms-sunken--plain${capV.nextZone === null ? ' is-max' : ''}`} {...tipProps(() => <TipBody title={t('talents.cap')} body={t('talents.cap.tip', { n: capV.perZone, max: capV.max })} />)}>
            <span class="tal-cap-top">
              <span class="tal-cap-n">{t('talents.cap.line', { cap: fmtInt(capV.cap), max: fmtInt(capV.max) })}</span>
              <span class="tal-cap-pips" aria-hidden="true">
                {Array.from({ length: (capV.max - capV.base) / capV.perZone }, (_, i) => (
                  <i key={i} class={`tal-cap-pip${i < capV.hardZones ? ' is-on' : ''}`} />
                ))}
              </span>
            </span>
            <span class="tal-cap-next">{capV.nextZone === null ? t('talents.cap.full', { max: capV.max }) : t('talents.cap.next', { zone: zoneName(capV.nextZone), n: capV.perZone })}</span>
            {waiting > 0 && <span class="tal-cap-wait">{t('talents.cap.waiting', { n: fmtInt(waiting) })}</span>}
          </div>

          <div class="tal-xp" {...tipProps(() => <TipBody title={t('talents.xp.label')} body={t('talents.xp.total', { xp: fmtInt(cs.xp) })} />)}>
            <div class="tal-xp-l">{t('talents.xp.label')}</div>
            <div class="tal-xp-g">
              <ArmGauge kind="gold" ch="1.35rem" value={prog.fraction} labelEnd={prog.next === null ? t('common.max') : `${fmtInt(prog.into)} / ${fmtInt(need)}`} />
              {flash > 0 && <span key={flash} class="tal-xp-flash" aria-hidden="true" />}
            </div>
            <div class="tal-xp-s">{prog.next === null ? t('talents.xp.max', { max: capV.cap }) : t('talents.xp.next', { n: fmtInt(need - prog.into) })}</div>
          </div>

          <p class="tal-text">{t('talents.explain')}</p>
          <p class="tal-text tal-text--dim">{t('talents.rules')}</p>

          <div class="tal-actions">
            <Button variant="wood" size="small" block disabled={spent === 0} title={spent === 0 ? t('talents.reset.none') : undefined} sound="back" onClick={onResetAll}>
              <Glyph name="close" />
              {t('talents.reset.all')}
            </Button>
          </div>

          <div class="tal-mode">
            <span class="tal-mode-l">{t('talents.mode.label')}</span>
            <span {...tipProps(() => <TipBody title={t('talents.mode.label')} body={t('talents.mode.tip')} />)}>
              <ModeSwitch />
            </span>
          </div>

          {activeView && <Bonuses view={activeView} />}

          <div class="tal-hints">
            <div class="tal-block-h">{t('talents.hint.title')}</div>
            <HintRows />
          </div>
        </div>
      </aside>
    </KitCtx.Provider>
  );
}

function ModeSwitch(): JSX.Element {
  lang.value;
  return (
    <Segmented
      kit
      value={tapMode.value}
      onChange={(k) => {
        tapMode.value = k;
      }}
      options={[
        { key: 'add', label: t('talents.mode.add') },
        { key: 'refund', label: t('talents.mode.refund') },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tab

type ConfirmState = { key: DoctrineKey | 'all' } | null;

export function TalentsTab(): JSX.Element {
  const { meta, content } = deps();
  const save = metaSave().value;
  const classId = armoryClass.value;
  const chosen = armoryDoctrine.value;
  lang.value;
  const cs = save.classes[classId];
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const root = useRef<HTMLDivElement>(null);
  const tex = useArmTex();

  useEffect(() => {
    tapMode.value = 'add';
    shownTree.value = null;
    return () => {
      tapMode.value = 'add';
    };
  }, []);

  const cap = talentCap(save);
  const views = KEYS.map((k) => treeView(content, cs, classId, k, cap));
  const classDef = indexOf().classes.get(classId);

  const act: NodeProps['act'] = (dk, nodeId, refund, el) => {
    const r = refund ? meta.refundTalent(classId, dk, nodeId) : meta.allocateTalent(classId, dk, nodeId);
    if (r.ok) {
      sfx(refund ? 'back' : 'unlock');
      return;
    }
    if (r.reason === 'nothingToRefund' || r.reason === 'maxed') {
      if (r.reason === 'maxed') el?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 220 });
      return;
    }
    sfx('error');
    el?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-0.3rem)' }, { transform: 'translateX(0.3rem)' }, { transform: 'translateX(-0.2rem)' }, { transform: 'translateX(0)' }], { duration: 260 });
    const view = views[KEYS.indexOf(dk)];
    if (r.reason === 'noPoints') {
      // XP is waiting above the cap: say what lifts it instead of "play more runs"
      const cv = talentCapView(save, content);
      const held = pointsForXp(cs.xp, cv.max) - pointsForXp(cs.xp, cv.cap);
      if (held > 0 && cv.nextZone !== null) pushToast(t('talents.fail.capped', { cap: cv.cap, n: held, zone: zoneName(cv.nextZone), gain: Math.min(held, cv.perZone) }), 'bad');
      else pushToast(t('talents.fail.noPoints'), 'bad');
    } else if (r.reason === 'rowLocked') {
      const nv = view?.nodes.find((x) => x.node.id === nodeId);
      const row = view?.rows.find((x) => x.row === nv?.node.row);
      pushToast(t('talents.fail.rowLocked', { n: row ? Math.max(1, row.needed - row.have) : 1 }), 'bad');
    } else if (r.reason === 'requiresLocked' && view) pushToast(t('talents.fail.requires', { name: r.blocker ? nodeName(view, r.blocker) : '' }), 'bad');
    else if (r.reason === 'dependency') pushToast(t('talents.fail.dependency'), 'bad');
  };

  // gamepad: X (banish) takes a point back from the focused node
  useKeys((a) => {
    if (confirm !== null || a.source !== 'gamepad' || a.kind !== 'banish') return false;
    const el = document.activeElement;
    if (el instanceof HTMLElement && root.current?.contains(el) && el.dataset.node && el.dataset.tree) {
      act(el.dataset.tree as DoctrineKey, el.dataset.node, true, el);
      return true;
    }
    return false;
  });

  const doReset = (key: DoctrineKey | 'all'): void => {
    const before = spentTotal(meta.save.classes[classId]);
    meta.respecTalents(classId, key === 'all' ? undefined : key);
    const after = spentTotal(meta.save.classes[classId]);
    sfx('purchase');
    pushToast(t('talents.reset.done', { n: fmtInt(before - after) }), 'good');
    setConfirm(null);
  };

  if (views.some((v) => v === null) || !classDef) {
    return (
      <div class="tal tal--empty" ref={root}>
        <div class="tal-empty ms-sunken ms-sunken--plain">{t('talents.empty')}</div>
      </div>
    );
  }

  const spentByTree: [number, number] = [views[0]?.spent ?? 0, views[1]?.spent ?? 0];
  const confirmTree = confirm && confirm.key !== 'all' ? views[KEYS.indexOf(confirm.key)] : null;
  const showKey: DoctrineKey = shownTree.value ?? chosen;
  const avail = availablePoints(cs, cap);
  const treeTabs = (): JSX.Element => (
    <Tabs
      kit
      value={showKey}
      onChange={(k) => {
        shownTree.value = k;
      }}
      tabs={KEYS.map((k, i) => {
        const v = views[i];
        const def = classDef.doctrines.find((d) => d.id === k);
        return { key: k, label: v ? tl(v.tree.name) : def ? tl(def.name) : k, ...(v && v.spent > 0 ? { badge: v.spent } : {}) };
      })}
    />
  );

  return (
    <div class="tal" ref={root} data-shown={showKey} style={tex}>
      <div class="tal-in">
        <div class="tal-tabs">{treeTabs()}</div>
        {KEYS.map((dk, i) => {
          const view = views[i];
          if (!view) return null;
          const def = classDef.doctrines.find((d) => d.id === dk);
          const g = def ? pickGlyph(def.basic, 'skill') : { glyph: 'star' as GlyphName, element: 'physical' as Element };
          return (
            <TreePanel
              key={`${classId}-${dk}`}
              classId={classId}
              dk={dk}
              view={view}
              active={dk === chosen}
              doctrineName={def ? tl(def.name) : tl(view.tree.name)}
              emblem={g.glyph}
              act={act}
              onReset={(k) => setConfirm({ key: k })}
              avail={avail}
              shown={dk === showKey}
              sw={treeTabs()}
            />
          );
        })}
        <SidePanel classId={classId} spentByTree={spentByTree} onResetAll={() => setConfirm({ key: 'all' })} activeView={views[KEYS.indexOf(chosen)] ?? null} />
      </div>

      {confirm && confirm.key === 'all' && (
        <Confirm danger title={t('talents.reset.allTitle')} text={t('talents.reset.allText', { n: fmtInt(spentTotal(cs)), name: className(classId) })} confirmLabel={t('talents.reset.confirm')} onCancel={() => setConfirm(null)} onConfirm={() => doReset('all')} />
      )}
      {confirm && confirm.key !== 'all' && confirmTree && (
        <Confirm
          danger
          title={t('talents.reset.treeTitle', { tree: tl(confirmTree.tree.name) })}
          text={t('talents.reset.treeText', { n: fmtInt(confirmTree.spent), tree: tl(confirmTree.tree.name) })}
          confirmLabel={t('talents.reset.confirm')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => doReset(confirm.key as DoctrineKey)}
        />
      )}
    </div>
  );
}
