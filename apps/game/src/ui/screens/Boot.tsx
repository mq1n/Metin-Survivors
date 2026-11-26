
// dark band along the bottom, ONE slim metal gauge (~83 % of the height, caption + percent beside it) with a glossy liquid fill and
// one line of tip on a plate. What is loading (chapter, zone, hero class, difficulty) is ONE caption plate under the logo, not a stack
// above the gauge. Every plate (caption, tip, failure dialog) is the same gunmetal plank with a thin gold hairline (boot.css).
//   boot    : the key art, the logo, the band. The first paint before it is the inline splash of index.html (same gauge row).
//   loading : the zone's wide splash `uk_boot_loading_splash_<zone>` (desktop, tablet, phone landscape), the 1024x1536 zone card
//             `art_zone_<zone>` full-bleed on a phone held upright (over its blurred copy where the screen is wider), the caption
//             plate under the logo, and a real error dialog (message, RETRY, BACK) when the run could not be built.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { fmtPct, t, tl } from '../../i18n/i18n';
import type { ClassDef, ZoneDef } from '../../data/schema';
import { portraitFaceUrl, texUrl, zoneArtUrl } from '../assets';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { EmberField } from '../components/Modal';
import { Kit, Panel } from '../components/Panel';
import { TitleBar } from '../components/TitleBar';
import { indexOf } from '../content';
import { deps } from '../env';
import { preloadPaintedMinimap } from '../hud/minimapPaintLoader';
import { BootGauge } from './BootGauge';
import './boot.css';

const TIP_COUNT = 10;
const TIP_MS = 5600;

/** DEV only: `?tip=N` pins the tip (stable screenshots) and stops the rotation. */
function pinnedTip(): number | null {
  if (!import.meta.env.DEV) return null;
  const n = Number(new URLSearchParams(location.search).get('tip'));
  return Number.isInteger(n) && n >= 1 && n <= TIP_COUNT ? n - 1 : null;
}

/** DEV only: the UI gallery (`?ui=gallery`) keeps whichever tip it opened with, so a capture never lands inside the two-step cross-fade
 *  (`&tiprot=1` lets it rotate again, to look at the cross-fade itself). */
function rotationStopped(): boolean {
  if (!import.meta.env.DEV) return false;
  const q = new URLSearchParams(location.search);
  return pinnedTip() !== null || (q.get('ui') === 'gallery' && q.get('tiprot') !== '1');
}

/** The current tip and the one that is fading out, so the plate cross-fades instead of popping. */
function useTips(): { cur: number; prev: number | null } {
  const [st, setSt] = useState<{ cur: number; prev: number | null }>(() => ({ cur: pinnedTip() ?? Math.floor(Math.random() * TIP_COUNT), prev: null }));
  useEffect(() => {
    if (rotationStopped()) return undefined;
    const id = window.setInterval(() => setSt((s) => ({ cur: (s.cur + 1) % TIP_COUNT, prev: s.cur })), TIP_MS);
    return () => window.clearInterval(id);
  }, []);
  return st;
}

const cssUrl = (u: string | null): string | undefined => (u ? `url("${u}")` : undefined);

/** The failed run load: one gunmetal dialog (rust title bar, sunken message well, RETRY + BACK in the kit plate style). The message is the
 *  player-facing sentence from app/loadFailure.ts (file paths and hashes already scrubbed out of the cause). The gauge below it says
 *  "Loading stopped": it does not keep claiming a stage. */
function FailPanel({ message }: { message: string }): JSX.Element {
  const { store } = deps();
  return (
    <div class="ms-bt-failwrap">
      <Kit class="ms-bt-pl ms-bt-fail">
        <div role="alertdialog" aria-labelledby="ms-bt-failtitle" aria-describedby="ms-bt-failmsg" class="ms-bt-failin">
          <TitleBar class="ms-bt-failbar">
            <span id="ms-bt-failtitle">{t('boot.failedTitle')}</span>
          </TitleBar>
          <Panel variant="sunken" plain class="ms-bt-failmsg">
            <p id="ms-bt-failmsg" role="alert">
              {message}
            </p>
          </Panel>
          <div class="ms-bt-failbtns">
            {/* One clean page reload: never a second boot() in this page (every listener and the GL context would exist twice).
                It also picks up a fresh index.html, which fixes the usual cause: a deploy while the tab was open. */}
            <Button size="big" class="ms-bt-btn" autofocus onClick={() => window.location.reload()}>
              {t('boot.retry')}
            </Button>
            <Button variant="wood" size="big" class="ms-bt-btn" sound="back" onClick={() => store.go('menu')}>
              {t('common.back')}
            </Button>
          </div>
        </div>
      </Kit>
    </div>
  );
}

/** What is loading, as ONE compact plate under the logo (the names are the content's own, the same words every other screen shows): the hero medallion, chapter, zone, the lore line, then class + difficulty. */
function CaptionPlate({ zone, cls, face, hard }: { zone: ZoneDef; cls: ClassDef | undefined; face: string | null; hard: boolean }): JSX.Element {
  return (
    <div class="ms-bt-pl ms-bt-caption">
      {cls && (
        <span class="ms-bt-medal" aria-hidden="true">
          <i style={face ? { backgroundImage: `url("${face}")` } : undefined} />
        </span>
      )}
      <div class="ms-bt-captext">
        <span class="ms-bt-chapter">{t('story.zoneIntro', { n: zone.order })}</span>
        <h2 class="ms-bt-zname">{tl(zone.name)}</h2>
        <p class="ms-bt-lore">{tl(zone.subtitle)}</p>
        {cls && (
          <div class="ms-bt-hero">
            <b class="ms-bt-who">{tl(cls.name)}</b>
            <span class={`ms-bt-diff ${hard ? 'is-hard' : ''}`}>{t(hard ? 'zone.hard' : 'zone.normal')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function BootScreen({ mode }: { mode: 'boot' | 'loading' }): JSX.Element {
  const { store } = deps();
  const loading = store.loading.value;
  const sel = store.selection.value;
  const tips = useTips();
  const ix = indexOf();
  const zone = mode === 'loading' ? ix.zones.get(sel.zone) : undefined;
  const cls = mode === 'loading' ? ix.classes.get(sel.classId) : undefined;
  const face = cls ? portraitFaceUrl(sel.classId, sel.sex) : null;
  // a ready-made wide splash fills the screen (desktop, tablet, phone landscape); a phone held upright shows the 2:3 zone card (1024 x 1536)
  // full-bleed, and wider screens without a splash show it as a plate over its own blurred copy
  const wideArt = zone ? texUrl(`uk_boot_loading_splash_${zone.id}`) : null;
  const tallArt = zone ? zoneArtUrl(zone) : null;
  const art = tallArt ?? wideArt;
  const failed = loading.error !== null;
  const fraction = Math.min(1, Math.max(0, loading.fraction));
  const stageKey = `boot.stage.${loading.label}`;
  const stage = failed ? t('boot.stage.failed') : `${loading.label !== '' && t(stageKey) !== stageKey ? t(stageKey) : t('boot.stage.default')}…`;

  // the first HUD frame wants the painted minimap: bake it behind the load (a worker; never throws)
  const biome = zone?.biome;
  useEffect(() => {
    if (biome) preloadPaintedMinimap(biome);
  }, [biome]);

  const vars: Record<string, string | undefined> = {
    '--bt-art': cssUrl(art),
    '--bt-wide': cssUrl(wideArt),
    '--bt-gauge': cssUrl(texUrl('uk_boot_loading_gauge')),
  };
  for (const k of Object.keys(vars)) if (vars[k] === undefined) delete vars[k];

  return (
    <div
      class={`ms-screen ms-boot ms-boot--${mode} ${wideArt ? 'has-wide' : ''} ${art ? 'has-plate' : ''} ${failed ? 'is-failed' : ''}`}
      style={vars as JSX.CSSProperties}
      data-zone={zone?.id}
    >
      <div class="ms-bt-bed" aria-hidden="true" />
      {art && (
        <div class="ms-bt-plate" aria-hidden="true">
          <i />
        </div>
      )}
      <div class="ms-bt-shade" aria-hidden="true" />
      <EmberField count={mode === 'boot' ? 28 : 22} />

      <div class="ms-bt-top">
        <Logo />
        {zone && <CaptionPlate zone={zone} cls={cls} face={face} hard={sel.difficulty === 'hard'} />}
      </div>

      {failed && <FailPanel message={loading.error ?? ''} />}

      <div class="ms-bt-band">
        <div class="ms-bt-grow">
          <span class="ms-bt-stage" aria-hidden="true">
            {stage}
          </span>
          <BootGauge value={fraction} fail={failed} label={t('boot.aria')} valueText={`${stage} ${fmtPct(fraction)}`} class="ms-bt-gauge" />
          <b class="ms-bt-pct" aria-hidden="true">
            {fmtPct(fraction)}
          </b>
        </div>

        {!failed && (
          <div class="ms-bt-pl ms-bt-tipplate">
            <span class="ms-bt-tiplabel">{t('boot.tipLabel')}</span>
            <div class="ms-bt-tips" aria-live="off">
              {tips.prev !== null && (
                <p key={`o${tips.prev}`} class="ms-bt-tip is-out" aria-hidden="true">
                  {t(`boot.tip.${tips.prev + 1}`)}
                </p>
              )}
              <p key={`i${tips.cur}`} class={`ms-bt-tip is-in ${tips.prev === null ? 'is-first' : ''}`}>
                {t(`boot.tip.${tips.cur + 1}`)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
