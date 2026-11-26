// Metin Essence: the broken stone yields its spirit. The cards deal in over soft rune-coloured god-rays; beside them the

// stones above, 3 armor stones below) over an engraved relief, and a row of three trinket sockets. Hovering (or
// focusing) a card marks the sockets it touches: a pearl gem glow for a FREE socket, an ember crack for a REPLACED one,
// a gold chevron for an UPGRADE. Pick flow is the shared `useCardModal`.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Rarity } from '../../data/schema';
import { t, tl } from '../../i18n/i18n';
import type { Card, HudSnapshot, ModalRequest } from '../../sim/types';
import { texUrl } from '../assets';
import { sfx } from '../audio';
import type { GlyphName } from '../components/glyphs';
import { Panel } from '../components/Panel';
import { IconSlot } from '../components/Slot';
import { CurrencyIcon, UiGlyph } from '../components/StatIcon';
import { tipProps } from '../components/Tooltip';
import { Burst, GodRays, Motes as FxMotes, shineProps } from '../components/UiFx';
import { indexOf } from '../content';
import { deps } from '../env';
import { buildTip } from '../itemTips';
import { layout } from '../layout';
import { useScope } from '../nav';
import { CardView } from './Card';
import { MedallionBody } from './Medallion';
import { useCardModal } from './LevelUp';
import { hashStr, marksOf, RewardActions, RewardHead, SOCKET_GEMS, STONE_RING_DEG, stoneVariant, type Mark, type MarkKind } from './rewardKit';
import './essence.css';

// ---------------------------------------------------------------------------------------------------------------
// shared helpers (Chest / Boss reward / Story reuse these)

/** `#rrggbb` → CSS variables that recolour the painted (orange) stone art to that hue. */
export function runeVars(hex: string): JSX.CSSProperties {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1] as string, 16) : 0xff9a2e;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return {
    '--rune': `#${(m ? (m[1] as string) : 'ff9a2e').toLowerCase()}`,
    '--rune-rot': `${Math.round(h - 28)}deg`,
    '--rune-sat': String(Math.min(1.25, Math.max(0.35, s * 1.35)).toFixed(2)),
    '--on-rune': l > 0.58 ? '#1a0a04' : '#fff7e0',
  } as JSX.CSSProperties;
}

const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// ---------------------------------------------------------------------------------------------------------------
// socket markers

interface SlotItem {
  id: string;
  icon: string;
  /** stone level / trinket rank */
  n: number;
}

/** The small picture of a socket state (legend chips and sockets share it). */
function StateMark({ kind }: { kind: MarkKind }): JSX.Element {
  if (kind === 'free')
    return (
      <svg class="ms-ess-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.5l8 6.2-3 12.3H7L4 8.7z" fill="#fbf1d6" stroke="#6d5a38" stroke-width="1.4" stroke-linejoin="round" />
        <path d="M12 2.5l8 6.2H4zM7 21l5-12.3L17 21" fill="none" stroke="#c9b27c" stroke-width="1" />
      </svg>
    );
  if (kind === 'replace')
    return (
      <svg class="ms-ess-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 3l7 7-4 3 8 5-3 3" fill="none" stroke="#ff7a3a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M3 3l7 7-4 3 8 5-3 3" fill="none" stroke="#ffe0a0" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M14 4l3 4M19 11l-3 2" stroke="#ff7a3a" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    );
  return (
    <svg class="ms-ess-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 13l7-7 7 7M5 20l7-7 7 7" fill="none" stroke="#6b4a10" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M5 13l7-7 7 7M5 20l7-7 7 7" fill="none" stroke="#f6cf62" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** The pearl gem lying in a free socket: the painted octagon-cut gem (uk_essence_chest_gem), a drawn one while it is not shipped. */
function GemFill(): JSX.Element {
  const gem = texUrl('uk_essence_chest_gem');
  if (gem) return <img class="ms-ess-gemfill" src={gem} alt="" aria-hidden="true" draggable={false} />;
  return (
    <svg class="ms-ess-gemfill" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M20 3 L33 9.5 L37 21 L30 35 L10 35 L3 21 L7 9.5 Z" fill="#f6e7bd" stroke="#7d6232" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M20 3 L33 9.5 L20 15 L7 9.5 Z" fill="#fffaf0" />
      <path d="M20 15 L37 21 L30 35 Z" fill="#d6b56a" />
      <path d="M20 15 L3 21 L10 35 Z" fill="#c8a458" />
    </svg>
  );
}

/** One entry of the socket-state key: a miniature of the state itself (the pearl gem, the charred tile, the gold chevrons) in an octagon seat, then its word. */
function LegendItem({ kind, label, lit }: { kind: MarkKind; label: string; lit: boolean }): JSX.Element {
  const gem = texUrl('uk_essence_chest_gem');
  const ember = texUrl('uk_essence_chest_ember');
  return (
    <span role="listitem" class={`ms-ess-lg is-${kind} ${lit ? 'is-lit' : ''}`}>
      <span class="ms-ess-lgseat ms-plate">
        {kind === 'free' && (gem ? <img class="ms-ess-lgimg" src={gem} alt="" aria-hidden="true" draggable={false} /> : <StateMark kind="free" />)}
        {kind === 'replace' && (
          <>
            {ember && <img class="ms-ess-lgimg is-ember" src={ember} alt="" aria-hidden="true" draggable={false} />}
            <StateMark kind="replace" />
          </>
        )}
        {kind === 'upgrade' && <StateMark kind="upgrade" />}
      </span>
      <b>{label}</b>
    </span>
  );
}

/** Ember cracks over a replaced socket (own jagged geometry, lit from inside). */
function Crack(): JSX.Element {
  return (
    <svg class="ms-ess-crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M58 4 L47 24 L60 36 L40 52 L55 66 L42 96" stroke="#c4300c" stroke-width="7.5" opacity="0.55" />
        <path d="M58 4 L47 24 L60 36 L40 52 L55 66 L42 96" stroke="#ff7a30" stroke-width="3.6" />
        <path d="M58 4 L47 24 L60 36 L40 52 L55 66 L42 96" stroke="#ffe3a0" stroke-width="1.3" />
        <path d="M60 36 L82 30 L92 44M40 52 L16 46 L8 60M55 66 L76 74" stroke="#ff7a30" stroke-width="2.6" />
        <path d="M60 36 L82 30 L92 44M40 52 L16 46 L8 60M55 66 L76 74" stroke="#ffe3a0" stroke-width="0.9" />
      </g>
    </svg>
  );
}

/** The charred, cracked tile laid over a replaced socket: painted ember tile (uk_essence_chest_ember) under the drawn fissures. */
function Ember(): JSX.Element {
  const tile = texUrl('uk_essence_chest_ember');
  return (
    <>
      {tile && <img class="ms-ess-ember" src={tile} alt="" aria-hidden="true" draggable={false} />}
      <Crack />
    </>
  );
}

interface SockProps {
  type: 'stone' | 'trinket';
  index: number;
  cur: SlotItem | null;
  ghost: GlyphName;
  marks: Mark[];
  active: number | null;
  cards: readonly Card[];
  /** ring angle in degrees (stones) */
  angle?: number;
  gem: string;
}

function EssSocket({ type, index, cur, ghost, marks, active, cards, angle, gem }: SockProps): JSX.Element {
  const { content } = deps();
  const ix = indexOf(content);
  const mine = active !== null ? marks.find((m) => m.card === active) : undefined;
  const shown = mine ?? (active === null ? marks[0] : undefined);
  const dim = active !== null && !mine && marks.length > 0;
  const card = mine ? cards[mine.card] : undefined;
  const incomingIcon = card ? (type === 'stone' ? ix.stones.get(card.id)?.icon : ix.trinkets.get(card.id)?.icon) : undefined;
  const rarityOf = (n: number): Rarity => RARITIES[Math.min(4, Math.max(0, type === 'stone' ? n : n - 1))] ?? 'common';
  const stoneSlotKind = index < 3 ? 'weapon' : 'armor';
  const kind = shown?.kind;

  let body: JSX.Element;
  if (cur && !(mine?.kind === 'free')) {
    body = (
      <IconSlot
        size="lg"
        icon={cur.icon}
        kind={type}
        rarity={rarityOf(cur.n)}
        {...(type === 'stone' ? { slot: stoneSlotKind, badge: `+${cur.n}` } : { badge: cur.n })}
        {...tipProps(() => (type === 'stone' ? buildTip({ type: 'stone', id: cur.id, level: cur.n }) : buildTip({ type: 'trinket', id: cur.id, rank: cur.n })))}
      />
    );
  } else if (mine?.kind === 'free' && incomingIcon && card) {
    body = <IconSlot size="lg" icon={incomingIcon} kind={type} rarity={card.rarity} class="is-preview" {...(type === 'stone' ? { slot: stoneSlotKind } : {})} />;
  } else {
    body = <IconSlot size="lg" ghost={ghost} {...tipProps(() => <div>{t('essence.slot.empty')}</div>)} />;
  }

  const label = shown
    ? marks
        .filter((m) => m.kind === shown.kind)
        .map((m) => m.card + 1)
        .join(', ')
    : '';
  const aria = kind ? t(kind === 'free' ? 'essence.sockFree' : kind === 'replace' ? 'essence.sockReplace' : 'essence.sockUpgrade', { n: label }) : undefined;

  return (
    <div
      class={`ms-ess-sock ms-ess-sock--${type} ${kind ? `is-${kind}` : ''} ${mine ? 'is-active' : ''} ${dim ? 'is-dim' : ''}`}
      style={{ '--gem': gem, ...(angle !== undefined ? { '--a': `${angle}deg` } : {}) } as JSX.CSSProperties}
      aria-label={aria}
    >
      <span class="ms-ess-seat ms-plate">
        {body}
        {kind === 'free' && !cur && !mine && <GemFill />}
        {kind === 'replace' && <Ember />}
        {kind === 'upgrade' && (
          <span class="ms-ess-up">
            <StateMark kind="upgrade" />
          </span>
        )}
      </span>
      {marks.length > 0 && (
        <span class="ms-ess-nums">
          {marks.map((m) => (
            <b key={m.card} class="ms-ess-num ms-plate ms-num">
              {m.card + 1}
            </b>
          ))}
        </span>
      )}
    </div>
  );
}

function targetCaption(card: Card, n: number, hud: HudSnapshot | null): string {
  const ix = indexOf(deps().content);
  switch (card.kind) {
    case 'stone': {
      if (!card.replaces) return t('essence.takesFree', { n });
      const old = ix.stones.get(card.replaces.id);
      return t('essence.replaceStone', { n, name: old ? tl(old.name) : card.replaces.id, level: card.replaces.level });
    }
    case 'stoneUp': {
      const def = ix.stones.get(card.id);
      return t('essence.upgradeStone', { n, name: def ? tl(def.name) : card.id, from: hud?.stones[card.slot]?.level ?? Math.max(0, card.rank - 1), to: card.rank });
    }
    case 'trinket': {
      if (!card.replaces) return t('essence.takesFree', { n });
      const old = ix.trinkets.get(card.replaces.id);
      return t('essence.replaceTrinket', { n, name: old ? tl(old.name) : card.replaces.id, level: card.replaces.level });
    }
    case 'trinketUp': {
      const def = ix.trinkets.get(card.id);
      return t('essence.upgradeTrinket', { n, name: def ? tl(def.name) : card.id, from: hud?.trinkets[card.slot]?.rank ?? Math.max(0, card.rank - 1), to: card.rank });
    }
    default:
      return t('essence.instant', { n });
  }
}

// ---------------------------------------------------------------------------------------------------------------

export function Essence({ request }: { request: ModalRequest }): JSX.Element {
  const { store, content } = deps();
  const ix = indexOf(content);
  const scope = useScope();
  const st = useCardModal(request, { pickSound: 'essencePick' });
  const hud = store.hud.value;
  const metin = ix.metins.get(request.source);
  const awakened = request.awakened;
  const rune = metin?.rune ?? '#ff9a2e';
  const [active, setActive] = useState<number | null>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const n = request.cards.length;
  const rarest = awakened || request.cards.some((c) => c.rarity === 'legendary');

  useEffect(() => {
    sfx('open');
  }, []);
  // a reroll / banish swaps the cards: forget the hovered one
  useEffect(() => setActive(null), [st.dealKey]);

  const marks = useMemo(() => marksOf(request.cards), [request.cards]);
  const idxOf = (e: Event): number | null => {
    const el = (e.target as HTMLElement | null)?.closest('.ms-card');
    const host = cardsRef.current;
    if (!el || !host) return null;
    const i = Array.prototype.indexOf.call(host.children, el) as number;
    return i >= 0 ? i : null;
  };

  const anyReplace = request.cards.some((c) => c.replaces);
  const activeCard = active !== null ? request.cards[active] : undefined;
  const caption = activeCard && active !== null ? targetCaption(activeCard, active + 1, hud) : anyReplace ? t('essence.replaceHint') : layout.value.touch ? t('levelup.pickHintTouch') : t('levelup.pickHint', { n });
  const stoneAt = (i: number): SlotItem | null => {
    const s = hud?.stones[i];
    return s ? { id: s.id, icon: s.icon, n: s.level } : null;
  };
  const trinketAt = (i: number): SlotItem | null => {
    const s = hud?.trinkets[i];
    return s ? { id: s.id, icon: s.icon, n: s.rank } : null;
  };
  const trinketLabels = [t('card.slot.bracelet'), t('card.slot.necklace'), t('card.slot.earring')];
  const trinketGhost: GlyphName[] = ['bracelet', 'amulet', 'earring'];
  const trinketGems = ['#c9a24a', '#d8d0b8', '#9a62d8'];
  const title = awakened ? t('essence.titleAwakened') : t('essence.title');
  const ownedW = [0, 1, 2].filter((i) => hud?.stones[i]).length;
  const ownedA = [3, 4, 5].filter((i) => hud?.stones[i]).length;
  const ownedT = hud ? hud.trinkets.filter(Boolean).length : 0;
  // which socket states the hovered card (or, idle, any card) shows, for the legend chips
  const litKinds = new Set<MarkKind>();
  const pool = activeCard ? [activeCard] : request.cards;
  for (const c of pool) {
    if (c.kind === 'stoneUp' || c.kind === 'trinketUp') litKinds.add('upgrade');
    else if (c.kind === 'stone' || c.kind === 'trinket') litKinds.add(c.replaces ? 'replace' : 'free');
  }

  const variant = useMemo(() => stoneVariant(request.source), [request.source]);
  const seed = (hashStr(request.source) % 89) + 5;
  const stoneArt = texUrl(`art_metin_${request.source.replace(/^metin_/, '')}`) ?? texUrl('art_metin_essence');
  const rootStyle = {
    ...runeVars(rune),
    '--sv-flip': variant.flip ? -1 : 1,
    '--sv-rot': `${variant.rot}deg`,
    '--sv-scale': variant.scale,
    '--sv-glow': variant.glow,
    '--sv-shift': `${variant.shift}%`,
    ...(stoneArt ? { '--stone-art': `url("${stoneArt}")` } : {}),
  } as JSX.CSSProperties;

  const legend: { kind: MarkKind; label: string }[] = [
    { kind: 'free', label: t('essence.tag.free') },
    { kind: 'replace', label: t('essence.tag.replace') },
    { kind: 'upgrade', label: t('essence.tag.upgrade') },
  ];

  return (
    <div
      class={`ms-cardmodal ms-rw ms-ess ms-norays ${awakened ? 'is-awakened' : ''} ${rarest ? 'ms-cardmodal--legendary' : ''}`}
      style={rootStyle}
      ref={scope}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <GodRays {...(awakened ? { tone: 'legendary' as const } : { tone: 'ember' as const, color: rune })} seed={seed} y="47%" intensity={awakened ? 0.75 : 0.5} />
      <div class="ms-ess-stage" aria-hidden="true">
        <div class="ms-ess-aura" />
      </div>
      <FxMotes preset="ember" count={awakened ? 56 : 34} color={awakened ? '#ffb347' : rune} seed={seed} />
      <Burst play={1} tone={awakened ? 'legendary' : 'ember'} {...(awakened ? {} : { color: rune })} y="47%" scale={awakened ? 1.2 : 0.95} sparks={awakened ? 64 : 40} seed={seed} />

      <RewardHead
        class="ms-ess-head"
        eyebrow={metin ? tl(metin.name) : t('essence.title')}
        eyebrowIcon={<CurrencyIcon kind="shard" size="1.3rem" />}
        title={title}
        sub={st.banishMode ? <b>{t('levelup.banishMode')}</b> : t('essence.subtitle')}
        extra={
          awakened ? (
            <span class="ms-ess-awaken ms-plate">
              <UiGlyph name="flame" tone="gold" flat size="1.4rem" />
              <span class="ms-ess-awaken-t">
                <b {...shineProps(t('essence.awakenedBadge'), { idle: true, delay: 0.6 })}>{t('essence.awakenedBadge')}</b>
                <i>{t('essence.awakenedHint')}</i>
              </span>
              <UiGlyph name="flame" tone="gold" flat size="1.4rem" class="ms-ess-awaken-r" />
            </span>
          ) : undefined
        }
      />

      <div class="ms-ess-main">
        <div class="ms-ess-left" aria-hidden="true">
          <div class="ms-ess-pool" />
          <div class="ms-ess-stone">
            <i class="ms-ess-stone-art" />
          </div>
        </div>

        <div
          class="ms-cm-cards ms-ess-cards"
          key={st.dealKey}
          ref={cardsRef}
          onPointerOver={(e) => setActive(idxOf(e))}
          onPointerLeave={() => setActive(null)}
          onFocusIn={(e) => setActive(idxOf(e))}
          onFocusOut={() => setActive(null)}
        >
          {request.cards.map((card, i) => (
            <CardView
              key={`${card.kind}:${card.id}:${i}`}
              card={card}
              index={i}
              delay={0.08 + i * 0.1}
              banish={st.banishMode}
              picked={st.picked === i}
              dim={st.picked !== null && st.picked !== i}
              onPick={st.choose}
            />
          ))}
        </div>

        <Panel variant="board" title={t('essence.sockets')} thin class="ms-ess-board">
          <div class="ms-ess-bd">
            <div class="ms-ess-medblock">
              <span class="ms-ess-arc is-top">
                {t('essence.group.weapon')} <b class="ms-num">{ownedW}/3</b>
              </span>
              <div class="ms-ess-med">
                <MedallionBody awakened={awakened} />
                <div class="ms-ess-ring">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <EssSocket
                      key={i}
                      type="stone"
                      index={i}
                      cur={stoneAt(i)}
                      ghost={i < 3 ? 'sword' : 'shield'}
                      marks={marks.stones[i] ?? []}
                      active={active}
                      cards={request.cards}
                      angle={STONE_RING_DEG[i] ?? 0}
                      gem={SOCKET_GEMS[i] ?? '#9a62d8'}
                    />
                  ))}
                </div>
              </div>
              <span class="ms-ess-arc is-bottom">
                {t('essence.group.armor')} <b class="ms-num">{ownedA}/3</b>
              </span>
            </div>
            <div class="ms-ess-jew">
              <span class="ms-ess-arc">
                {t('essence.trinkets')} <b class="ms-num">{ownedT}/3</b>
              </span>
              <div class="ms-ess-trin">
                {[0, 1, 2].map((i) => (
                  <div class="ms-ess-tslot" key={i}>
                    <EssSocket type="trinket" index={i} cur={trinketAt(i)} ghost={trinketGhost[i] ?? 'gem'} marks={marks.trinkets[i] ?? []} active={active} cards={request.cards} gem={trinketGems[i] ?? '#c9a24a'} />
                    <span class="ms-ess-cap">{trinketLabels[i] ?? ''}</span>
                  </div>
                ))}
              </div>
            </div>
            <div class="ms-ess-legend" role="list" aria-label={t('essence.legend')}>
              {legend.map((l) => (
                <LegendItem key={l.kind} kind={l.kind} label={l.label} lit={litKinds.has(l.kind)} />
              ))}
            </div>
          </div>
        </Panel>

        <div class="ms-ess-foot">
          <div class={`ms-ess-caption ${activeCard?.replaces ? 'is-replace' : ''} ${!activeCard && !anyReplace ? 'is-hint' : ''}`} aria-live="polite">
            {caption}
          </div>
          <RewardActions st={st} request={request} skipLabel={t('essence.skip')} sealedNote={t('essence.sealedNote')} class="ms-ess-bottom" />
        </div>
      </div>

      {request.waited > 0 && <div class="ms-cm-hint">{t('levelup.waiting', { s: Math.max(0, Math.ceil(20 - request.waited)) })}</div>}
    </div>
  );
}
