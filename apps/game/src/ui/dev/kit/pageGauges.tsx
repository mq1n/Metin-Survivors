// Kit specimen page: gauges (C5). Dev only. 6 skins x fills 0 / 37 / 100, then the options one by one.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { portraitFaceUrl } from '../../assets';
import { Gauge, type GaugeSkin } from '../../components/Gauge';
import { Orb } from '../../components/Orb';
import { Panel } from '../../components/Panel';
import { Bar } from '../../components/Slot';

function Sec({ title, note, children }: { title: string; note?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <section class="ks-sec">
      <h3 class="ks-h">{title}</h3>
      {note && <p class="ks-note">{note}</p>}
      <div class="ks-row">{children}</div>
    </section>
  );
}

const SKINS: GaugeSkin[] = ['hp', 'sp', 'xp', 'boss', 'loader'];

function Matrix(): JSX.Element {
  return (
    <Panel variant="board" class="ks-wide" body>
      <div class="ks-gmatrix">
        {SKINS.map((s) => (
          <>
            <span key={`${s}-l`} class="ks-lbl ks-rowlbl">
              {s}
            </span>
            {[0, 0.37, 1].map((f) => (
              <Gauge key={`${s}-${f}`} skin={s} value={f} label={s === 'hp' ? `${Math.round(f * 480)} / 480` : `${Math.round(f * 100)}%`} height={s === 'boss' ? '1.7rem' : undefined} />
            ))}
          </>
        ))}
        <span class="ks-lbl ks-rowlbl">thin xp</span>
        {[0, 0.37, 1].map((f) => (
          <Gauge key={`t${f}`} skin="xp" value={f} thin />
        ))}
      </div>
    </Panel>
  );
}

function Options(): JSX.Element {
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFlash((n) => n + 1), 2600);
    return () => window.clearInterval(id);
  }, []);
  return (
    <Panel variant="board" class="ks-wide" body>
      <div class="ks-gopts">
        <span class="ks-lbl">shield (blue segment)</span>
        <Gauge skin="hp" value={0.55} shield={0.25} label="264 + 120" />
        <span class="ks-lbl">low hp (edge pulse + shake)</span>
        <Gauge skin="hp" value={0.16} label="77 / 480" />
        <span class="ks-lbl">segments 10 + shine</span>
        <Gauge skin="xp" value={0.62} segments={10} shine />
        <span class="ks-lbl">sparks</span>
        <Gauge skin="xp" value={0.45} spark />
        <span class="ks-lbl">threshold flash (every 2.6 s)</span>
        <Gauge skin="xp" value={0.78} flash={flash} />
        <span class="ks-lbl">label start / end</span>
        <Gauge skin="hp" value={0.7} labelStart="Lv 12" labelEnd="3,400 / 4,800" />
        <span class="ks-lbl">caps plain</span>
        <Gauge skin="sp" value={0.5} caps="plain" label="50%" />
        <span class="ks-lbl">caps none</span>
        <Gauge skin="sp" value={0.5} caps="none" label="50%" />
        <span class="ks-lbl">custom paint (colour prop)</span>
        <Gauge value={0.6} color="linear-gradient(180deg, #1f4a2a, #8fe39a 30%, #2f8a4a 60%, #14301c)" glow="#4fc86a" />
        <span class="ks-lbl">big boss plate 2.2 rem</span>
        <Gauge skin="boss" value={0.82} height="2.2rem" label="Tiger God" />
        <span class="ks-lbl">Bar alias (kit scope)</span>
        <Bar value={0.4} variant="xp" label="Bar variant=xp" />
        <span class="ks-lbl">Bar legacy (kit=false)</span>
        <Bar kit={false} value={0.4} variant="xp" label="Bar legacy" />
        <span class="ks-lbl">Bar legacy hp</span>
        <Bar kit={false} value={0.7} variant="hp" label="372 / 480" />
      </div>
    </Panel>
  );
}

function Orbs(): JSX.Element {
  const face = portraitFaceUrl('warrior', 'm');
  return (
    <Panel variant="board" class="ks-wide" body>
      <div class="ks-flow">
        <Orb src={face} size="4rem" level={12} />
        <Orb src={face} size="6rem" level={39} glow="#e8a33a" />
        <Orb size="8rem" level="P">
          <span class="ms-title" style={{ fontSize: '2.4rem' }}>
            W
          </span>
        </Orb>
        <div class="ks-col" style={{ flex: 1, minWidth: '14rem' }}>
          <Gauge skin="hp" value={0.72} label="346 / 480" />
          <Gauge skin="sp" value={0.4} label="40 / 100" />
          <Gauge skin="xp" value={0.18} thin />
        </div>
      </div>
    </Panel>
  );
}

export function GaugesPage(): JSX.Element {
  return (
    <>
      <Sec title="Gauges · 5 skins + thin × fill 0 / 37 / 100" note="black-metal channel, spiked brass caps (uk_gauge_cap), lacquer-tube fill, leading-edge glow">
        <Matrix />
      </Sec>
      <Sec title="Orb frame + gauge stack (taskbar read)" note="uk_orb_ring around a portrait, level plate on the rim, HP / SP / XP gauges beside it">
        <Orbs />
      </Sec>
      <Sec title="Options" note="shield, low state, segments, sparks, flash, labels, caps, custom paint, Bar alias">
        <Options />
      </Sec>
    </>
  );
}
