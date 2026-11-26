// Boss reward: "Spoils of <boss>". A banner for the slain boss (epithet, zone, SLAIN stamp), the painted open chest and a
// radial light behind the cards, a slow dramatic deal-in, and hold-to-reveal for legendary cards (face-down until you hold
// the card — or press Enter / its number — then it flips with a golden burst). Pick flow is the shared `useCardModal`.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, tl } from '../../i18n/i18n';
import type { Card, ModalRequest } from '../../sim/types';
import { texUrl, zoneArtUrl } from '../assets';
import { sfx } from '../audio';
import { UiGlyph } from '../components/StatIcon';
import { Burst, GodRays, Motes } from '../components/UiFx';
import { indexOf } from '../content';
import { cardStartsHidden } from '../cardModel';
import { deps } from '../env';
import { useKeys, useScope } from '../nav';
import { CardView } from './Card';
import { useCardModal } from './LevelUp';
import { CoinSpray, RewardActions, RewardHead } from './rewardKit';
import './boss.css';

const HOLD_MS = 850;
const KEY_HOLD_MS = 600;

interface BossCardProps {
  card: Card;
  index: number;
  delay: number;
  hidden: boolean;
  banish: boolean;
  picked: boolean;
  dim: boolean;
  onPick: (i: number) => void;
  onShown: (i: number) => void;
  /** lets the hotkey handler start the reveal of this card */
  register: (i: number, reveal: (() => void) | null) => void;
}

type Face = 'back' | 'charging' | 'flipping' | 'front';

/** One reward card; legendary ones start face-down and must be revealed (hold / Enter) before they can be picked. */
function BossCard({ card, index, delay, hidden, banish, picked, dim, onPick, onShown, register }: BossCardProps): JSX.Element {
  const [born] = useState(hidden);
  const seal = texUrl('uk_essence_chest_seal');
  const [face, setFace] = useState<Face>(born ? 'back' : 'front');
  const [prog, setProg] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);
  const dur = useRef(HOLD_MS);
  const flipTimer = useRef(0);
  const pickTimer = useRef(0);
  const latest = useRef({ banish, picked, onPick, onShown });
  latest.current = { banish, picked, onPick, onShown };

  useEffect(() => {
    if (picked || banish) {
      window.clearTimeout(pickTimer.current);
      pickTimer.current = 0;
    }
  }, [picked, banish]);

  const stop = (): void => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };
  const flip = (): void => {
    stop();
    setProg(1);
    setFace('flipping');
    sfx('unlock');
    flipTimer.current = window.setTimeout(() => {
      setFace('front');
      latest.current.onShown(index);
      // Directly activate/claim the legendary card once hold-to-open reveals it (no extra click required).
      if (!latest.current.banish && !latest.current.picked) {
        pickTimer.current = window.setTimeout(() => {
          pickTimer.current = 0;
          if (!latest.current.banish && !latest.current.picked) latest.current.onPick(index);
        }, 480);
      }
    }, 300);
  };
  const charge = (ms: number): void => {
    if (face === 'flipping' || face === 'front' || raf.current) return;
    dur.current = ms;
    start.current = performance.now();
    setFace('charging');
    const tick = (now: number): void => {
      const k = Math.min(1, (now - start.current) / dur.current);
      setProg(k);
      if (k >= 1) flip();
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const release = (): void => {
    if (face !== 'charging' || dur.current !== HOLD_MS) return;
    stop();
    setProg(0);
    setFace('back');
  };

  useEffect(() => {
    register(index, face === 'back' || face === 'charging' ? () => charge(KEY_HOLD_MS) : null);
  });
  useEffect(
    () => () => {
      register(index, null);
      stop();
      window.clearTimeout(flipTimer.current);
      window.clearTimeout(pickTimer.current);
    },
    [],
  );

  if (face === 'front') {
    const wasHidden = born;
    return (
      <div class={`ms-boss-flipwrap ${wasHidden ? 'is-revealed' : ''}`} style={{ '--deal-delay': `${wasHidden ? 0 : delay}s` } as JSX.CSSProperties}>
        <CardView card={card} index={index} delay={wasHidden ? 0 : delay} banish={banish} picked={picked} dim={dim} onPick={onPick} />
        {wasHidden && <Burst play={1} tone="legendary" x="50%" y="46%" scale={0.7} sparks={30} seed={index + 4} />}
      </div>
    );
  }
  return (
    <button
      type="button"
      class={`ms-card ms-boss-back ms-r-legendary ${face === 'flipping' ? 'is-flipping' : ''} ${face === 'charging' ? 'is-charging' : ''}`}
      style={{ '--deal-delay': `${delay}s`, '--deal-rot': `${(index - 1) * 2.2}deg`, '--p': `${(prog * 360).toFixed(1)}deg` } as JSX.CSSProperties}
      data-nav=""
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        charge(HOLD_MS);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        // keyboard activation (Enter / Space) arrives as a click with no pointer: reveal on a short automatic hold
        if (e.detail === 0) charge(KEY_HOLD_MS);
      }}
    >
      <span class="ms-card-bg" aria-hidden="true" />
      <span class="ms-card-gem" aria-hidden="true" />
      <span class="ms-card-key">{index + 1}</span>
      <span class="ms-boss-crest">
        <span class="ms-boss-ring" />
        {seal ? (
          <img class="ms-boss-seal" src={seal} alt="" aria-hidden="true" draggable={false} />
        ) : (
          <span class="ms-boss-sigil">
            <UiGlyph name="crown" tone="gold" size="3.6rem" />
          </span>
        )}
      </span>
      <span class="ms-card-rarity">{t('rarity.legendary')}</span>
      <span class="ms-card-name ms-boss-wait">{t('bossReward.legendaryWaits')}</span>
      <span class="ms-boss-ghosts" aria-hidden="true">
        {['?????? ????', '???? ?????'].map((label, k) => (
          <span class="ms-card-line has-ico ms-boss-ghost" key={k}>
            <span class="ms-boss-ghost-ico ms-plate">
              <b class="ms-num">?</b>
            </span>
            <span class="ms-card-llabel ms-boss-ghost-label">{label}</span>
            <span class="ms-card-well">
              <b class="ms-boss-ghost-val ms-num">+??%</b>
            </span>
          </span>
        ))}
      </span>
      <span class="ms-boss-hold ms-plate">
        <UiGlyph name="lock" tone="gold" flat size="1.1rem" />
        {t('bossReward.holdToReveal')}
      </span>
    </button>
  );
}

export function BossReward({ request }: { request: ModalRequest }): JSX.Element {
  const { content, store } = deps();
  const ix = indexOf(content);
  const scope = useScope();
  const st = useCardModal(request);
  const boss = ix.bosses.get(request.source);
  const zone = ix.zones.get(store.runSelection.value.zone) ?? ix.zones.get(content.zones.find((z) => z.bosses.some((b) => b.boss === request.source) || z.final.boss === request.source)?.id ?? '');
  const artUrl = zone ? zoneArtUrl(zone) : null;
  // the stage floor: the 2:1 boss-chest plate (desktop / tablet / phone landscape); phone portrait draws the boss's open chest (boss.css)
  const chestUrl = texUrl('art_chest_boss') ?? texUrl('art_chest_boss_open') ?? texUrl('art_chest_open');
  const bossName = boss ? tl(boss.name) : t('bossReward.fallback');

  // legendary cards stay hidden until revealed; keys are per deal so a reroll re-hides the new legendaries
  const [shown, setShown] = useState<Record<string, true>>({});
  const reveals = useRef(new Map<number, () => void>());
  const keyOf = (i: number): string => `${st.dealKey}:${i}`;
  // a legendary SURPRISE waits for the hold; the Sky Sovereign's Boon (always legendary, never a surprise) is dealt face up (cardModel.cardStartsHidden)
  const isHidden = (i: number): boolean => {
    const card = request.cards[i];
    return card !== undefined && cardStartsHidden(card) && !shown[keyOf(i)];
  };
  // 1-4 cards: the milestone reward is three (rank-up, essence, epic), a dry build is dealt two (Boon + shards); four share LevelUp's card contract
  const n = Math.max(1, Math.min(4, request.cards.length));

  useEffect(() => {
    sfx('bossRoar');
  }, []);

  useKeys((a) => {
    if (a.kind === 'card' && isHidden(a.index)) {
      if (!a.repeat) reveals.current.get(a.index)?.();
      return true;
    }
    return false;
  });

  return (
    <div
      class={`ms-cardmodal ms-rw ms-cardmodal--legendary ms-boss ms-boss--n${n} ${n >= 4 ? 'ms-lu--n4' : ''} ms-norays`}
      style={{ '--n': String(n), ...(artUrl ? { '--zone-art': `url("${artUrl}")` } : {}) } as JSX.CSSProperties}
      ref={scope}
      role="dialog"
      aria-modal="true"
      aria-label={t('bossReward.title', { name: bossName })}
    >
      <GodRays tone="legendary" y="50%" intensity={0.62} seed={23} />
      <div class="ms-boss-stage" aria-hidden="true">
        <div class="ms-boss-zone" />
        <div class="ms-boss-aura" />
        {chestUrl && <div class={`ms-boss-chest ${texUrl('art_chest_boss') ? 'is-plate' : ''}`} />}
      </div>
      <Motes preset="gold" count={40} color="#ffc65a" seed={13} />
      <Burst play={1} tone="legendary" y="50%" scale={1.15} sparks={60} seed={13} />
      <CoinSpray play={1} x={0.5} y={0.86} count={44} seed={29} delay={0.35} />

      <RewardHead
        class="ms-boss-head"
        title={t('bossReward.title', { name: bossName })}
        sub={st.banishMode ? <b>{t('levelup.banishMode')}</b> : t('bossReward.subtitle')}
        eyebrow=""
        banner={
          <div class="ms-boss-banner ms-plate">
            <span class="ms-boss-medal">
              <UiGlyph name="skull" tone="crimson" size="1.7rem" />
            </span>
            <span class="ms-boss-plate">
              <b>{boss ? tl(boss.title) : bossName}</b>
            </span>
            <span class="ms-boss-stamp ms-stamp">{t('bossReward.slain')}</span>
          </div>
        }
      />

      <div class="ms-cm-cards ms-boss-cards" key={st.dealKey}>
        {request.cards.map((card, i) => (
          <BossCard
            key={`${st.dealKey}:${card.kind}:${card.id}:${i}`}
            card={card}
            index={i}
            delay={0.5 + i * 0.3}
            hidden={isHidden(i)}
            banish={st.banishMode}
            picked={st.picked === i}
            dim={st.picked !== null && st.picked !== i}
            onPick={st.choose}
            onShown={(idx) => setShown((s) => ({ ...s, [keyOf(idx)]: true }))}
            register={(idx, fn) => {
              if (fn) reveals.current.set(idx, fn);
              else reveals.current.delete(idx);
            }}
          />
        ))}
      </div>

      <RewardActions st={st} request={request} sealedNote={t('bossReward.sealedNote')} class="ms-boss-bottom" />
      {request.waited > 0 && <div class="ms-cm-hint">{t('levelup.waiting', { s: Math.max(0, Math.ceil(20 - request.waited)) })}</div>}
    </div>
  );
}
