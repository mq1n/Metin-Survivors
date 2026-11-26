// Kit specimen pages for UiFx (C9) and the engraved icon kit (C11). Dev only: loaded lazily by
// ui/dev/scenarios/kit-fx.ts (gallery ids kit-fx*, kit-burst*, kit-icons*), rendered into an overlay host above the UI.
import { render, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Burst, GodRays, Motes, Pillar, shineProps, type FxTone } from '../../components/UiFx';
import { CurrencyIcon, EdgeArrow, GlyphCap, GradeIcon, KeyCap, StatIcon, STAT_FAMILY, UiGlyph, type CurrencyKind, type Grade, type StatId, type UiGlyphName, type UiTone } from '../../components/StatIcon';

export type KitPage = 'fx' | 'burst' | 'icons' | 'icons48' | 'glyphs';
export interface KitOpts {
  /** freeze time for burst pages */
  t?: number;
  tone?: FxTone;
  /** fx page: only one section (rays | motes | burst | classes) */
  section?: string;
}

const CSS = `
.kit-page{position:absolute;inset:0;overflow:auto;background:#0b0907;color:#e8dcc0;font-family:var(--f-body);padding:calc(1rem + var(--safe-t,0px)) 1rem 1rem;box-sizing:border-box}
.kit-h{font-family:var(--f-head);font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#e8c36a;font-size:.8rem;margin:.2rem 0 .5rem}
.kit-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,21rem),1fr));gap:.7rem;margin-bottom:1rem}
.kit-cell{position:relative;height:13.5rem;border-radius:6px;overflow:hidden;background:radial-gradient(90% 80% at 50% 46%,#1c140f,#070504);box-shadow:inset 0 0 0 1px #3a3530,inset 0 0 0 2px #0d0b09}
.kit-cell.is-art{background:linear-gradient(160deg,#3a3f46,#1d2024 45%,#2a221a)}
.kit-cell>.kit-label{position:absolute;left:.5rem;top:.35rem;z-index:5;font-size:.72rem;color:#b9a98a;letter-spacing:.04em}
.kit-title{position:absolute;left:0;right:0;top:40%;z-index:3;text-align:center;font-family:var(--f-title);font-weight:900;font-size:2rem;letter-spacing:.04em;background:linear-gradient(180deg,#fff6d0 0%,#f4d27e 40%,#cf9b34 70%,#f7d77f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 .14rem 0 rgba(70,36,4,.95))}
.kit-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:.55rem .7rem;padding:.55rem .7rem;border-radius:6px;margin-bottom:.45rem}
.kit-row .kit-cap{width:5.6rem;flex:none;font-size:.7rem;color:#9c8c70;align-self:center}
.kit-g1{background:#0d0a08}.kit-g2{background:#2a2219}.kit-g3{background:#8a8a80}
.kit-g3 .kit-cap{color:#1a1612}
.kit-ic{display:flex;flex-direction:column;align-items:center;gap:.15rem;font-size:.6rem;color:#8a7a60}
.kit-g3 .kit-ic{color:#2a241e}
.kit-medal{display:inline-flex;align-items:center;justify-content:center;width:5rem;height:5rem;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fff0b8,#c8902e 55%,#5a3a10);box-shadow:0 0 0 .2rem #2a1606,0 .3rem .8rem #000;font-family:var(--f-title);font-weight:900;font-size:1.8rem;color:#2a1604}
.kit-btn{display:inline-block;padding:.6rem 1.4rem;border-radius:5px;background:linear-gradient(#4a4741,#2e2c28);box-shadow:inset 0 0 0 1px #6a655c,0 0 0 1px #0d0b09;font-family:var(--f-head);font-weight:700;letter-spacing:.12em;color:#efe4c8}
.kit-burst{position:absolute;inset:0;background:radial-gradient(90% 80% at 50% 46%,rgba(10,5,3,.74) 0%,rgba(4,2,1,.95) 100%),linear-gradient(160deg,#2d3a2a,#1a1f17 50%,#2a2418)}
.kit-burst .kit-big{position:absolute;left:0;right:0;top:calc(46% - 3.4rem);z-index:3;text-align:center}
.kit-burst .kit-eyebrow{font-family:var(--f-head);font-weight:700;letter-spacing:.34em;font-size:.9rem;color:#ffe9a8;text-transform:uppercase}
.kit-burst .kit-title{position:static;font-size:4.2rem;line-height:1.05}
.kit-burst .kit-sub{font-size:1rem;color:#d8c8a4;margin-top:.3rem}
.kit-burst .kit-t{position:absolute;right:1rem;bottom:.8rem;z-index:4;font:600 .9rem var(--f-num);color:#b9a98a}
.ms-portrait .kit-burst .kit-title{font-size:2.6rem}
`;

function Style(): JSX.Element {
  return <style>{CSS}</style>;
}

// ------------------------------------------------------------------------------------------------------------- fx page

const TONES: FxTone[] = ['gold', 'legendary', 'crimson', 'jade', 'frost', 'violet'];

function Rays(): JSX.Element[] {
  return TONES.map((tone, i) => (
    <div key={tone} class="kit-cell">
      <span class="kit-label">GodRays · {tone}</span>
      <GodRays tone={tone} seed={7 + i} size="44rem" spin={tone === 'gold' ? 150 : 90} />
      <div class="kit-title">Level Up</div>
    </div>
  ));
}

function MotesCells(): JSX.Element[] {
  const cells: [string, JSX.Element, boolean?][] = [
    ['Motes · ember (EmberField)', <Motes preset="ember" count={34} />],
    ['Motes · gold', <Motes preset="gold" count={40} />],
    ['Motes · snow', <Motes preset="snow" count={70} />, true],
    ['Motes · burst (loop)', <Motes preset="burst" count={64} loop period={2.4} y={0.55} />],
    ['Motes · burst jade', <Motes preset="burst" count={48} loop period={2.1} color="#7fe3aa" y={0.55} seed={4} />],
    ['Motes · ember on art', <Motes preset="ember" count={28} seed={9} />, true],
  ];
  return cells.map(([label, el, art]) => (
    <div key={label} class={`kit-cell${art ? ' is-art' : ''}`}>
      <span class="kit-label">{label}</span>
      {el}
    </div>
  ));
}

function useReplay(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((v) => v + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

function BurstCells({ tone = 'gold' }: { tone?: FxTone }): JSX.Element {
  const n = useReplay(2600);
  return (
    <>
      {[0.1, 0.4, 0.9].map((t) => (
        <div key={t} class="kit-cell">
          <span class="kit-label">Burst · t = {t.toFixed(1)} s</span>
          <Burst t={t} tone={tone} scale={0.62} y="62%" />
          <div class="kit-title" style={{ top: '52%' }}>
            Level Up
          </div>
        </div>
      ))}
      <div class="kit-cell">
        <span class="kit-label">Burst · live (every 2.6 s)</span>
        <Burst play={n} tone={tone} scale={0.62} y="62%" />
        <div class="kit-title" style={{ top: '52%' }}>
          Level Up
        </div>
      </div>
      <div class="kit-cell">
        <span class="kit-label">Burst · legendary t = .4</span>
        <Burst t={0.4} tone="legendary" scale={0.62} y="62%" seed={5} />
      </div>
      <div class="kit-cell">
        <span class="kit-label">Burst · jade t = .4 (essence)</span>
        <Burst t={0.4} tone="jade" scale={0.62} y="62%" seed={8} />
      </div>
    </>
  );
}

function ClassCells(): JSX.Element {
  const n = useReplay(3000);
  const sp = shineProps('Victory', { idle: true, delay: 0.2 });
  return (
    <>
      <div class="kit-cell">
        <span class="kit-label">.ms-shine-sweep (shineProps, idle)</span>
        <div {...sp} class={`kit-title ${sp.class}`}>
          Victory
        </div>
      </div>
      <div class="kit-cell" style={{ display: 'grid', placeItems: 'center' }}>
        <span class="kit-label">.ms-stamp + .ms-ring-burst</span>
        <div key={n} style={{ position: 'relative', display: 'grid', placeItems: 'center', width: '12rem', height: '10rem' }}>
          <i class="ms-ring-burst" style={{ '--fx-x': '50%', '--fx-y': '50%', '--ring-size': '7rem', '--d': '0.2s' } as JSX.CSSProperties} />
          <span class="kit-medal ms-stamp">P</span>
        </div>
      </div>
      <div class="kit-cell" style={{ display: 'grid', placeItems: 'center' }}>
        <span class="kit-label">.ms-flash-on / .ms-flash</span>
        <i key={`f${n}`} class="ms-flash" style={{ '--d': '0.5s' } as JSX.CSSProperties} />
        <span key={`b${n}`} class="kit-btn ms-flash-on" style={{ '--d': '0.5s' } as JSX.CSSProperties}>
          +1 Point
        </span>
      </div>
      <div class="kit-cell">
        <span class="kit-label">{'<Pillar>'} (live)</span>
        <Pillar key={`p${n}`} y="80%" />
      </div>
      <div class="kit-cell">
        <span class="kit-label">.ms-pillar (CSS only)</span>
        <i key={`c${n}`} class="ms-pillar" style={{ '--fx-y': '80%' } as JSX.CSSProperties} />
      </div>
      <div class="kit-cell">
        <span class="kit-label">GodRays still (reduced motion look)</span>
        <GodRays spin={0} pulse={false} size="44rem" />
      </div>
    </>
  );
}

function FxPage({ section }: { section?: string }): JSX.Element {
  const show = (s: string): boolean => !section || section === s;
  return (
    <div class="kit-page">
      {show('rays') && (
        <>
          <div class="kit-h">C9 · GodRays (procedural sprite, 2 counter-turning layers)</div>
          <div class="kit-grid">{Rays()}</div>
        </>
      )}
      {show('motes') && (
        <>
          <div class="kit-h">C9 · Motes (one canvas, ≤128 particles, analytic)</div>
          <div class="kit-grid">{MotesCells()}</div>
        </>
      )}
      {show('burst') && (
        <>
          <div class="kit-h">C9 · Burst (pillar + star flare + rings + sparkles + flash)</div>
          <div class="kit-grid">
            <BurstCells />
          </div>
        </>
      )}
      {show('classes') && (
        <>
          <div class="kit-h">C9 · fx.css classes</div>
          <div class="kit-grid">
            <ClassCells />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------- burst page

function BurstPage({ t, tone = 'gold' }: { t?: number; tone?: FxTone }): JSX.Element {
  const n = useReplay(3200);
  const sp = shineProps('Level Up', { delay: 0.3 });
  return (
    <div class="kit-burst">
      <GodRays tone={tone === 'gold' ? 'gold' : tone} />
      <Motes preset="gold" count={30} seed={2} />
      <Burst {...(t !== undefined ? { t } : { play: n })} tone={tone} />
      <div class="kit-big">
        <div class="kit-eyebrow">Level 12</div>
        {t === undefined ? (
          <div key={n} {...sp} class={`kit-title ${sp.class}`}>
            Level Up
          </div>
        ) : (
          <div class="kit-title">Level Up</div>
        )}
        <div class="kit-sub">Choose a blessing</div>
      </div>
      <span class="kit-t">{t !== undefined ? `t = ${t.toFixed(2)} s (frozen)` : 'live'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------- icon pages

const CURRENCIES: CurrencyKind[] = ['yeop', 'shard', 'kills', 'time', 'xp'];
const STATS = Object.keys(STAT_FAMILY) as StatId[];
const GRADES: [Grade, number][] = [
  ['n', 1],
  ['n', 2],
  ['n', 3],
  ['m', 1],
  ['m', 2],
  ['g', 1],
  ['g', 2],
  ['p', 1],
];
const GLYPHS: UiGlyphName[] = ['close', 'back', 'prev', 'next', 'up', 'down', 'plus', 'minus', 'check', 'pause', 'play', 'gear', 'sound', 'monitor', 'gamepad', 'cloud', 'chest', 'trophy', 'book', 'person', 'swords', 'link', 'heart', 'crown', 'clock', 'skull', 'lock', 'star', 'info', 'warn', 'flame', 'shield'];
const UI_TONES: UiTone[] = ['gold', 'pewter', 'bronze', 'crimson', 'jade', 'ivory'];

const px = (n: number): string => `${n}px`;

function IconsPage(): JSX.Element {
  const sizes = [24, 32, 48];
  return (
    <div class="kit-page">
      <div class="kit-h">C11 · Currency objects (24 / 32 / 48 px)</div>
      {(['kit-g1', 'kit-g2', 'kit-g3'] as const).map((g) => (
        <div key={g} class={`kit-row ${g}`}>
          <span class="kit-cap">{g === 'kit-g1' ? 'night' : g === 'kit-g2' ? 'slot plate' : 'grey'}</span>
          {CURRENCIES.map((k) => sizes.map((s) => <CurrencyIcon key={`${k}${s}`} kind={k} size={px(s)} />))}
        </div>
      ))}
      <div class="kit-h">C11 · Stat gem tiles (orange offence · blue utility · green sustain)</div>
      {sizes.map((s) => (
        <div key={s} class="kit-row kit-g1">
          <span class="kit-cap">{s}px</span>
          {STATS.map((id) => (
            <span key={id} class="kit-ic" title={id}>
              <StatIcon stat={id} size={px(s)} />
              {s === 48 && <span>{id}</span>}
            </span>
          ))}
        </div>
      ))}
      <div class="kit-h">C11 · Grade medallions (1 2 3 · M1 M2 · G1 G2 · P)</div>
      {(['kit-g1', 'kit-g2'] as const).map((g) => (
        <div key={g} class={`kit-row ${g}`}>
          <span class="kit-cap">24 / 32 / 48</span>
          {GRADES.map(([gr, lv]) => sizes.map((s) => <GradeIcon key={`${gr}${lv}${s}`} grade={gr} level={lv} size={px(s)} />))}
        </div>
      ))}
      <div class="kit-h">C11 · HUD edge arrows</div>
      <div class="kit-row kit-g2">
        <span class="kit-cap">boss / metin</span>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <EdgeArrow key={`b${a}`} kind="boss" angle={a} size="48px" />
        ))}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <EdgeArrow key={`m${a}`} kind="metin" angle={a} size="48px" />
        ))}
      </div>
    </div>
  );
}

function GlyphsPage(): JSX.Element {
  const sizes = [24, 32, 48];
  return (
    <div class="kit-page">
      <div class="kit-h">C11 · Engraved UI symbols — gold (active) / pewter (idle), relief</div>
      {(['gold', 'pewter'] as const).map((tone) =>
        sizes.map((s) => (
          <div key={`${tone}${s}`} class="kit-row kit-g1">
            <span class="kit-cap">
              {tone} {s}px
            </span>
            {GLYPHS.map((g) => (
              <UiGlyph key={g} name={g} tone={tone} size={px(s)} />
            ))}
          </div>
        )),
      )}
      <div class="kit-h">Tones (relief) · flat sheen variant</div>
      <div class="kit-row kit-g2">
        <span class="kit-cap">tones 40px</span>
        {UI_TONES.map((tone) => (['gear', 'chest', 'trophy', 'sound', 'close'] as const).map((g) => <UiGlyph key={`${tone}${g}`} name={g} tone={tone} size="40px" />))}
      </div>
      <div class="kit-row kit-g3">
        <span class="kit-cap">grey ground</span>
        {GLYPHS.slice(0, 22).map((g) => (
          <UiGlyph key={g} name={g} tone="gold" size="32px" />
        ))}
      </div>
      <div class="kit-row kit-g2" style={{ alignItems: 'center', fontSize: '1.15rem' }}>
        <span class="kit-cap">caps</span>
        <GlyphCap name="close" />
        <GlyphCap name="back" size="2.8rem" />
        <GlyphCap name="next" size="2.8rem" />
        <GlyphCap name="gear" size="3.4rem" />
        <GlyphCap name="pause" size="3.4rem" tone="pewter" />
        <KeyCap>Esc</KeyCap>
        <KeyCap>E</KeyCap>
        <KeyCap>1</KeyCap>
        <KeyCap>Space</KeyCap>
      </div>
      <div class="kit-row kit-g1">
        <span class="kit-cap">flat 20px</span>
        {GLYPHS.map((g) => (
          <UiGlyph key={g} name={g} tone="gold" size="20px" flat />
        ))}
      </div>
    </div>
  );
}

/** ART.md §10: every icon at 48 px on night / slot plate / grey grounds. */
function Icons48Page(): JSX.Element {
  return (
    <div class="kit-page">
      {(['kit-g1', 'kit-g2', 'kit-g3'] as const).map((g) => (
        <div key={g} class={`kit-row ${g}`} style={{ gap: '.5rem' }}>
          {CURRENCIES.map((k) => (
            <CurrencyIcon key={k} kind={k} size="48px" />
          ))}
          {STATS.map((id) => (
            <StatIcon key={id} stat={id} size="48px" />
          ))}
          {GRADES.map(([gr, lv]) => (
            <GradeIcon key={`${gr}${lv}`} grade={gr} level={lv} size="48px" />
          ))}
          {GLYPHS.map((n) => (
            <UiGlyph key={n} name={n} tone={g === 'kit-g3' ? 'pewter' : 'gold'} size="48px" />
          ))}
          <EdgeArrow kind="boss" size="48px" />
          <EdgeArrow kind="metin" size="48px" />
        </div>
      ))}
    </div>
  );
}

function Specimen({ page, opts }: { page: KitPage; opts: KitOpts }): JSX.Element {
  return (
    <>
      <Style />
      {page === 'fx' && <FxPage {...(opts.section ? { section: opts.section } : {})} />}
      {page === 'burst' && <BurstPage {...(opts.t !== undefined ? { t: opts.t } : {})} {...(opts.tone ? { tone: opts.tone } : {})} />}
      {page === 'icons' && <IconsPage />}
      {page === 'glyphs' && <GlyphsPage />}
      {page === 'icons48' && <Icons48Page />}
    </>
  );
}

export function mountSpecimen(host: HTMLElement, page: KitPage, opts: KitOpts = {}): void {
  render(<Specimen page={page} opts={opts} />, host);
}

export function unmountSpecimen(host: HTMLElement): void {
  render(null, host);
  host.remove();
}
