// Hero select (kit v1, B3 rebuild, round 3): the screen IS the character-select scene. A full-bleed courtyard (uk_hero_select_stage) sits
// behind everything; the hero stands on a painted dais (uk_hero_select_dais) in the middle with gold scimitar blades (T12, grey at the
// ends) flanking it; CLASS and DOCTRINE + EMPIRE float over the sides as slim pewter boards, the hero's dock (name, base stat gem tiles,
// gear shelf, Armory / Talents) sits under the dais, kingdom banners (T11) pick the empire.
// Persists everything through `store.select(...)`; Enter → zone select, Esc → menu, ←/→ step the class while a class
// card has focus (gamepad D-pad as well). Phones get their own compositions (portrait: class strip + stage + name plaque + tab sheet;
// landscape: class rail + stage + tab sheet over a button row) instead of a scaled desktop screen. Layout numbers: hero.css / hero-stage.css.
// HD-02: while the profile has never played a run (`firstRunHero`, heroFirstRun.ts) the recommended class carries a gold "Recommended for your
// first run" plate on its card (a star medal on the phone strip / rail) and says so on its record line; the phone layouts add a caption on the stage.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RunSelection } from '../../app/store';
import type { ClassDef, ClassId, ContentDB, DoctrineDef, EmpireDef, Sex, SkillDef, StatMods } from '../../data/schema';
import { GEAR_SLOTS } from '../../data/schema';
import { fmtInt, lang, t, tl } from '../../i18n/i18n';
import { availablePoints, collectionProgress, equippedPieces, spentTotal, talentCap, type SaveData } from '../../meta';
import { sfx } from '../audio';
import { ensureSkillVfx } from '../../vfx/skills/loader';
import { portraitFaceCropUrl, portraitUrl, texUrl } from '../assets';
import { Button, Tabs } from '../components/Button';
import { Chip } from '../components/Chip';
import { Glyph } from '../components/glyphs';
import { CLASS_COLOR, ELEMENT_COLOR, ClassEmblem, slotGlyph } from '../components/Icon';
import { EmberField } from '../components/Modal';
import { Kit, Panel, useKit } from '../components/Panel';
import { ScrollFade } from '../components/ScrollFade';
import { IconSlot, KeyHint } from '../components/Slot';
import { StatIcon } from '../components/StatIcon';
import { Medal } from '../components/Medal';
import { StatWell } from '../components/StatWell';
import { TipBody, tipProps } from '../components/Tooltip';
import { deps, type HeroPreviewHandle } from '../env';
import { indexOf, skillDescription, statModRows } from '../content';
import { buildTip, gearRarity } from '../itemTips';
import { layout } from '../layout';
import { useKeys, useScope } from '../nav';
import { metaSave, openView, type ArmoryTab } from '../view';
import { BladeArrow, ClassGem, EmpireFlag, StageScene } from './heroArt';
import { Dais, DaisLight, DaisLightTex, DaisTex } from './heroDais';
import { HeroGauge } from './heroGauge';
import { firstRunHero } from './heroFirstRun';
import { heroRecord } from './heroRecord';
import { attachTurntable } from './heroTurn';
import './hero.css';

/** Custom properties on inline styles. */
export const cv = (v: Record<string, string | number>): JSX.CSSProperties => v as unknown as JSX.CSSProperties;

/**
 * Hero look from equipped gear: the equipped armor piece's tier (else the weapon's) selects the model/weapon tier.
 * Gear tiers run 1..4 (zone tier) and hero models t0..t3, so tier N wears model N−1; no gear = the starter look (t0).
 */
export function armorTierOf(save: SaveData, content: ContentDB, classId: ClassId): number {
  const eq = equippedPieces(save, content, classId);
  const armor = eq.find((p) => p.def.slot === 'armor');
  const weapon = eq.find((p) => p.def.slot === 'weapon');
  const tier = armor?.def.tier ?? weapon?.def.tier ?? 1;
  return Math.max(0, Math.min(3, tier - 1));
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared bits (also used by the zone screen)

export interface TipSegOption<K extends string> {
  key: K;
  label: ComponentChildren;
  /** greyed out + not focusable, but still hoverable (the tooltip explains why) and clickable (error sound) */
  disabled?: boolean;
  tip?: () => ComponentChildren;
}

/** Segmented toggle whose options carry tooltips (so a locked option can say why it is locked). Kit plates inside a kit scope. */
export function TipSeg<K extends string>({ options, value, onChange, label }: { options: readonly TipSegOption<K>[]; value: K; onChange: (k: K) => void; label?: string }): JSX.Element {
  const kit = useKit();
  return (
    <div class={`${kit ? 'ms-kseg' : 'ms-seg'} ms-tseg`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          class={kit ? `ms-kseg-btn ms-plate ${o.key === value ? 'is-active' : ''} ${o.disabled ? 'is-off' : ''}` : 'ms-seg-btn'}
          aria-checked={o.key === value}
          aria-disabled={o.disabled ? 'true' : undefined}
          data-nav=""
          {...(o.tip ? tipProps(o.tip) : {})}
          onClick={() => {
            if (o.disabled) return sfx('error');
            if (o.key !== value) {
              sfx('tab');
              onChange(o.key);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Painted art that disappears quietly when the texture is missing or fails to load. */
export function Painted({ url, class: cls }: { url: string | null; class: string }): JSX.Element | null {
  const [bad, setBad] = useState<string | null>(null);
  if (!url || bad === url) return null;
  return <img class={cls} src={url} alt="" draggable={false} decoding="async" onError={() => setBad(url)} />;
}

/** Keyboard "Enter" (a click without pointer, detail 0) on an already-chosen card continues; anything else chooses it. */
export const chooseOrContinue = (chosen: boolean, choose: () => void, proceed: () => void) => (e: MouseEvent): void => {
  if (chosen && e.detail === 0) proceed();
  else if (!chosen) choose();
};

type Mode = 'w' | 'p' | 'l';
type Page = 'doctrine' | 'empire' | 'info';

// ---------------------------------------------------------------------------------------------------------------------
// Classes

/** comparison pips of one class (1..5 among all classes): health, armor, speed */
interface ClassPips {
  hp: number;
  armor: number;
  speed: number;
}

function MiniPips({ stat, n, label }: { stat: string; n: number; label: string }): JSX.Element {
  return (
    <span class="ms-hs-mini" title={`${label} ${n} / 5`}>
      <StatIcon stat={stat} size="1.1rem" />
      <span class="ms-hs-mini-pips">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} class={i < n ? 'on' : ''} />
        ))}
      </span>
    </span>
  );
}

function ClassCard({ cls, sex, selected, index, points, mode, pips, reco, onPick, onProceed }: { cls: ClassDef; sex: Sex; selected: boolean; index: number; points: number; mode: Mode; pips: ClassPips; reco: boolean; onPick: () => void; onProceed: () => void }): JSX.Element {
  const shownSex: Sex = cls.sexes.includes(sex) ? sex : (cls.sexes[0] ?? 'm');
  // the 256 px face crop (cheaper than the 768 x 1152 bust and framed by the file itself); the bust with a scaled crop when no crop ships
  const faceCrop = portraitFaceCropUrl(cls.id, shownSex);
  // the recommended class of a profile with no runs: the ribbon is decoration for the eye, the label carries the words for a screen reader
  const tip = reco ? tipProps(() => <TipBody title={t('hero.reco.badge')} body={t('hero.reco.tip')} />) : null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={reco ? `${tl(cls.name)}. ${t('hero.reco.badge')}` : tl(cls.name)}
      class={`ms-hs-class ms-hs-class--${mode} ms-plate ${selected ? 'is-sel' : ''} ${reco ? 'is-reco' : ''}`}
      style={cv({ '--cl': CLASS_COLOR[cls.id], '--i': index })}
      data-nav=""
      data-arrows="x"
      data-class={cls.id}
      data-autofocus={selected ? '' : undefined}
      data-reco={reco ? '' : undefined}
      {...(tip ?? {})}
      onClick={chooseOrContinue(selected, onPick, onProceed)}
      onPointerEnter={(e) => {
        tip?.onPointerEnter(e);
        if (e.pointerType === 'mouse' && !selected) sfx('hover');
      }}
    >
      <span class="ms-hs-portrait-wrap">
        <span class="ms-hs-face">
          {faceCrop ? <Painted url={faceCrop} class="ms-hs-face-art is-face" /> : <Painted url={portraitUrl(cls.id, shownSex)} class="ms-hs-face-art" />}
          <span class="ms-hs-face-shade" />
        </span>
        <span class="ms-hs-class-emblem">
          <ClassGem classId={cls.id} size="2.1rem" />
        </span>
      </span>
      <span class="ms-hs-class-text">
        {reco && mode === 'w' && (
          <span class="ms-hs-reco ms-plate" aria-hidden="true">
            <Glyph name="star" />
            <span class="ms-hs-reco-t">{t('hero.reco.badge')}</span>
          </span>
        )}
        <span class="ms-hs-class-name">{tl(cls.name)}</span>
        <span class="ms-hs-class-role">{t(`hero.role.${cls.id}`)}</span>
        {mode === 'w' && (
          <span class="ms-hs-class-pips" aria-hidden="true">
            <MiniPips stat="maxHp" n={pips.hp} label={t('hero.stat.hp')} />
            <MiniPips stat="armor" n={pips.armor} label={t('hero.stat.armor')} />
            <MiniPips stat="moveSpeed" n={pips.speed} label={t('hero.stat.speed')} />
          </span>
        )}
      </span>
      {points > 0 && <Medal tag label={points} class="ms-hs-class-pts" title={t('hero.points', { n: points })} />}
      {reco && mode !== 'w' && (
        <span class="ms-hs-reco ms-hs-reco--star ms-plate" aria-hidden="true">
          <Glyph name="star" />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Hero info: stat gem tiles

/** one fixed decimal (5.4, 6.0) in the active language */
const fixed1 = (n: number): string => new Intl.NumberFormat(lang.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

/** 1..5: position of `v` among all classes' values (a comparison, not an absolute scale). */
function rankPips(v: number, all: number[]): number {
  return Math.max(1, Math.min(5, all.filter((x) => x <= v).length));
}

function StatPlate({ stat, label, value, unit, pips, tip }: { stat: string; label: string; value: string; unit?: string; pips: number; tip: string }): JSX.Element {
  return (
    <div class="ms-hs-stat" {...tipProps(() => <TipBody title={label} body={tip} />)}>
      <StatIcon stat={stat} size="2.7rem" />
      <div class="ms-hs-stat-body">
        <span class="ms-hs-stat-label">{label}</span>
        <StatWell value={value} unit={unit} size="md" tone="gold" />
        <span class="ms-hs-pips" role="img" aria-label={`${pips} / 5`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} class={i < pips ? 'on' : ''} />
          ))}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Doctrine + empire

function SkillBrief({ label, labelTip, def }: { label: string; labelTip: string; def: SkillDef | undefined }): JSX.Element | null {
  if (!def) return null;
  const color = ELEMENT_COLOR[def.element];
  return (
    <div class="ms-hs-brief">
      <IconSlot size="sm" icon={def.icon} kind="skill" element={def.element} style={cv({ '--rc': color, '--rg': `${color}55` })} {...tipProps(() => buildTip({ type: 'skill', id: def.id }))} />
      <div class="ms-hs-brief-text">
        <span class="ms-hs-brief-label" {...tipProps(() => <div>{labelTip}</div>)}>
          {label}
        </span>
        <b class="ms-hs-brief-name">{tl(def.name)}</b>
        <span class="ms-hs-brief-meta">
          <i class="ms-hs-dot" style={cv({ '--dc': color })} />
          <span>{t(`element.${def.element}`)}</span>
          <span class="ms-hs-sep" aria-hidden="true">
            ·
          </span>
          <span>{t(`hero.behavior.${def.behavior}`)}</span>
        </span>
      </div>
    </div>
  );
}

/** desc + the two starting skills + (optionally) the starter text + the skill pool: the part of a doctrine that changes with the choice */
function DoctrineBody({ d, withStarter }: { d: DoctrineDef; withStarter: boolean }): JSX.Element {
  const ix = indexOf();
  const basic = ix.skills.get(d.basic);
  const starter = ix.skills.get(d.starter);
  const pool = d.skills.map((id) => ix.skills.get(id)).filter((s): s is SkillDef => s !== undefined);
  return (
    <>
      <p class="ms-hs-doc-desc">{tl(d.desc)}</p>
      <div class="ms-hs-doc-skills">
        <SkillBrief label={t('hero.doc.basic')} labelTip={t('hero.doc.basicTip')} def={basic} />
        <SkillBrief label={t('hero.doc.starter')} labelTip={t('hero.doc.starter')} def={starter} />
      </div>
      {withStarter && (
        <div class="ms-hs-doc-more">
          <div>{starter && <p class="ms-hs-doc-starter">{skillDescription(starter)}</p>}</div>
        </div>
      )}
      <div class="ms-hs-doc-pool">
        <span class="ms-hs-brief-label" {...tipProps(() => <div>{t('hero.doc.poolTip')}</div>)}>
          {t('hero.doc.pool')}
        </span>
        <div class="ms-hs-doc-poolrow">
          {pool.map((s) => (
            <IconSlot key={s.id} size="xs" icon={s.icon} kind="skill" element={s.element} {...tipProps(() => buildTip({ type: 'skill', id: s.id }))} />
          ))}
        </div>
      </div>
    </>
  );
}

function DocMark({ k }: { k: string }): JSX.Element {
  return (
    <span class="ms-hs-doc-mark" aria-hidden="true">
      {k}
    </span>
  );
}

function DoctrineCard({ d, selected, index, onPick, onProceed }: { d: DoctrineDef; selected: boolean; index: number; onPick: () => void; onProceed: () => void }): JSX.Element {
  const k = d.id.toUpperCase();
  return (
    <div
      class={`ms-hs-doc ${selected ? 'is-sel' : ''}`}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      data-nav=""
      data-doctrine={d.id}
      style={cv({ '--i': index })}
      onClick={chooseOrContinue(selected, onPick, onProceed)}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && !selected) sfx('hover');
      }}
    >
      <div class="ms-hs-doc-head">
        <DocMark k={k} />
        <div class="ms-hs-doc-title">
          <h3 class="ms-head">{tl(d.name)}</h3>
          <span class="ms-eyebrow">{t('hero.doc.tag', { k })}</span>
        </div>
        <Chip size="sm" icon={<Glyph name="star" />} class="ms-hs-check">
          {t('common.selected')}
        </Chip>
      </div>
      <DoctrineBody d={d} withStarter />
    </div>
  );
}

/** phones: two picker buttons, then the detail of the chosen doctrine only (no reflow, short) */
function DoctrinePicker({ cls, doctrine, onPick }: { cls: ClassDef; doctrine: DoctrineDef; onPick: (d: DoctrineDef) => void }): JSX.Element {
  return (
    <div class="ms-hs-dpick">
      <div class="ms-hs-dsel" role="radiogroup" aria-label={t('hero.panel.doctrine')}>
        {cls.doctrines.map((d) => {
          const on = d.id === doctrine.id;
          const k = d.id.toUpperCase();
          return (
            <button key={d.id} type="button" role="radio" aria-checked={on} class={`ms-hs-dbtn ms-plate ${on ? 'is-sel' : ''}`} data-nav="" data-doctrine={d.id} onClick={() => onPick(d)}>
              <DocMark k={k} />
              <span class="ms-hs-dbtn-text">
                <b>{tl(d.name)}</b>
                <i>{t('hero.doc.tag', { k })}</i>
              </span>
              <span class="ms-hit" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div class="ms-hs-doc ms-hs-doc--flat is-sel">
        <DoctrineBody d={doctrine} withStarter={false} />
      </div>
    </div>
  );
}

function EmpireTile({ e, selected, onPick, onProceed }: { e: EmpireDef; selected: boolean; onPick: () => void; onProceed: () => void }): JSX.Element {
  const rows = statModRows(e.bonus);
  const tip = tipProps(() => <TipBody title={tl(e.name)} body={tl(e.desc)} rows={rows.map((r) => ({ label: r.label, value: r.value, bad: !r.positive }))} />);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      class={`ms-hs-emp ${selected ? 'is-sel' : ''}`}
      style={cv({ '--ec': e.color })}
      data-nav=""
      data-empire={e.id}
      {...tip}
      onClick={chooseOrContinue(selected, onPick, onProceed)}
      onPointerEnter={(ev) => {
        tip.onPointerEnter(ev);
        if (ev.pointerType === 'mouse' && !selected) sfx('hover');
      }}
    >
      <span class="ms-hs-flag">
        <EmpireFlag empire={e.id} color={e.color} selected={selected} />
      </span>
      <span class="ms-hs-emp-name">{tl(e.name)}</span>
      <span class="ms-hs-emp-bonus">
        {rows.map((r) => (
          <span key={r.label}>
            <b>{r.value}</b> {r.label}
          </span>
        ))}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

function HeroScreen({ cls }: { cls: ClassDef }): JSX.Element {
  const { store, meta, content, heroPreview } = deps();
  const scope = useScope();
  const rootRef = useRef<HTMLDivElement | null>(null);
  lang.value;
  const lv = layout.value;
  const mode: Mode = lv.portrait ? 'p' : lv.tier === 'phone-l' ? 'l' : 'w';
  const [page, setPage] = useState<Page>('doctrine');
  const save = metaSave().value;
  const sel = store.selection.value;
  const ix = indexOf();
  const doctrine = cls.doctrines.find((d) => d.id === sel.doctrine) ?? cls.doctrines[0];
  const empire = ix.empires.get(sel.empire) ?? content.empires[0];
  const sex: Sex = cls.sexes.includes(sel.sex) ? sel.sex : (cls.sexes[0] ?? 'm');
  const color = CLASS_COLOR[cls.id];
  const tier = armorTierOf(save, content, cls.id);

  // ---- keep the stored selection valid (content may have changed since it was saved) -------------------------------
  useEffect(() => {
    const fix: Partial<RunSelection> = {};
    if (sel.classId !== cls.id) fix.classId = cls.id;
    if (sel.sex !== sex) fix.sex = sex;
    if (sel.doctrine !== doctrine.id) fix.doctrine = doctrine.id;
    if (empire && sel.empire !== empire.id) fix.empire = empire.id;
    if (sel.armorTier !== tier) fix.armorTier = tier;
    if (Object.keys(fix).length > 0) store.select(fix);
  }, [sel.classId, sel.sex, sel.doctrine, sel.empire, sel.armorTier, cls.id, sex, doctrine.id, empire?.id, tier]);

  // ---- 3D preview (optional engine hook); remounts when the composition changes (the stage element is a new node) ---
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<{ handle: HeroPreviewHandle; sig: string } | null>(null);
  const previewSel = { classId: cls.id, sex, doctrine: doctrine.id, empire: empire?.id ?? sel.empire, armorTier: tier };
  const sig = `${previewSel.classId}|${previewSel.sex}|${previewSel.doctrine}|${previewSel.empire}|${previewSel.armorTier}`;
  useEffect(() => {
    const el = stageRef.current;
    if (!heroPreview || !el) return undefined;
    // heroPreview spins forever: the turntable adapter holds the figure front-on (3/4) with a slow sway, see heroTurn.ts
    const handle = attachTurntable(el, heroPreview.mount(el, previewSel), previewSel);
    previewRef.current = { handle, sig };
    return () => {
      handle.dispose();
      previewRef.current = null;
    };
  }, [heroPreview, mode]);
  useEffect(() => {
    const p = previewRef.current;
    if (p && p.sig !== sig) {
      p.sig = sig;
      p.handle.update(previewSel);
    }
  }, [sig]);
  // class change: the figure fades / flashes in (CSS class re-triggered), the dais puffs (keyed element below)
  const firstSwap = useRef(true);
  useEffect(() => {
    if (firstSwap.current) {
      firstSwap.current = false;
      return;
    }
    const el = stageRef.current;
    if (!el) return;
    el.classList.remove('is-swap');
    void el.offsetWidth;
    el.classList.add('is-swap');
  }, [cls.id]);

  // ---- actions --------------------------------------------------------------------------------------------------------
  const pickClass = (c: ClassDef): void => {
    if (c.id === cls.id) return;
    sfx('tab');
    store.select({ classId: c.id, sex: c.sexes.includes(sel.sex) ? sel.sex : (c.sexes[0] ?? 'm') });
  };
  // the class's skill effects are a lazy chunk: start fetching it now, the run's load awaits it (a failure surfaces there)
  const prefetch = (): void => void ensureSkillVfx([cls.id]).catch(() => undefined);
  const next = (): void => {
    sfx('confirm');
    prefetch();
    store.go('zoneSelect');
  };
  const back = (): void => {
    sfx('back');
    store.go('menu');
  };
  const goArmory = (tab: ArmoryTab): void => {
    store.go('menu');
    openView('armory', tab);
  };
  const list = content.classes;
  const classIx = Math.max(0, list.findIndex((c) => c.id === cls.id));
  const canPrev = classIx > 0;
  const canNext = classIx < list.length - 1;
  const step = (dir: 1 | -1): void => {
    const to = list[classIx + dir];
    if (!to) return sfx('error');
    pickClass(to);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-class="${to.id}"]`)?.focus({ preventScroll: true }));
  };

  useKeys((a) => {
    const active = document.activeElement;
    const inScope = active instanceof HTMLElement && rootRef.current?.contains(active) === true && active.hasAttribute('data-nav');
    switch (a.kind) {
      case 'cancel':
        back();
        return true;
      case 'confirm':
        // a focused control activates itself (keyboard: nav.ts clicks it, gamepad: clickFocused after us)
        if (inScope) return false;
        if (!a.repeat) next();
        return true;
      case 'left':
      case 'right':
        if (active instanceof HTMLElement && active.dataset.class !== undefined) {
          if (!a.repeat) step(a.kind === 'left' ? -1 : 1);
          return true;
        }
        return false;
      default:
        return false;
    }
  });

  // ---- derived view data --------------------------------------------------------------------------------------------
  const { maxHp, armor, moveSpeed, ...restBase } = cls.base;
  const extras = Object.entries(restBase as StatMods).flatMap(([k, v]) => statModRows({ [k]: v } as StatMods).map((r) => ({ ...r, stat: k })));
  const allHp = content.classes.map((c) => c.base.maxHp);
  const allArmor = content.classes.map((c) => c.base.armor);
  const allSpeed = content.classes.map((c) => c.base.moveSpeed);
  const coll = collectionProgress(save, meta.content, cls.id);
  const eqBySlot = new Map(equippedPieces(save, meta.content, cls.id).map((p) => [p.def.slot, p] as const));
  const cs = save.classes[cls.id];
  const cap = talentCap(save);
  const free = availablePoints(cs, cap);
  const spent = spentTotal(cs);
  const stats = save.stats.classes[cls.id];
  const recoId = firstRunHero(save, content.classes);
  const recoCls = recoId ? content.classes.find((c) => c.id === recoId) : undefined;
  const portrait = portraitUrl(cls.id, sex);
  const has3d = heroPreview !== undefined;
  // no engine (gallery, no WebGL): a pose render of the model stands on the dais; the painted bust is the last resort
  const pose = has3d ? null : (texUrl(`uk_hero_select_pose_${cls.id}_${sex}`) ?? texUrl(`uk_hero_select_pose_${cls.id}_m`));
  const floorTex = texUrl('uk_hud_bar');
  const backdropTex = texUrl('uk_hero_select_stage');
  const daisTex = texUrl('uk_hero_select_dais');
  const lookText = eqBySlot.has('armor') || eqBySlot.has('weapon') ? t('hero.look', { n: tier + 1 }) : t('hero.lookBase');

  // ---- pieces ----------------------------------------------------------------------------------------------------------
  const classCards = content.classes.map((c, i) => (
    <ClassCard
      key={c.id}
      cls={c}
      sex={sex}
      selected={c.id === cls.id}
      index={i}
      points={availablePoints(save.classes[c.id], cap)}
      mode={mode}
      pips={{ hp: rankPips(c.base.maxHp, allHp), armor: rankPips(c.base.armor, allArmor), speed: rankPips(c.base.moveSpeed, allSpeed) }}
      reco={c.id === recoId}
      onPick={() => pickClass(c)}
      onProceed={next}
    />
  ));

  const extrasEl =
    extras.length > 0 ? (
      <div class="ms-hs-extras">
        {extras.map((r) => (
          <span key={r.label} class="ms-hs-bonus ms-plate">
            <StatIcon stat={r.stat} size="2.1rem" />
            <b class={`ms-hs-bonus-num ${r.positive ? '' : 'is-bad'}`}>{r.value}</b>
            <span class="ms-hs-bonus-label">{r.label}</span>
          </span>
        ))}
      </div>
    ) : null;

  const lookEl = (
    <Chip size="sm" icon={<Glyph name="helmet" />} class="ms-hs-look" title={t('hero.lookTip')}>
      {lookText}
    </Chip>
  );
  const dragEl = has3d ? (
    <span class="ms-hs-drag ms-hs-drag--hint" aria-hidden="true">
      <svg viewBox="0 0 40 14" focusable="false">
        <path d="M3 7H37M3 7l6-5M3 7l6 5M37 7l-6-5M37 7l-6 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {t('hero.drag')}
    </span>
  ) : null;

  // the courtyard: one full-bleed painted scene behind the whole screen (drawn halls / sky / floor when the raster is missing)
  const backdrop = (
    <div class={`ms-hs-bg ${backdropTex ? 'ms-hs-bg--bd' : ''}`} style={cv({ ...(floorTex ? { '--hs-floor-tex': `url("${floorTex}")` } : {}), ...(backdropTex ? { '--hs-bd': `url("${backdropTex}")` } : {}) })} aria-hidden="true">
      {backdropTex && <div class="ms-hs-backdrop" />}
      <div class="ms-hs-sky" />
      <div class="ms-hs-scene">
        <StageScene />
      </div>
      <div class="ms-hs-fog" />
      <div class="ms-hs-floor">
        <div class="ms-hs-floor-plane" />
      </div>
    </div>
  );

  // phone layouts: the cards show only a star, so a caption on top of the stage says what it means while another hero is selected (the selected one
  // says it on its record line). It floats over the stage: a flow line would push the footer off a short tablet portrait (768 x 1024).
  const recoCap =
    mode !== 'w' && recoCls && recoCls.id !== cls.id ? (
      <div class="ms-hs-reco-cap" role="note">
        <Glyph name="star" />
        <span>{t('hero.reco.cap', { hero: tl(recoCls.name) })}</span>
      </div>
    ) : null;

  // the stage: dais + hero + blades, sized from its own box (desktop: the whole screen; phones: the free zone between the boards)
  const stage = (
    <div class={`ms-hs-stage ${has3d ? 'ms-hs-stage--3d' : ''}`}>
      <div class="ms-hs-bgfx" aria-hidden="true">
        <div class="ms-hs-cone" />
        <div class="ms-hs-pool" />
        <div class={`ms-hs-dais ${daisTex ? 'ms-hs-dais--tex' : ''}`}>
          {daisTex ? (
            <>
              <DaisTex url={daisTex} />
              <DaisLightTex />
            </>
          ) : (
            <>
              <Dais />
              <DaisLight />
            </>
          )}
        </div>
        <div class="ms-hs-shadow" />
      </div>
      <div class="ms-hs-fig">
        {!has3d && pose && <Painted key={pose} url={pose} class="ms-hs-pose" />}
        {!has3d && !pose && <Painted key={portrait ?? 'none'} url={portrait} class="ms-hs-portrait" />}
        {!portrait && !pose && !has3d && (
          <div class="ms-hs-emblem-big">
            <ClassEmblem classId={cls.id} size="9rem" />
          </div>
        )}
        {has3d && <div class="ms-hs-3d" ref={stageRef} />}
      </div>
      <div class="ms-hs-fgfx" aria-hidden="true">
        <i class="ms-hs-puff" key={cls.id} />
      </div>
      <BladeArrow dir="prev" disabled={!canPrev} onClick={() => step(-1)} label={t('hero.prevClass')} />
      <BladeArrow dir="next" disabled={!canNext} onClick={() => step(1)} label={t('hero.nextClass')} />
      {mode === 'w' && extrasEl && <div class="ms-hs-tags">{extrasEl}</div>}
      {mode === 'w' ? (
        <div class="ms-hs-tagsl">
          {lookEl}
          {dragEl}
        </div>
      ) : (
        dragEl
      )}
      {recoCap}
    </div>
  );

  const plate = (
    <div class="ms-hs-plate">
      <ClassEmblem classId={cls.id} size="2.6rem" />
      <div class="ms-hs-plate-name">
        <h2 class="ms-title" key={cls.id}>
          {tl(cls.name)}
        </h2>
        <span class="ms-hs-plate-sub">
          {tl(doctrine.name)} ·{' '}
          {cls.id === recoId ? (
            <span class="ms-hs-reco-line">
              <Glyph name="star" /> {t('hero.reco.badge')}
            </span>
          ) : stats.runs > 0 ? (
            heroRecord(stats.runs, stats.wins)
          ) : (
            t('hero.freshRecord')
          )}
        </span>
      </div>
      <TipSeg
        label={t('hero.panel.hero')}
        value={sex}
        onChange={(s) => {
          store.select({ sex: s });
        }}
        options={(['m', 'f'] as const).map((s) => {
          const ok = cls.sexes.includes(s);
          return {
            key: s,
            label: (
              <>
                {!ok && <Glyph name="lock" />}
                {t(`hero.sex.${s}`)}
              </>
            ),
            disabled: !ok,
            ...(ok ? {} : { tip: () => <div>{t(`hero.sexOnly.${cls.sexes[0] ?? 'm'}`)}</div> }),
          };
        })}
      />
    </div>
  );

  const descEl = (
    <p class="ms-hs-desc" key={cls.id}>
      {tl(cls.desc)}
    </p>
  );

  const statsEl = (
    <div class="ms-hs-stats" role="group" aria-label={t('hero.base')}>
      <StatPlate stat="maxHp" label={t('hero.stat.hp')} value={fmtInt(maxHp)} pips={rankPips(maxHp, allHp)} tip={t('hero.statTip')} />
      <StatPlate stat="armor" label={t('hero.stat.armor')} value={fmtInt(armor)} pips={rankPips(armor, allArmor)} tip={t('hero.statTip')} />
      <StatPlate stat="moveSpeed" label={t('hero.stat.speed')} value={fixed1(moveSpeed)} unit={t('stat.speedUnit')} pips={rankPips(moveSpeed, allSpeed)} tip={t('hero.statTip')} />
    </div>
  );

  const gearEl = (
    <div class="ms-hs-gear">
      <div class="ms-hs-gear-row" aria-label={t('hero.equipment')}>
        {GEAR_SLOTS.map((slot) => {
          const p = eqBySlot.get(slot);
          return p ? (
            <IconSlot
              key={slot}
              size="sm"
              icon={p.def.icon}
              kind="gear"
              slot={slot}
              rarity={gearRarity(p.def.tier)}
              {...(p.plus > 0 ? { badge: `+${p.plus}` } : {})}
              {...tipProps(() => buildTip({ type: 'gear', id: p.def.id, plus: p.plus }), { rarity: gearRarity(p.def.tier) })}
            />
          ) : (
            <IconSlot key={slot} size="sm" ghost={slotGlyph(slot)} {...tipProps(() => <TipBody title={t('hero.emptySlot', { slot: t(`gear.slot.${slot}`) })} />)} />
          );
        })}
      </div>
      <div class="ms-hs-coll" {...tipProps(() => <TipBody title={t('hero.collection')} body={t('hero.collectionTip')} />)}>
        <StatWell layout="row" size="sm" label={t('hero.collection')} value={`${fmtInt(coll.owned)} / ${fmtInt(coll.total)}`} />
        <HeroGauge value={coll.total > 0 ? coll.owned / coll.total : 0} ch="0.78rem" />
        {coll.owned === 0 && <span class="ms-hs-gearhint">{t('hero.gearHint')}</span>}
      </div>
    </div>
  );

  const linksEl = (
    <div class="ms-hs-links">
      <Button variant="wood" size="small" class="ms-hs-link" aria-label={t('menu.armory')} title={`${t('menu.armory')} · ${t('hero.armorySub')}`} onClick={() => goArmory('character')} sub={t('hero.armorySub')}>
        <Glyph name="shield" /> <span class="ms-hs-link-t">{t('menu.armory')}</span>
      </Button>
      <Button
        variant="wood"
        size="small"
        class="ms-hs-link"
        aria-label={t('hero.talents')}
        title={`${t('hero.talents')} · ${free > 0 ? t('hero.pointsFree', { n: fmtInt(free) }) : t('hero.pointsSpent', { n: fmtInt(spent) })}`}
        onClick={() => goArmory('talents')}
        sub={free > 0 ? t('hero.pointsFree', { n: fmtInt(free) }) : t('hero.pointsSpent', { n: fmtInt(spent) })}
      >
        <Glyph name="star" /> <span class="ms-hs-link-t">{t('hero.talents')}</span>
        {free > 0 && <Medal tag label={free} class="ms-hs-link-badge" />}
      </Button>
    </div>
  );

  // hero page of the phone tab sheet: the same pieces, stacked
  const info = (
    <div class="ms-hs-info">
      {descEl}
      {statsEl}
      {extrasEl}
      <div class="ms-hs-lookrow">{lookEl}</div>
      {gearEl}
      {linksEl}
    </div>
  );

  const doctrines = (
    <div class="ms-hs-docs" role="radiogroup" aria-label={t('hero.panel.doctrine')}>
      {cls.doctrines.map((d, i) => (
        <DoctrineCard
          key={`${cls.id}:${d.id}`}
          d={d}
          index={i}
          selected={d.id === doctrine.id}
          onPick={() => {
            sfx('tab');
            store.select({ doctrine: d.id });
          }}
          onProceed={next}
        />
      ))}
    </div>
  );

  const empires = empire ? (
    <div class="ms-hs-empire">
      <div class="ms-hs-emps" role="radiogroup" aria-label={t('hero.panel.empire')}>
        {content.empires.map((e) => (
          <EmpireTile
            key={e.id}
            e={e}
            selected={e.id === empire.id}
            onPick={() => {
              sfx('tab');
              store.select({ empire: e.id });
            }}
            onProceed={next}
          />
        ))}
      </div>
      <div class="ms-hs-empire-detail" key={empire.id} style={cv({ '--ec': empire.color })}>
        <p>{tl(empire.desc)}</p>
      </div>
    </div>
  ) : null;

  const tabs = (
    <>
      <Tabs
        class="ms-hs-tabs"
        value={page}
        onChange={setPage}
        tabs={[
          { key: 'doctrine', label: t('hero.panel.doctrine') },
          { key: 'empire', label: t('hero.panel.empire') },
          { key: 'info', label: t('hero.panel.hero'), ...(free > 0 ? { badge: free } : {}) },
        ]}
      />
      <ScrollFade class="ms-hs-pages" viewClass="ms-hs-pages-view" axis="y" size="1.6rem" cue={false}>
        {page === 'doctrine' ? <DoctrinePicker cls={cls} doctrine={doctrine} onPick={(d) => { sfx('tab'); store.select({ doctrine: d.id }); }} /> : page === 'empire' ? empires : info}
      </ScrollFade>
    </>
  );

  const head = (
    <header class="ms-hs-head">
      <span class="ms-eyebrow">{t('hero.step', { n: 1, total: 2 })}</span>
      <h1 class="ms-title ms-hs-title">{t('hero.title')}</h1>
      <div class="ms-hs-steps" aria-hidden="true">
        <span class="is-on">
          <i />
          {t('hero.stepHero')}
        </span>
        <b />
        <span>
          <i />
          {t('hero.stepZone')}
        </span>
      </div>
    </header>
  );

  const backBtn = (
    <Button variant="wood" sound="back" class="ms-hs-back" aria-label={t('common.back')} onClick={back}>
      <span class="ms-hs-back-arrow" aria-hidden="true">
        ←
      </span>
      <span class="ms-hs-back-t">{t('common.back')}</span> <KeyHint k="Esc" />
    </Button>
  );
  const nextBtn = (
    <Button size="big" class="ms-hs-next" onClick={() => { prefetch(); store.go('zoneSelect'); }} sound="confirm" sub={empire ? t('hero.nextSub', { class: tl(cls.name), doctrine: tl(doctrine.name), empire: tl(empire.name) }) : undefined}>
      {t('hero.next')} → <KeyHint k="Enter" />
    </Button>
  );
  const hints = (
    <>
      <div class="ms-hs-hint">
        <span>
          <KeyHint k="←" />
          <KeyHint k="→" /> {t('hero.hint.class')}
        </span>
      </div>
      <div class="ms-hs-hint ms-hs-hint--touch">{t('hero.hint.touch')}</div>
    </>
  );

  const body =
    mode === 'w' ? (
      <div class="ms-hs-cols">
        <Panel variant="thinboard" class="ms-hs-board ms-hs-board--class" title={t('hero.panel.class')}>
          <div class="ms-hs-classes" role="radiogroup" aria-label={t('hero.panel.class')}>
            {classCards}
          </div>
          <div class="ms-hs-classhint">{hints}</div>
        </Panel>
        <div class="ms-hs-mid">
          <Panel variant="thinboard" class="ms-hs-dock">
            {plate}
            <div class="ms-hs-dock-body">
              {statsEl}
              {gearEl}
            </div>
            <div class="ms-hs-dock-foot">{linksEl}</div>
          </Panel>
        </div>
        <div class="ms-hs-right">
          <Panel variant="thinboard" class="ms-hs-board ms-hs-board--doc" title={t('hero.panel.doctrine')}>
            <ScrollFade class="ms-hs-docwrap" viewClass="ms-hs-docview" axis="y" size="1.4rem">
              {doctrines}
            </ScrollFade>
          </Panel>
          <Panel variant="thinboard" class="ms-hs-board ms-hs-board--emp" title={t('hero.panel.empire')}>
            {empires}
          </Panel>
        </div>
        <div class="ms-hs-fl">{backBtn}</div>
        <div class="ms-hs-fr">{nextBtn}</div>
      </div>
    ) : mode === 'p' ? (
      <div class="ms-hs-pcol">
        <div class="ms-hs-strip" role="radiogroup" aria-label={t('hero.panel.class')}>
          {classCards}
        </div>
        {stage}
        <div class="ms-hs-plate-wrap ms-plate">{plate}</div>
        <Panel variant="thinboard" class="ms-hs-pboard">
          {tabs}
        </Panel>
        <footer class="ms-hs-foot">
          <div class="ms-hs-actions">
            {backBtn}
            {nextBtn}
          </div>
          <div class="ms-hs-hint ms-hs-hint--touch">{t('hero.hint.touch')}</div>
        </footer>
      </div>
    ) : (
      <div class="ms-hs-lrow">
        <div class="ms-hs-rail" role="radiogroup" aria-label={t('hero.panel.class')}>
          {classCards}
        </div>
        {stage}
        <Panel variant="thinboard" class="ms-hs-pboard">
          {tabs}
        </Panel>
        <div class="ms-hs-fl">{backBtn}</div>
        <div class="ms-hs-fc ms-plate">{plate}</div>
        <div class="ms-hs-fr">{nextBtn}</div>
      </div>
    );

  return (
    <div class={`ms-screen ms-hs ms-hs--${mode}`} ref={(el) => { rootRef.current = el; scope(el); }} style={cv({ '--cc': color })}>
      {backdrop}
      <div class="ms-hs-veil" />
      {mode === 'w' && stage}
      <EmberField count={14} />
      <Kit contents>
        {head}
        {body}
      </Kit>
    </div>
  );
}

export function HeroSelect(): JSX.Element {
  const { store, content } = deps();
  const cls = indexOf().classes.get(store.selection.value.classId) ?? content.classes[0];
  if (!cls) {
    return (
      <div class="ms-screen">
        <div class="ms-backdrop ms-backdrop--dim" />
      </div>
    );
  }
  return <HeroScreen cls={cls} />;
}
