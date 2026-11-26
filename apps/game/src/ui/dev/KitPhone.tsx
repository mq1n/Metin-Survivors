// Phone-tier specimen (C8, UI core lane C; dev only, rides in the gallery chunk). Gallery scenarios `kit-phone*`
// (ui/dev/scenarios/kit-phone.ts) mount it over an empty run screen: live tier readout, the ScrollFade states (fits /
// start / middle / end, horizontal, zero-JS .ms-edgefade), core controls with their measured touch boxes, keyboard /
// touch hints and the safe-area utilities. Every number on the page is measured in the page, not typed in.
import { effect } from '@preact/signals';
import { h, render, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ClassId, ContentDB } from '../../data/schema';
import { tl } from '../../i18n/i18n';
import { Button, Tabs } from '../components/Button';
import { Segmented, Slider, Toggle } from '../components/Controls';
import { ScrollFade } from '../components/ScrollFade';
import { IconSlot, KeyHint } from '../components/Slot';
import { LAYOUT_TIERS, layout } from '../layout';
import { subView } from '../view';
import type { GalleryCtx } from '../gallery';
import './kitPhone.css';

interface Row {
  icon: string;
  name: string;
  sub: string;
}

function rowsFor(content: ContentDB, classId: ClassId): Row[] {
  const skills = content.skills.filter((s) => s.classId === classId || s.classId === 'common');
  const out: Row[] = skills.map((s) => ({ icon: s.icon, name: tl(s.name), sub: `${s.kind} · ${s.element}` }));
  for (const p of content.passives) out.push({ icon: p.icon, name: tl(p.name), sub: `passive · ${p.maxRank} ranks` });
  return out;
}

function List({ rows, count, at, label }: { rows: Row[]; count: number; at: 'start' | 'middle' | 'end'; label: string }): JSX.Element {
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = view.current;
    if (!el) return undefined;
    const id = requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = at === 'start' ? 0 : at === 'end' ? max : Math.round(max / 2);
    });
    return () => cancelAnimationFrame(id);
  }, [at, count]);
  return (
    <figure class="kp-demo">
      <ScrollFade class="kp-list" viewClass="kp-list-view" viewRef={view}>
        {rows.slice(0, count).map((r, i) => (
          <div key={i} class="kp-row">
            <IconSlot icon={r.icon} size="sm" />
            <span class="kp-row-text">
              <b>{r.name}</b>
              <i>{r.sub}</i>
            </span>
          </div>
        ))}
      </ScrollFade>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function EdgeList({ rows }: { rows: Row[] }): JSX.Element {
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = view.current;
    if (!el) return undefined;
    const id = requestAnimationFrame(() => (el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.4)));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <figure class="kp-demo">
      <div class="kp-list">
        <div ref={view} class="kp-list-view ms-scroll ms-edgefade">
          {rows.slice(0, 12).map((r, i) => (
            <div key={i} class="kp-row">
              <IconSlot icon={r.icon} size="sm" />
              <span class="kp-row-text">
                <b>{r.name}</b>
                <i>{r.sub}</i>
              </span>
            </div>
          ))}
        </div>
      </div>
      <figcaption>.ms-edgefade · zero JS</figcaption>
    </figure>
  );
}

/** Effective hit box of an element: how far a tap still lands on it, scanning out from its centre along x and y. */
function hitBox(el: Element): { w: number; h: number } {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hits = (x: number, y: number): boolean => {
    const t = document.elementFromPoint(x, y);
    return !!t && (t === el || el.contains(t));
  };
  const reach = (dx: number, dy: number): number => {
    let d = 0;
    while (d < 60 && hits(cx + dx * (d + 1), cy + dy * (d + 1))) d++;
    return d;
  };
  if (!hits(cx, cy)) return { w: 0, h: 0 };
  return { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
}

function Measured({ children, label, wide }: { children: JSX.Element; label: string; wide?: boolean }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<{ rw: number; rh: number; w: number; h: number } | null>(null);
  const lay = layout.value;
  useEffect(() => {
    let id = 0;
    // elementFromPoint answers null outside the viewport: measure only while the control (plus its hit slop) is on screen,
    // keep the last good numbers otherwise, and measure again after every scroll / layout change
    const measure = (): void => {
      id = 0;
      const el = box.current?.querySelector('button, [role="slider"], input');
      if (!el) return;
      const r = el.getBoundingClientRect();
      // fully visible and clear of the fixed header band (the page scroller starts below it)
      const top = document.querySelector('.kp-page')?.getBoundingClientRect().top ?? 0;
      if (r.left < 1 || r.top < top + 1 || r.right > innerWidth - 1 || r.bottom > innerHeight - 1) return;
      const hb = hitBox(el);
      setM({ rw: Math.round(r.width), rh: Math.round(r.height), w: hb.w, h: hb.h });
    };
    const schedule = (): void => {
      if (id) cancelAnimationFrame(id);
      id = requestAnimationFrame(() => (id = requestAnimationFrame(measure)));
    };
    setM(null);
    schedule();
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    return () => {
      if (id) cancelAnimationFrame(id);
      document.removeEventListener('scroll', schedule, { capture: true });
    };
  }, [lay.w, lay.h, lay.touch]);
  const need = lay.touch ? lay.tap : 0;
  const ok = !!m && m.w >= need - 0.5 && m.h >= need - 0.5;
  return (
    <div class={`kp-meas ${wide ? 'kp-meas--wide' : ''}`} ref={box}>
      <div class="kp-meas-ctl">{children}</div>
      <div class={`kp-meas-tag ${m ? (ok ? 'is-ok' : 'is-bad') : ''}`}>
        <span>{label}</span>
        <b class="ms-num">{m ? `${m.rw}×${m.rh}` : '…'}</b>
        {m && (m.w !== m.rw || m.h !== m.rh) && <em class="ms-num">hit {m.w}×{m.h}</em>}
      </div>
    </div>
  );
}

function Readout(): JSX.Element {
  const l = layout.value;
  const [safe, setSafe] = useState('0 / 0 / 0 / 0');
  useEffect(() => {
    const ui = document.querySelector('.ms-ui');
    if (!ui) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;padding:var(--safe-t) var(--safe-r) var(--safe-b) var(--safe-l)';
    ui.appendChild(probe);
    const cs = getComputedStyle(probe);
    setSafe([cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => Math.round(parseFloat(v))).join(' / '));
    probe.remove();
  }, [l.w, l.h]);
  return (
    <div class="kp-readout">
      <div class="kp-tiers" aria-label="tier">
        {LAYOUT_TIERS.map((t) => (
          <span key={t} class={`kp-tier ${t === l.tier ? 'is-on' : ''}`}>
            {t}
          </span>
        ))}
      </div>
      <div class="kp-facts">
        <span>
          <i>viewport</i>
          <b class="ms-num">
            {l.w}×{l.h}
          </b>
        </span>
        <span>
          <i>rem</i>
          <b class="ms-num">{l.rem.toFixed(2)} px</b>
        </span>
        <span>
          <i>dpr</i>
          <b class="ms-num">{l.dpr}</b>
        </span>
        <span>
          <i>pointer</i>
          <b>{l.touch ? 'touch' : 'mouse'}</b>
        </span>
        <span>
          <i>hover</i>
          <b>{l.hover ? 'yes' : 'no'}</b>
        </span>
        <span>
          <i>--tap</i>
          <b class="ms-num">{Math.round(l.tap)} px</b>
        </span>
        <span>
          <i>safe t/r/b/l</i>
          <b class="ms-num">{safe}</b>
        </span>
      </div>
    </div>
  );
}

function KitPhone({ content, classId }: { content: ContentDB; classId: ClassId }): JSX.Element {
  const rows = rowsFor(content, classId);
  const [seg, setSeg] = useState<'tr' | 'en'>('en');
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(0.6);
  const chips = [...content.zones.map((z) => tl(z.name)), ...content.bosses.map((b) => tl(b.name))].slice(0, 14);
  return (
    <div class="kp ms-safe-pad">
      <header class="kp-bar">
        <h1 class="kp-title">Phone tier · C8</h1>
        <Readout />
      </header>
      <ScrollFade class="kp-page" viewClass="kp-page-view" size="3rem">
        <section class="kp-sec kp-sec--fades">
          <h2 class="kp-h">
            Scroll fades <small>an edge fades only while more lies beyond it</small>
          </h2>
          <div class="kp-lists">
            <List rows={rows} count={3} at="start" label="fits · no fade, no cue" />
            <List rows={rows} count={14} at="start" label="start · fade + cue below" />
            <List rows={rows} count={14} at="middle" label="middle · both edges" />
            <List rows={rows} count={14} at="end" label="end · fade above only" />
            <EdgeList rows={rows} />
          </div>
          <figure class="kp-demo kp-demo--x">
            <ScrollFade axis="x" class="kp-strip" viewClass="kp-strip-view">
              {chips.map((c, i) => (
                <span key={i} class="kp-chip">
                  {c}
                </span>
              ))}
            </ScrollFade>
            <figcaption>axis x · side fades + cues</figcaption>
          </figure>
        </section>

        <section class="kp-sec kp-sec--tap">
          <h2 class="kp-h">
            Touch targets <small>core controls reach --tap on touch; the switch keeps its size with a hit slop</small>
          </h2>
          <div class="kp-ctls">
            <Measured label="primary · small">
              <Button size="small">Resume</Button>
            </Measured>
            <Measured label="stone · small">
              <Button variant="wood" size="small">
                Back <KeyHint k="Esc" />
              </Button>
            </Measured>
            <Measured label="icon">
              <Button variant="wood" size="small" icon aria-label="Fullscreen">
                ⛶
              </Button>
            </Measured>
            <Measured label="segmented">
              <Segmented
                options={[
                  { key: 'tr', label: 'TR' },
                  { key: 'en', label: 'EN' },
                ]}
                value={seg}
                onChange={setSeg}
              />
            </Measured>
            <Measured label="tab" wide>
              <Tabs
                tabs={[
                  { key: 'a', label: 'Build' },
                  { key: 'b', label: 'Stats' },
                  { key: 'c', label: 'Log' },
                ]}
                value={tab}
                onChange={setTab}
              />
            </Measured>
            <Measured label="switch">
              <Toggle value={on} onChange={setOn} label="Damage numbers" />
            </Measured>
            <Measured label="slider">
              <Slider value={vol} onChange={setVol} label="Music" />
            </Measured>
          </div>
        </section>

        <section class="kp-sec kp-sec--hints">
          <h2 class="kp-h">
            Hints <small>key caps for keyboards, words for fingers</small>
          </h2>
          <p class="kp-hint">
            <span class="ms-kbd-only">
              Press <KeyHint k="Esc" /> to resume
            </span>
            <span class="ms-touch-only">Tap ❚❚ to resume</span>
          </p>
          <p class="kp-hint">
            <span class="ms-hover-only">Hover an icon for details</span>
            <span class="ms-touch-only">Hold an icon for details</span>
          </p>
          <div class="kp-press">
            <span class="kp-press-btn">rest</span>
            <span class="kp-press-btn is-pressed">pressed</span>
            <small>a press sinks the plate 1 px (touch :active)</small>
          </div>
        </section>

        <section class="kp-sec kp-sec--safe">
          <h2 class="kp-h">
            Safe area <small>--edge + device inset (simulated 28 / 10 / 22 / 10 px)</small>
          </h2>
          <div class="kp-device">
            <div class="kp-device-screen ms-safe-pad">
              <div class="kp-device-ui">
                <span>.ms-safe-pad</span>
                <i>content clears the notch and the home bar</i>
              </div>
            </div>
          </div>
        </section>
      </ScrollFade>
    </div>
  );
}

let active: (() => void) | null = null;

/**
 * Mounts the specimen over an empty run screen (no HUD snapshot = nothing renders under it). It unmounts itself as soon
 * as another scenario changes the store screen, HUD, modal or menu sub-view.
 */
export function showKitPhone(g: GalleryCtx): void {
  active?.();
  g.store.setScreen('run');
  const host = document.querySelector<HTMLElement>('.ms-ui');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'ms-layer kp-host';
  host.appendChild(el);
  render(h(KitPhone, { content: g.content, classId: g.classId }), el);
  const screen0 = g.store.screen.value;
  const hud0 = g.store.hud.value;
  const modal0 = g.store.modal.value;
  const sub0 = subView.value;
  let done = false;
  const dispose = (): void => {
    if (done) return;
    done = true;
    stop();
    render(null, el);
    el.remove();
    if (active === dispose) active = null;
  };
  const stop = effect(() => {
    const changed = g.store.screen.value !== screen0 || g.store.hud.value !== hud0 || g.store.modal.value !== modal0 || subView.value !== sub0;
    if (changed) queueMicrotask(dispose);
  });
  active = dispose;
}
