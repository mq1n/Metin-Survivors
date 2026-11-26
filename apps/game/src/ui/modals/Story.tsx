// Story popup: a quest-log style dialog in the stone-and-pewter family — a charcoal board with a rust-copper title bar
// (the caption), a speaker plate on the left (zone art / the live boss on its dais with a level nameplate / the hero with a class
// nameplate / the metin stone with its floor sigil) and a warm woven grid parchment with a faded sepia print in its corner for the
// text (parchment only for story text). The stone buttons sit on the board under the sheet. One page per
// paragraph, revealed with an ink-in word reveal; every page is laid out in the same cell so the dialog is as tall as its tallest page
// and never jumps (Enter / Space / click = next page, last = Continue, Esc skips). Kinds: zoneIntro, bossIntro, victory, defeat,
// metin. Unknown refs degrade to a plain page.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { StoryNotice } from '../../app/store';
import { t, tl } from '../../i18n/i18n';
import { metinArtUrl, portraitUrl, texUrl, zoneArtUrl } from '../assets';
import { sfx } from '../audio';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { ScrollFade } from '../components/ScrollFade';
import { UiGlyph, type UiGlyphProps } from '../components/StatIcon';
import { Motes } from '../components/UiFx';
import { className, indexOf } from '../content';
import { deps } from '../env';
import { focusFirst, useKeys, useScope } from '../nav';
import { inkDelay, inkWords, mixHex, runeTint } from './storyArt';
import { BossStage, Emblem, paperUrl, Seal, Sigil, Swirl, weaveUrl } from './StoryStage';
import { PAPER_TONES, runePaper, type PaperTone } from './storyPaper';
import './story.css';

interface Page {
  /** title bar caption */
  caption: string;
  /** the headline on the sheet */
  head: string;
  /** the line under the headline (boss title / zone tagline / the zone of an outcome) */
  sub: string;
  paras: string[];
  artUrl: string | null;
  /** metin rune colour */
  rune: string | null;
  great: boolean;
  /** metin id (sigil seed) */
  metinId: string | null;
  /** boss model + level */
  boss: { model: string; level: number } | null;
}

const EMPTY: Page = { caption: '', head: '', sub: '', paras: [], artUrl: null, rune: null, great: false, metinId: null, boss: null };

function pageOf(story: StoryNotice): Page {
  const { content, store } = deps();
  const ix = indexOf(content);
  const selZone = ix.zones.get(store.runSelection.value.zone);
  switch (story.kind) {
    case 'zoneIntro': {
      const z = ix.zones.get(story.ref);
      return {
        ...EMPTY,
        caption: t('story.zoneIntro', { n: z?.order ?? 1 }),
        head: z ? tl(z.name) : story.ref,
        sub: z ? tl(z.subtitle) : '',
        paras: (z?.story.intro ?? []).map(tl).filter(Boolean),
        artUrl: z ? zoneArtUrl(z) : null,
      };
    }
    case 'bossIntro': {
      const b = ix.bosses.get(story.ref);
      const z = selZone ?? content.zones.find((zz) => zz.bosses.some((x) => x.boss === story.ref) || zz.final.boss === story.ref);
      return {
        ...EMPTY,
        caption: t('story.bossIntro'),
        head: b ? tl(b.name) : story.ref,
        sub: b ? tl(b.title) : '',
        paras: b ? [tl(b.intro)].filter(Boolean) : [],
        artUrl: z ? zoneArtUrl(z) : null,
        boss: b ? { model: b.model, level: b.level } : null,
      };
    }
    case 'victory':
    case 'defeat': {
      const z = ix.zones.get(story.ref) ?? selZone;
      const list = z ? (story.kind === 'victory' ? z.story.victory : z.story.defeat) : [];
      return {
        ...EMPTY,
        // the outcome is the headline (nothing sits above it but the title bar); the zone it happened in is the line under it
        caption: t('story.zoneIntro', { n: z?.order ?? 1 }),
        head: t(story.kind === 'victory' ? 'story.victory' : 'story.defeatHead'),
        sub: z ? tl(z.name) : story.ref,
        paras: list.map(tl).filter(Boolean),
        artUrl: z ? zoneArtUrl(z) : null,
      };
    }
    case 'metin': {
      const m = ix.metins.get(story.ref);
      return {
        ...EMPTY,
        caption: t('story.metin'),
        head: m ? tl(m.name) : story.ref,
        paras: m ? [tl(m.lore)].filter(Boolean) : [],
        artUrl: selZone ? zoneArtUrl(selZone) : null,
        rune: m?.rune ?? null,
        great: Boolean(m && 'great' in m && m.great),
        metinId: m?.id ?? null,
      };
    }
    default:
      return { ...EMPTY, head: story.ref };
  }
}

const KIND_GLYPH: Record<string, UiGlyphProps['name']> = {
  zoneIntro: 'book',
  bossIntro: 'skull',
  victory: 'crown',
  defeat: 'skull',
  metin: 'star',
};

/** The left plate: what the story is about, painted / live (never a flat disc). */
function Plate({ kind, page }: { kind: StoryNotice['kind']; page: Page }): JSX.Element {
  const { store } = deps();
  const [bossFailed, setBossFailed] = useState(false);
  const sel = store.runSelection.value;
  const hero = kind === 'victory' || kind === 'defeat' ? portraitUrl(sel.classId, sel.sex) : null;
  const tint = runeTint(page.rune);
  // a great metin has its own painted stone (the four greats ship one), every other type the shared one
  const stone = metinArtUrl(page.metinId);
  return (
    <div class="ms-story-plate ms-sunken ms-sunken--plain">
      <div class="ms-story-art" style={page.artUrl ? ({ '--art': `url("${page.artUrl}")` } as JSX.CSSProperties) : undefined}>
        <div class="ms-story-pic" />
        {kind === 'bossIntro' && page.boss && !bossFailed && <BossStage modelId={page.boss.model} onFail={() => setBossFailed(true)} />}
        {kind === 'bossIntro' && (!page.boss || bossFailed) && <Seal glyph="skull" tone="crimson" size="8rem" class="ms-story-seal--mid" />}
        {kind === 'bossIntro' && <Motes preset="ember" count={30} intensity={0.8} seed={11} class="ms-story-motes" />}
        {hero && <img class="ms-story-hero" src={hero} alt="" draggable={false} />}
        {kind === 'victory' && <Motes preset="gold" count={34} intensity={0.9} seed={5} class="ms-story-motes" />}
        {kind === 'defeat' && <Motes preset="ember" count={18} color="#b8a090" intensity={0.5} speed={0.6} seed={9} class="ms-story-motes" />}
        {kind === 'metin' && (
          <>
            {page.metinId && <Sigil id={page.metinId} great={page.great} />}
            {stone && <div class="ms-story-stone" style={{ backgroundImage: `url("${stone}")` }} />}
            <Motes preset="ember" count={26} color={tint.hex} intensity={0.85} seed={3} class="ms-story-motes" />
          </>
        )}
        <div class="ms-story-shade" />
      </div>
      {kind === 'victory' && (
        <div class="ms-story-nameplate">
          <Emblem glyph="crown" tone="gold" />
          <span>{className(sel.classId)}</span>
        </div>
      )}
      {kind === 'defeat' && (
        <div class="ms-story-nameplate">
          <Emblem glyph="skull" tone="pewter" />
          <span>{className(sel.classId)}</span>
        </div>
      )}
      {kind === 'bossIntro' && page.boss && (
        <div class="ms-story-nameplate">
          <Emblem glyph="skull" tone="crimson" />
          <span>{t('story.bossLevel', { n: page.boss.level })}</span>
        </div>
      )}
    </div>
  );
}

/** One page: the current one fades in word by word (ink); the others only reserve their height in the same cell. */
function StoryPage({ text, current }: { text: string; current: boolean }): JSX.Element {
  const cls = `ms-story-page ${current ? 'is-on' : ''}`;
  if (!current)
    return (
      <div class={cls} aria-hidden="true">
        <p class="ms-story-p">{text}</p>
      </div>
    );
  const words = inkWords(text);
  return (
    <div class={cls}>
      <p class="ms-story-p">
        {words.map((w, i) => (
          <span key={i} class="ms-ink" style={{ '--d': `${inkDelay(i, words.length)}s` } as JSX.CSSProperties}>
            {`${w} `}
          </span>
        ))}
      </p>
    </div>
  );
}

function paperTone(kind: StoryNotice['kind'], rune: string | null): { key: string; tone: PaperTone } {
  switch (kind) {
    case 'victory':
      return { key: 'warm', tone: PAPER_TONES.warm };
    case 'defeat':
      return { key: 'ash', tone: PAPER_TONES.ash };
    case 'bossIntro':
      return { key: 'blood', tone: PAPER_TONES.blood };
    case 'metin':
      return { key: `rune:${rune ?? ''}`, tone: runePaper(rune) };
    default:
      return { key: 'plain', tone: PAPER_TONES.plain };
  }
}

export function StoryModal({ story }: { story: StoryNotice }): JSX.Element {
  const { store } = deps();
  const scope = useScope();
  const page = pageOf(story);
  const paras = page.paras.length > 0 ? page.paras : [t('story.missing')];
  const [shown, setShown] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const t0 = useRef(performance.now());
  const last = shown >= paras.length;
  const kind = story.kind;

  useEffect(() => {
    sfx(kind === 'bossIntro' ? 'bossRoar' : kind === 'victory' ? 'unlock' : 'open');
    const id = requestAnimationFrame(() => focusFirst());
    return () => cancelAnimationFrame(id);
  }, [kind]);
  // each new page starts at the top of the sheet
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [shown]);

  const dismiss = (): void => {
    sfx('close');
    store.dismissStory();
  };
  const advance = (): void => {
    if (performance.now() - t0.current < 300) return;
    if (last) dismiss();
    else {
      sfx('click');
      setShown((n) => n + 1);
    }
  };
  useKeys((a) => {
    if (a.kind === 'cancel') {
      dismiss();
      return true;
    }
    if (a.kind === 'confirm') {
      if (!a.repeat) advance();
      return true;
    }
    return false;
  });

  const tint = runeTint(page.rune);
  // the painted paper (uk_story_sheet) is tinted per kind through a luminosity blend in story.css; without it the sheet paints its own
  const rasterPaper = texUrl('uk_story_sheet');
  const paper = useMemo(() => {
    if (rasterPaper) return rasterPaper;
    const p = paperTone(kind, page.rune);
    return paperUrl(p.key, p.tone);
  }, [rasterPaper, kind, page.rune]);
  const style = {
    ...(kind === 'metin'
      ? { '--rune': tint.hex, '--rune-rot': `${tint.rot}deg`, '--rune-sat': String(tint.sat), '--rune-bri': String(tint.bri), '--on-rune': tint.on, '--paper-tone': mixHex('#e3cc9a', tint.hex, 0.14) }
      : {}),
  } as JSX.CSSProperties;
  const weave = useMemo(() => weaveUrl(), []);
  const sheetStyle = (paper || weave ? { ...(paper ? { '--paper': `url("${paper}")` } : {}), ...(weave ? { '--weave': `url("${weave}")` } : {}) } : undefined) as JSX.CSSProperties | undefined;

  return (
    <div class={`ms-modal ms-modal--blur ms-story ms-story--${kind} ms-story--p${Math.min(3, paras.length)}`} ref={scope} role="dialog" aria-modal="true" aria-label={page.head} style={style}>
      <Panel
        variant="board"
        class="ms-story-board"
        title={page.caption}
        titleIcon={<UiGlyph name={KIND_GLYPH[kind] ?? 'book'} tone="gold" flat />}
        onClose={() => store.dismissStory()}
        closeLabel={t('story.skip')}
      >
        <div class="ms-story-inner">
          <Plate kind={kind} page={page} />

          <section class={`ms-story-sheet ${rasterPaper ? 'has-raster' : ''} ${weave ? 'has-weave' : ''}`} style={sheetStyle} onClick={() => advance()}>
            <header class="ms-story-head">
              <h2 class="ms-story-title">{page.head}</h2>
              {page.sub && <p class="ms-story-sub">{page.sub}</p>}
              <hr class="ms-story-rule" />
            </header>
            <ScrollFade class="ms-story-bodywrap" viewClass="ms-story-body" viewRef={bodyRef} cue={false} axis="y" size="1.6rem">
              <div class="ms-story-pages" aria-live="polite">
                {paras.map((p, i) => (
                  <StoryPage key={i} text={p} current={i === shown - 1} />
                ))}
              </div>
            </ScrollFade>
            <Swirl />
          </section>

          <footer class="ms-story-foot">
            <div class="ms-story-pips" role="img" aria-label={paras.length > 1 ? t('story.pages', { n: shown, m: paras.length }) : undefined} aria-hidden={paras.length > 1 ? undefined : 'true'}>
              {paras.length > 1 && paras.map((_, i) => <i key={i} class={i === shown - 1 ? 'is-on is-now' : i < shown ? 'is-on' : ''} />)}
            </div>
            <p class="ms-story-hint ms-kbd-only">{t('story.hint')}</p>
            <div class="ms-story-actions">
              {!last && (
                <Button variant="wood" sound="none" onClick={dismiss}>
                  {t('story.skip')}
                </Button>
              )}
              <Button autofocus onClick={advance} sound="none">
                {last ? t('story.continue') : t('story.next')}
              </Button>
            </div>
          </footer>
        </div>
      </Panel>
    </div>
  );
}
