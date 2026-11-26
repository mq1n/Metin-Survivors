// Credits (round 3 on kit v1): one charcoal board over the dimmed splash - rust title bar with the boxed close, the logo + a
// ruled tagline, three recessed granite wells in a balanced grid (making of | typefaces + built with, then thanks with the
// closing line) and the original-content notice as a two-part well of its own (parchment is for the story only). Section
// captions are engraved rules, not plates; links share the copy's face. At 1080p the whole board fits without scrolling;
// smaller screens scroll gently until the player touches them, with a fade and a chevron cue at the edge that still has content.
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import { sfx } from '../audio';
import { texUrl } from '../assets';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { Panel } from '../components/Panel';
import { ScrollFade } from '../components/ScrollFade';
import { UiGlyph, type UiGlyphName } from '../components/StatIcon';
import { Motes } from '../components/UiFx';
import { deps } from '../env';
import { useKeys, useScope } from '../nav';
import { closeView } from '../view';
import './credits.css';

interface CreditRow {
  /** role / name line (i18n key or a proper noun shown verbatim) */
  title: string;
  titleIsKey?: boolean;
  /** secondary line (i18n key) */
  textKey?: string;
  /** plain-text link */
  link?: string;
}

interface CreditSection {
  id: string;
  glyph: UiGlyphName;
  rows: readonly CreditRow[];
}

const SECTIONS: readonly CreditSection[] = [
  {
    id: 'make',
    glyph: 'crown',
    rows: [
      { title: 'credits.role.design', titleIsKey: true, textKey: 'credits.who.team' },
      { title: 'credits.role.code', titleIsKey: true, textKey: 'credits.who.team' },
      { title: 'credits.role.art', titleIsKey: true, textKey: 'credits.who.art' },
      { title: 'credits.role.models', titleIsKey: true, textKey: 'credits.who.models' },
      { title: 'credits.role.audio', titleIsKey: true, textKey: 'credits.who.audio' },
      { title: 'credits.role.writing', titleIsKey: true, textKey: 'credits.who.writing' },
    ],
  },
  {
    id: 'thanks',
    glyph: 'heart',
    rows: [
      { title: 'credits.thanks.players', titleIsKey: true, textKey: 'credits.thanks.playersText' },
      { title: 'credits.thanks.community', titleIsKey: true, textKey: 'credits.thanks.communityText' },
    ],
  },
  {
    id: 'fonts',
    glyph: 'book',
    rows: [
      { title: 'Cinzel', textKey: 'credits.font.cinzel' },
      { title: 'Alegreya Sans', textKey: 'credits.font.alegreya' },
      { title: 'Barlow Condensed', textKey: 'credits.font.barlow' },
    ],
  },
  {
    id: 'tech',
    glyph: 'gear',
    rows: [
      { title: 'three.js', textKey: 'credits.tech.three', link: 'threejs.org' },
      { title: 'Preact + Signals', textKey: 'credits.tech.preact', link: 'preactjs.com' },
      { title: 'Vite + TypeScript', textKey: 'credits.tech.vite', link: 'vite.dev' },
      { title: 'Cloudflare', textKey: 'credits.tech.cloudflare', link: 'cloudflare.com' },
      { title: 'Hono', textKey: 'credits.tech.hono', link: 'hono.dev' },
      { title: 'Elemental Sandbox', textKey: 'credits.tech.elemental', link: 'github.com/majidmanzarpour/threejs-vfx' },
    ],
  },
];

/** Section caption: glyph + caption, then an engraved rule (a dark groove over a pale lip) running to the well's edge. */
function Head({ glyph, children }: { glyph: UiGlyphName; children: string }): JSX.Element {
  return (
    <h2 class="ms-cred-head">
      <UiGlyph name={glyph} tone="gold" size="1.15em" />
      <span>{children}</span>
      <i class="ms-cred-rule" aria-hidden="true" />
    </h2>
  );
}

function Rows({ s }: { s: CreditSection }): JSX.Element {
  return (
    <dl class="ms-cred-rows">
      {s.rows.map((r) => (
        <div class="ms-cred-row" key={r.title}>
          <dt>{r.titleIsKey ? t(r.title) : r.title}</dt>
          <dd>
            {r.textKey && <span>{t(r.textKey)}</span>}
            {r.link && <span class="ms-cred-link">{r.link}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Card({ s, i, children }: { s: CreditSection; i: number; children?: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <section class={`ms-plate ms-cred-card ms-cred-card--${s.id}`} style={{ '--i': i } as JSX.CSSProperties}>
      <Head glyph={s.glyph}>{t(`credits.section.${s.id}`)}</Head>
      {s.id === 'fonts' && <p class="ms-cred-card-note">{t('credits.fonts.license')}</p>}
      <Rows s={s} />
      {children}
    </section>
  );
}

export function CreditsScreen(): JSX.Element {
  const { version } = deps();
  const scope = useScope();
  const scroller = useRef<HTMLDivElement>(null);
  const graniteUrl = texUrl('uk_main_menu_granite');
  useKeys((a) => {
    if (a.kind === 'cancel') {
      sfx('back');
      closeView();
      return true;
    }
    if (a.kind === 'up' || a.kind === 'down') {
      scroller.current?.scrollBy({ top: a.kind === 'up' ? -160 : 160, behavior: 'smooth' });
      return true;
    }
    return false;
  });

  // gentle auto-scroll while the player is only watching (stops for good on any interaction; honours reduced motion)
  useEffect(() => {
    const el = scroller.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let raf = 0;
    let stopped = false;
    let last = 0;
    let pos = 0;
    const stop = (): void => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    const tick = (now: number): void => {
      if (stopped) return;
      if (last === 0) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      pos += dt * 26;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 2) return;
      el.scrollTop = pos;
      if (pos < max) raf = requestAnimationFrame(tick);
    };
    const start = window.setTimeout(() => {
      pos = el.scrollTop;
      raf = requestAnimationFrame(tick);
    }, 3200);
    const events = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const;
    for (const e of events) el.addEventListener(e, stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      window.clearTimeout(start);
      stop();
      for (const e of events) el.removeEventListener(e, stop);
      window.removeEventListener('keydown', stop);
    };
  }, []);

  return (
    <div class="ms-screen ms-cred-screen" ref={scope} style={graniteUrl ? ({ '--c-granite': `url("${graniteUrl}")` } as JSX.CSSProperties) : undefined}>
      <div class="ms-cred-art" aria-hidden="true" />
      <div class="ms-cred-veil" aria-hidden="true" />
      <div class="ms-cred-motes" aria-hidden="true">
        <Motes preset="ember" count={26} seed={3} speed={0.7} intensity={0.8} />
      </div>

      <div class="ms-cred-stage">
        <Panel variant="board" ornate title={t('credits.title')} titleIcon={<UiGlyph name="book" tone="gold" />} onClose={closeView} class="ms-cred-board">
          <ScrollFade class="ms-cred-sf" viewClass="ms-cred-view" viewRef={scroller} size="2rem">
            <div class="ms-cred-hero">
              <Logo class="ms-cred-logo" sub={false} />
              <p class="ms-cred-tag">
                <span>{t('app.subtitle')}</span>
              </p>
              {version && version !== 'dev' && <span class="ms-cred-version ms-num">{t('app.version', { v: version })}</span>}
            </div>

            <div class="ms-cred-cols">
              <div class="ms-cred-col">
                <Card s={SECTIONS[0]!} i={0} />
              </div>
              <div class="ms-cred-col">
                <Card s={SECTIONS[2]!} i={1} />
                <Card s={SECTIONS[3]!} i={2} />
              </div>
            </div>

            <Card s={SECTIONS[1]!} i={3}>
              <p class="ms-cred-outro">{t('credits.outro')}</p>
            </Card>

            <section class="ms-plate ms-cred-card ms-cred-notice" style={{ '--i': 4 } as JSX.CSSProperties}>
              <div class="ms-cred-notice-lead">
                <Head glyph="shield">{t('credits.disclaimer.title')}</Head>
                <p class="ms-cred-notice-main">{t('menu.disclaimer')}</p>
              </div>
              <p class="ms-cred-notice-more">{t('credits.disclaimer.more')}</p>
            </section>
          </ScrollFade>

          <div class="ms-cred-foot">
            <Button variant="wood" size="small" sound="back" onClick={closeView}>
              <UiGlyph name="back" tone="pewter" size="1.2em" /> {t('common.back')}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
