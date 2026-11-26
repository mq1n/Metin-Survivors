// Build board (the taskbar's relic button): everything the run owns by name, in a stone board over the bottom-right corner:
// passives with their rank, spirit stones with their level, trinkets with their rank. The icons carry the same tooltips as the
// bar's and the buff row; the board is a quick read, not a menu (the run keeps going behind it).
// With awakening pacts on (balance.pacts, OF-02) the board starts with the pact links: one row per owned skill that has a pact
// passive, [skill] -- gold chain -- [passive], the chain glowing once the pact is kept and the skill stands at G2.
import type { JSX, RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { t, tl } from '../../i18n/i18n';
import type { HudSnapshot } from '../../sim/types';
import { Panel } from '../components/Panel';
import { IconSlot } from '../components/Slot';
import { TipBody, tipProps } from '../components/Tooltip';
import { indexOf, itemName, statModRows } from '../content';
import { pactLinks, type PactLinkView } from '../cardModel';
import { buildTip } from '../itemTips';
import { pactTip } from '../modals/Card';
import { buildOpen } from './hooks';
import './buildPacts.css';

interface Entry {
  key: string;
  node: JSX.Element;
  name: string;
  sub: string;
}

function Section({ title, entries }: { title: string; entries: Entry[] }): JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <section class="ms-bb-sec">
      <h3 class="ms-bb-head">{title}</h3>
      <div class="ms-bb-grid">
        {entries.map((e) => (
          <div key={e.key} class="ms-bb-row">
            {e.node}
            <span class="ms-bb-txt">
              <b>{e.name}</b>
              <em>{e.sub}</em>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const LINK_X = [0, 1, 2, 3] as const;

function Links(): JSX.Element[] {
  return LINK_X.map((i) => <rect key={i} x={1 + i * 10} y="2.5" width="13" height="7" rx="3.5" />);
}

/**
 * Four interlocked links (currentColor); buildPacts.css breaks the middle ones while the pact is open or blocked. A ready pact also draws the links a
 * second time as a halo: that copy carries the (static, blurred) glow and the pulse only moves its opacity, so the board's own drop-shadow filter never
 * has a blur re-rastered under it every frame.
 */
function Chain({ halo }: { halo: boolean }): JSX.Element {
  return (
    <span class="ms-pact-link" aria-hidden="true">
      <svg class="ms-pact-chain" viewBox="0 0 44 12" preserveAspectRatio="none" focusable="false">
        {Links()}
      </svg>
      {halo && (
        <svg class="ms-pact-chain ms-pact-halo" viewBox="0 0 44 12" preserveAspectRatio="none" focusable="false">
          {Links()}
        </svg>
      )}
    </span>
  );
}

/**
 * The tooltip of a pact passive's tile. A passive the hero holds is the ordinary build tip at its rank. One the hero does not hold is a preview: it
 * names the rank the pact asks for and what the passive gives at that rank, with no "Rank 1 / 5" line that would read as owned.
 */
function partnerTip(l: PactLinkView): JSX.Element {
  const def = indexOf().passives.get(l.passiveId);
  if (l.have > 0 || !def) return buildTip({ type: 'passive', id: l.passiveId, rank: Math.max(1, l.have) });
  return <TipBody title={tl(def.name)} sub={t('offers.board.partnerPreview', { need: l.need })} body={tl(def.desc)} rows={statModRows(def.perRank, l.need).map((r) => ({ label: r.label, value: r.value, bad: !r.positive }))} />;
}

function PactRow({ l }: { l: PactLinkView }): JSX.Element {
  return (
    <li class={`ms-pact-row is-${l.state}`} aria-label={t('offers.board.link', { skill: l.skillName, passive: l.passiveName, state: l.text })}>
      <IconSlot size="sm" icon={l.skillIcon} kind="skill" rank={l.skillRank} awakened={l.state === 'awakened'} {...tipProps(() => pactTip({ type: 'skill', id: l.skillId, rank: l.skillRank }, l))} />
      <Chain halo={l.state === 'ready'} />
      <span class="ms-pact-pass">
        <IconSlot size="sm" icon={l.passiveIcon} kind="passive" {...(l.have > 0 ? { badge: l.have } : {})} {...tipProps(() => partnerTip(l))} />
      </span>
      <span class="ms-pact-txt">
        <b>{l.skillName}</b>
        <em>{l.text}</em>
      </span>
    </li>
  );
}

/** The smallest body that is still a board; below it (meter open on a small screen) the board gives up the room under the damage meter. */
export const BOARD_FLOOR = 192;
/** The air between the board's top edge and the column above it, px. */
const BOARD_GAP = 8;

/** Where things stand on the HUD, all in px of one vertical space (the board's offset parent). */
export interface BoardRoomInput {
  /** the bottom edge of the board */
  bottom: number;
  /** the board's own chrome around its scrolling body (title bar, frame) */
  frame: number;
  /** the bottom of the hard limit: the minimap (or its medallion) and the corruption gauge when it stands */
  hard: number;
  /** the bottom of the whole top-right column: the hard limit plus the damage-meter table when it is open */
  whole: number;
}

/**
 * The tallest body (`--bb-body-max`, px) a board with pact rows may have. It stops under the whole top-right column; when that leaves less than the
 * floor (the meter table is open on a small screen) it gives up the room under the table and stops under the minimap and the gauge instead, as the
 * plain board does. The floor itself never lifts the board above the hard limit: with the room under the gauge below the floor the body is that
 * small (the minimap and the gauge are never covered).
 */
export function boardRoom(i: BoardRoomInput): number {
  const under = (y: number): number => Math.floor(i.bottom - y - BOARD_GAP - i.frame);
  const full = under(Math.max(i.hard, i.whole));
  return Math.max(0, full >= BOARD_FLOOR ? full : under(i.hard));
}

/**
 * The room a board with pact rows may take (R1, OF-02): the pact section is tall, so the body grows up to the top-right column instead of stopping at
 * hud.css's 30 rem, and never over the minimap or the corruption gauge. The board is anchored at the bottom, so the room is the distance from its
 * bottom edge to the bottom of `.ms-hud-tr` (the minimap or its medallion, the gauge when it stands, the damage-meter table when it is open), less
 * the board's own frame (boardRoom); it is set as `--bb-body-max` on the board (buildPacts.css reads it).
 * The column changes while the board stays open (the gauge comes and goes with the corruption, the meter and the minimap are toggled, the meter
 * table fills up), so a ResizeObserver on the column refits the board on every change, besides the window resize (a tier change moves the column);
 * both are removed when the board closes.
 * Layout px (offset sizes, rect differences), so the rise-in animation of the board cannot skew it.
 */
function useBoardRoom(ref: RefObject<HTMLDivElement>, on: boolean): void {
  useLayoutEffect(() => {
    const root = ref.current;
    const column = document.querySelector<HTMLElement>('.ms-hud-tr');
    if (!on || !root || !column) return undefined;
    const fit = (): void => {
      const board = root.querySelector<HTMLElement>('.ms-bb-board');
      const body = root.querySelector<HTMLElement>('.ms-bb-body');
      if (!board || !body) return;
      const parentTop = root.offsetParent ? root.offsetParent.getBoundingClientRect().top : 0;
      const colRect = column.getBoundingClientRect();
      let hard = colRect.top;
      for (const el of Array.from(column.children)) if (!el.classList.contains('ms-hud-meter-wrap')) hard = Math.max(hard, el.getBoundingClientRect().bottom);
      const room = boardRoom({
        bottom: root.offsetTop + root.offsetHeight,
        frame: body.getBoundingClientRect().top - board.getBoundingClientRect().top,
        hard: hard - parentTop,
        whole: colRect.bottom - parentTop,
      });
      root.style.setProperty('--bb-body-max', `${room}px`);
    };
    fit();
    let roRaf = 0;
    const onResize = (): void => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        fit();
      });
    };
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    watch?.observe(column);
    window.addEventListener('resize', fit);
    return () => {
      if (roRaf) cancelAnimationFrame(roRaf);
      watch?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [on, ref]);
}

export function BuildBoard({ hud }: { hud: HudSnapshot }): JSX.Element | null {
  const open = buildOpen.value;
  const pacts = open ? pactLinks(hud) : [];
  const ref = useRef<HTMLDivElement>(null);
  useBoardRoom(ref, open && pacts.length > 0);
  if (!open) return null;
  const close = (): void => {
    buildOpen.value = false;
  };
  const passives: Entry[] = hud.passives.map((p) => ({
    key: p.id,
    name: itemName(p.id),
    sub: t('common.rank', { n: p.rank }),
    node: <IconSlot size="sm" icon={p.icon} kind="passive" badge={p.rank} {...tipProps(() => buildTip({ type: 'passive', id: p.id, rank: p.rank }))} />,
  }));
  const stones: Entry[] = [];
  hud.stones.forEach((s, i) => {
    if (s) stones.push({ key: `s${i}`, name: itemName(s.id), sub: `+${s.level}`, node: <IconSlot size="sm" icon={s.icon} kind="stone" badge={`+${s.level}`} {...tipProps(() => buildTip({ type: 'stone', id: s.id, level: s.level }))} /> });
  });
  const trinkets: Entry[] = [];
  hud.trinkets.forEach((s, i) => {
    if (s) trinkets.push({ key: `t${i}`, name: itemName(s.id), sub: t('common.rank', { n: s.rank }), node: <IconSlot size="sm" icon={s.icon} kind="trinket" badge={s.rank} {...tipProps(() => buildTip({ type: 'trinket', id: s.id, rank: s.rank }))} /> });
  });
  const empty = pacts.length + passives.length + stones.length + trinkets.length === 0;
  return (
    <div ref={ref} class={`ms-bb ${pacts.length > 0 ? 'has-pacts' : ''}`} data-block="" role="dialog" aria-label={t('hud.build.title')}>
      <Panel variant="board" thin title={t('hud.build.title')} onClose={close} class="ms-bb-board">
        <div class="ms-bb-body ms-scroll ms-edgefade">
          {empty && <p class="ms-bb-empty">{t('hud.build.empty')}</p>}
          {pacts.length > 0 && (
            <section class="ms-bb-sec ms-pact-board">
              <h3 class="ms-bb-head">{t('offers.board.title')}</h3>
              <ul class="ms-pact-list">
                {pacts.map((l) => (
                  <PactRow key={l.skillId} l={l} />
                ))}
              </ul>
            </section>
          )}
          <Section title={t('hud.passives')} entries={passives} />
          <Section title={t('hud.stones')} entries={stones} />
          <Section title={t('hud.trinkets')} entries={trinkets} />
        </div>
      </Panel>
    </div>
  );
}
