// Kit specimen page: type system (C7). Dev only. Two voices (Cinzel display / Alegreya Sans body), lining + tabular numerals,
// the --t-* scale with its px floor, the Turkish dotted / dotless I.
import type { ComponentChildren, JSX } from 'preact';
import { Panel } from '../../components/Panel';
import { StatWell } from '../../components/StatWell';

const SCALE: { k: string; cls: string }[] = [
  { k: '2xs', cls: 'ms-t-2xs' },
  { k: 'xs', cls: 'ms-t-xs' },
  { k: 'sm', cls: 'ms-t-sm' },
  { k: 'md', cls: 'ms-t-md' },
  { k: 'lg', cls: 'ms-t-lg' },
  { k: 'xl', cls: 'ms-t-xl' },
  { k: '2xl', cls: 'ms-t-2xl' },
  { k: '3xl', cls: 'ms-t-3xl' },
];

function Sec({ title, note, children }: { title: string; note?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <section class="ks-sec">
      <h3 class="ks-h">{title}</h3>
      {note && <p class="ks-note">{note}</p>}
      <div class="ks-row">{children}</div>
    </section>
  );
}

export function TypePage(): JSX.Element {
  return (
    <>
      <Sec title="Scale · --t-2xs … --t-3xl" note="rem for layout scaling, px floor for legibility (2xs 12 px / 10.5 px, md 15 px / 13 px)">
        <Panel variant="board" class="ks-wide" body>
          <div class="ks-typescale">
            {SCALE.map((s) => (
              <>
                <span key={`${s.k}-l`} class="ks-lbl ks-rowlbl">
                  --t-{s.k}
                </span>
                <span key={`${s.k}-h`} class={`ms-head ${s.cls}`}>
                  Choose your hero
                </span>
                <span key={`${s.k}-b`} class={s.cls}>
                  The ember road climbs 0123456789 steps. Level 39 · 12:45 · Tier 1
                </span>
              </>
            ))}
          </div>
        </Panel>
      </Sec>
      <Sec title="Roles" note="ms-title (display) · ms-head · ms-eyebrow · ms-label · ms-body · ms-fine · ms-num">
        <Panel variant="board" class="ks-win" body>
          <div class="ks-col">
            <span class="ms-eyebrow">Chapter one</span>
            <span class="ms-title ms-title--2xl">CHOOSE YOUR HERO</span>
            <span class="ms-head ms-head--lg">Hero select · Zone select</span>
            <span class="ms-label">Experience</span>
            <p class="ms-body">Body copy in Alegreya Sans at 15 px: readable lining numerals, 0123456789, never old-style.</p>
            <p class="ms-fine">Fine print: 13 px floor for tooltips, captions and sub lines.</p>
            <div class="ks-flow">
              <span class="ms-num ms-num--3xl">00:00</span>
              <span class="ms-num ms-num--2xl">128,450</span>
              <StatWell value="39" size="lg" />
            </div>
          </div>
        </Panel>
        <Panel variant="board" class="ks-win" body>
          <div class="ks-col">
            <span class="ms-eyebrow">Turkish</span>
            <span class="ms-title ms-title--2xl">{'ışık İstanbul'.toLocaleUpperCase('tr')}</span>
            <span class="ms-head ms-head--lg" style={{ textTransform: 'uppercase' }}>
              Atladın · Başla · Işınlan · iyi
            </span>
            <p class="ms-body" lang="tr">
              İlk düşman geldi, ışın kılıcı çıktı. Çıkış, Ödül, Şans, Ğ ve ğ.
            </p>
          </div>
        </Panel>
      </Sec>
    </>
  );
}
