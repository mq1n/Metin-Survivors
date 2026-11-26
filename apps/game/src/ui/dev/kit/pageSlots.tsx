// Kit specimen page: slots, medals, wells, chips (C4). Dev only.
import type { ComponentChildren, JSX } from 'preact';
import type { Rarity } from '../../../data/schema';
import { Chip, type ChipTone } from '../../components/Chip';
import { Glyph } from '../../components/glyphs';
import { Medal } from '../../components/Medal';
import { Panel } from '../../components/Panel';
import { IconSlot } from '../../components/Slot';
import { StatWell } from '../../components/StatWell';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const SKILL = 'icon_skill_bladewheel';
const GEAR = 'icon_gear_warrior_weapon_sword_t1';
const STONE = 'icon_pearl_lethal';
const LEGACY = 'icon_gear_bracelet_t2';
const PASSIVE = 'icon_passive_follow_through';

function Sec({ title, note, children }: { title: string; note?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <section class="ks-sec">
      <h3 class="ks-h">{title}</h3>
      {note && <p class="ks-note">{note}</p>}
      <div class="ks-row">{children}</div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children?: ComponentChildren }): JSX.Element {
  return (
    <div class="ks-slotcell">
      {children}
      <span class="ks-lbl">{label}</span>
    </div>
  );
}

function Matrix(): JSX.Element {
  const states: { key: string; node: (r: Rarity) => JSX.Element }[] = [
    { key: 'empty', node: (r) => <IconSlot rarity={r} ghost="helmet" /> },
    { key: 'cutout', node: (r) => <IconSlot rarity={r} icon={GEAR} kind="gear" /> },
    { key: 'legacy', node: (r) => <IconSlot rarity={r} icon={LEGACY} kind="gear" slot="bracelet" /> },
    { key: 'locked', node: (r) => <IconSlot rarity={r} icon={GEAR} kind="gear" locked /> },
    { key: 'awakened', node: (r) => <IconSlot rarity={r} icon={GEAR} kind="gear" awakened /> },
    { key: 'cooldown', node: (r) => <IconSlot rarity={r} icon={GEAR} kind="gear" cooldown={0.6} /> },
    { key: 'selected', node: (r) => <IconSlot rarity={r} icon={GEAR} kind="gear" selected onClick={() => undefined} /> },
    { key: 'badge +3', node: (r) => <IconSlot rarity={r} icon={STONE} kind="stone" badge="+3" /> },
  ];
  return (
    <Panel variant="board" class="ks-wide" body>
      <div class="ks-slotmatrix">
        <span />
        {states.map((s) => (
          <span key={s.key} class="ks-lbl ks-hdr">
            {s.key}
          </span>
        ))}
        {RARITIES.map((r) => (
          <>
            <span key={`${r}-l`} class="ks-lbl ks-rowlbl">
              {r}
            </span>
            {states.map((s) => (
              <div key={`${r}-${s.key}`} class="ks-slotpad" title={s.key}>
                {s.node(r)}
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
      <div class="ks-flow ks-flow--end">
        {(['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const).map((s) => (
          <Cell key={s} label={s}>
            <IconSlot size={s} icon={SKILL} kind="skill" rank={s === 'xs' ? 1 : s === 'sm' ? 3 : s === 'md' ? 4 : s === 'lg' ? 5 : s === 'xl' ? 6 : 7} hotkey={s === 'md' ? '3' : undefined} />
          </Cell>
        ))}
        <Cell label="form tile">
          <IconSlot icon={SKILL} kind="skill" />
        </Cell>
        <Cell label="form cutout">
          <IconSlot icon={GEAR} kind="gear" rarity="rare" />
        </Cell>
        <Cell label="form legacy">
          <IconSlot icon={LEGACY} kind="gear" rarity="rare" />
        </Cell>
        <Cell label="passive tile">
          <IconSlot icon={PASSIVE} kind="passive" badge={3} />
        </Cell>
        <Cell label="no icon (fallback)">
          <IconSlot icon="icon_unknown_fire_blade" kind="skill" element="fire" rank={2} />
        </Cell>
        <Cell label="legacy slot">
          <IconSlot kit={false} icon={SKILL} kind="skill" rank={3} rarity="epic" />
        </Cell>
      </div>
    </Panel>
  );
}

function Ranks(): JSX.Element {
  return (
    <Panel variant="board" class="ks-wide" body>
      <div class="ks-flow ks-flow--end">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
          <Cell key={r} label={`rank ${r}`}>
            <IconSlot size="lg" icon={SKILL} kind="skill" rank={r} />
          </Cell>
        ))}
      </div>
      <div class="ks-flow ks-flow--end" style={{ marginTop: '1rem' }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
          <Cell key={r} label={`sm ${r}`}>
            <IconSlot size="sm" icon={SKILL} kind="skill" rank={r} />
          </Cell>
        ))}
        {['n', 'm', 'g', 'p'].map((b) => (
          <Cell key={b} label={`medal ${b}`}>
            <Medal band={b as 'n'} label={b === 'n' ? '3' : b === 'p' ? 'P' : `${b.toUpperCase()}2`} size="lg" />
          </Cell>
        ))}
        <Cell label="tag">
          <Medal tag label="+12" size="lg" />
        </Cell>
      </div>
    </Panel>
  );
}

function Wells(): JSX.Element {
  return (
    <Panel variant="board" title="Character" class="ks-win" body>
      <div class="ks-wells">
        <StatWell label="Level" value={39} layout="row" />
        <StatWell label="Experience" value="142,300" unit="/ 232,767" />
        <StatWell label="Yeop" value="4,380,000" tone="gold" icon={<Glyph name="coin" />} />
        <StatWell label="Kills" value={812} size="sm" dotted />
        <StatWell label="Damage taken" value="1,204" tone="bad" />
        <StatWell label="Heal" value="+86" tone="good" size="sm" />
        <StatWell label="Score" value="128,450" layout="stack" size="hero" />
        <div class="ks-flow">
          <StatWell value={7} size="sm" />
          <StatWell value="12:45" />
          <StatWell value="x3" size="lg" tone="gold" />
        </div>
      </div>
    </Panel>
  );
}

const TONES: ChipTone[] = ['neutral', 'gold', 'red', 'jade', 'violet', 'info', 'new'];

function Chips(): JSX.Element {
  return (
    <Panel variant="board" class="ks-win" body>
      <div class="ks-flow">
        {TONES.map((t) => (
          <Chip key={t} tone={t}>
            {t === 'new' ? 'New' : t}
          </Chip>
        ))}
      </div>
      <div class="ks-flow" style={{ marginTop: '0.7rem' }}>
        {TONES.map((t) => (
          <Chip key={t} tone={t} size="sm" icon={t === 'red' ? <Glyph name="skull" /> : undefined}>
            {t}
          </Chip>
        ))}
      </div>
    </Panel>
  );
}

export function SlotsPage(): JSX.Element {
  return (
    <>
      <Sec title="Slots · rarity × state" note="Octagon cell (14 % chamfer), pewter / rarity rim, glow as drop-shadow, medal and lock outside the frame">
        <Matrix />
      </Sec>
      <Sec title="Sizes · icon forms · rank bands" note="tile = octagon tile with its own rim · cutout = transparent object on the well · legacy = opaque square masked to the octagon">
        <Sizes />
      </Sec>
      <Sec title="Rank medals · rank-band tiles" note="rank 0-2 = base tile, 3-4 = __m, 5-6 = __g, 7 = __p">
        <Ranks />
      </Sec>
      <Sec title="Number wells · chips">
        <Wells />
        <Chips />
      </Sec>
    </>
  );
}
