// Armory: the meta hub (menu sub-view). One charcoal board window (rust-copper title bar with the boxed close, the

// tab pane. The first four tabs are kit-skinned (Character, Collection, Drop Tables, Codex); Talents and Blacksmith still
// render their own legacy skin, so they sit in a kit-off island until their owner rebuilds them.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtInt, t, tl } from '../../../i18n/i18n';
import type { ClassId } from '../../../data/schema';
import { CLASS_IDS, availablePoints, collectionProgress, talentCap } from '../../../meta';
import { sfx } from '../../audio';
import { Tabs, type TabDef } from '../../components/Button';
import { ClassEmblem, CLASS_COLOR, Currency } from '../../components/Icon';
import { Kit, Panel } from '../../components/Panel';
import { useScrollFade } from '../../components/ScrollFade';
import { KeyHint } from '../../components/Slot';
import { StatWell } from '../../components/StatWell';
import { UiGlyph, type UiGlyphName } from '../../components/StatIcon';
import { TipBody, tipProps } from '../../components/Tooltip';
import { indexOf } from '../../content';
import { deps } from '../../env';
import { portraitFaceUrl, texUrl } from '../../assets';
import { layout } from '../../layout';
import { useKeys, useScope } from '../../nav';
import { ARMORY_TABS, armoryTab, closeView, metaSave, type ArmoryTab } from '../../view';
import { BlacksmithTab } from './Blacksmith';
import { CharacterTab } from './Character';
import { CodexTab, codexNeedsHero } from './Codex';
import { CollectionTab } from './Collection';
import { DropTablesTab } from './DropTables';
import { TalentsTab } from './Talents';
import { artVars } from './Art';
import { ArmGauge } from './ArmGauge';
import { armoryClass, armoryCodexSub, armorySex, seedArmoryState, setArmoryClass } from './state';
import './armory.css';

const TAB_GLYPH: Record<ArmoryTab, UiGlyphName> = {
  character: 'person',
  collection: 'chest',
  drops: 'skull',
  codex: 'book',
  talents: 'star',
  blacksmith: 'flame',
};

function TabBody({ tab }: { tab: ArmoryTab }): JSX.Element {
  switch (tab) {
    case 'character':
      return <CharacterTab />;
    case 'collection':
      return <CollectionTab />;
    case 'drops':
      return <DropTablesTab />;
    case 'codex':
      return <CodexTab />;
    case 'talents':
      // legacy-skinned until its owner adopts the kit: keep it out of the kit scope of the shell
      return (
        <Kit on={false} contents>
          <TalentsTab />
        </Kit>
      );
    case 'blacksmith':
      return (
        <Kit on={false} contents>
          <BlacksmithTab />
        </Kit>
      );
  }
}

function isEditable(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function Armory(): JSX.Element {
  const scope = useScope();
  const { content } = deps();
  const ix = indexOf();
  useState(() => {
    seedArmoryState();
    return true;
  });
  const save = metaSave().value;
  const tab = armoryTab.value;
  const classId = armoryClass.value;
  const cls = ix.classes.get(classId);
  const progress = collectionProgress(save, content, classId);
  const points = availablePoints(save.classes[classId], talentCap(save));

  const go = (k: ArmoryTab): void => {
    armoryTab.value = k;
  };
  const step = (d: number): void => {
    const i = ARMORY_TABS.indexOf(armoryTab.value);
    const next = ARMORY_TABS[(i + d + ARMORY_TABS.length) % ARMORY_TABS.length];
    if (next) {
      sfx('tab');
      go(next);
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const navRef = useRef<HTMLDivElement>(null);
  useScrollFade(navRef, { axis: 'x' });
  // phone portrait: the whole board body scrolls (display: contents everywhere else), so it fades at the edge where more content lies
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollFade(bodyRef);
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('.ms-ktab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  // the phone-portrait strip draws symbols only: the plates keep their names for screen readers (and the badge count for Talents)
  useEffect(() => {
    navRef.current?.querySelectorAll<HTMLElement>('.ms-ktab').forEach((el, i) => {
      const k = ARMORY_TABS[i];
      if (k) el.setAttribute('aria-label', k === 'talents' && points > 0 ? `${t('armory.tab.talents')} (${points})` : t(`armory.tab.${k}`));
    });
  });

  // Esc = Done
  useKeys((a) => {
    if (a.kind === 'cancel') {
      sfx('back');
      closeView();
      return true;
    }
    return false;
  });
  // Q / E, [ / ] and PageUp / PageDown switch tabs (←/→ belong to focus navigation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (e.code === 'KeyQ' || e.code === 'BracketLeft' || e.code === 'PageUp') {
        e.preventDefault();
        stepRef.current(-1);
      } else if (e.code === 'KeyE' || e.code === 'BracketRight' || e.code === 'PageDown') {
        e.preventDefault();
        stepRef.current(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // every tab carries an engraved symbol; only the phone-portrait strip shows it (idle plates collapse to the symbol, the lit plate keeps its name)
  const tabs: TabDef<ArmoryTab>[] = ARMORY_TABS.map((k) => ({
    key: k,
    label: (
      <>
        <UiGlyph name={TAB_GLYPH[k]} tone={k === tab ? 'gold' : 'pewter'} flat class="ms-arm-tabico" />
        <span class="ms-arm-tablabel">{t(`armory.tab.${k}`)}</span>
      </>
    ),
    ...(k === 'talents' && points > 0 ? { badge: points } : {}),
  }));

  return (
    <div class={`ms-screen ms-arm ${texUrl('uk_hud_tag') ? 'has-art' : ''}`} ref={scope} style={artVars()}>
      <div class="ms-backdrop ms-backdrop--art ms-backdrop--dim" />

      <Panel variant="board" ornate title={layout.value.tier === 'phone-p' ? `${t('armory.title')} · ${t(`armory.tab.${tab}`)}` : t('armory.title')} onClose={() => closeView()} closeLabel={t('armory.done')} class="ms-arm-board">
        <div class="ms-arm-scroll" ref={bodyRef}>
        <div class="ms-arm-top">
          <div class="ms-arm-tabs">
            <KeyHint k="Q" class="ms-arm-keyhint" />
            <div class="ms-arm-tabscroll ms-scroll" ref={navRef}>
              <Tabs tabs={tabs} value={tab} onChange={go} class="ms-arm-tabrow" />
            </div>
            <KeyHint k="E" class="ms-arm-keyhint" />
          </div>

          <div
            class="ms-arm-bank"
            {...tipProps(() => (
              <TipBody title={t('armory.bank.title')} body={t('armory.bank.tip')} rows={[
                { label: t('hud.yeop'), value: fmtInt(save.bank.yeop) },
                { label: t('hud.shards'), value: fmtInt(save.bank.shards) },
              ]} />
            ))}
          >
            <StatWell size="md" icon={<Currency kind="yeop" />} value={fmtInt(save.bank.yeop)} class="ms-arm-bank-well" />
            <StatWell size="md" icon={<Currency kind="shard" />} value={fmtInt(save.bank.shards)} class="ms-arm-bank-well" />
          </div>
        </div>

        {/* the Codex pages do not depend on the hero (phones give the rail's room back to them) except the Pacts page, which lists the skills of the viewed hero */}
        <div class={`ms-arm-main ${tab === 'codex' && !codexNeedsHero(armoryCodexSub.value, content) ? 'is-codex' : ''}`}>
          <aside class="ms-arm-rail" aria-label={t('armory.classes')}>
            <div class="ms-arm-railhead" {...tipProps(() => <TipBody title={cls ? tl(cls.name) : classId} body={t('armory.perClass')} rows={[{ label: t('armory.piecesLabel'), value: `${fmtInt(progress.owned)} / ${fmtInt(progress.total)}` }]} />)}>
              <span class="ms-eyebrow">{t('armory.heroes')}</span>
            </div>
            {CLASS_IDS.map((id, i) => (
              <ClassChip key={id} id={id} index={i} active={id === classId} />
            ))}
            <p class="ms-arm-railnote">{t('armory.perClass')}</p>
          </aside>
          <main class="ms-arm-pane" key={tab}>
            <TabBody tab={tab} />
          </main>
        </div>
        </div>
      </Panel>
    </div>
  );
}

function ClassChip({ id, index, active }: { id: ClassId; index: number; active: boolean }): JSX.Element {
  const { content } = deps();
  const save = metaSave().value;
  const def = indexOf().classes.get(id);
  const p = collectionProgress(save, content, id);
  const sex = def?.sexes.includes(armorySex.value) ? armorySex.value : (def?.sexes[0] ?? 'm');
  const art = portraitFaceUrl(id, sex);
  const points = availablePoints(save.classes[id], talentCap(save));
  return (
    <button
      type="button"
      class={`ms-arm-class ms-plate ${active ? 'is-active' : ''}`}
      style={{ '--cc': CLASS_COLOR[id], '--i': index } as JSX.CSSProperties}
      data-nav=""
      aria-pressed={active}
      aria-label={def ? tl(def.name) : id}
      onClick={() => {
        if (!active) {
          sfx('tab');
          setArmoryClass(id);
        }
      }}
      {...tipProps(() => (
        <TipBody
          title={def ? tl(def.name) : id}
          sub={def ? def.doctrines.map((d) => tl(d.name)).join(' · ') : undefined}
          rows={[
            { label: t('armory.piecesLabel'), value: `${fmtInt(p.owned)} / ${fmtInt(p.total)}` },
            { label: t('armory.talentPoints'), value: fmtInt(points) },
          ]}
        />
      ))}
    >
      <span class="ms-arm-avatar">
        {art ? <span class="ms-arm-avatar-art" style={{ backgroundImage: `url("${art}")` }} /> : <ClassEmblem classId={id} size="100%" />}
        <i class="ms-arm-avatar-ring" aria-hidden="true" />
      </span>
      <span class="ms-arm-class-text">
        <b class="ms-head">{def ? tl(def.name) : id}</b>
        <small class="ms-num">
          {fmtInt(p.owned)}/{fmtInt(p.total)}
        </small>
      </span>
      <ArmGauge thin kind="gold" ch="0.42rem" value={p.total > 0 ? p.owned / p.total : 0} class="ms-arm-class-bar" />
      {points > 0 && <i class="ms-arm-class-dot" aria-hidden="true" />}
    </button>
  );
}
