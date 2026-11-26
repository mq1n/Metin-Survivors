// Kit specimen page: tooltips (C6). Dev only. The tips are drawn in place (position: static); the icon row at the bottom
// has live tipProps for hovering by hand.
import type { ComponentChildren, JSX } from 'preact';
import type { Rarity } from '../../../data/schema';
import { buildTip, gearRarity } from '../../itemTips';
import { Panel } from '../../components/Panel';
import { IconSlot } from '../../components/Slot';
import { TipBody, tipProps } from '../../components/Tooltip';

function Sec({ title, note, children }: { title: string; note?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <section class="ks-sec">
      <h3 class="ks-h">{title}</h3>
      {note && <p class="ks-note">{note}</p>}
      <div class="ks-row">{children}</div>
    </section>
  );
}

function Tip({ rarity, parchment, children }: { rarity?: Rarity; parchment?: boolean; children?: ComponentChildren }): JSX.Element {
  return (
    <div class={`ms-tip ks-tipstatic ${parchment ? 'ms-tip--parchment' : ''} ${rarity ? `ms-tip-r ms-r-${rarity}` : ''}`}>{children}</div>
  );
}

export function TipsPage(): JSX.Element {
  const gearId = 'warrior_weapon_sword_t1';
  return (
    <>
      <Sec title="Tooltip · stat lines · rarity titles" note="near-black translucent box, pewter edge + inner hairline, Cinzel title in the rarity colour; good green / bad red / info pale yellow">
        <Tip rarity="rare">
          <TipBody
            title="Iron Wolf Fang"
            sub="Weapon · Rare"
            body="A fang-edged blade that hungers for blood."
            rows={[
              { label: 'Attack', value: '+18' },
              { label: 'Crit chance', value: '+4%' },
              { label: 'Move speed', value: '-3%', bad: true },
              { label: 'Element', value: 'Physical', tone: 'info' },
            ]}
            lore="Forged where the river runs red."
          />
        </Tip>
        <Tip rarity="legendary">
          <TipBody title="Dragon-Gilded Edge" sub="Weapon · Legendary" rows={[{ label: 'Attack', value: '+64' }, { label: 'Crit damage', value: '+30%' }]} foot="Click to equip" />
        </Tip>
        <Tip rarity="epic">
          <TipBody title="Violet Ward" sub="Passive · Rank 2 / 5" body="Reduces damage taken while standing still." rows={[{ label: 'Damage taken', value: '-12%' }]} />
        </Tip>
        <Tip>
          <TipBody title="Plain tooltip" body="No rarity: the title stays gold. A long description wraps at 22 rem and keeps its 13 px floor even on a phone." />
        </Tip>
        <Tip parchment>
          <TipBody title="Parchment slip" sub="Story only" body="Lore text on parchment is opt-in through tipProps(..., { parchment: true })." lore="Ink on cream." />
        </Tip>
      </Sec>
      <Sec title="Real content (buildTip)">
        <Tip>{buildTip({ type: 'skill', id: 'bladewheel', rank: 3 })}</Tip>
        <Tip rarity={gearRarity(1)}>{buildTip({ type: 'gear', id: gearId, plus: 2 })}</Tip>
        <Tip>{buildTip({ type: 'passive', id: 'follow_through', rank: 2 })}</Tip>
      </Sec>
      <Sec title="Live (hover or long-press these)">
        <Panel variant="board" body>
          <div class="ks-flow">
            <IconSlot size="lg" icon="icon_skill_bladewheel" kind="skill" rank={4} {...tipProps(() => buildTip({ type: 'skill', id: 'bladewheel', rank: 4 }))} />
            <IconSlot size="lg" icon="icon_gear_warrior_weapon_sword_t1" kind="gear" rarity="uncommon" {...tipProps(() => buildTip({ type: 'gear', id: gearId, plus: 0 }), { rarity: 'uncommon' })} />
            <IconSlot size="lg" icon="icon_pearl_lethal" kind="stone" rarity="rare" {...tipProps(() => <TipBody title="Lethal Stone" sub="Weapon stone" rows={[{ label: 'Crit chance', value: '+2%' }]} />, { rarity: 'rare' })} />
            <IconSlot size="lg" ghost="helmet" {...tipProps(() => <div>Empty helmet slot</div>)} />
          </div>
        </Panel>
      </Sec>
    </>
  );
}
