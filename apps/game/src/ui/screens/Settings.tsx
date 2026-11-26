// Settings: language, audio, graphics, controls reference, profile & cloud (sync, conflict resolver, transfer codes, privacy)
// and save data (export / import / reset). `SettingsPanel` is the reusable body (the Pause modal embeds it);
// `SettingsScreen` wraps it in the full-screen menu sub-view (backdrop + stone board with the rust-copper title bar).
// Kit v1 (B8 pause-settings): board + title bar, plate rail, compact option rows, engraved symbols, number wells.
import { signal } from '@preact/signals';
import { isTransferCode, normalizeCode, validateDisplayName } from '@ms/shared/api';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { settings, type DamageNumberMode, type QualitySetting, type SettingsData } from '../../engine/settings';
import { fmtDateTime, fmtInt, fmtPct, fmtTime, lang, setLang, t } from '../../i18n/i18n';
import {
  classifyCloudError,
  downloadMsav,
  formatTransferCode,
  importMsav as parseMsav,
  msavFileName,
  publicProfileName,
  readMsavFile,
  SaveError,
  summarizeSave,
  type SaveSummary,
  type SyncConflict,
  type SyncOutcome,
} from '../../meta';
import { sfx } from '../audio';
import { Button, Tabs } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field, Segmented, Slider, TextInput } from '../components/Controls';
import { Gauge } from '../components/Gauge';
import { Logo } from '../components/Logo';
import { EmberField } from '../components/Modal';
import { Panel } from '../components/Panel';
import { ScrollFade } from '../components/ScrollFade';
import { KeyHint } from '../components/Slot';
import { StatWell } from '../components/StatWell';
import { UiGlyph, type UiGlyphName } from '../components/StatIcon';
import { tipProps } from '../components/Tooltip';
import { deps } from '../env';
import { HINT_IDS } from '../hud/hints';
import { layout } from '../layout';
import { useKeys, useScope } from '../nav';
import { profileFieldValue, profileLabel } from '../profileName';
import { closeView, metaSave, pushToast } from '../view';
import { KitConfirm, KitDialog } from './kitDialog';
import { usePsTex } from './psTex';
import { copyWithToast, failureText, useNow } from './onlineShared';
import { WellTrack } from './wellTrack';
import './settings.css';

export type SettingsTab = 'general' | 'audio' | 'graphics' | 'controls' | 'profile' | 'data';

const TAB_DEFS: readonly { key: SettingsTab; glyph: UiGlyphName }[] = [
  { key: 'general', glyph: 'gear' },
  { key: 'audio', glyph: 'sound' },
  { key: 'graphics', glyph: 'monitor' },
  { key: 'controls', glyph: 'gamepad' },
  { key: 'profile', glyph: 'cloud' },
  { key: 'data', glyph: 'chest' },
];

/** The section the panel shows (module-level so the gallery / Pause can preselect one and reopening keeps it). */
export const settingsTab = signal<SettingsTab>('general');

// ---------------------------------------------------------------------------------------------------------------
// small shared pieces

let savedTimer: number | undefined;

/** Settings apply live; one calm "Saved" toast once the player stops fiddling. */
function setOpt(patch: Partial<SettingsData>): void {
  settings.update(patch);
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => pushToast(t('toast.saved'), 'good', 1400), 650);
}


function OnOff({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return (
    <div class="ms-set-onoff" role="group" aria-label={label}>
      <Segmented
        options={[
          { key: 'on', label: t('common.on') },
          { key: 'off', label: t('common.off') },
        ]}
        value={value ? 'on' : 'off'}
        onChange={(k) => onChange(k === 'on')}
      />
    </div>
  );
}

/** A section of a tab: engraved caption strip (symbol + caption + carved groove) over its rows. */
function Group({ title, icon, i = 0, danger, class: cls, children }: { title?: string; icon?: UiGlyphName; i?: number; danger?: boolean; class?: string; children?: ComponentChildren }): JSX.Element {
  return (
    <section class={`ms-set-group ${danger ? 'is-danger' : ''} ${cls ?? ''}`} style={`--i:${i}`}>
      {title !== undefined && (
        <h3 class="ms-set-group-title">
          {icon && <UiGlyph name={icon} tone={danger ? 'crimson' : 'gold'} />}
          <span>{title}</span>
        </h3>
      )}
      {children}
    </section>
  );
}

/** Counter that re-renders the caller whenever the cloud service reports an outcome (background sync, conflict …). */
function useCloudTick(): number {
  const cloud = deps().meta.cloud;
  const [n, setN] = useState(0);
  useEffect(() => cloud?.subscribe(() => setN((v) => v + 1)), [cloud]);
  return n;
}

function outcomeMessage(o: SyncOutcome): { text: string; tone: 'good' | 'info' | 'bad' } {
  switch (o.kind) {
    case 'upToDate':
      return { text: t('settings.sync.upToDate'), tone: 'good' };
    case 'pulled':
      return { text: t('settings.sync.pulled'), tone: 'good' };
    case 'pushed':
      return { text: t('settings.sync.pushed'), tone: 'good' };
    case 'conflict':
      return { text: t('settings.sync.conflict'), tone: 'info' };
    case 'offline':
      return { text: t('settings.sync.offline'), tone: 'bad' };
    case 'disabled':
      return { text: t('settings.sync.disabled'), tone: 'info' };
    case 'incompatible':
      return { text: t('settings.sync.incompatible'), tone: 'bad' };
    case 'error':
      return { text: t('settings.sync.error', { reason: failureText(o.failure) }), tone: 'bad' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// General · Audio · Graphics

function GeneralTab(): JSX.Element {
  const { version } = deps();
  const l = lang.value;
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const on = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const canFullscreen = document.fullscreenEnabled === true;
  return (
    <>
      <Group title={t('settings.general.language')} icon="book" i={0}>
        <Field label={t('settings.general.language')} hint={t('settings.general.language.hint')}>
          <Segmented
            options={[
              { key: 'tr', label: t('settings.lang.tr') },
              { key: 'en', label: t('settings.lang.en') },
            ]}
            value={l}
            onChange={(k) => {
              setLang(k);
              pushToast(t('settings.general.languageChanged'), 'good');
            }}
          />
        </Field>
      </Group>
      {canFullscreen && (
        <Group title={t('settings.general.display')} icon="monitor" i={1}>
          <Field label={t('settings.general.fullscreen')} hint={t('settings.general.fullscreen.hint')}>
            <OnOff
              value={fullscreen}
              label={t('settings.general.fullscreen')}
              onChange={(on) => {
                try {
                  if (on) void document.documentElement.requestFullscreen();
                  else if (document.fullscreenElement) void document.exitFullscreen();
                } catch {
                  /* some browsers refuse (iOS) */
                }
              }}
            />
          </Field>
        </Group>
      )}
      <Group title={t('settings.general.about')} icon="info" i={2} class="ms-set-about">
        <div class="ms-set-about-body">
          <Logo class="ms-set-logo" />
          <div class="ms-set-about-rows">
            <StatWell layout="row" size="sm" label={t('settings.general.version')} value={version ?? 'dev'} />
            <p class="ms-set-note">{t('menu.disclaimer')}</p>
          </div>
        </div>
      </Group>
    </>
  );
}

function AudioTab(): JSX.Element {
  const s = settings.signal.value;
  const rows = [
    { key: 'masterVolume', id: 'master', glyph: 'sound' },
    { key: 'musicVolume', id: 'music', glyph: 'play' },
    { key: 'sfxVolume', id: 'sfx', glyph: 'swords' },
  ] as const satisfies readonly { key: 'masterVolume' | 'musicVolume' | 'sfxVolume'; id: string; glyph: UiGlyphName }[];
  return (
    <Group title={t('settings.tab.audio')} icon="sound" i={0} class="ms-set-mixer">
      {rows.map((r) => (
        <Field
          key={r.key}
          label={
            <span class="ms-set-label-ico">
              <UiGlyph name={r.glyph} tone="pewter" size="1.55rem" />
              {t(`settings.audio.${r.id}`)}
            </span>
          }
          hint={t(`settings.audio.${r.id}.hint`)}
        >
          <div class="ms-set-slider-row ms-set-slider-row--aux">
            <Slider
              value={s[r.key]}
              min={0}
              max={1}
              step={0.05}
              label={t(`settings.audio.${r.id}`)}
              format={(v) => fmtPct(v)}
              onChange={(v) => {
                const patch: Partial<SettingsData> = {};
                patch[r.key] = v;
                setOpt(patch);
              }}
            />
            {r.id === 'sfx' ? (
              <Button size="small" variant="wood" title={t('settings.audio.test')}>
                {t('settings.audio.test')}
              </Button>
            ) : (
              <span class="ms-set-aux" aria-hidden="true" />
            )}
          </div>
        </Field>
      ))}
    </Group>
  );
}

const DPR_OPTIONS = [0, 1, 1.5, 2, 3] as const;
const QUALITIES: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const DAMAGE_MODES: readonly DamageNumberMode[] = ['off', 'crit', 'all'];

function GraphicsTab(): JSX.Element {
  const s = settings.signal.value;
  const fps = deps().store.fps.value;
  const dprNearest = DPR_OPTIONS.reduce((best, v) => (Math.abs(v - s.dprCap) < Math.abs(best - s.dprCap) ? v : best), 0 as number);
  // hints this profile has been shown (ids an older build wrote that no hint uses any more do not count)
  const seen = s.hintsSeen.filter((id) => (HINT_IDS as readonly string[]).includes(id)).length;
  return (
    <>
      <Group title={t('settings.gfx.performance')} icon="flame" i={0}>
        <Field label={t('settings.gfx.quality')} hint={t('settings.gfx.quality.hint')}>
          <Segmented
            options={QUALITIES.map((q) => ({ key: q, label: q === 'auto' ? t('common.auto') : t(`quality.${q}`) }))}
            value={s.quality}
            onChange={(q) => setOpt({ quality: q })}
          />
        </Field>
        <Field label={t('settings.gfx.dpr')} hint={t('settings.gfx.dpr.hint')}>
          <Segmented
            options={DPR_OPTIONS.map((v) => ({ key: String(v), label: v === 0 ? t('common.auto') : t('settings.gfx.dpr.value', { n: v }) }))}
            value={String(dprNearest)}
            onChange={(k) => setOpt({ dprCap: Number(k) })}
          />
        </Field>
      </Group>
      <Group title={t('settings.gfx.feedback')} icon="swords" i={1}>
        <Field label={t('settings.gfx.shake')} hint={t('settings.gfx.shake.hint')}>
          <Slider value={s.screenShake} min={0} max={1} step={0.05} label={t('settings.gfx.shake')} format={(v) => fmtPct(v)} onChange={(v) => setOpt({ screenShake: v })} />
        </Field>
        <Field label={t('settings.gfx.dmg')} hint={t('settings.gfx.dmg.hint')}>
          <Segmented
            options={DAMAGE_MODES.map((m) => ({ key: m, label: m === 'off' ? t('common.off') : m === 'all' ? t('common.all') : t('settings.gfx.dmg.crit') }))}
            value={s.damageNumbers}
            onChange={(m) => setOpt({ damageNumbers: m })}
          />
        </Field>
      </Group>
      <Group title={t('settings.gfx.interface')} icon="gear" i={2}>
        <Field label={t('settings.gfx.fps')} hint={fps > 0 ? `${t('settings.gfx.fps.hint')} · ${t('hud.fps', { n: fmtInt(fps) })}` : t('settings.gfx.fps.hint')}>
          <OnOff value={s.showFps} label={t('settings.gfx.fps')} onChange={(v) => setOpt({ showFps: v })} />
        </Field>
        <Field label={t('settings.gfx.touch')} hint={t('settings.gfx.touch.hint')}>
          <OnOff value={s.touchControls} label={t('settings.gfx.touch')} onChange={(v) => setOpt({ touchControls: v })} />
        </Field>
        <Field label={t('hint.setting')} hint={t('hint.setting.hint')}>
          <OnOff value={s.showHints} label={t('hint.setting')} onChange={(v) => setOpt({ showHints: v })} />
        </Field>
        <Field label={t('hint.reset')} hint={seen > 0 ? t('hint.reset.hint', { n: seen, total: HINT_IDS.length }) : t('hint.reset.none')}>
          <Button
            variant="wood"
            size="small"
            disabled={seen === 0}
            onClick={() => {
              settings.resetHints();
              sfx('confirm');
              pushToast(t('hint.reset.done'), 'good');
            }}
          >
            {t('hint.reset')}
          </Button>
        </Field>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Controls (read-only reference)

interface ControlRow {
  id: string;
  /** alternative key groups, e.g. [[W,A,S,D],[↑,←,↓,→]] */
  keys: string[][];
  /** gamepad badges */
  pad: string[];
}

const CONTROL_GROUPS: readonly { id: string; icon: UiGlyphName; rows: readonly ControlRow[] }[] = [
  {
    id: 'move',
    icon: 'person',
    rows: [
      {
        id: 'move',
        keys: [
          ['W', 'A', 'S', 'D'],
          ['↑', '←', '↓', '→'],
        ],
        pad: ['LS'],
      },
      { id: 'navigate', keys: [['↑', '←', '↓', '→']], pad: ['D-Pad'] },
    ],
  },
  {
    id: 'cards',
    icon: 'star',
    rows: [
      { id: 'pick', keys: [['1', '2', '3', '4']], pad: ['LB', 'RB', 'A'] },
      { id: 'reroll', keys: [['R']], pad: ['Y'] },
      { id: 'banish', keys: [['B']], pad: ['X'] },
      { id: 'skip', keys: [['X'], ['S']], pad: [] },
    ],
  },
  {
    id: 'game',
    icon: 'gear',
    rows: [
      { id: 'pause', keys: [['Esc'], ['P']], pad: ['Start'] },
      { id: 'confirm', keys: [['Enter'], ['Space']], pad: ['A'] },
      { id: 'back', keys: [['Esc']], pad: ['B'] },
      { id: 'fps', keys: [['F3']], pad: [] },
    ],
  },
];

/** Rows whose hint is a keyboard sentence ("Press the number ...", "... while pressing a number"): touch layouts show their own `.hintTouch` line. */
const TOUCH_HINT: ReadonlySet<string> = new Set(['pick', 'banish']);

/** Engraved pewter pad button: one disc for every face button (the letter carries the hue), a chamfered plate for the rest. */
function PadBadge({ k }: { k: string }): JSX.Element {
  const face = k.length === 1;
  return <span class={`ms-pad ${face ? `ms-pad--face ms-pad--${k.toLowerCase()}` : 'ms-pad--pill'}`}>{k}</span>;
}

function ControlsTab(): JSX.Element {
  return (
    <>
      <p class="ms-set-note ms-set-intro">{t('settings.keys.intro')}</p>
      <p class="ms-set-note ms-set-touch-note">{t('settings.keys.touch')}</p>
      {CONTROL_GROUPS.map((g, gi) => (
        <Group key={g.id} title={t(`settings.keys.group.${g.id}`)} i={gi} icon={g.icon}>
          <div class="ms-set-keys">
            {g.rows.map((r) => (
              <div class="ms-set-keyrow" key={r.id} {...tipProps(() => <div>{t(`settings.keys.${r.id}.hint`)}</div>)}>
                <div class="ms-set-keyname">
                  {t(`settings.keys.${r.id}`)}
                  {TOUCH_HINT.has(r.id) ? (
                    <>
                      <span class="ms-kfield-hint ms-kbd-only">{t(`settings.keys.${r.id}.hint`)}</span>
                      <span class="ms-kfield-hint ms-touch-only">{t(`settings.keys.${r.id}.hintTouch`)}</span>
                    </>
                  ) : (
                    <span class="ms-kfield-hint">{t(`settings.keys.${r.id}.hint`)}</span>
                  )}
                </div>
                <div class="ms-set-keycaps">
                  {r.keys.map((grp, i) => (
                    <span class="ms-set-keygroup ms-key--kbd" key={i}>
                      {i > 0 && <span class="ms-set-keysep">{t('settings.keys.or')}</span>}
                      {grp.map((k) => (
                        <KeyHint key={k} k={k} />
                      ))}
                    </span>
                  ))}
                </div>
                <div class="ms-set-pads">
                  {r.pad.map((k) => (
                    <PadBadge key={k} k={k} />
                  ))}
                  {r.id === 'move' && (
                    <Chip size="sm" tone="neutral">
                      {t('settings.keys.move.touch')}
                    </Chip>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Save summaries (conflict resolver + import preview)

const SUMMARY_ROWS: readonly { id: string; num: (s: SaveSummary) => number; text: (s: SaveSummary) => string }[] = [
  { id: 'name', num: () => 0, text: (s) => profileLabel(s.name) },
  { id: 'updated', num: (s) => s.updated, text: (s) => fmtDateTime(s.updated) },
  { id: 'runs', num: (s) => s.runs, text: (s) => fmtInt(s.runs) },
  { id: 'wins', num: (s) => s.wins, text: (s) => fmtInt(s.wins) },
  { id: 'playTime', num: (s) => s.playTime, text: (s) => fmtTime(s.playTime) },
  { id: 'bestScore', num: (s) => s.bestScore, text: (s) => fmtInt(s.bestScore) },
  { id: 'yeop', num: (s) => s.yeop, text: (s) => fmtInt(s.yeop) },
  { id: 'shards', num: (s) => s.shards, text: (s) => fmtInt(s.shards) },
  { id: 'talentPoints', num: (s) => s.talentPoints, text: (s) => fmtInt(s.talentPoints) },
  { id: 'gearOwned', num: (s) => s.gearOwned, text: (s) => fmtInt(s.gearOwned) },
  { id: 'zonesUnlocked', num: (s) => s.zonesUnlocked, text: (s) => fmtInt(s.zonesUnlocked) },
];

function SummaryCompare({ left, right, leftTitle, rightTitle }: { left: SaveSummary; right: SaveSummary; leftTitle: string; rightTitle: string }): JSX.Element {
  return (
    <div class="ms-set-cmp ms-sunken ms-sunken--plain" role="table">
      <div class="ms-set-cmp-row ms-set-cmp-head" role="row">
        <span />
        <b>{leftTitle}</b>
        <b>{rightTitle}</b>
      </div>
      {SUMMARY_ROWS.map((row) => {
        const a = row.num(left);
        const b = row.num(right);
        return (
          <div class="ms-set-cmp-row" role="row" key={row.id}>
            <span class="ms-set-cmp-label">{t(`settings.sum.${row.id}`)}</span>
            <span class={`ms-num ${a > b ? 'is-better' : ''}`}>{row.text(left)}</span>
            <span class={`ms-num ${b > a ? 'is-better' : ''}`}>{row.text(right)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ConflictDialog({ conflict, onClose, onResolved }: { conflict: SyncConflict; onClose: () => void; onResolved: (o: SyncOutcome, choice: 'local' | 'cloud') => void }): JSX.Element {
  const { meta } = deps();
  const [busy, setBusy] = useState(false);
  const resolve = async (choice: 'local' | 'cloud'): Promise<void> => {
    if (busy || !meta.cloud) return;
    setBusy(true);
    const o = await meta.cloud.resolveConflict(choice);
    setBusy(false);
    onResolved(o, choice);
  };
  return (
    <KitDialog
      title={t('settings.conflict.title')}
      icon="cloud"
      width="min(46rem, 94%)"
      onClose={onClose}
      footer={
        <>
          <Button variant="wood" disabled={busy} onClick={() => void resolve('cloud')}>
            <UiGlyph name="cloud" tone="pewter" size="1.2em" /> {t('settings.conflict.useCloud')}
          </Button>
          <Button disabled={busy} onClick={() => void resolve('local')}>
            <UiGlyph name="person" tone="gold" size="1.2em" /> {t('settings.conflict.keepLocal')}
          </Button>
        </>
      }
    >
      <p class="ms-set-dialog-text">{t('settings.conflict.text')}</p>
      <SummaryCompare left={conflict.local} right={conflict.cloud} leftTitle={t('settings.conflict.local')} rightTitle={t('settings.conflict.cloud')} />
      <p class="ms-set-note ms-set-cmp-legend">{t('settings.conflict.legend')}</p>
    </KitDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Profile & Cloud

function ProfileCard(): JSX.Element {
  const { meta, api } = deps();
  const save = metaSave().value;
  const summary = summarizeSave(save);
  // an unnamed profile shows an empty field (the placeholder asks for a name), not the stored default
  const shown = profileFieldValue(save.profile.name);
  const [name, setName] = useState(shown);
  useEffect(() => setName(shown), [shown]);
  const trimmed = name.normalize('NFC').trim();
  const dirty = trimmed !== '' && trimmed !== shown;
  const online = validateDisplayName(trimmed);
  const submit = async (): Promise<void> => {
    if (!dirty) return;
    meta.rename(trimmed);
    sfx('confirm');
    pushToast(t('settings.profile.renamed', { name: profileLabel(meta.save.profile.name) }), 'good');
    const v = validateDisplayName(publicProfileName(meta.save.profile));
    if (api?.hasCredentials() && v.ok) {
      try {
        await api.rename(v.value);
      } catch {
        pushToast(t('settings.profile.renameOnline'), 'info');
      }
    }
  };
  return (
    <Group title={t('settings.profile.title')} icon="person" i={0}>
      <Field label={t('settings.profile.name')} hint={t('settings.profile.name.hint')}>
        <div class="ms-set-inline">
          <TextInput value={name} maxLength={24} placeholder={t('settings.profile.placeholder')} label={t('settings.profile.name')} onInput={setName} onEnter={() => void submit()} />
          <Button size="small" variant="wood" disabled={!dirty} onClick={() => void submit()}>
            {t('settings.profile.save')}
          </Button>
        </div>
        {trimmed !== '' && !online.ok && <span class="ms-set-warn">{t('settings.profile.onlineLimit')}</span>}
      </Field>
      <div class="ms-set-stats">
        {(
          [
            ['runs', fmtInt(summary.runs)],
            ['wins', fmtInt(summary.wins)],
            ['playTime', fmtTime(summary.playTime)],
            ['bestScore', fmtInt(summary.bestScore)],
          ] as const
        ).map(([id, v]) => (
          <StatWell key={id} layout="stack" size="md" tone="gold" label={t(`settings.sum.${id}`)} value={v} />
        ))}
      </div>
    </Group>
  );
}

function CloudCard({ result, report, onOpenConflict }: { result: { text: string; tone: 'good' | 'info' | 'bad' } | null; report: (o: SyncOutcome) => void; onOpenConflict: () => void }): JSX.Element {
  const { meta } = deps();
  const cloud = meta.cloud;
  useCloudTick();
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);
  const state = cloud === null ? 'offline' : cloud.enabled ? 'on' : 'unlinked';
  const pending = cloud?.conflict ?? null;
  const lastSync = cloud?.state.lastSyncAt ?? 0;

  const sync = async (): Promise<void> => {
    if (!cloud || busy) return;
    setBusy(true);
    report(await meta.syncNow());
    setBusy(false);
  };
  const enable = async (): Promise<void> => {
    if (!cloud || busy) return;
    setBusy(true);
    const v = validateDisplayName(publicProfileName(meta.save.profile));
    const r = await cloud.enable(v.ok ? v.value : undefined);
    if (!r.ok) {
      pushToast(failureText(r.failure), 'bad');
      setBusy(false);
      return;
    }
    sfx('unlock');
    report(await meta.syncNow());
    setBusy(false);
  };

  return (
    <Group title={t('settings.cloud.title')} icon="cloud" i={1}>
      <div class={`ms-set-cloud is-${state}`}>
        <span class="ms-set-dot" aria-hidden="true" />
        <div class="ms-set-cloud-main">
          <b>{t(`settings.cloud.status.${state}`)}</b>
          {state === 'on' && (
            <span class="ms-set-cloud-sub">
              {t('settings.cloud.lastSync')}: {lastSync > 0 ? fmtAgoSince(lastSync, now) : t('settings.cloud.never')}
            </span>
          )}
        </div>
        {state === 'on' && (
          <Chip size="sm" tone={cloud?.state.dirty ? 'gold' : 'jade'} class={`ms-set-state ${cloud?.state.dirty ? 'is-dirty' : 'is-clean'}`} icon={<i class="ms-set-lamp" aria-hidden="true" />}>
            {cloud?.state.dirty ? t('settings.cloud.dirty') : t('settings.cloud.clean')}
          </Chip>
        )}
        <div class="ms-set-cloud-act">
          {state === 'unlinked' && (
            <Button size="small" variant="wood" disabled={busy} onClick={() => void enable()}>
              <UiGlyph name="cloud" tone="gold" size="1.25em" /> {busy ? t('settings.cloud.syncing') : t('settings.cloud.enable')}
            </Button>
          )}
          {state === 'on' && (
            <Button size="small" variant="wood" disabled={busy} onClick={() => void sync()}>
              <UiGlyph name="cloud" tone="gold" size="1.25em" /> {busy ? t('settings.cloud.syncing') : t('settings.cloud.syncNow')}
            </Button>
          )}
          {state === 'offline' && (
            <Button size="small" variant="wood" disabled>
              <UiGlyph name="lock" tone="pewter" size="1.25em" /> {t('settings.cloud.syncNow')}
            </Button>
          )}
        </div>
      </div>
      {state === 'offline' && <p class="ms-set-note">{t('settings.cloud.offlineNote')}</p>}
      {state === 'unlinked' && <p class="ms-set-note">{t('settings.cloud.enable.hint')}</p>}
      {pending && (
        <div class="ms-set-result is-info ms-set-conflict-banner">
          <UiGlyph name="warn" tone="gold" size="1.4rem" />
          <span>{t('settings.sync.conflict')}</span>
          <Button size="small" onClick={onOpenConflict}>
            {t('settings.conflict.resolve')}
          </Button>
        </div>
      )}
      {result && (
        <div class={`ms-set-result is-${result.tone}`} role="status">
          {result.text}
        </div>
      )}
    </Group>
  );
}

/** "3 min ago" relative to the ticking clock (so the label keeps up without a full re-render of the screen). */
function fmtAgoSince(ts: number, now: number): string {
  const d = Math.max(0, Math.round((now - ts) / 1000));
  if (d < 45) return t('time.justNow');
  const m = Math.round(d / 60);
  if (m < 60) return t('time.minAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 36) return t('time.hourAgo', { n: h });
  return t('time.dayAgo', { n: Math.round(h / 24) });
}

function TransferCard({ report, onOpenConflict }: { report: (o: SyncOutcome) => void; onOpenConflict: () => void }): JSX.Element {
  const { meta } = deps();
  const cloud = meta.cloud;
  const [code, setCode] = useState<{ display: string; expiresAt: number; ttl: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const now = useNow(1000, code !== null);
  const remaining = code ? Math.max(0, code.expiresAt - now) : 0;
  const norm = normalizeCode(input).slice(0, 8);
  const complete = norm.length === 8;
  const alphabetOk = isTransferCode(norm);

  const create = async (): Promise<void> => {
    if (!cloud || creating) return;
    setCreating(true);
    setCreateError(null);
    const r = await cloud.createTransferCode(publicProfileName(meta.save.profile));
    setCreating(false);
    if (r.ok) {
      sfx('unlock');
      setCode({ display: r.display, expiresAt: r.expiresAt, ttl: Math.max(1, r.expiresAt - Date.now()) });
    } else if (r.failure) {
      setCreateError(failureText(r.failure));
      pushToast(failureText(r.failure), 'bad');
    } else {
      const msg = r.outcome.kind === 'conflict' ? t('settings.transfer.needSync') : outcomeMessage(r.outcome).text;
      setCreateError(msg);
      pushToast(msg, 'bad');
      if (r.outcome.kind === 'conflict') onOpenConflict();
    }
  };
  const claim = async (): Promise<void> => {
    if (!cloud || claiming || !complete) return;
    setClaiming(true);
    setClaimError(null);
    const r = await cloud.claimTransferCode(norm);
    setClaiming(false);
    if (r.ok) {
      setInput('');
      sfx('unlock');
      if (r.outcome.kind === 'conflict' || r.outcome.kind === 'offline' || r.outcome.kind === 'error' || r.outcome.kind === 'incompatible') report(r.outcome);
      else {
        pushToast(t('settings.transfer.claimed'), 'good');
        report(r.outcome);
      }
    } else {
      setClaimError(failureText(r.failure));
      pushToast(failureText(r.failure), 'bad');
    }
  };
  const disabled = cloud === null;
  const expired = code !== null && remaining <= 0;

  return (
    <Group title={t('settings.transfer.title')} icon="link" i={2}>
      <p class="ms-set-note">{t('settings.transfer.intro')}</p>
      <div class="ms-set-split">
        <div class="ms-set-sub ms-sunken ms-sunken--framed">
          <h4 class="ms-set-subhead">{t('settings.transfer.sub.create')}</h4>
          {code === null ? (
            <>
              <p class="ms-kfield-hint">{t('settings.transfer.create.hint')}</p>
              <Button variant="wood" disabled={disabled || creating} onClick={() => void create()}>
                {creating ? t('settings.transfer.creating') : t('settings.transfer.create')}
              </Button>
            </>
          ) : (
            <div class={`ms-set-code ${expired ? 'is-expired' : ''}`}>
              <span class="ms-set-code-label">{t('settings.transfer.code')}</span>
              <span class="ms-set-code-text ms-num" aria-live="polite">
                {code.display}
              </span>
              <Gauge thin skin="xp" value={expired ? 0 : remaining / code.ttl} />
              <span class="ms-set-code-exp ms-num">{expired ? t('settings.transfer.expired') : t('settings.transfer.expires', { time: fmtTime(remaining / 1000) })}</span>
              <div class="ms-set-actions">
                <Button size="small" variant="wood" disabled={expired} onClick={() => void copyWithToast(code.display)}>
                  <UiGlyph name="link" tone="gold" size="1.25em" /> {t('common.copy')}
                </Button>
                <Button size="small" variant="ghost" disabled={creating} onClick={() => void create()}>
                  {t('settings.transfer.regenerate')}
                </Button>
              </div>
            </div>
          )}
          {createError && <span class="ms-set-warn">{createError}</span>}
        </div>
        <div class="ms-set-sub ms-sunken ms-sunken--framed">
          <h4 class="ms-set-subhead">{t('settings.transfer.sub.enter')}</h4>
          <p class="ms-kfield-hint">{t('settings.transfer.enter.hint')}</p>
          <TextInput
            code
            value={norm.length > 4 ? `${norm.slice(0, 4)}-${norm.slice(4)}` : norm}
            maxLength={9}
            placeholder={t('settings.transfer.placeholder')}
            label={t('settings.transfer.enter')}
            onInput={(v) => {
              setClaimError(null);
              setInput(v);
            }}
            onEnter={() => void claim()}
          />
          <Button size="small" variant="wood" disabled={disabled || claiming || !complete} onClick={() => void claim()}>
            {claiming ? t('settings.transfer.claiming') : t('settings.transfer.claim')}
          </Button>
          {complete && !alphabetOk && <span class="ms-set-warn">{t('settings.transfer.badFormat')}</span>}
          {claimError && <span class="ms-set-warn">{claimError}</span>}
        </div>
      </div>
    </Group>
  );
}

/** The slice of the HTTP client the privacy card needs; `UiApi` does not list `deleteAccount` (the gallery's mock api has none). */
interface ErasableApi {
  hasCredentials(): boolean;
  deleteAccount?: () => Promise<void>;
}

/**
 * Privacy: what the server keeps (verified against workers/api: migrations 0001/0002, routes/*, limits.ts, coopRoom.ts)
 * and the erasure on request (`api.deleteAccount()` → DELETE /players/me). On success the client has dropped its cloud
 * identity, so the cloud card falls back to "not linked" and the game goes on offline; local progress is not touched.
 * Layout: a three-entry ledger (what goes online / what the server keeps / what deleting does), then the action strip.
 */
function PrivacyCard({ onErased }: { onErased: () => void }): JSX.Element {
  const api: ErasableApi | undefined = deps().api;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const available = typeof api?.deleteAccount === 'function';
  const linked = available && api?.hasCredentials() === true;

  const erase = async (): Promise<void> => {
    setConfirm(false);
    if (!api?.deleteAccount || busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.deleteAccount();
      sfx('close');
      setDone(true);
      pushToast(t('settings.privacy.deleted'), 'good');
      onErased();
    } catch (e) {
      setError(t('settings.privacy.failed', { reason: failureText(classifyCloudError(e)) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title={t('settings.privacy.title')} icon="shield" i={3} class="ms-set-privacy">
      <div class="ms-set-ledger">
        <div class="ms-set-ledger-row ms-sunken ms-sunken--plain">
          <h4 class="ms-set-subhead">
            <UiGlyph name="cloud" tone="pewter" size="1.3rem" />
            <span>{t('settings.privacy.h.online')}</span>
          </h4>
          <p class="ms-set-note">{t('settings.privacy.intro')}</p>
        </div>
        <div class="ms-set-ledger-row ms-sunken ms-sunken--plain">
          <h4 class="ms-set-subhead">
            <UiGlyph name="chest" tone="pewter" size="1.3rem" />
            <span>{t('settings.privacy.h.stores')}</span>
          </h4>
          <p class="ms-set-note">{t('settings.privacy.stores')}</p>
        </div>
        <div class="ms-set-ledger-row ms-sunken ms-sunken--plain">
          <h4 class="ms-set-subhead">
            <UiGlyph name="skull" tone="pewter" size="1.3rem" />
            <span>{t('settings.privacy.h.erase')}</span>
          </h4>
          <p class="ms-set-note">{t('settings.privacy.erase')}</p>
        </div>
      </div>
      {!available && <p class="ms-set-note ms-set-privacy-state">{t('settings.privacy.unavailable')}</p>}
      {available && !linked && !done && <p class="ms-set-note ms-set-privacy-state">{t('settings.privacy.none')}</p>}
      {linked && (
        <div class="ms-set-actions ms-set-privacy-act">
          <Button danger variant="wood" disabled={busy} onClick={() => setConfirm(true)}>
            {busy ? t('settings.privacy.deleting') : t('settings.privacy.delete')}
          </Button>
        </div>
      )}
      {error && (
        <div class="ms-set-result is-bad" role="alert">
          {error}
        </div>
      )}
      {done && !linked && (
        <div class="ms-set-result is-good" role="status">
          {t('settings.privacy.deleted')}
        </div>
      )}
      {confirm && <KitConfirm danger title={t('settings.privacy.confirm.title')} text={t('settings.privacy.confirm.text')} confirmLabel={t('settings.privacy.confirm.yes')} onCancel={() => setConfirm(false)} onConfirm={() => void erase()} />}
    </Group>
  );
}

function ProfileTab(): JSX.Element {
  const { meta } = deps();
  const tick = useCloudTick();
  const [, erased] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: 'good' | 'info' | 'bad' } | null>(null);
  const cloud = meta.cloud;
  // a conflict surfaced by a background sync opens the resolver right away
  useEffect(() => cloud?.subscribe((o) => o.kind === 'conflict' && setDialog(true)), [cloud]);
  const report = (o: SyncOutcome): void => {
    const m = outcomeMessage(o);
    setResult(m);
    pushToast(m.text, m.tone);
    if (o.kind === 'conflict') setDialog(true);
  };
  const conflict = tick >= 0 ? (cloud?.conflict ?? null) : null;
  return (
    <>
      <ProfileCard />
      <CloudCard result={result} report={report} onOpenConflict={() => setDialog(true)} />
      <TransferCard report={report} onOpenConflict={() => setDialog(true)} />
      <PrivacyCard onErased={() => erased((n) => n + 1)} />
      {dialog && conflict && (
        <ConflictDialog
          conflict={conflict}
          onClose={() => setDialog(false)}
          onResolved={(o, choice) => {
            setDialog(false);
            if (o.kind === 'pushed' || o.kind === 'pulled' || o.kind === 'upToDate') {
              sfx('equip');
              const m = { text: t(choice === 'local' ? 'settings.conflict.resolved.local' : 'settings.conflict.resolved.cloud'), tone: 'good' as const };
              setResult(m);
              pushToast(m.text, 'good');
            } else report(o);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Save data

function ExportCard(): JSX.Element {
  const { meta } = deps();
  return (
    <Group title={t('settings.data.export.title')} icon="chest" i={0}>
      <p class="ms-set-note">{t('settings.data.export.text')}</p>
      <div class="ms-set-actions">
        <Button
          variant="wood"
          onClick={() => {
            downloadMsav(meta.save);
            pushToast(t('settings.data.exported', { file: msavFileName(meta.save) }), 'good');
          }}
        >
          <UiGlyph name="down" tone="gold" size="1.25em" /> {t('settings.data.export.button')}
        </Button>
      </div>
    </Group>
  );
}

interface PendingImport {
  fileName: string;
  text: string;
  preview: SaveSummary;
  fromVersion: number;
  repairs: number;
}

function ImportCard(): JSX.Element {
  const { meta } = deps();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorText = (e: unknown): string => t(e instanceof SaveError ? `settings.data.err.${e.code}` : 'settings.data.err.unknown');

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const text = await readMsavFile(file);
      const parsed = parseMsav(text, meta.content);
      setPending({ fileName: file.name, text, preview: summarizeSave(parsed.save), fromVersion: parsed.fromVersion, repairs: parsed.repairs.length });
      sfx('open');
    } catch (e) {
      setError(errorText(e));
      pushToast(errorText(e), 'bad');
    }
  };
  const apply = async (p: PendingImport): Promise<void> => {
    setBusy(true);
    try {
      const r = await meta.importMsav(p.text);
      sfx('equip');
      const bits = [t('settings.data.imported', { name: profileLabel(meta.save.profile.name) })];
      if (r.fromVersion !== meta.save.version) bits.push(t('settings.data.imported.migrated', { n: r.fromVersion }));
      if (r.repairs.length > 0) bits.push(t('settings.data.imported.repairs', { n: r.repairs.length }));
      setDone(bits.join(' '));
      pushToast(bits[0] ?? '', 'good');
    } catch (e) {
      setError(errorText(e));
      pushToast(errorText(e), 'bad');
    }
    setBusy(false);
    setPending(null);
  };

  return (
    <Group title={t('settings.data.import.title')} icon="up" i={1}>
      <p class="ms-set-note">{t('settings.data.import.text')}</p>
      <div
        class={`ms-set-drop ms-sunken ms-sunken--framed ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void pick(e.dataTransfer?.files[0]);
        }}
      >
        <UiGlyph name="chest" tone={over ? 'gold' : 'pewter'} size="2rem" />
        <span class="ms-set-drop-text">{t('settings.data.import.drop')}</span>
        <span class="ms-set-drop-or">{t('settings.data.import.or')}</span>
        <Button size="small" variant="wood" disabled={busy} onClick={() => input.current?.click()}>
          {t('settings.data.import.pick')}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".msav,application/octet-stream"
          hidden
          onChange={(e) => {
            const el = e.currentTarget as HTMLInputElement;
            void pick(el.files?.[0]);
            el.value = '';
          }}
        />
      </div>
      {error && (
        <div class="ms-set-result is-bad" role="alert">
          {error}
        </div>
      )}
      {done && (
        <div class="ms-set-result is-good" role="status">
          {done}
        </div>
      )}
      {pending && (
        <KitDialog
          title={t('settings.data.import.confirmTitle')}
          icon="warn"
          width="min(46rem, 94%)"
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="wood" sound="back" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
              <Button danger disabled={busy} onClick={() => void apply(pending)}>
                {t('settings.data.import.confirm')}
              </Button>
            </>
          }
        >
          <p class="ms-set-dialog-text">{t('settings.data.import.confirmText', { file: pending.fileName })}</p>
          <SummaryCompare left={pending.preview} right={summarizeSave(meta.save)} leftTitle={t('settings.data.import.compare.file')} rightTitle={t('settings.data.import.compare.now')} />
          {(pending.fromVersion !== meta.save.version || pending.repairs > 0) && (
            <p class="ms-set-note ms-set-cmp-legend">
              {pending.fromVersion !== meta.save.version ? `${t('settings.data.imported.migrated', { n: pending.fromVersion })} ` : ''}
              {pending.repairs > 0 ? t('settings.data.imported.repairs', { n: pending.repairs }) : ''}
            </p>
          )}
        </KitDialog>
      )}
    </Group>
  );
}

function DangerCard(): JSX.Element {
  const { meta } = deps();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState('');
  const word = t('settings.reset.word');
  const matches = typed.trim().toLocaleUpperCase(lang.value === 'tr' ? 'tr' : 'en') === word;
  const close = (): void => {
    setStep(0);
    setTyped('');
  };
  const wipe = async (): Promise<void> => {
    close();
    await meta.resetProfile();
    sfx('close');
    pushToast(t('settings.reset.done'), 'good');
  };
  return (
    <Group title={t('settings.reset.danger')} icon="skull" i={2} danger>
      <p class="ms-set-note">{t('settings.reset.text')}</p>
      <div class="ms-set-actions">
        <Button danger variant="wood" onClick={() => setStep(1)}>
          {t('settings.reset.button')}
        </Button>
      </div>
      {step === 1 && <KitConfirm danger title={t('settings.reset.confirm1.title')} text={t('settings.reset.confirm1.text')} confirmLabel={t('common.continue')} onCancel={close} onConfirm={() => setStep(2)} />}
      {step === 2 && (
        <KitDialog
          title={t('settings.reset.confirm2.title')}
          danger
          width="min(32rem, 94%)"
          onClose={close}
          footer={
            <>
              <Button variant="wood" sound="back" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button danger disabled={!matches} onClick={() => void wipe()}>
                {t('settings.reset.confirm2.yes')}
              </Button>
            </>
          }
        >
          <p class="ms-set-dialog-text">{t('settings.reset.confirm2.text', { word })}</p>
          <TextInput code value={typed} onInput={setTyped} placeholder={word} label={word} onEnter={() => matches && void wipe()} />
        </KitDialog>
      )}
    </Group>
  );
}

function DataTab(): JSX.Element {
  return (
    <>
      <ExportCard />
      <ImportCard />
      <DangerCard />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Panel + screen

/** The settings body (section rail, content, footer). Embeddable: size it through `--set-h` / a flex parent. */
export function SettingsPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  const tab = settingsTab.value;
  const compact = layout.value.compact;
  const tick = useCloudTick();
  const conflictPending = tick >= 0 && deps().meta.cloud?.conflict != null;
  const [askReset, setAskReset] = useState(false);
  const wellView = useRef<HTMLDivElement>(null);
  const resetSettings = (): void => {
    // every preference back to its default; the language and the hints already shown stay
    settings.resetPreferences();
    sfx('confirm');
    pushToast(t('toast.settingsReset'), 'good');
  };
  return (
    <div class="ms-set">
      <Tabs
        class="ms-set-rail"
        value={tab}
        onChange={(k) => {
          settingsTab.value = k;
        }}
        tabs={TAB_DEFS.map((d) => ({
          key: d.key,
          label: (
            <>
              <UiGlyph name={d.glyph} tone={d.key === tab ? 'gold' : 'pewter'} size="1.45rem" />
              <span class="ms-set-tab-label">{t(`settings.tab.${d.key}`)}</span>
            </>
          ),
          ...(d.key === 'profile' && conflictPending ? { badge: '!' } : {}),
        }))}
      />
      <div class="ms-set-wellwrap">
        <ScrollFade key={tab} class="ms-set-well ms-sunken ms-sunken--plain" viewClass="ms-set-body" size="1.6rem" cue={false} viewRef={wellView}>
          {tab === 'general' && <GeneralTab />}
          {tab === 'audio' && <AudioTab />}
          {tab === 'graphics' && <GraphicsTab />}
          {tab === 'controls' && <ControlsTab />}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'data' && <DataTab />}
        </ScrollFade>
        <WellTrack key={`track-${tab}`} view={wellView} />
      </div>
      <div class="ms-set-foot">
        <Button variant="wood" size="small" class="ms-set-reset" onClick={() => setAskReset(true)} {...{ title: t('settings.resetDefaults.tip') }}>
          <UiGlyph name="gear" tone="pewter" size="1.2em" /> {t('settings.resetDefaults')}
        </Button>
        <span class="ms-set-autosave">{t('settings.autosave')}</span>
        {onClose && (
          <Button size={compact ? 'small' : 'normal'} sound="back" onClick={onClose}>
            <UiGlyph name="back" tone="ivory" size="1.2em" /> {t('common.back')}
          </Button>
        )}
      </div>
      {askReset && (
        <KitConfirm
          title={t('settings.resetDefaults.confirm.title')}
          text={t('settings.resetDefaults.confirm.text')}
          confirmLabel={t('settings.resetDefaults.confirm.yes')}
          onCancel={() => setAskReset(false)}
          onConfirm={() => {
            setAskReset(false);
            resetSettings();
          }}
        />
      )}
    </div>
  );
}

export function SettingsScreen(): JSX.Element {
  const scope = useScope();
  const compact = layout.value.compact;
  const tex = usePsTex();
  useKeys((a) => {
    if (a.kind !== 'cancel') return false;
    sfx('back');
    closeView();
    return true;
  });
  return (
    <div class="ms-screen ms-set-screen" ref={scope}>
      <div class="ms-backdrop ms-backdrop--art ms-backdrop--dim" />
      <EmberField count={14} />
      <Panel variant="board" ornate={!compact} class="ms-set-card" style={tex} title={t('settings.title')} onClose={closeView} closeLabel={t('common.back')}>
        <SettingsPanel onClose={closeView} />
      </Panel>
    </div>
  );
}
