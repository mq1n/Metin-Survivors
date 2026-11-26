
// stone pattern repeats), with the hero orb standing on its left end, three stacked tube gauges, the coin sockets (kills / yeop /
// shards / damage per second), the auto-cast skills as octagon slots seated straight in the stone with a real pitch (hotkey
// numeral and rank medal INSIDE the slot), the spirit-stone / trinket sockets and the octagon picture buttons (region map, build
// board, menu). No framed boxes, nothing hangs off the strip, no lettering on the pictures. Phones re-seat the same parts:
// portrait lifts the vitals to the top-left and keeps two rows in the strip.
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { fmtCompact, fmtInt, fmtPct, t } from '../../i18n/i18n';
import type { HudSkillSlot, HudSnapshot } from '../../sim/types';
import { portraitFaceUrl, texUrl } from '../assets';
import { ClassEmblem } from '../components/Icon';
import { Orb } from '../components/Orb';
import { IconSlot } from '../components/Slot';
import { tipProps } from '../components/Tooltip';
import { deps } from '../env';
import { buildTip } from '../itemTips';
import { contentKindOf, skillBar, splitSkills } from '../skillSlots';
import { HudGauge } from './HudGauge';
import { layout } from '../layout';
import { BtnArt, CoinArt, HudDefs, type BtnKind, type CoinKind } from './art';
import { autoCast, setAutoCast } from '../../app/combatMode';
import { atlasOpen, buildInBar, buildOpen, equipInBar, fmtCd, mapInBar, meterOpen, setMeterOpen, useTrail } from './hooks';
import { slotFlash } from './skillCue';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** HP at or under this share of the maximum raises the low-health warning (orb ring, gauge, screen edges). */
export const LOW_HP = 0.3;



const BLOCKS: readonly { w: number; ox: number; oy: number; fl: 1 | -1; br: number }[] = [
  { w: 7.4, ox: 0, oy: 0, fl: 1, br: 1 },
  { w: 12.6, ox: -5.7, oy: -2.3, fl: -1, br: 1.03 },
  { w: 8.8, ox: -11.1, oy: -9.4, fl: 1, br: 0.97 },
  { w: 13.7, ox: -2.9, oy: -5.1, fl: -1, br: 1.01 },
  { w: 7.9, ox: -8.4, oy: -12.2, fl: 1, br: 0.98 },
  { w: 10.3, ox: -13.6, oy: -3.7, fl: -1, br: 1.03 },
  { w: 11.7, ox: -1.2, oy: -10.8, fl: 1, br: 0.97 },
  { w: 6.6, ox: -6.6, oy: -7.4, fl: -1, br: 1.01 },
  { w: 9.4, ox: -10.2, oy: -1.1, fl: 1, br: 1.03 },
  { w: 11.2, ox: -4.1, oy: -13.5, fl: -1, br: 0.98 },
  { w: 8.4, ox: -12.7, oy: -6.2, fl: 1, br: 1.03 },
];

function Strip(): JSX.Element {
  return (
    <div class="ms-tb-strip" aria-hidden="true" data-block="">
      {BLOCKS.map((b, i) => (
        <span key={i} class="ms-tb-blk" style={{ '--w': b.w, '--ox': `${b.ox}rem`, '--oy': `${b.oy}rem`, '--fl': b.fl, '--br': b.br } as JSX.CSSProperties}>
          <i />
        </span>
      ))}
    </div>
  );
}

function Vitals({ hud, low }: { hud: HudSnapshot; low: boolean }): JSX.Element {
  const { store } = deps();
  const sel = store.runSelection.value;
  const face = portraitFaceUrl(sel.classId, sel.sex);
  const hpFrac = hud.hpMax > 0 ? clamp01(hud.hp / hud.hpMax) : 0;
  const trail = useTrail(hpFrac);
  const shieldFrac = hud.hpMax > 0 ? clamp01(hud.shield / hud.hpMax) : 0;
  const xpFrac = hud.xpNext > 0 ? clamp01(hud.xp / hud.xpNext) : 0;
  return (
    <div class={`ms-tb-vitals ${low ? 'is-low' : ''}`} data-block="">
      <span key={hud.level} class="ms-tb-orb" data-block="" {...tipProps(() => <div class="ms-tip-title">{t('hud.level', { n: hud.level })}</div>)}>
        <Orb {...(face ? { src: face } : {})} level={hud.level} {...(low ? { glow: '#e3382a' } : {})}>
          {!face && <ClassEmblem classId={sel.classId} size="100%" />}
        </Orb>
      </span>
      <div class="ms-tb-gauges">
        <div class="ms-tb-hp" {...tipProps(() => <div>{t('hud.hp')}: {fmtInt(hud.hp)} / {fmtInt(hud.hpMax)}</div>)}>
          <HudGauge kind="hp" value={hpFrac} trail={trail} ch="var(--ch-hp)" low={low} label={`${fmtInt(hud.hp)} / ${fmtInt(hud.hpMax)}`} />
        </div>
        <div class={`ms-tb-sp ${shieldFrac <= 0 ? 'is-off' : ''}`} {...tipProps(() => <div>{hud.shield > 0 ? t('hud.hpShield', { n: fmtInt(hud.shield) }) : t('hud.noShield')}</div>)}>
          <HudGauge
            kind="sp"
            value={shieldFrac}
            ch="var(--ch-sm)"
            dormant={shieldFrac <= 0}
            labelEnd={
              <>
                <span class="ms-hg-tag">{t('hud.shield')}</span>
                {fmtInt(hud.shield)}
              </>
            }
          />
        </div>
        <div class="ms-tb-xp" {...tipProps(() => <div>{t('hud.level', { n: hud.level })} · {fmtInt(hud.xp)} / {fmtInt(hud.xpNext)}</div>)}>
          <HudGauge
            kind="xp"
            value={xpFrac}
            ch="var(--ch-sm)"
            flash={hud.level}
            labelEnd={
              <>
                <span class="ms-hg-tag">{t('hud.xp')}</span>
                {fmtPct(xpFrac)}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

/** A painted raster of the picture once the manifest ships one, else the drawn picture. */
function Picture({ id, fallback }: { id: string; fallback: JSX.Element }): JSX.Element {
  const url = texUrl(id);
  return url ? <img class="ms-tb-img" src={url} alt="" draggable={false} decoding="async" /> : fallback;
}

function Coin({ kind, value, label }: { kind: CoinKind; value: string; label: string }): JSX.Element {
  return (
    <div class={`ms-tb-coin ms-tb-coin--${kind}`} role="group" aria-label={`${label}: ${value}`} {...tipProps(() => <div class="ms-tip-title">{label}</div>)}>
      <span class="ms-tb-lens">
        <Picture id={`uk_hud_ico_${kind}`} fallback={<CoinArt kind={kind} />} />
      </span>
      <b class="ms-num">{value}</b>
    </div>
  );
}

/** The fourth coin: damage per second. It is also the toggle of the damage-meter table (the number never sits on a button picture). */
function DpsCoin({ hud }: { hud: HudSnapshot }): JSX.Element {
  const open = meterOpen.value;
  const dps = fmtCompact(hud.dps);
  const label = `${t('hud.toggleMeter')}: ${dps}/s`;
  return (
    <button type="button" class={`ms-tb-coin ms-tb-coin--dps ms-tb-coin--btn ${open ? 'is-open' : ''}`} data-nav="" aria-pressed={open} aria-label={label} {...tipProps(() => <div class="ms-tip-title">{label}</div>)} onClick={() => setMeterOpen(!open)}>
      <span class="ms-tb-lens">
        <Picture id="uk_hud_ico_dps" fallback={<CoinArt kind="dps" />} />
      </span>
      <b class="ms-num">{dps}</b>
    </button>
  );
}

function Coins({ hud }: { hud: HudSnapshot }): JSX.Element {
  return (
    <div class="ms-tb-coins" data-block="">
      <Coin kind="kills" value={fmtCompact(hud.kills)} label={t('hud.kills')} />
      <Coin kind="yeop" value={fmtCompact(hud.yeop)} label={t('hud.yeop')} />
      <Coin kind="shard" value={fmtInt(hud.shards)} label={t('hud.shards')} />
      {!layout.value.compact && <DpsCoin hud={hud} />}
    </div>
  );
}

/** A carved socket for a slot the run has not filled yet: an octagon dimple with a lit lower rim (never a faint copy of a slot
 *  frame, so neighbours can not overlap into a "( ( (" chain). Sized by --s like a slot. */
export function Dimple(): JSX.Element {
  return (
    <span class="ms-tb-dimple" aria-hidden="true">
      <i />
    </span>
  );
}

/** One auto-cast slot; while it cools the wedge sweeps and the snapshot's `cdLeft` (seconds) is the countdown number on it.
 *  Context skills (DESIGN M1) add a ring on the slot's rim: ARMED (ready, waiting for its trigger) = a pulsing amber rim, ACTIVE (its
 *  window / shell is up) = a mint rim that sweeps away clockwise as the window runs out. An INSURANCE skill (War Oath, Cure: `calm`)
 *  sits armed for most of a run, so its armed rim is a calm static one (no pulse, dimmer, cooler gold). A co-op guest's mirror has no
 *  `state` (reads as cooling). */
function SkillSlot({ s, i }: { s: HudSkillSlot; i: number }): JSX.Element {
  const { input } = deps();
  const cd = s.basic ? 0 : s.cooldown;
  const state = s.state ?? 'cooling';
  const left = s.activeLeft ?? 0;
  const fired = slotFlash.value[s.id] ?? 0;
  // the window's length is not in the snapshot: the largest value seen since it opened is the full ring (kills may stretch it)
  const peak = useRef(0);
  if (state !== 'active') peak.current = 0;
  else if (left > peak.current) peak.current = left;
  const ringStyle = state === 'active' ? ({ '--ring-a': `${(peak.current > 0 ? clamp01(left / peak.current) : 1) * 360}deg` } as JSX.CSSProperties) : undefined;
  return (
    <span
      class={`ms-tb-sk ${state === 'cooling' ? '' : `is-${state}`}${state === 'armed' && s.calm ? ' is-calm' : ''}`}
      data-state={state}
      onClick={() => input?.triggerSkillSlot(i)}
    >
      <IconSlot icon={s.icon} kind="skill" rank={s.rank} hotkey={String(i + 1)} cooldown={cd} awakened={s.awakened} {...tipProps(() => buildTip({ type: 'skill', id: s.id, rank: s.rank }))} />
      {state !== 'cooling' && <i class="ms-tb-ring" style={ringStyle} aria-hidden="true" />}
      <span class="ms-tb-fire-host" aria-hidden="true">
        {fired > 0 && <i key={fired} class={`ms-tb-fire ${s.basic ? 'is-basic' : ''}`} />}
      </span>
      {cd > 0.001 && s.cdLeft > 0.001 && <b class="ms-tb-cdnum ms-num">{fmtCd(s.cdLeft)}</b>}
    </span>
  );
}

function AutoCastToggle(): JSX.Element {
  const on = autoCast.value;
  const tip = on ? t('hud.autoCast.on') : t('hud.autoCast.off');
  const label = on ? t('hud.autoCast.labelOn') : t('hud.autoCast.labelOff');
  return (
    <button
      type="button"
      class={`ms-tb-auto ${on ? 'is-on' : 'is-manual'}`}
      data-block=""
      aria-pressed={on}
      aria-label={tip}
      {...tipProps(() => <div class="ms-tip-title">{tip}</div>)}
      onClick={(e) => {
        setAutoCast(!on);
        e.currentTarget.blur();
      }}
    >
      <i class="ms-tb-auto-dot" aria-hidden="true" />
      <span class="ms-tb-auto-txt">{label}</span>
    </button>
  );
}

export const PORTRAIT_TASKBAR = {
  tbHRem: 7.7,
  slotSRem: 3,
  slotGapRatio: 0.14,
  seatBezelRem: 0.2,
  skillsLeftRem: 0.75,
  skillsBottomRem: 0.95,
  skillsBudgetReserveRem: 2.15,
  pauseRightRem: 0.6,
  pauseBottomRem: 1,
  pauseMinRem: 3.3,
  coinsBottomRem: 4.55,
  coinsHeightRem: 2.9,
  autoRightRem: 0.6,
  autoAboveStripRem: 0.55,
  autoMinHeightRem: 2.4,
  autoPadXRem: 0.72,
  autoGapRem: 0.4,
  autoDotRem: 0.56,
  autoBorderPx: 1.5,
} as const;

export interface PortraitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PortraitLayoutSpec {
  w: number;
  h: number;
  rem: number;
  tap: number;
  seats: number;
  autoTextPx: number;
  safeL?: number;
  safeR?: number;
  safeB?: number;
}

/** Exact CSS-cascade bounding boxes for the portrait phone taskbar (`hud.css` `.ms-portrait`) used to verify non-overlap. */
export function portraitTaskbarRects(spec: PortraitLayoutSpec): {
  strip: PortraitRect;
  skills: PortraitRect;
  skillsBezel: PortraitRect;
  pause: PortraitRect;
  coins: PortraitRect;
  auto: PortraitRect;
  slotPx: number;
} {
  const { w, h, rem, tap, seats, autoTextPx } = spec;
  const safeL = spec.safeL ?? 0;
  const safeR = spec.safeR ?? 0;
  const safeB = spec.safeB ?? 0;
  const P = PORTRAIT_TASKBAR;
  const n = Math.max(1, Math.floor(seats));
  const skN = Math.max(6, n);
  const skF = Math.min(1, 35 / (6 * skN - 1));
  const btnS = Math.max(P.pauseMinRem * rem, tap);
  const budget = Math.max(0, w - safeL - safeR - btnS - P.skillsBudgetReserveRem * rem);
  const units = (1 + P.slotGapRatio) * skN - P.slotGapRatio;
  const slotPx = Math.min(P.slotSRem * rem * skF, budget / units);
  const gapPx = slotPx * P.slotGapRatio;
  const skillsW = n * slotPx + Math.max(0, n - 1) * gapPx;
  const skillsL = P.skillsLeftRem * rem + safeL;
  const skillsB = h - (P.skillsBottomRem * rem + safeB);
  const bezel = P.seatBezelRem * rem;

  const pauseR = w - (P.pauseRightRem * rem + safeR);
  const pauseB = h - (P.pauseBottomRem * rem + safeB);

  const tbH = P.tbHRem * rem;
  const stripT = h - (tbH + safeB);

  const coinsB = h - (P.coinsBottomRem * rem + safeB);
  const coinsH = P.coinsHeightRem * rem;

  const autoH = Math.max(P.autoMinHeightRem * rem, tap);
  const autoChromeW = (P.autoPadXRem * 2 + P.autoDotRem + P.autoGapRem) * rem + P.autoBorderPx * 2;
  const autoMaxW = Math.max(0, w - safeL - safeR - P.autoRightRem * 2 * rem);
  const autoW = Math.min(autoMaxW, autoChromeW + autoTextPx);
  const autoR = w - (P.autoRightRem * rem + safeR);
  const autoB = h - (tbH + P.autoAboveStripRem * rem + safeB);

  return {
    strip: { left: 0, top: stripT, right: w, bottom: h, width: w, height: tbH + safeB },
    skills: { left: skillsL, top: skillsB - slotPx, right: skillsL + skillsW, bottom: skillsB, width: skillsW, height: slotPx },
    skillsBezel: { left: skillsL - bezel, top: skillsB - slotPx - bezel, right: skillsL + skillsW + bezel, bottom: skillsB + bezel, width: skillsW + bezel * 2, height: slotPx + bezel * 2 },
    pause: { left: pauseR - btnS, top: pauseB - btnS, right: pauseR, bottom: pauseB, width: btnS, height: btnS },
    coins: { left: safeL, top: coinsB - coinsH, right: w - safeR, bottom: coinsB, width: w - safeL - safeR, height: coinsH },
    auto: { left: autoR - autoW, top: autoB - autoH, right: autoR, bottom: autoB, width: autoW, height: autoH },
    slotPx,
  };
}

function Skills({ hud }: { hud: HudSnapshot }): JSX.Element {
  const { content } = deps();
  // the basic attack and the talent ultimates do not take one of the maxActiveSkills slots (the sim counts the actives only): all
  // of the actives get their slot, the basic leads the bar and the ultimates follow it (QA PLAYREV-2: the 6th active had no slot)
  const bar = skillBar(splitSkills(hud.skills, contentKindOf), content.balance.maxActiveSkills);
  const slots: JSX.Element[] = bar.map((s, i) => (s ? <SkillSlot key={s.id} s={s} i={i} /> : <Dimple key={`e${i}`} />));
  return (
    <div class="ms-tb-skills" role="group" aria-label={t('hud.skills')} data-dense={bar.length > 8 ? '' : undefined} style={bar.length > 6 ? ({ '--sk-n': String(bar.length) } as JSX.CSSProperties) : undefined}>
      {slots}
    </div>
  );
}



function Equip({ hud }: { hud: HudSnapshot }): JSX.Element | null {
  if (hud.stones.length === 0 && hud.trinkets.length === 0) return null;
  return (
    <div class="ms-tb-equip" data-block="">
      <div class="ms-tb-eq-group" role="group" aria-label={t('hud.stones')}>
        {hud.stones.map((s, i) =>
          s ? (
            <span key={`s${i}`} class="ms-tb-sk">
              <IconSlot size="sm" icon={s.icon} kind="stone" badge={`+${s.level}`} {...tipProps(() => buildTip({ type: 'stone', id: s.id, level: s.level }))} />
            </span>
          ) : (
            <Dimple key={`s${i}`} />
          ),
        )}
      </div>
      <span class="ms-tb-eq-sep" aria-hidden="true" />
      <div class="ms-tb-eq-group" role="group" aria-label={t('hud.trinkets')}>
        {hud.trinkets.map((s, i) =>
          s ? (
            <span key={`t${i}`} class="ms-tb-sk">
              <IconSlot size="sm" icon={s.icon} kind="trinket" badge={s.rank} {...tipProps(() => buildTip({ type: 'trinket', id: s.id, rank: s.rank }))} />
            </span>
          ) : (
            <Dimple key={`t${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

function BtnFace({ kind }: { kind: BtnKind }): JSX.Element {
  return (
    <span class="ms-tb-art" aria-hidden="true">
      <Picture id={`uk_hud_btn_${kind}`} fallback={<BtnArt kind={kind} />} />
    </span>
  );
}

function MenuButtons({ hud }: { hud: HudSnapshot }): JSX.Element {
  const { store } = deps();
  const atlas = atlasOpen.value;
  const build = buildOpen.value;
  const items = hud.passives.length + hud.stones.filter(Boolean).length + hud.trinkets.filter(Boolean).length;
  const pause = layout.value.touch ? t('hud.pause') : `${t('hud.pause')} · Esc`;
  return (
    <div class="ms-tb-btns">
      {mapInBar() && (
        <button type="button" class={`ms-tb-btn ms-plate ms-tb-btn--map ${atlas ? 'is-open' : ''}`} data-nav="" aria-pressed={atlas} aria-label={t('zonemap.openAtlas')} {...tipProps(() => <div class="ms-tip-title">{t('zonemap.openAtlas')}</div>)} onClick={() => (atlasOpen.value = !atlas)}>
          <BtnFace kind="map" />
        </button>
      )}
      {buildInBar() && (
        <button type="button" class={`ms-tb-btn ms-plate ms-tb-btn--build ${build ? 'is-open' : ''}`} data-nav="" aria-pressed={build} aria-label={t('hud.build')} {...tipProps(() => <div class="ms-tip-title">{t('hud.build')}</div>)} onClick={() => (buildOpen.value = !build)}>
          <BtnFace kind="build" />
          {items > 0 && <b class="ms-tb-badge ms-num">{items}</b>}
        </button>
      )}
      <button type="button" class="ms-tb-btn ms-plate ms-tb-btn--menu" data-nav="" aria-label={t('hud.pause')} {...tipProps(() => <div class="ms-tip-title">{pause}</div>)} onClick={() => store.pause()}>
        <BtnFace kind="menu" />
      </button>
    </div>
  );
}

export function Taskbar({ hud, low }: { hud: HudSnapshot; low: boolean }): JSX.Element {
  return (
    <div class={`ms-tb ${equipInBar() ? 'ms-tb--wide' : ''}`}>
      <HudDefs />
      <Strip />
      <div class="ms-tb-left">
        <Vitals hud={hud} low={low} />
        <Coins hud={hud} />
      </div>
      <div class="ms-tb-center">
        <Skills hud={hud} />
      </div>
      <div class="ms-tb-right">
        {equipInBar() && <Equip hud={hud} />}
        <MenuButtons hud={hud} />
      </div>
      <AutoCastToggle />
    </div>
  );
}
