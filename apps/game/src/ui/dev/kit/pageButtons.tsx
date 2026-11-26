// Kit specimen page: plates, tabs, form controls (C3). Dev only. States are forced with the `.ks-*` classes of
// kitSpecimen.css (a real :hover / :focus cannot be held on twenty elements at once).
import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button, Tabs } from '../../components/Button';
import { Field, Segmented, Slider, TextInput, Toggle } from '../../components/Controls';
import { Panel } from '../../components/Panel';
import { Glyph } from '../../components/glyphs';

const noop = (): void => undefined;

function Sec({ title, note, children }: { title: string; note?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <section class="ks-sec">
      <h3 class="ks-h">{title}</h3>
      {note && <p class="ks-note">{note}</p>}
      <div class="ks-row">{children}</div>
    </section>
  );
}

const KINDS: { key: string; label: string; props: Record<string, unknown> }[] = [
  { key: 'primary', label: 'primary (lacquer)', props: { variant: 'primary' } },
  { key: 'stone', label: 'stone  variant="wood"', props: { variant: 'wood' } },
  { key: 'active', label: 'stone + active', props: { variant: 'wood', active: true } },
  { key: 'text', label: 'text  variant="ghost"', props: { variant: 'ghost' } },
  { key: 'danger', label: 'danger', props: { variant: 'wood', danger: true } },
];
const STATES = ['rest', 'hover', 'focus', 'pressed', 'disabled'] as const;

function Matrix(): JSX.Element {
  return (
    <Panel variant="board" class="ks-wide" body>
      <div class="ks-matrix">
        <span />
        {STATES.map((s) => (
          <span key={s} class="ks-lbl ks-hdr">
            {s}
          </span>
        ))}
        {KINDS.map((k) => (
          <>
            <span key={`${k.key}-l`} class="ks-lbl ks-rowlbl">
              {k.label}
            </span>
            {STATES.map((s) => (
              <div key={`${k.key}-${s}`} class="ks-cell" data-st={s}>
                <Button {...(k.props as object)} class={s === 'rest' || s === 'disabled' ? '' : `ks-${s}`} disabled={s === 'disabled'} onClick={noop} sound="none">
                  Continue
                </Button>
              </div>
            ))}
          </>
        ))}
      </div>
    </Panel>
  );
}

function Sizes(): JSX.Element {
  return (
    <Panel variant="board" class="ks-wide" body>
      <div class="ks-flow">
        <Button size="small" onClick={noop} sound="none">
          Small
        </Button>
        <Button onClick={noop} sound="none">
          Normal
        </Button>
        <Button size="big" onClick={noop} sound="none">
          Big · Start
        </Button>
        <Button variant="wood" size="small" onClick={noop} sound="none">
          Small
        </Button>
        <Button variant="wood" onClick={noop} sound="none">
          Normal
        </Button>
        <Button variant="wood" size="big" onClick={noop} sound="none">
          Big
        </Button>
        <Button variant="wood" icon onClick={noop} sound="none" aria-label="Plus">
          <Glyph name="plus" />
        </Button>
        <Button variant="wood" sub="1,250 Yeop" onClick={noop} sound="none">
          Reroll
        </Button>
        <Button variant="wood" danger onClick={noop} sound="none">
          Banish
        </Button>
        <Button variant="ghost" onClick={noop} sound="none">
          Skip
        </Button>
        <Button variant="ghost" class="ks-hover" onClick={noop} sound="none">
          Skip (hover)
        </Button>
      </div>
      <div class="ks-col" style={{ marginTop: '0.8rem', maxWidth: '20rem' }}>
        <Button block onClick={noop} sound="none">
          Block primary
        </Button>
        <Button block variant="wood" left onClick={noop} sound="none">
          Block stone · left
        </Button>
      </div>
    </Panel>
  );
}

function Legacy(): JSX.Element {
  return (
    <div class="ks-flow ks-legacy">
      <Button kit={false} onClick={noop} sound="none">
        Legacy primary
      </Button>
      <Button kit={false} variant="wood" onClick={noop} sound="none">
        Legacy wood
      </Button>
      <Button kit={false} variant="ghost" onClick={noop} sound="none">
        Legacy ghost
      </Button>
      <Button kit={false} danger onClick={noop} sound="none">
        Legacy danger
      </Button>
    </div>
  );
}

function Controls(): JSX.Element {
  const [tab, setTab] = useState('skills');
  const [seg, setSeg] = useState('high');
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [a, setA] = useState(0.37);
  const [b, setB] = useState(1);
  const [txt, setTxt] = useState('Ironbound');
  return (
    <Panel variant="board" title="Settings" onClose={noop} class="ks-wide" body>
      <Tabs
        tabs={[
          { key: 'skills', label: 'Skills' },
          { key: 'gear', label: 'Gear', badge: 3 },
          { key: 'stones', label: 'Stones' },
          { key: 'off', label: 'Locked', disabled: true },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div class="ks-ctl">
        <Field label="Quality" hint="Segmented plates in a trough">
          <Segmented
            options={[
              { key: 'low', label: 'Low' },
              { key: 'med', label: 'Medium' },
              { key: 'high', label: 'High' },
              { key: 'ultra', label: 'Ultra', disabled: true },
            ]}
            value={seg}
            onChange={setSeg}
          />
        </Field>
        <Field label="Music volume" hint="Drag: value bubble">
          <Slider value={a} onChange={setA} />
        </Field>
        <Field label="Effects volume">
          <Slider value={b} onChange={setB} ticks={5} />
        </Field>
        <Field label="Screen shake">
          <Toggle value={on} onChange={setOn} label="Screen shake" />
        </Field>
        <Field label="Damage numbers">
          <Toggle value={off} onChange={setOff} label="Damage numbers" />
        </Field>
        <Field label="Player name">
          <TextInput value={txt} onInput={setTxt} label="Name" />
        </Field>
        <Field label="Room code">
          <TextInput value="K7QX" onInput={noop} code label="Code" />
        </Field>
        <Field label="Forced states">
          <div class="ks-flow">
            <div class="ks-ctl-hold ks-drag">
              <Slider value={0.62} onChange={noop} />
            </div>
            <div class="ks-ctl-hold ks-focus-in">
              <TextInput value="focused" onInput={noop} label="Focused" />
            </div>
          </div>
        </Field>
      </div>
    </Panel>
  );
}

export function ButtonsPage(): JSX.Element {
  return (
    <>
      <Sec title="Plates · kind × state" note="Button inside a kit scope: stone #3d3c37 · hover lifts the face and lights the label · pressed inverts the bevel · disabled keeps 3:1 text">
        <Matrix />
      </Sec>
      <Sec title="Sizes · block · icon · sub caption · danger · text">
        <Sizes />
      </Sec>
      <Sec title="Tabs · segmented · slider · toggle · input · field" note="Kit controls on a board">
        <Controls />
      </Sec>
      <Sec title="Legacy (kit={false}) for comparison">
        <Legacy />
      </Sec>
    </>
  );
}
