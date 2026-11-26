
// blocks (hero orb under a raised half-ring crown, health / shield / experience gauges between one brass bracket per side, kill /
// yeop / shard coin sockets, auto-cast skill slots, spirit-stone + trinket sockets and four octagon buttons with engraved sepia
// pictures: region map, build board, damage meter, menu: Taskbar.tsx, art.tsx), the round zone minimap top-right with its painted
// picture (Minimap.tsx, minimapPaint.ts), a carved timer plaque + boss plate top-centre (BossPlate.tsx), the passives as a bare

// (BuildBoard.tsx), event banners, the low-HP / hit / darkness overlays, the corruption gauge, the optional damage meter table, the
// co-op status and the touch joystick.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtCompact, fmtPct, fmtTime, t } from '../../i18n/i18n';
import { settings } from '../../engine/settings';
import { texUrl } from '../assets';
import type { HudSnapshot } from '../../sim/types';
import { IconSlot } from '../components/Slot';
import { Kit } from '../components/Panel';
import { IconArt } from '../components/Icon';
import { Motes, shineProps } from '../components/UiFx';
import { UiGlyph } from '../components/StatIcon';
import { tipProps } from '../components/Tooltip';
import { indexOf, skillName } from '../content';
import { deps } from '../env';
import { buildTip } from '../itemTips';
import { layout } from '../layout';
import { announcements, hitFlash, levelPop, useAnnounceFeed, type Announcement, type AnnounceTone } from './announce';
import { CoinArt } from './art';
import { BossRow } from './BossPlate';
import { BuildBoard } from './BuildBoard';
import { EdgeArrows } from './EdgeArrows';
import { HudGauge } from './HudGauge';
import { atlasOpen, buildOpen, equipInBar, meterOpen, miscOpen } from './hooks';
import { Atlas, Minimap } from './Minimap';
import { castCues, useSkillCueFeed } from './skillCue';
import { LOW_HP, Taskbar } from './Taskbar';
import './hud.css';

// ---------------------------------------------------------------------------------------------------- build strip




function BuildStrip({ hud }: { hud: HudSnapshot }): JSX.Element | null {
  const compact = layout.value.compact;
  const passives = hud.passives;
  const hasMisc = hud.stones.some(Boolean) || hud.trinkets.some(Boolean);
  const miscCount = hud.stones.filter(Boolean).length + hud.trinkets.filter(Boolean).length;
  const inBar = equipInBar();
  const chip = compact && hasMisc;
  const showMisc = hasMisc && !inBar && (!compact || miscOpen.value);
  if (passives.length === 0 && !chip) return null;
  return (
    <div class="ms-bs" data-block="">
      {(passives.length > 0 || chip) && (
        <div class="ms-bs-row" role="group" aria-label={t('hud.passives')}>
          {passives.map((p) => (
            <IconSlot key={p.id} size="sm" icon={p.icon} kind="passive" badge={p.rank} {...tipProps(() => buildTip({ type: 'passive', id: p.id, rank: p.rank }))} />
          ))}
          {chip && (
            <button type="button" class={`ms-bs-more ms-plate ${miscOpen.value ? 'is-open' : ''}`} data-nav="" aria-expanded={miscOpen.value} aria-label={t('hud.build.more')} {...tipProps(() => <div class="ms-tip-title">{t('hud.build.more')}</div>)} onClick={() => (miscOpen.value = !miscOpen.value)}>
              <span class="ms-bs-gem" aria-hidden="true">
                <CoinArt kind="relic" />
              </span>
              <b class="ms-num">{miscCount}</b>
              <span class="ms-hit" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {showMisc && (
        <div class="ms-bs-row ms-bs-row--misc" role="group" aria-label={`${t('hud.stones')} · ${t('hud.trinkets')}`}>
          {hud.stones.map((s, i) =>
            s ? <IconSlot key={`s${i}`} size="xs" icon={s.icon} kind="stone" badge={`+${s.level}`} {...tipProps(() => buildTip({ type: 'stone', id: s.id, level: s.level }))} /> : null,
          )}
          {hud.stones.some(Boolean) && hud.trinkets.some(Boolean) && <span class="ms-bs-sep" aria-hidden="true" />}
          {hud.trinkets.map((s, i) =>
            s ? <IconSlot key={`t${i}`} size="xs" icon={s.icon} kind="trinket" badge={s.rank} {...tipProps(() => buildTip({ type: 'trinket', id: s.id, rank: s.rank }))} /> : null,
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- top centre

/** What the timer line says: the countdown to the next boss, the Great Metin, "boss fight" while one is on the field (never
 *  "Next boss in 00:00"), or that every boss is down. */
function timerFlags(hud: HudSnapshot): { soon: boolean; fight: boolean; final: boolean; line: string } {
  const nb = hud.nextBoss;
  const bossDef = nb ? indexOf().bosses.get(nb.id) : undefined;
  const final = !!(nb && bossDef && indexOf().zonesOrdered.some((z) => z.final.boss === nb.id));
  const fight = !!hud.boss;
  const soon = !fight && !!nb && nb.in < 30;
  const line = fight ? t('hud.bossFight') : nb ? t(final ? 'hud.finalBoss' : 'hud.nextBoss', { time: fmtTime(nb.in) }) : t('hud.noBoss');
  return { soon, fight, final, line };
}

/** The clock + its line (+ the corruption line on portrait phones): the inside of the timer plate and of the card's first row. */
function TimerInner({ hud, withCorruption }: { hud: HudSnapshot; withCorruption?: boolean }): JSX.Element {
  const { soon, fight, final, line } = timerFlags(hud);
  const corr = withCorruption && hud.corruption >= 0.01 ? Math.min(1, hud.corruption) : 0;
  return (
    <>
      <div class="ms-tm-time ms-num">{fmtTime(hud.time)}</div>
      <div class="ms-tm-next">
        <UiGlyph name={final && !fight ? 'crown' : 'skull'} tone={soon || fight ? 'crimson' : 'pewter'} flat />
        <span>{line}</span>
      </div>
      {corr > 0 && (
        <div class={`ms-tm-co ${corr > 0.66 ? 'is-high' : ''}`} {...tipProps(() => <div>{corr > 0.66 ? t('hud.corruption.high') : t('hud.corruption')}</div>)}>
          <UiGlyph name="flame" tone={corr > 0.66 ? 'crimson' : 'bronze'} flat />
          <span class="ms-co-label">{t('hud.corruption')}</span>
          <HudGauge kind="corr" value={corr} ch="0.6rem" />
          <b class="ms-num">{fmtPct(corr)}</b>
        </div>
      )}
    </>
  );
}

/** The timer as its own plate: portrait phones keep it on the top-left block, beside the minimap, with the corruption line. */
function Timer({ hud, withCorruption }: { hud: HudSnapshot; withCorruption?: boolean }): JSX.Element {
  const { soon, fight } = timerFlags(hud);
  const corr = withCorruption && hud.corruption >= 0.01;
  return (
    <div class={`ms-tm ms-plate ${soon ? 'is-soon' : ''} ${fight ? 'is-fight' : ''} ${corr ? 'has-co' : ''}`} data-block="" role="timer" aria-label={t('hud.time')}>
      <TimerInner hud={hud} {...(withCorruption ? { withCorruption } : {})} />
    </div>
  );
}

const TONE_LABEL: Partial<Record<AnnounceTone, string>> = {
  boss: 'hud.ann.boss',
  metin: 'hud.ann.metin',
  danger: 'hud.ann.danger',
  victory: 'hud.ann.victory',
};
const TONE_FX: Partial<Record<AnnounceTone, string>> = { boss: '#ff5a3c', danger: '#ff7a3a', victory: '#ffd36a', metin: '#ffb050' };

/** The event banner as the LAST ROW of the top-centre card (boss incoming, Metin falling, phases, victories): a toned glow behind
 *  an eyebrow word, the title with a light sweep and the subtitle. It opens and closes inside the card (never a plate of its own).
 *  Big ones (boss, great Metin, victory) throw sparks. */
function AnnounceRow({ a }: { a: Announcement }): JSX.Element {
  const eyebrow = TONE_LABEL[a.tone];
  const fx = a.color ?? TONE_FX[a.tone];
  const shine = shineProps(a.title, { delay: 0.15 });
  return (
    <div role="status" class={`ms-tc-an ms-an--${a.tone} ${a.big ? 'is-big' : ''}`} style={a.color ? ({ '--ac': a.color } as JSX.CSSProperties) : undefined}>
      {a.big && fx && (
        <span class="ms-an-fx" aria-hidden="true">
          <Motes preset="burst" count={64} color={fx} x={0.5} y={0.55} spread={1.7} intensity={1.6} seed={a.id} />
        </span>
      )}
      <div class="ms-tc-an-in">
        <div class="ms-tc-an-head">
          {eyebrow && <span class="ms-an-eyebrow">{t(eyebrow)}</span>}
          <span {...shine} class={`ms-an-title ${shine.class}`}>
            {a.title}
          </span>
        </div>
        {a.sub && <span class="ms-an-sub">{a.sub}</span>}
      </div>
    </div>
  );
}

/** ONE tablet at the top centre: the run clock, and (only while there is one) the boss row and the event banner under it, cut
 *  from the same stone with carved dividers. Replaces the three separate plates that stacked over the play area. Portrait
 *  phones keep the clock on their own block (`timer` false) and use the card for the boss + banner. */
function TopCentre({ hud, timer }: { hud: HudSnapshot; timer: boolean }): JSX.Element | null {
  const feed = announcements.value;
  const a = feed[feed.length - 1];
  const boss = hud.boss;
  if (!timer && !boss && !a) return null;
  const { soon, fight } = timerFlags(hud);
  return (
    <div class={`ms-tc ms-plate ${boss ? 'has-boss' : ''} ${boss?.enraged ? 'is-enraged' : ''} ${boss?.final ? 'is-final' : ''} ${a ? `has-an an-${a.tone}` : ''}`} data-block="">
      {timer && (
        <div class={`ms-tc-time ${soon ? 'is-soon' : ''} ${fight ? 'is-fight' : ''}`} role="timer" aria-label={t('hud.time')}>
          <TimerInner hud={hud} />
        </div>
      )}
      {boss && <BossRow boss={boss} />}
      {a && <AnnounceRow key={a.id} a={a} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- top right

function Corruption({ value, metins, modalOpen }: { value: number; metins: HudSnapshot['metins']; modalOpen: boolean }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (modalOpen || value < 0.01) setOpen(false);
  }, [modalOpen, value < 0.01]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  if (value < 0.01) return null;
  const high = value > 0.66;
  const mid = !high && value > 0.33;
  const spawnPct = Math.round(value * 60);
  const elitePct = Math.round(value * 30);
  const rewardPct = Math.round(value * 50);
  const tierLabel = high ? t('hud.corruption.crit') : mid ? t('hud.corruption.mid') : t('hud.corruption.low');
  return (
    <div ref={wrapRef} class={`ms-co-wrap ${open ? 'is-open' : ''}`} data-block="">
      <button
        type="button"
        class={`ms-co ms-plate ${high ? 'is-high' : ''} ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        {...tipProps(() => (
          <div>
            <div class="ms-tip-title">{high ? t('hud.corruption.high') : t('hud.corruption')}</div>
            <div class="ms-tip-sub">{t('hud.corruption.clickHint')}</div>
          </div>
        ))}
        onClick={(e) => {
          setOpen((v) => !v);
          e.currentTarget.blur();
        }}
      >
        <UiGlyph name="flame" tone={high ? 'crimson' : 'bronze'} flat />
        <span class="ms-co-label">
          <span class="ms-co-full">{t('hud.corruption')}</span>
          <span class="ms-co-short">{t('hud.corruption.short')}</span>
        </span>
        <HudGauge kind="corr" value={Math.min(1, value)} ch="0.8rem" />
        <b class="ms-num">{fmtPct(value)}</b>
        <span class="ms-co-chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div class="ms-co-pop ms-sunken ms-sunken--plain" role="dialog" aria-label={t('hud.corruption')}>
          <div class="ms-co-pop-head">
            <UiGlyph name="flame" tone={high ? 'crimson' : 'gold'} flat />
            <strong>{t('hud.corruption')}</strong>
            <span class={`ms-co-pop-badge ${high ? 'is-high' : mid ? 'is-mid' : ''}`}>
              {tierLabel} · {fmtPct(value)}
            </span>
          </div>
          <p class="ms-co-pop-desc">{t('hud.corruption.desc')}</p>
          <div class="ms-co-pop-rows">
            <div class="ms-co-pop-row is-warn">
              <span>{t('hud.corruption.spawn')}</span>
              <b class="ms-num">+{spawnPct}%</b>
            </div>
            <div class="ms-co-pop-row is-warn">
              <span>{t('hud.corruption.elites')}</span>
              <b class="ms-num">+{elitePct}%</b>
            </div>
            <div class="ms-co-pop-row is-good">
              <span>{t('hud.corruption.rewards')}</span>
              <b class="ms-num">+{rewardPct}%</b>
            </div>
            <div class="ms-co-pop-row">
              <span>{t('hud.corruption.metins')}</span>
              <b class="ms-num">{metins.length}</b>
            </div>
          </div>
          <div class="ms-co-pop-tip">{t('hud.corruption.tip')}</div>
        </div>
      )}
    </div>
  );
}

function DamageMeter({ hud }: { hud: HudSnapshot }): JSX.Element | null {
  if (layout.value.compact || !meterOpen.value) return null;
  const rows = hud.dmg ?? [];
  const total = rows.reduce((s, r) => s + r.damage, 0);
  const top = rows[0]?.damage ?? 0;
  return (
    <div class="ms-hud-meter-wrap" data-block="">
      <div class="ms-hud-meter ms-sunken ms-sunken--plain">
        <div class="ms-hud-meter-head">
          <UiGlyph name="swords" tone="gold" flat />
          <span>{t('hud.damageMeter')}</span>
          {hud.dps > 0 && <b class="ms-num">{fmtCompact(hud.dps)}/s</b>}
        </div>
        {rows.length === 0 ? (
          <div class="ms-hud-meter-empty">{t('hud.damageMeter.empty')}</div>
        ) : (
          rows.slice(0, 5).map((r) => {
            const def = indexOf().skills.get(r.skillId);
            return (
              <div class="ms-hud-meter-row" key={r.skillId}>
                <span class="ms-hud-meter-fill" style={{ width: `${top > 0 ? (r.damage / top) * 100 : 0}%` }} />
                <span class="ms-hud-meter-icon">{def && <IconArt id={def.icon} kind="skill" element={def.element} />}</span>
                <span class="ms-hud-meter-name">{skillName(r.skillId)}</span>
                <b class="ms-num">{fmtCompact(r.damage)}</b>
                <span class="ms-hud-meter-pct ms-num">{total > 0 ? fmtPct(r.damage / total) : ''}</span>
              </div>
            );
          })
        )}
        {rows.length > 0 && (
          <div class="ms-hud-meter-total">
            <span>{t('hud.total')}</span>
            <b class="ms-num">{fmtCompact(total)}</b>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- touch + co-op

function Joystick(): JSX.Element | null {
  const { input } = deps();
  const l = layout.value;
  if (!input) return null;
  const st = input.touch.state.value;
  const show = l.touch || settings.value.touchControls || input.touchSeen.value;
  if (!show) return null;
  return (
    <div class="ms-hud-joy" aria-hidden="true">
      {st.active ? (
        <>
          <div class="ms-joy-base" style={{ left: `${st.baseX}px`, top: `${st.baseY}px`, width: `${st.radius * 2}px`, height: `${st.radius * 2}px` }} />
          <div class="ms-joy-knob" style={{ left: `${st.knobX}px`, top: `${st.knobY}px` }} />
        </>
      ) : (
        <div class="ms-joy-hint" data-block="">
          <i class="ms-joy-ring" />
          <i class="ms-joy-nub" />
          <span>{t('hud.joystick')}</span>
        </div>
      )}
    </div>
  );
}

function CoopLayer(): JSX.Element | null {
  const status = deps().store.coop.value;
  if (!status) return null;
  const waiting = status.pendingPicks;
  const notice = status.phase === 'reconnecting' ? t('hud.coop.reconnecting') : status.phase === 'disconnected' ? t('hud.coop.disconnected') : status.hostPaused ? t('hud.coop.hostPaused') : null;
  const peers = status.players.filter((p) => !p.local);
  return (
    <div class="ms-hud-coop" data-block="">
      {notice && (
        <div class="ms-hud-coop-chip ms-plate is-warn">
          <UiGlyph name="link" tone="crimson" flat />
          <span>{notice}</span>
        </div>
      )}
      {waiting.length > 0 && (
        <div class="ms-hud-coop-chip ms-plate is-wait">
          <UiGlyph name="clock" tone="gold" flat />
          <span>{t('hud.coop.waiting', { names: waiting.map((w) => w.name).join(', '), s: Math.max(0, Math.ceil(Math.min(...waiting.map((w) => w.left)))) })}</span>
        </div>
      )}
      {peers.length > 0 && (
        <div class="ms-hud-coop-peers ms-plate" {...tipProps(() => <div>{t('hud.coop.ping', { ms: Math.round(status.pingMs) })}</div>)}>
          {peers.map((p) => (
            <span key={p.slot} class={`ms-hud-coop-peer ${p.connected ? '' : 'is-off'}`}>
              <i />
              {p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Painted HUD materials (uk_hud_*): published as CSS variables on the HUD root; every use has a CSS fallback (the coin socket is
 *  drawn, the stone is the SVG turbulence of hud.css, the gauges are gradients). The manifest can finish loading after the first
 *  HUD frame, hence the short retry. */
const TEX_VARS: readonly (readonly [id: string, cssVar: string])[] = [
  ['uk_hud_coin', '--tex-hud-coin'],
  ['uk_hud_bar', '--tex-hud-bar'],
  ['uk_hud_gtube', '--tex-hud-gtube'],
  ['uk_hud_gfill_red', '--tex-hud-gfill-red'],
  ['uk_hud_gfill_blue', '--tex-hud-gfill-blue'],
  ['uk_hud_gfill_gold', '--tex-hud-gfill-gold'],
  ['uk_hud_tray', '--tex-hud-tray'],
  ['uk_hud_lvl', '--tex-hud-lvl'],
  ['uk_hud_tag', '--tex-hud-tag'],
];
function useHudTextures(): JSX.CSSProperties | undefined {
  const read = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [id, v] of TEX_VARS) {
      const url = texUrl(id);
      if (url) out[v] = `url("${url}")`;
    }
    return out;
  };
  const [tex, setTex] = useState(read);
  const missing = TEX_VARS.some(([, v]) => !tex[v]);
  useEffect(() => {
    if (!missing) return undefined;
    const id = window.setTimeout(() => setTex(read()), 600);
    return () => window.clearTimeout(id);
  }, [missing]);
  const style: Record<string, string> = { ...tex };
  // the painted tube carries its own dark glass: the channel stays see-through over it
  if (tex['--tex-hud-gtube']) style['--hg-ch-bg'] = 'transparent';
  return Object.keys(style).length ? (style as JSX.CSSProperties) : undefined;
}

function SkillCues(): JSX.Element | null {
  const cues = castCues.value;
  if (cues.length === 0) return null;
  return (
    <div class="ms-sk-cues" aria-hidden="true">
      {cues.map((c) => (
        <div key={c.key} class="ms-sk-cue" style={{ '--cue-c': c.color } as JSX.CSSProperties}>
          <span class="ms-sk-cue-ico">
            <IconArt id={c.icon} kind="skill" />
          </span>
          <span class="ms-sk-cue-name">{c.name}</span>
        </div>
      ))}
    </div>
  );
}

export function Hud(): JSX.Element | null {
  const { store } = deps();
  const tex = useHudTextures();
  const hud = store.hud.value;
  useAnnounceFeed();
  useSkillCueFeed();
  // a modal (pause, level-up, chest …) takes the screen: the region map and the build board step aside
  const modalOpen = store.modal.value !== null;
  useEffect(() => {
    if (!modalOpen) return;
    buildOpen.value = false;
    atlasOpen.value = false;
  }, [modalOpen]);
  const flash = hitFlash.value;
  const pop = levelPop.value;
  const showFps = settings.value.showFps;
  const fps = store.fps.value;
  if (!hud) return null;
  const low = hud.alive && hud.hpMax > 0 && hud.hp / hud.hpMax <= LOW_HP;
  const portraitPhone = layout.value.compact && layout.value.portrait;
  return (
    <div class="ms-layer ms-hud" style={tex} data-level-pop={pop}>
      <Kit contents>
        {hud.darkness > 0.01 && <div class="ms-hud-dark" style={{ opacity: Math.min(0.92, hud.darkness) }} />}
        <div class={`ms-hud-lowhp ${low ? 'is-on' : ''}`} />
        <div key={flash} class={`ms-hud-hit ${flash > 0 ? 'is-on' : ''}`} />

        <div class="ms-hud-tl">
          <BuildStrip hud={hud} />
        </div>
        {portraitPhone && (
          <div class="ms-hud-tmp">
            <Timer hud={hud} withCorruption />
          </div>
        )}
        <div class="ms-hud-tc">
          <TopCentre hud={hud} timer={!portraitPhone} />
          <CoopLayer />
        </div>
        <div class="ms-hud-tr">
          <Minimap hud={hud} />
          {!portraitPhone && <Corruption value={hud.corruption} metins={hud.metins} modalOpen={modalOpen} />}
          <DamageMeter hud={hud} />
        </div>

        <SkillCues />
        <Taskbar hud={hud} low={low} />
        {!layout.value.compact && <BuildBoard hud={hud} />}
        <EdgeArrows hud={hud} />
        <Joystick />
        {atlasOpen.value && <Atlas hud={hud} />}
        {showFps && <div class="ms-hud-fps ms-num">{t('hud.fps', { n: fps })}</div>}
      </Kit>
    </div>
  );
}
