// Pause: a stone board (rust-copper title bar, boxed close = resume) over the dimmed + blurred scene. Left: the hero's build
// as octagon slots with rank medals (skills / passives / spirit stones / trinkets, tooltips intact). Right: live run
// statistics (HP + XP gauges, number-well stat tiles, top damage). Actions: Resume (the one lacquer plate), Settings (stone),
// Abandon run (crimson plate with a skull, apart). Settings opens the shared `SettingsPanel` inline in the same board.
// Kit v1 (B8 pause-settings).
import { signal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rarity } from '../../data/schema';
import { fmtCompact, fmtInt, fmtTime, t, tl } from '../../i18n/i18n';
import { sfx } from '../audio';
import { Button, Tabs } from '../components/Button';
import { Chip } from '../components/Chip';
import { ClassEmblem } from '../components/Icon';
import { Panel } from '../components/Panel';
import { ScrollFade } from '../components/ScrollFade';
import { IconSlot, KeyHint } from '../components/Slot';
import { CurrencyIcon, StatIcon, UiGlyph, type UiGlyphName } from '../components/StatIcon';
import { StatWell } from '../components/StatWell';
import { tipProps } from '../components/Tooltip';
import { indexOf, skillName } from '../content';
import { deps } from '../env';
import { layout } from '../layout';
import { buildTip } from '../itemTips';
import { focusFirst, useKeys, useScope } from '../nav';
import { contentKindOf, skillBar, splitSkills } from '../skillSlots';
import { KitConfirm } from '../screens/kitDialog';
import { usePsTex } from '../screens/psTex';
import { SettingsPanel } from '../screens/Settings';
import { WellTrack } from '../screens/wellTrack';
import { PauseGauge } from './PauseGauge';
import './pause.css';

/** Which sub-view of the pause panel is open (module signal so the gallery can open the settings view directly). */
export const pauseSubView = signal<'main' | 'settings'>('main');

const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** One build row: the engraved name + a count well on the left, the octagon slots on the right (stacked on narrow cards). */
function BuildRow({ label, count, max, icon, children }: { label: string; count: number; max: number; icon: UiGlyphName; children: JSX.Element[] }): JSX.Element {
  // the tray is sized for six slots; a row that holds more (the basic attack and ultimates ride beside the six skill slots) shares the width
  const wide = children.length > 6 ? ({ '--pn': String(children.length) } as JSX.CSSProperties) : undefined;
  return (
    <div class="ms-pause-row">
      <div class="ms-pause-rlabel">
        <span class="ms-pause-rname">
          <UiGlyph name={icon} tone="pewter" />
          <span>{label}</span>
        </span>
        <Chip size="sm" tone={count >= max ? 'gold' : 'neutral'} class="ms-pause-count">
          {count}/{max}
        </Chip>
      </div>
      <div class="ms-pause-slots" style={wide}>
        {children}
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, tone }: { icon: ComponentChildren; label: string; value: string; tone?: 'gold' }): JSX.Element {
  return (
    <div class="ms-pstat">
      <span class="ms-pstat-ico">{icon}</span>
      <span class="ms-pstat-label">{label}</span>
      <StatWell size="md" value={value} {...(tone ? { tone } : {})} />
    </div>
  );
}

export function Pause(): JSX.Element {
  const { store, content } = deps();
  const ix = indexOf(content);
  const scope = useScope();
  const hud = store.hud.value;
  const sel = store.runSelection.value;
  const [confirm, setConfirm] = useState(false);
  const view = pauseSubView.value;
  const lay = layout.value;
  const tex = usePsTex();
  /** phone portrait: HP / XP stay in view under the who strip and the two trays become Build | Stats panes (nothing is cut off) */
  const phoneP = lay.compact && lay.portrait;
  const [pane, setPane] = useState<'build' | 'stats'>('build');
  const bodyView = useRef<HTMLDivElement>(null);
  const mainSize = lay.compact ? 'small' : lay.h < 820 ? 'normal' : 'big';
  const subSize = lay.compact ? 'small' : 'normal';

  useEffect(() => {
    sfx('open');
    const id = requestAnimationFrame(() => focusFirst());
    return () => {
      cancelAnimationFrame(id);
      pauseSubView.value = 'main';
    };
  }, []);

  /** The engine resumes the run on every Esc / P; inside a sub-view that press only means "back", so pause again right after. */
  const keepPaused = (): void => {
    queueMicrotask(() => {
      if (!store.paused.value) store.pause();
    });
  };
  const closeSub = (): void => {
    pauseSubView.value = 'main';
  };
  useKeys((a) => {
    if ((a.kind === 'cancel' || a.kind === 'pause') && view === 'settings') {
      sfx('back');
      pauseSubView.value = 'main';
      keepPaused();
      return true;
    }
    // Enter with nothing focused (the click landed on the backdrop) resumes, as the brief asks
    if (a.kind === 'confirm' && view === 'main' && !confirm && !a.repeat && !(document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute('data-nav'))) {
      store.resume();
      return true;
    }
    return false;
  });
  useEffect(() => {
    if (view === 'main') {
      const id = requestAnimationFrame(() => focusFirst());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [view]);

  const cls = ix.classes.get(sel.classId);
  const doctrine = cls?.doctrines.find((d) => d.id === sel.doctrine);
  const zone = ix.zones.get(sel.zone);
  const maxSkills = content.balance.maxActiveSkills;
  const maxPassives = content.balance.maxPassives;

  // the count and the six sockets are the actives only (the sim's cap: the basic attack and talent ultimates take no slot); the basic and
  // the ultimates are drawn in the same tray so every skill the hero holds is listed (QA PLAYREV-2: "7/6" and the 6th skill missing)
  const skillSplit = splitSkills(hud?.skills, contentKindOf);
  const skills: JSX.Element[] = skillBar(skillSplit, maxSkills).map((s, i) =>
    s ? (
      <IconSlot key={i} size="md" icon={s.icon} kind="skill" rank={s.rank} awakened={s.awakened} {...tipProps(() => buildTip({ type: 'skill', id: s.id, rank: s.rank }))} />
    ) : (
      <IconSlot key={i} size="md" ghost="plus" />
    ),
  );
  const passives: JSX.Element[] = [];
  for (let i = 0; i < maxPassives; i++) {
    const p = hud?.passives[i];
    passives.push(
      p ? (
        <IconSlot key={i} size="md" icon={p.icon} kind="passive" badge={p.rank} {...tipProps(() => buildTip({ type: 'passive', id: p.id, rank: p.rank }))} />
      ) : (
        <IconSlot key={i} size="md" ghost="plus" />
      ),
    );
  }
  const stoneCount = hud?.stones.length ?? 6;
  const stones: JSX.Element[] = [];
  for (let i = 0; i < stoneCount; i++) {
    const s = hud?.stones[i];
    const ghost = i < 3 ? 'sword' : 'shield';
    stones.push(
      s ? (
        <IconSlot
          key={i}
          size="md"
          icon={s.icon}
          kind="stone"
          slot={i < 3 ? 'weapon' : 'armor'}
          rarity={RARITIES[Math.min(4, s.level)] ?? 'common'}
          badge={`+${s.level}`}
          {...tipProps(() => buildTip({ type: 'stone', id: s.id, level: s.level }))}
        />
      ) : (
        <IconSlot key={i} size="md" ghost={ghost} />
      ),
    );
  }
  const trinkets: JSX.Element[] = [];
  const trinketCount = hud?.trinkets.length ?? 3;
  const trinketGhost = ['bracelet', 'amulet', 'earring'] as const;
  for (let i = 0; i < trinketCount; i++) {
    const s = hud?.trinkets[i];
    trinkets.push(
      s ? (
        <IconSlot
          key={i}
          size="md"
          icon={s.icon}
          kind="trinket"
          rarity={RARITIES[Math.min(4, Math.max(0, s.rank - 1))] ?? 'common'}
          badge={s.rank}
          {...tipProps(() => buildTip({ type: 'trinket', id: s.id, rank: s.rank }))}
        />
      ) : (
        <IconSlot key={i} size="md" ghost={trinketGhost[i] ?? 'gem'} />
      ),
    );
  }

  const dmgTotal = hud ? hud.dmg.reduce((sum, d) => sum + d.damage, 0) : 0;
  const dmgTop = hud?.dmg.slice(0, 5) ?? [];
  const dmgMax = Math.max(1, dmgTop[0]?.damage ?? 1);
  const filled = (a: ({ id: string } | null)[] | undefined): number => (a ?? []).filter(Boolean).length;
  const sub = view === 'settings';
  const phoneL = lay.compact && !lay.portrait;
  const hpCh = phoneL ? '1.15rem' : phoneP ? '1.7rem' : '1.95rem';
  const xpCh = phoneL ? '1rem' : phoneP ? '1.4rem' : '1.6rem';
  const vitals = hud ? (
    <div class="ms-pause-vitals">
      <div class="ms-pause-vital">
        <span class="ms-pause-vico">
          <StatIcon stat="maxHp" />
        </span>
        <PauseGauge kind="red" ch={hpCh} value={hud.hpMax > 0 ? hud.hp / hud.hpMax : 0} label={`${fmtInt(hud.hp)} / ${fmtInt(hud.hpMax)}`} title={`${t('hud.hp')} ${fmtInt(hud.hp)} / ${fmtInt(hud.hpMax)}`} />
      </div>
      <div class="ms-pause-vital">
        <span class="ms-pause-vico">
          <StatIcon stat="xpGain" />
        </span>
        <PauseGauge kind="gold" ch={xpCh} value={hud.xpNext > 0 ? hud.xp / hud.xpNext : 0} label={t('hud.level', { n: hud.level })} title={t('hud.level', { n: hud.level })} />
      </div>
    </div>
  ) : null;

  return (
    <div class="ms-modal ms-modal--blur ms-pause" ref={scope} role="dialog" aria-modal="true" aria-label={t('pause.title')}>
      <Panel
        variant="board"
        ornate={!lay.compact}
        thin={lay.compact}
        class={`ms-pause-panel ${sub ? 'is-sub' : ''}`}
        title={sub ? t('pause.settings') : t('pause.title')}
        style={tex}
        onClose={sub ? closeSub : () => store.resume()}
        closeLabel={sub ? t('common.back') : t('pause.resume')}
      >
        {sub ? (
          <div class="ms-pause-settings">
            <SettingsPanel onClose={closeSub} />
          </div>
        ) : (
          <>
            <header class="ms-pause-who">
              <ClassEmblem classId={sel.classId} size="2.6rem" />
              <div class="ms-pause-whotxt">
                <span class="ms-pause-class">
                  {cls ? tl(cls.name) : sel.classId}
                  {doctrine && <span class="ms-pause-doc"> · {tl(doctrine.name)}</span>}
                </span>
                <span class="ms-pause-zone">
                  <span>{zone ? tl(zone.name) : sel.zone}</span>
                  <Chip size="sm" tone={sel.difficulty === 'hard' ? 'red' : 'neutral'}>
                    {t(`runEnd.difficulty.${sel.difficulty}`)}
                  </Chip>
                </span>
              </div>
              {hud && (
                <div class="ms-pause-time" title={t('pause.time')}>
                  <CurrencyIcon kind="time" size="2rem" />
                  <StatWell size="lg" tone="gold" value={fmtTime(hud.time)} />
                </div>
              )}
            </header>

            {phoneP && vitals}
            {phoneP && (
              <Tabs
                class="ms-pause-tabs"
                value={pane}
                onChange={setPane}
                tabs={[
                  {
                    key: 'build',
                    label: (
                      <>
                        <UiGlyph name="swords" tone={pane === 'build' ? 'gold' : 'pewter'} size="1.3rem" />
                        <span>{t('pause.tab.build')}</span>
                      </>
                    ),
                  },
                  {
                    key: 'stats',
                    label: (
                      <>
                        <UiGlyph name="trophy" tone={pane === 'stats' ? 'gold' : 'pewter'} size="1.3rem" />
                        <span>{t('pause.tab.stats')}</span>
                      </>
                    ),
                  },
                ]}
              />
            )}

            <div class="ms-pause-bodybox">
              <ScrollFade key={phoneP ? pane : 'all'} class="ms-pause-bodywrap" viewClass="ms-pause-body" size="1.6rem" cue={false} viewRef={bodyView}>
                <section class={`ms-pause-card ms-pause-build ms-sunken ms-sunken--framed ${phoneP && pane !== 'build' ? 'is-off' : ''}`}>
                  <h2 class="ms-pause-ct">
                    <UiGlyph name="swords" tone="gold" />
                    <span>{t('pause.build')}</span>
                  </h2>
                  <BuildRow label={t('hud.skills')} icon="flame" count={skillSplit.actives.length} max={maxSkills}>
                    {skills}
                  </BuildRow>
                  <BuildRow label={t('hud.passives')} icon="star" count={hud?.passives.length ?? 0} max={maxPassives}>
                    {passives}
                  </BuildRow>
                  <BuildRow label={t('hud.stones')} icon="shield" count={filled(hud?.stones)} max={stoneCount}>
                    {stones}
                  </BuildRow>
                  <BuildRow label={t('hud.trinkets')} icon="crown" count={filled(hud?.trinkets)} max={trinketCount}>
                    {trinkets}
                  </BuildRow>
                </section>

                <section class={`ms-pause-card ms-pause-statsec ms-sunken ms-sunken--framed ${phoneP && pane !== 'stats' ? 'is-off' : ''}`}>
                  <h2 class="ms-pause-ct">
                    <UiGlyph name="trophy" tone="gold" />
                    <span>{t('pause.stats')}</span>
                  </h2>
                  {hud ? (
                    <>
                      {!phoneP && vitals}
                      <div class="ms-pause-stats">
                        <StatTile icon={<CurrencyIcon kind="kills" />} label={t('pause.kills')} value={fmtInt(hud.kills)} />
                        <StatTile icon={<StatIcon stat="level" />} label={t('pause.level')} value={fmtInt(hud.level)} />
                        <StatTile icon={<CurrencyIcon kind="yeop" />} label={t('pause.yeop')} value={fmtInt(hud.yeop)} />
                        <StatTile icon={<CurrencyIcon kind="shard" />} label={t('pause.shards')} value={fmtInt(hud.shards)} />
                        <StatTile icon={<StatIcon stat="damage" />} label={t('pause.damage')} value={fmtCompact(dmgTotal)} tone="gold" />
                        <StatTile icon={<StatIcon stat="dps" />} label={t('stat.dps')} value={fmtCompact(hud.dps)} tone="gold" />
                      </div>
                      {dmgTop.length > 0 && (
                        <div class="ms-pause-top">
                          <h3 class="ms-pause-subct">{t('pause.topDamage')}</h3>
                          {dmgTop.map((d) => {
                            const def = ix.skills.get(d.skillId);
                            return (
                              <div key={d.skillId} class="ms-pause-top-row">
                                <IconSlot size="xs" icon={def?.icon ?? `icon_skill_${d.skillId}`} kind="skill" {...(def ? { element: def.element } : {})} />
                                <span class="ms-pause-top-name">{skillName(d.skillId)}</span>
                                <PauseGauge thin kind="gold" ch="0.62rem" value={Math.max(0.03, d.damage / dmgMax)} />
                                <StatWell size="sm" value={fmtCompact(d.damage)} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <p class="ms-pause-empty">{t('hud.damageMeter.empty')}</p>
                  )}
                </section>
              </ScrollFade>
              <WellTrack key={`track-${phoneP ? pane : 'all'}`} view={bodyView} class="ms-wtrack--pause" />
            </div>

            <footer class="ms-pause-actions">
              <div class="ms-pause-act-l">
                <Button variant="wood" size={subSize} danger onClick={() => setConfirm(true)}>
                  {t('pause.quit')}
                </Button>
              </div>
              <div class="ms-pause-hint ms-kbd-only">
                <KeyHint k="Esc" />
                <KeyHint k="P" />
                <span>{t('pause.resume')}</span>
              </div>
              <div class="ms-pause-act-r">
                <Button
                  variant="wood"
                  size={subSize}
                  onClick={() => {
                    pauseSubView.value = 'settings';
                  }}
                >
                  <UiGlyph name="gear" tone="gold" size="1.25em" /> {t('pause.settings')}
                </Button>
                <Button size={mainSize} autofocus onClick={() => store.resume()}>
                  <UiGlyph name="swords" tone="ivory" size="1.25em" /> {t('pause.resume')}
                </Button>
              </div>
            </footer>
          </>
        )}
      </Panel>

      {confirm && (
        <KitConfirm
          danger
          title={t('pause.quitTitle')}
          text={t('pause.quitConfirm')}
          confirmLabel={t('pause.quitYes')}
          onCancel={() => {
            setConfirm(false);
            keepPaused();
          }}
          onConfirm={() => {
            setConfirm(false);
            store.quit();
          }}
        />
      )}
    </div>
  );
}
