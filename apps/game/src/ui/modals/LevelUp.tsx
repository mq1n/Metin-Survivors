// Level-Up (owner B6, kit v1): god-rays + a golden pillar / ring burst (UiFx) behind a Lv medallion and the shining title,
// up to 4 stone cards with deal-in animation, the current build on one pewter bar, Reroll / Banish / Skip on stone plates.
// Hotkeys: 1–4 pick (with Banish armed or B held: banish), R reroll, B arm banish, X / S skip.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { MAX_SKILL_RANK, resolveOverflow } from '../../data/schema';
import { fmtInt, t, tn } from '../../i18n/i18n';
import type { ModalRequest } from '../../sim/types';
import { texUrl } from '../assets';
import { sfx } from '../audio';
import { pactLinks, type PactLinkView } from '../cardModel';
import { Button } from '../components/Button';
import { Orb } from '../components/Orb';
import { Kit } from '../components/Panel';
import { IconSlot, KeyHint } from '../components/Slot';
import { CurrencyIcon } from '../components/StatIcon';
import { tipProps } from '../components/Tooltip';
import { Burst, GodRays, Motes, shineProps } from '../components/UiFx';
import { deps } from '../env';
import { useKeys, useScope } from '../nav';
import { buildTip } from '../itemTips';
import { contentKindOf, skillBar, splitSkills } from '../skillSlots';
import { CardView, PactGlyph, pactTip } from './Card';
import { FloorDisc, PillarShaft } from './cardArt';

/** Input lockout after a card modal opens, so held movement keys / clicks cannot pick by accident. */
const LOCKOUT_MS = 420;
/** Level-up: how long the chosen card keeps its flash + burst before the modal closes (the other modals keep 300 ms). */
const PICK_MS = 560;

export interface CardModalState {
  banishMode: boolean;
  setBanishMode: (v: boolean) => void;
  picked: number | null;
  choose: (i: number) => void;
  reroll: () => void;
  skip: () => void;
  banishArm: () => void;
  dealKey: number;
}

/** Shared behaviour of card modals (Level-Up, Essence, Chest, Boss reward): picking, banish mode, lockout, hotkeys. */
export function useCardModal(request: ModalRequest, opts: { pickSound?: 'cardPick' | 'essencePick'; pickMs?: number } = {}): CardModalState {
  const { store, input } = deps();
  const [banishMode, setBanishMode] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const pickedRef = useRef<number | null>(null);
  const pickTimer = useRef(0);
  const openedAt = useRef(performance.now());
  const cardsRef = useRef(request.cards);
  const [dealKey, setDealKey] = useState(0);

  // reroll / banish replace the cards array → replay the deal animation
  useEffect(() => {
    if (cardsRef.current !== request.cards) {
      cardsRef.current = request.cards;
      setDealKey((k) => k + 1);
      openedAt.current = performance.now() - LOCKOUT_MS * 0.5;
    }
  }, [request.cards]);

  useEffect(
    () => () => {
      window.clearTimeout(pickTimer.current);
      pickTimer.current = 0;
    },
    [],
  );

  const locked = (): boolean => performance.now() - openedAt.current < LOCKOUT_MS;

  const choose = (i: number): void => {
    if (pickedRef.current !== null || locked() || i < 0 || i >= request.cards.length) return;
    if (banishMode || input?.isHeld('KeyB')) {
      if (!request.canBanish || request.banishes <= 0) {
        sfx('error');
        return;
      }
      sfx('cardBanish');
      setBanishMode(false);
      store.banish(i);
      return;
    }
    pickedRef.current = i;
    setPicked(i);
    sfx(opts.pickSound ?? 'cardPick');
    const reqId = request.id;
    window.clearTimeout(pickTimer.current);
    pickTimer.current = window.setTimeout(() => {
      pickTimer.current = 0;
      const cur = store.modal.peek();
      if (cur && 'request' in cur && cur.request.id !== reqId) return;
      store.chooseCard(i);
    }, opts.pickMs ?? 300);
  };
  const reroll = (): void => {
    if (picked !== null || locked()) return;
    if (!request.canReroll || request.rerolls <= 0) return sfx('error');
    sfx('cardReroll');
    setBanishMode(false);
    store.reroll();
  };
  const skip = (): void => {
    if (picked !== null || locked()) return;
    if (!request.canSkip || request.skips <= 0) return sfx('error');
    sfx('click');
    store.skip();
  };
  const banishArm = (): void => {
    if (picked !== null) return;
    if (!request.canBanish || request.banishes <= 0) return sfx('error');
    sfx('toggleOn');
    setBanishMode((m) => !m);
  };

  useKeys((a) => {
    switch (a.kind) {
      case 'card':
        if (!a.repeat) choose(a.index);
        return true;
      case 'reroll':
        if (!a.repeat) reroll();
        return true;
      case 'banish':
        if (!a.repeat) banishArm();
        return true;
      case 'skip':
        if (!a.repeat) skip();
        return true;
      case 'cancel':
        if (banishMode) {
          setBanishMode(false);
          return true;
        }
        return false;
      default:
        return false;
    }
  });
  // S = skip (the engine only maps X); ignore auto-repeat so a held movement key cannot skip
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyS' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return { banishMode, setBanishMode, picked, choose, reroll, skip, banishArm, dealKey };
}

function BuildRow({ label, children, class: cls }: { label: string; children: JSX.Element[]; class?: string }): JSX.Element {
  return (
    <div class={`ms-cm-slots ms-lu-row ${cls ?? ''}`}>
      <span class="ms-cm-slots-label">{label}</span>
      <div class="ms-cm-slotrow">{children}</div>
    </div>
  );
}

/**
 * Build bar (OF-02): a skill whose awakening hangs on a pact wears a chain mark. Gold and glowing = the pact is kept and the skill
 * stands at G2 (its next rank-up is the awakening); dim = it stands at G2 and waits for its passive; dim and broken = it stands at G2
 * and the passive can no longer be taken (no passive slot left). Other states stay bare, and with pacts off (no link) nothing is
 * added. The words are the aria label of the mark and the pact line of the skill's tooltip (a long-press on touch): never a native
 * `title`, which a desktop would show next to the tooltip.
 */
function PactTag({ link, children }: { link: PactLinkView | undefined; children: JSX.Element }): JSX.Element {
  if (!link || !(link.state === 'ready' || ((link.state === 'open' || link.state === 'blocked') && link.skillRank >= MAX_SKILL_RANK - 1))) return children;
  const label = link.state === 'ready' ? t('offers.bar.pactReady') : link.state === 'blocked' ? link.text : t('offers.bar.pactOpen', { name: link.passiveName });
  return (
    <span class={`ms-lu-pk is-${link.state}`}>
      {children}
      <span class="ms-lu-pk-mark" role="img" aria-label={label}>
        <PactGlyph broken={link.state === 'blocked'} />
      </span>
    </span>
  );
}

/** What is left of an action: one lit gem per use (an empty socket at 0, "x12" past five). Never the look of the hotkey cap. */
function Charges({ n }: { n: number }): JSX.Element {
  const left = t('levelup.left', { n: fmtInt(n) });
  return (
    <span class="ms-lu-charges" role="img" aria-label={left} title={left}>
      {n > 5 ? (
        <b class="ms-lu-charges-n">×{fmtInt(n)}</b>
      ) : n <= 0 ? (
        <i class="is-off" />
      ) : (
        Array.from({ length: n }, (_, i) => <i key={i} />)
      )}
    </span>
  );
}

/** A stone action plate: label, the uses left as gems, the hotkey cap (hidden on touch). */
function ActionButton({ label, count, k, onClick, disabled, active, title, mark }: { label: string; count: number; k: string; onClick: () => void; disabled: boolean; active?: boolean; title?: string; mark?: JSX.Element }): JSX.Element {
  return (
    <Button variant="wood" onClick={onClick} disabled={disabled} sound="none" {...(active ? { active } : {})} {...(title ? { title } : {})} class="ms-lu-act">
      <span class="ms-lu-act-label">
        {label}
        {mark}
      </span>
      <Charges n={count} />
      <KeyHint k={k} />
    </Button>
  );
}

/** Portrait phone: the modal scrolls when four cards do not fit; a stone chevron says so (and scrolls on a tap) while more lies below. */
function useMoreBelow(root: { current: HTMLElement | null }, deps: unknown[]): boolean {
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = root.current?.parentElement;
    if (!el) return;
    const upd = (): void => {
      if (!el.closest('.ms-portrait')) return setMore(false);
      setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 14);
    };
    // the cards fly in with a transform (their travel counts as scrollable overflow): measure once they have landed, not before
    const timer = window.setTimeout(upd, 1100);
    let roRaf = 0;
    const onResize = (): void => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        upd();
      });
    };
    el.addEventListener('scroll', upd, { passive: true });
    el.addEventListener('animationend', upd);
    void document.fonts?.ready.then(upd);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    ro?.observe(el);
    return () => {
      window.clearTimeout(timer);
      if (roRaf) cancelAnimationFrame(roRaf);
      el.removeEventListener('scroll', upd);
      el.removeEventListener('animationend', upd);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return more;
}

/** A name that wraps to two lines makes the plaque of every card of the row two lines tall (class on the modal, set from the DOM). */
function useTallNames(fx: { current: HTMLElement | null }, deps: unknown[]): void {
  useLayoutEffect(() => {
    const root = fx.current?.parentElement;
    if (!root) return;
    let last: boolean | null = null;
    const upd = (): void => {
      const tall = root.querySelector('.ms-card-name.is-wrap') !== null;
      if (tall === last && root.classList.contains('ms-lu--tallnames') === tall) return;
      last = tall;
      root.classList.toggle('ms-lu--tallnames', tall);
    };
    upd();
    void document.fonts?.ready.then(upd);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(upd);
    mo?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    return () => mo?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Where the level-up light stands: the floor line of the stage (the foot of the pillar, the centre of the floor disc) is the
 * bottom edge of the card row (the title block on a portrait phone, where the cards stack below it), as a % of the modal.
 */
function useFloor(fx: { current: HTMLElement | null }, deps: unknown[]): string {
  const [floor, setFloor] = useState('76%');
  useLayoutEffect(() => {
    const host = fx.current?.parentElement;
    if (!host) return;
    const put = (): void => {
      const r = host.getBoundingClientRect();
      const portrait = !!host.closest('.ms-portrait');
      const a = host.querySelector(portrait ? '.ms-lu-head' : '.ms-lu-cards')?.getBoundingClientRect();
      if (!a || r.height < 1) return;
      const y = portrait ? a.bottom - 6 : a.bottom - 14;
      setFloor(`${Math.max(20, Math.min(92, ((y - r.top) / r.height) * 100)).toFixed(1)}%`);
    };
    put();
    void document.fonts?.ready.then(put);
    let roRaf = 0;
    const onResize = (): void => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        put();
      });
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    ro?.observe(host);
    return () => {
      if (roRaf) cancelAnimationFrame(roRaf);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return floor;
}

export function LevelUp({ request }: { request: ModalRequest }): JSX.Element {
  const { store, content } = deps();
  const scope = useScope();
  const fxRef = useRef<HTMLDivElement>(null);
  const st = useCardModal(request, { pickMs: PICK_MS });
  const hud = store.hud.value;
  const maxSkills = content.balance.maxActiveSkills;
  const n = request.cards.length;
  const rarest = request.cards.some((c) => c.rarity === 'legendary');
  const floor = useFloor(fxRef, [n]);
  useTallNames(fxRef, [n]);
  const more = useMoreBelow(fxRef, [n, request.cards]);
  // the painted floor sprite (uk_levelup_ring, additive on black); the drawn disc is the fallback. The pillar is painted in code (PillarShaft).
  const ringSrc = texUrl('uk_levelup_ring');

  useEffect(() => {
    sfx('levelUp');
  }, []);

  const pactBy = new Map(pactLinks(hud).map((l) => [l.skillId, l]));
  // a skipped offer banks overflow.skipRefund Metin shards while the shard rules are on (sim/cards.ts skipOffer): the plate says so (R6: "Skip returns nothing")
  const overflow = content.balance.overflow ? resolveOverflow(content.balance.overflow) : null;
  const refund = overflow?.shards ? overflow.skipRefund : 0;
  // every skill the hero holds: the basic, the actives (their `maxSkills` sockets, empty ones shown) and the ultimates (QA PLAYREV-2)
  const skillSlots: JSX.Element[] = skillBar(splitSkills(hud?.skills, contentKindOf), maxSkills).map((s, i) =>
    s ? (
      <PactTag key={i} link={pactBy.get(s.id)}>
        <IconSlot size="md" icon={s.icon} kind="skill" rank={s.rank} awakened={s.awakened} {...tipProps(() => pactTip({ type: 'skill', id: s.id, rank: s.rank }, pactBy.get(s.id)))} />
      </PactTag>
    ) : (
      <IconSlot key={i} size="md" ghost="plus" />
    ),
  );
  const passiveSlots: JSX.Element[] = (hud?.passives ?? []).map((p, i) => (
    <IconSlot key={i} size="md" icon={p.icon} kind="passive" badge={p.rank} {...tipProps(() => buildTip({ type: 'passive', id: p.id, rank: p.rank }))} />
  ));
  // the light of the stage stays gold whatever the rarity (a legendary only burns brighter): the card rims carry the rarity colour
  const tone = 'gold';
  const titleShine = shineProps(t('levelup.title'), { delay: 0.5 });

  return (
    <div
      class={`ms-cardmodal ms-lu ms-norays ms-lu--n${n} ${rarest ? 'ms-cardmodal--legendary' : ''}`}
      style={{ '--n': String(n) } as JSX.CSSProperties}
      ref={scope}
      role="dialog"
      aria-modal="true"
      aria-label={t('levelup.title')}
    >
      <div class="ms-lu-fx" aria-hidden="true" ref={fxRef} style={{ '--lu-floor-y': floor } as JSX.CSSProperties}>
        <GodRays tone={tone} y={floor} intensity={rarest ? 0.55 : 0.4} size="110vmax" />
        {/* T14: a standing column of light on a lit floor disc under the card row (persistent), and the one-shot burst on top of it */}
        <FloorDisc src={ringSrc} />
        <PillarShaft height={`calc(${floor} + 1.2rem)`} />
        <Burst play={1} tone={tone} x="50%" y={floor} scale={1} halo ring={false} />
        <Motes preset="gold" count={26} y={0.5} intensity={0.8} />
      </div>

      <div class="ms-cm-head ms-lu-head">
        <Orb size="5.6rem" glow="rgba(255, 200, 100, 0.55)" level={t('levelup.lv')} class="ms-lu-orb" title={t('levelup.level', { n: fmtInt(request.level) })}>
          <b class="ms-lu-lv ms-num">{fmtInt(request.level)}</b>
        </Orb>
        <div class="ms-lu-titles">
          <h2 {...titleShine} class={`ms-cm-title ms-lu-title ${titleShine.class}`}>
            {t('levelup.title')}
          </h2>
          <p class={`ms-cm-sub ms-lu-sub ${st.banishMode ? 'is-banish' : ''}`}>{st.banishMode ? <b>{t('levelup.banishMode')}</b> : t('levelup.subtitle')}</p>
        </div>
      </div>

      <div class="ms-cm-cards ms-lu-cards" key={st.dealKey}>
        {request.cards.map((card, i) => (
          <CardView
            key={`${card.kind}:${card.id}:${i}`}
            card={card}
            index={i}
            delay={0.12 + i * 0.1}
            banish={st.banishMode}
            picked={st.picked === i}
            dim={st.picked !== null && st.picked !== i}
            onPick={st.choose}
          />
        ))}
      </div>

      {/* the ground ring of the burst crosses the cards for its first second (UiFx has no over-layer prop, so it is its own layer here) */}
      <div class="ms-lu-fx ms-lu-fx--over" aria-hidden="true">
        <Burst play={1} tone={tone} x="50%" y={floor} scale={1} pillar={false} star={false} flash={false} sparks={0} />
      </div>

      <div class="ms-cm-bottom ms-lu-bottom">
        {more && (
          <button
            type="button"
            class="ms-lu-more"
            data-nav=""
            aria-label={t('levelup.moreCards')}
            onClick={(e) => (e.currentTarget.closest('.ms-lu') as HTMLElement | null)?.scrollBy({ top: 300, behavior: 'smooth' })}
          >
            <svg viewBox="0 0 24 14" aria-hidden="true">
              <path d="M2 2.5 12 11.5 22 2.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        )}
        <Kit class="ms-plate ms-lu-build">
          <BuildRow label={t('levelup.slots')}>{skillSlots}</BuildRow>
          {passiveSlots.length > 0 && <BuildRow label={t('levelup.passives')} class="ms-lu-row--passives">{passiveSlots}</BuildRow>}
        </Kit>
        <Kit contents>
          <div class="ms-cm-actions ms-lu-actions">
            <ActionButton label={t('levelup.reroll')} count={request.rerolls} k="R" onClick={st.reroll} disabled={!request.canReroll || request.rerolls <= 0} />
            <ActionButton label={t('levelup.banish')} count={request.banishes} k="B" onClick={st.banishArm} disabled={!request.canBanish || request.banishes <= 0} active={st.banishMode} />
            <ActionButton
              label={t('levelup.skip')}
              count={request.skips}
              k="X"
              onClick={st.skip}
              disabled={!request.canSkip || request.skips <= 0}
              title={refund > 0 ? tn('offers.skip.refund', refund) : t('offers.skip.plain')}
              {...(refund > 0
                ? {
                    mark: (
                      <span class="ms-lu-act-refund" aria-hidden="true">
                        <CurrencyIcon kind="shard" size="1.05em" />
                        <b>+{fmtInt(refund)}</b>
                      </span>
                    ),
                  }
                : {})}
            />
          </div>
        </Kit>
      </div>
      {request.waited > 0 && <div class="ms-cm-hint">{t('levelup.waiting', { s: Math.max(0, Math.ceil(20 - request.waited)) })}</div>}
      <div class="ms-cm-hint ms-lu-hint">
        <span class="ms-kbd-only">{t('levelup.pickHint', { n })}</span>
        <span class="ms-touch-only">{t('levelup.pickHintTouch')}</span>
      </div>
    </div>
  );
}
