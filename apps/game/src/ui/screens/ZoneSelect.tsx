
// ONE continuous landmass (ZoneAtlas.tsx): our four zones are its bordered regions, each the live ZoneMap raster of the zone, planted
// with a cloth banner pin, a charcoal name plate and small markers, joined in campaign order by a road that crosses the border at a
// gate (open padlock seal, or an iron chain + closed padlock while the way is shut). A second board carries the dossier of the chosen
// zone: painted header, records, boss timeline, Metin stones, a chronicle excerpt (full text in a sheet), the enemy roster in octagon
// slots, difficulty with its modifier wells, the Custom-run sheet and the lacquer Enter plate.
// Keys: ←/→ zone (while a region has focus / D-pad), H hard mode, Enter start, Esc back.
import type { JSX } from 'preact';
import type { RunOptionsConfig } from '../../data/loader';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RunOptions, RunSelection } from '../../app/store';
import type { Difficulty, Element, EnemyDef, EnemyRank, L10n, RaceTag, Rarity, ZoneDef } from '../../data/schema';
import { fmtDec, fmtInt, fmtPct, fmtTime, lang, t, tl } from '../../i18n/i18n';
import { zoneStatuses, type ZoneStatus } from '../../meta';
import { clampRunOptions, runOptionsReward, runOptionsTable } from '../../sim';
import { sfx } from '../audio';
import { texUrl, zoneArtUrl } from '../assets';
import { Button } from '../components/Button';
import { Field, Slider } from '../components/Controls';
import { Chip } from '../components/Chip';
import { Glyph, type GlyphName } from '../components/glyphs';
import { EmberField } from '../components/Modal';
import { Kit, Panel } from '../components/Panel';
import { ScrollFade } from '../components/ScrollFade';
import { IconSlot, KeyHint } from '../components/Slot';
import { StatWell } from '../components/StatWell';
import { UiGlyph } from '../components/StatIcon';
import { TipBody, tipProps } from '../components/Tooltip';
import { deps } from '../env';
import { enemyName, indexOf, metinName } from '../content';
import { focusFirst, useKeys, useScope } from '../nav';
import { metaSave, pushToast } from '../view';
import { dangerOf, DangerSkulls, HardSeal, roman } from './zoneArt';
import { Painted, ZoneAtlas } from './ZoneAtlas';
import './zone.css';

/** multiplier with two fixed decimals (×1.50, ×2.00) in the active language */
const fixed2 = (n: number): string => new Intl.NumberFormat(lang.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const cv = (v: Record<string, string | number>): JSX.CSSProperties => v as unknown as JSX.CSSProperties;

const OPT_KEYS = ['density', 'health', 'damage', 'speed'] as const;
const NO_OPTIONS: RunOptions = { density: 1, health: 1, damage: 1, speed: 1 };

const RANK_ORDER: Record<EnemyRank, number> = { pawn: 0, pawnElite: 1, knight: 2, knightElite: 3, boss: 4, king: 5 };
const RANK_RARITY: Record<EnemyRank, Rarity> = { pawn: 'common', pawnElite: 'uncommon', knight: 'rare', knightElite: 'epic', boss: 'legendary', king: 'legendary' };
const RACE_ELEMENT: Record<RaceTag, Element> = {
  animal: 'physical',
  orc: 'dark',
  esoteric: 'dark',
  undead: 'poison',
  devil: 'fire',
  insect: 'poison',
  desert: 'holy',
  ice: 'ice',
  fire: 'fire',
  dragon: 'fire',
  human: 'wind',
  metin: 'lightning',
};
const RACE_GLYPH: Record<RaceTag, GlyphName> = {
  animal: 'claw',
  orc: 'fist',
  esoteric: 'eye',
  undead: 'skull',
  devil: 'flame',
  insect: 'drop',
  desert: 'wind',
  ice: 'frost',
  fire: 'flame',
  dragon: 'dragon',
  human: 'sword',
  metin: 'stone',
};

/** a tint per creature model (the name says it: blue / frost, grey, red / fire, black / dark ...), so six wolves are six different tiles */
function foeElement(model: string, race: RaceTag | undefined): Element {
  if (/blue|frost|ice|snow|yeti/.test(model)) return 'ice';
  if (/red|fire|flame|ember|lava/.test(model)) return 'fire';
  if (/black|dark|shadow|ghost|night/.test(model)) return 'dark';
  if (/grey|gray|white|silver|wind/.test(model)) return 'wind';
  if (/poison|plague|scorpion|bug/.test(model)) return 'poison';
  if (/holy|ascetic|monk/.test(model)) return 'holy';
  if (/thunder|bolt|storm|lightning/.test(model)) return 'lightning';
  return race ? RACE_ELEMENT[race] : 'physical';
}

/** a roster glyph per creature model (placeholders until the baked portraits `icon_enemy_<model>` ship) */
function foeGlyph(model: string, race: RaceTag | undefined): GlyphName {
  if (/archer|bow/.test(model)) return 'bow';
  if (/wolf|dog/.test(model)) return 'wolf';
  if (/boar/.test(model)) return 'fist';
  if (/bear|tiger|lion/.test(model)) return 'claw';
  if (/scout/.test(model)) return 'daggers';
  if (/leader|captain|general/.test(model)) return 'swords';
  if (/soldier|warrior|fighter|barbarian|knight/.test(model)) return 'sword';
  if (/sorcerer|conjurer|spirit/.test(model)) return 'bolt';
  if (/scorpion|bug/.test(model)) return 'drop';
  if (/ghost/.test(model)) return 'skull';
  if (/golem|whale|lion|yeti|frosty|man$/.test(model)) return race === 'fire' ? 'flame' : race === 'ice' ? 'frost' : 'fist';
  return race ? RACE_GLYPH[race] : 'skull';
}

/** 'Lv 4' for a single level, 'Lv 4–9' for a span (the old roster printed 'Lv 1–1') */
const lvText = (lo: number, hi: number): string => (lo === hi ? t('common.level', { n: lo }) : t('zone.levels', { a: lo, b: hi }));

// ---------------------------------------------------------------------------------------------------------------------
// Enemy roster of a zone, one entry per creature model (variants folded together)

interface Foe {
  model: string;
  name: L10n;
  lo: number;
  hi: number;
  rank: EnemyRank;
  glyph: GlyphName;
  element: Element;
  variants: L10n[];
}

const rosterCache = new WeakMap<ZoneDef, Foe[]>();

function rosterOf(zone: ZoneDef): Foe[] {
  const cached = rosterCache.get(zone);
  if (cached) return cached;
  const ix = indexOf();
  const ids = new Set<string>();
  for (const band of zone.bands) {
    for (const s of band.spawns) {
      ids.add(s.enemy);
      if (s.group) {
        if (s.group.leader) ids.add(s.group.leader);
        for (const m of s.group.members) ids.add(m);
      }
    }
    for (const id of band.elites?.pool ?? []) ids.add(id);
  }
  const byModel = new Map<string, EnemyDef[]>();
  for (const id of ids) {
    const e = ix.enemies.get(id);
    if (!e) continue;
    let list = byModel.get(e.model);
    if (!list) {
      list = [];
      byModel.set(e.model, list);
    }
    list.push(e);
  }
  const foes: Foe[] = [];
  for (const [model, list] of byModel) {
    list.sort((a, b) => a.level - b.level || a.name.en.length - b.name.en.length);
    const rep = list[0];
    const last = list[list.length - 1];
    if (!rep || !last) continue;
    const rank = list.reduce<EnemyRank>((r, e) => (RANK_ORDER[e.rank] > RANK_ORDER[r] ? e.rank : r), rep.rank);
    const race = rep.race[0];
    foes.push({
      model,
      name: rep.name,
      lo: rep.level,
      hi: Math.max(last.level, rep.level),
      rank,
      glyph: foeGlyph(model, race),
      element: foeElement(model, race),
      variants: list.slice(1).map((e) => e.name),
    });
  }
  foes.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  rosterCache.set(zone, foes);
  return foes;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dossier pieces

function Section({ title, children, class: cls }: { title: string; children: JSX.Element | JSX.Element[]; class?: string }): JSX.Element {
  return (
    <section class={`ms-zs-sec ${cls ?? ''}`}>
      <div class="ms-zs-sectitle">
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function Timeline({ zone }: { zone: ZoneDef }): JSX.Element {
  const ix = indexOf();
  const items = [...zone.bosses.map((b) => ({ at: b.at, id: b.boss, final: false })), { at: zone.final.at, id: zone.final.boss, final: true }];
  return (
    <ol class="ms-zs-tl" style={cv({ '--n': items.length })}>
      {items.map((it, i) => {
        const boss = ix.bosses.get(it.id);
        const tip = tipProps(() => (
          <TipBody
            title={enemyName(it.id)}
            sub={`${it.final ? t('zone.finalBoss') : t('zone.boss')}${boss ? ` · ${t('common.level', { n: boss.level })}` : ''}`}
            body={`${boss ? `${tl(boss.title)} — ` : ''}${t('zone.arrives', { time: fmtTime(it.at) })}`}
            rows={boss ? [{ label: t('stat.hp'), value: fmtInt(boss.hp) }] : []}
            lore={it.final ? `${t('zone.greatMetin')}: ${metinName(zone.final.greatMetin)}` : boss ? tl(boss.intro) : undefined}
          />
        ));
        return (
          <li key={it.id} class={`ms-zs-tl-item ${it.final ? 'is-final' : ''}`} style={cv({ '--i': i })} {...tip}>
            <StatWell value={fmtTime(it.at)} size="sm" tone={it.final ? 'gold' : 'neutral'} class="ms-zs-tl-time" />
            <span class="ms-zs-tl-track">
              <span class="ms-zs-tl-node ms-plate">
                <UiGlyph name={it.final ? 'crown' : 'skull'} tone={it.final ? 'gold' : 'ivory'} flat />
              </span>
            </span>
            <span class="ms-zs-tl-name">{enemyName(it.id)}</span>
            {it.final && <span class="ms-zs-tl-sub">{t('zone.greatMetin')}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The first sentences of a paragraph (never cut inside a sentence): about 150..250 characters. */
export function excerptOf(text: string, max = 250): string {
  const parts = text.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) ?? [text];
  let out = '';
  for (const raw of parts) {
    const part = raw.trim();
    if (out && out.length + 1 + part.length > max) break;
    out = out ? `${out} ${part}` : part;
    if (out.length >= 150) break;
  }
  return out || text;
}

function chapterOf(zone: ZoneDef): { title: L10n | null; paragraphs: L10n[] } {
  const { content } = deps();
  const chapter = content.story.chapters.find((c) => c.zone === zone.id);
  return { title: chapter ? chapter.title : null, paragraphs: chapter ? chapter.text : zone.story.intro };
}

/** the painted scroll (uk_zone_select_scroll, 9-sliced by CSS border-image) as a CSS variable; undefined while it is not shipped */
function scrollStyle(): JSX.CSSProperties | undefined {
  const u = texUrl('uk_zone_select_scroll');
  return u ? cv({ '--zs-scroll': `url("${u}")` }) : undefined;
}

/** The chronicle excerpt: a scroll with wooden rods, burnt edges, the first paragraph and a read-on plate. */
function Chronicle({ zone, onOpen }: { zone: ZoneDef; onOpen: () => void }): JSX.Element {
  const { title, paragraphs } = chapterOf(zone);
  const first = paragraphs[0];
  const full = first ? tl(first) : '';
  const excerpt = excerptOf(full);
  const more = paragraphs.length > 1 || excerpt.length < full.length;
  const scroll = scrollStyle();
  return (
    <div class="ms-zs-chron">
      <div class={`ms-zs-parch ms-zs-parch--short ${scroll ? 'has-img' : ''}`} style={scroll}>
        <i class="ms-zs-rod is-top" aria-hidden="true" />
        <div class="ms-zs-parch-in">
          {title && <h3 class="ms-zs-parch-title">{tl(title)}</h3>}
          {first && <p class="ms-zs-parch-p">{excerpt}</p>}
        </div>
        <i class="ms-zs-rod is-bot" aria-hidden="true" />
      </div>
      {more && (
        <Button variant="wood" size="small" class="ms-zs-readon" onClick={onOpen} sound="open">
          <UiGlyph name="book" tone="gold" flat /> {t('zone.chronicleRead')}
        </Button>
      )}
    </div>
  );
}

function Roster({ zone }: { zone: ZoneDef }): JSX.Element {
  const foes = rosterOf(zone);
  return (
    <div class="ms-zs-foes-tray ms-sunken">
      <ScrollFade class="ms-zs-foes-fade" viewClass="ms-zs-foes" size="1.6rem" cue={false} aria-label={t('zone.roster')}>
      {foes.map((f) => (
        <span
          key={f.model}
          class="ms-zs-foe"
          {...tipProps(() => (
            <TipBody
              title={tl(f.name)}
              sub={lvText(f.lo, f.hi)}
              body={f.variants.length > 0 ? `${t('zone.rosterVariants')} ${f.variants.map((v) => tl(v)).join(', ')}` : undefined}
            />
          ))}
        >
          <IconSlot size="sm" icon={`icon_enemy_${f.model}`} kind="misc" glyph={f.glyph} element={f.element} rarity={RANK_RARITY[f.rank]} />
          <span class="ms-zs-foe-text">
            <b>{tl(f.name)}</b>
            <i class="ms-num">{lvText(f.lo, f.hi)}</i>
          </span>
        </span>
      ))}
      </ScrollFade>
    </div>
  );
}

/** Chip label of the phone-landscape 3-column grid: "Metin of Lament" -> "Sorrow", "Great Ebon Metin" -> "Great Black", TR "Yas Metini" -> "Üzüntü". The full name stays in the tip and (screen-reader-only) in the chip. */
export function shortMetinName(full: string): string {
  const s = full
    .replace(/^Great Metin of (?:the )?/i, 'Great ')
    .replace(/^Metin of (?:the )?/i, '')
    .replace(/\s+Metini?$/i, '')
    .trim();
  return s || full;
}

function Metins({ zone }: { zone: ZoneDef }): JSX.Element {
  const ix = indexOf();
  const ids = [...zone.metins.types, zone.final.greatMetin];
  const tip = tipProps(() => <TipBody title={t('zone.metins')} body={t('zone.metinsTip', { time: fmtTime(zone.metins.firstAt), a: zone.metins.interval[0], b: zone.metins.interval[1] })} />);
  return (
    <div class="ms-zs-metins" {...tip}>
      {ids.map((id) => {
        const m = ix.metins.get(id);
        const great = id === zone.final.greatMetin;
        return (
          <span
            key={id}
            class={`ms-zs-metin ms-plate ${great ? 'is-great' : ''}`}
            {...tipProps(() => (
              <TipBody
                title={metinName(id)}
                sub={great ? t('zone.greatMetin') : undefined}
                body={m ? tl(m.lore) : undefined}
                rows={m ? [{ label: t('stat.hp'), value: fmtInt(m.hp) }, { label: t('zone.metinAwakens', { n: fmtInt(m.awakenAfter) }), value: '' }] : []}
              />
            ))}
          >
            <span class="ms-zs-socket" aria-hidden="true">
              <i class="ms-zs-gem" style={cv({ '--dc': m?.rune ?? '#e8c36a' })} />
            </span>
            {great && <UiGlyph name="crown" tone="gold" flat class="ms-zs-metin-crown" />}
            <span class="ms-zs-metin-name">
              <span class="ms-zs-mn-full">{metinName(id)}</span>
              <span class="ms-zs-mn-short" aria-hidden="true">
                {shortMetinName(metinName(id))}
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Normal / Hard plates; a locked Hard stays clickable (error sound + toast) and carries its tooltip. */
function DiffSeg({ value, onChange, hardOk, normalTip, hardTip }: { value: Difficulty; onChange: (d: Difficulty) => void; hardOk: boolean; normalTip?: () => JSX.Element; hardTip: () => JSX.Element }): JSX.Element {
  const btn = (key: Difficulty, label: JSX.Element | string, off: boolean, tip?: () => JSX.Element): JSX.Element => (
    <button
      type="button"
      role="radio"
      aria-checked={key === value}
      aria-disabled={off ? 'true' : undefined}
      class={`ms-kseg-btn ms-plate ms-zs-segbtn ${key === value ? 'is-active' : ''} ${off ? 'is-off' : ''} ${key === 'hard' ? 'is-hard' : ''}`}
      data-nav=""
      {...(tip ? tipProps(tip) : {})}
      onClick={() => {
        if (off) return onChange(key);
        if (key !== value) {
          sfx('tab');
          onChange(key);
        }
      }}
    >
      {label}
    </button>
  );
  return (
    <div class="ms-kseg ms-zs-seg" role="radiogroup" aria-label={t('zone.difficulty')}>
      {btn('normal', t('zone.normal'), false, normalTip)}
      {btn(
        'hard',
        <>
          {!hardOk ? <UiGlyph name="lock" tone="pewter" flat /> : <UiGlyph name="skull" tone={value === 'hard' ? 'crimson' : 'pewter'} flat />}
          {t('zone.hard')}
        </>,
        !hardOk,
        hardTip,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Sheets (Custom run, full chronicle)

interface RewardInfo {
  table: RunOptionsConfig;
  opts: RunOptions;
  optReward: number;
  hardMul: number;
  total: number;
  capped: boolean;
  modified: number;
}

function Sheet({ onClose, children, class: cls }: { onClose: () => void; children: JSX.Element; class?: string }): JSX.Element {
  const scope = useScope();
  useKeys((a) => {
    if (a.kind === 'cancel') {
      sfx('back');
      onClose();
      return true;
    }
    return false;
  });
  useEffect(() => {
    sfx('open');
    const id = requestAnimationFrame(() => focusFirst());
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div class={`ms-zs-sheet ${cls ?? ''}`} ref={scope} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  );
}

function RunOptionsSheet({ info, hard, onChange, onReset, onClose }: { info: RewardInfo; hard: boolean; onChange: (k: (typeof OPT_KEYS)[number], v: number) => void; onReset: () => void; onClose: () => void }): JSX.Element {
  const { table, opts, optReward, hardMul, total, capped } = info;
  return (
    <Sheet onClose={onClose}>
      <Panel variant="board" ornate title={t('zone.opt.title')} onClose={onClose} class="ms-zs-opts">
        <div class="ms-zs-opts-in">
          <div class="ms-zs-opts-head">
            <p>{t('zone.opt.desc', { max: fmtDec(table.rewardMax, 0) })}</p>
            <div class={`ms-zs-reward ${capped ? 'is-capped' : ''}`} {...tipProps(() => <TipBody title={t('zone.opt.reward')} body={t('zone.opt.rewardHint')} />)}>
              <StatWell layout="stack" size="lg" label={t('zone.opt.reward')} value={`×${fixed2(total)}`} tone={capped ? 'gold' : 'neutral'} />
              <small>
                {capped ? <Chip tone="gold" size="sm">{t('zone.opt.max')}</Chip> : null}
                {capped ? ` ${t('zone.opt.capped', { max: fmtDec(table.rewardMax, 0) })}` : t('zone.opt.options', { n: fixed2(optReward) })}
                {hard ? ` · ${t('zone.opt.hardStack', { n: fixed2(hardMul) })}` : ''}
              </small>
            </div>
          </div>
          <div class="ms-zs-opts-rows ms-scroll">
            {OPT_KEYS.map((k) => (
              <Field key={k} label={t(`zone.opt.${k}`)} hint={t(`zone.opt.${k}Hint`)}>
                <Slider value={opts[k]} min={table[k].min} max={table[k].max} step={table[k].step} label={t(`zone.opt.${k}`)} onChange={(v) => onChange(k, v)} format={(v) => fmtPct(v, 0)} />
              </Field>
            ))}
          </div>
          <div class="ms-zs-opts-foot">
            <Button variant="wood" size="small" onClick={onReset} disabled={info.modified === 0}>
              {t('zone.opt.reset')}
            </Button>
            <Button size="small" sound="confirm" onClick={onClose}>
              {t('zone.opt.done')}
            </Button>
          </div>
        </div>
      </Panel>
    </Sheet>
  );
}

function ChronicleSheet({ zone, onClose }: { zone: ZoneDef; onClose: () => void }): JSX.Element {
  const { title, paragraphs } = chapterOf(zone);
  return (
    <Sheet onClose={onClose}>
      <Panel variant="board" ornate title={t('zone.chronicle')} onClose={onClose} class="ms-zs-chsheet">
        <div class="ms-zs-chsheet-in">
          <ScrollFade class="ms-zs-chsheet-fade" viewClass="ms-zs-chsheet-view" aria-label={t('zone.chronicle')}>
            <div class={`ms-zs-parch ms-zs-parch--full ${scrollStyle() ? 'has-img' : ''}`} style={scrollStyle()}>
              <i class="ms-zs-rod is-top" aria-hidden="true" />
              <div class="ms-zs-parch-in">
                {title && <h3 class="ms-zs-parch-title">{tl(title)}</h3>}
                {paragraphs.map((p, i) => (
                  <p key={i} class="ms-zs-parch-p">
                    {tl(p)}
                  </p>
                ))}
              </div>
              <i class="ms-zs-rod is-bot" aria-hidden="true" />
            </div>
          </ScrollFade>
          <div class="ms-zs-opts-foot">
            <Button size="small" sound="confirm" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </Panel>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function ZoneSelect(): JSX.Element {
  const { store, meta, content } = deps();
  const scope = useScope();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState<'opts' | 'story' | null>(null);
  lang.value;
  const save = metaSave().value;
  const sel = store.selection.value;
  const ix = indexOf();
  const statuses = zoneStatuses(save, meta.content);
  const firstOpen = statuses.find((s) => s.unlocked) ?? statuses[0];
  const cur = statuses.find((s) => s.zone.id === sel.zone) ?? firstOpen;
  if (!cur) {
    return (
      <div class="ms-screen">
        <div class="ms-backdrop ms-backdrop--dim" />
      </div>
    );
  }
  const z = cur.zone;
  const hardOk = cur.hardUnlocked;
  const difficulty: Difficulty = sel.difficulty === 'hard' && hardOk ? 'hard' : 'normal';
  const hard = difficulty === 'hard';

  const reqText = (st: ZoneStatus): string | null => {
    const r = st.requirement;
    if (!r) return null;
    const prev = ix.zones.get(r.zone);
    if (!prev) return null;
    return t(r.difficulty === 'hard' ? 'zone.reqHard' : 'zone.req', { boss: enemyName(prev.final.boss), zone: tl(prev.name) });
  };
  const hardReq = (): string => {
    // the zone's own Normal clear opens its Hard mode
    return t('zone.hardLockedTip', { zone: tl(z.name) });
  };

  // ---- keep the stored selection valid -------------------------------------------------------------------------------
  useEffect(() => {
    const fix: Partial<RunSelection> = {};
    if (sel.zone !== z.id) fix.zone = z.id;
    if (sel.difficulty !== difficulty) fix.difficulty = difficulty;
    if (Object.keys(fix).length > 0) store.select(fix);
  }, [sel.zone, sel.difficulty, z.id, difficulty]);

  // ---- phone portrait: the hero and the record wells always end just above the pinned action bar (the atlas takes what is left) ----------
  const lockedNow = !cur.unlocked;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const fit = (): void => {
      if (!root.closest('.ms-portrait')) {
        root.style.removeProperty('--zs-world-h');
        return;
      }
      const sc = root.querySelector<HTMLElement>('.ms-zs-mainwrap .ms-scroll');
      if (sc && sc.scrollTop > 2) return;
      const rec = root.querySelector<HTMLElement>('.ms-zs-rec, .ms-zs-lockbar');
      const foot = root.querySelector<HTMLElement>('.ms-zs-dfoot');
      const world = root.querySelector<HTMLElement>('.ms-zs-world');
      if (!rec || !foot || !world) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const slack = foot.getBoundingClientRect().top - rec.getBoundingClientRect().bottom - 8;
      if (Math.abs(slack) < 3) return;
      const next = Math.max(15 * rem, Math.min(22 * rem, world.getBoundingClientRect().height + slack));
      root.style.setProperty('--zs-world-h', `${Math.round(next)}px`);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    for (const el of root.querySelectorAll('.ms-zs-hero, .ms-zs-dfoot, .ms-zs-head')) ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [z.id, lang.value, hard, lockedNow]);

  // ---- Run Options + reward -------------------------------------------------------------------------------------------
  const table = runOptionsTable(content.balance);
  const opts = clampRunOptions(sel.runOptions, table);
  const optReward = runOptionsReward(opts, table);
  const hardMul = hard ? content.balance.hard.reward : 1;
  const rawSum = 1 + OPT_KEYS.reduce((s, k) => s + table[k].rewardWeight * (opts[k] - 1), 0);
  const info: RewardInfo = { table, opts, optReward, hardMul, total: optReward * hardMul, capped: rawSum > table.rewardMax + 1e-9, modified: OPT_KEYS.filter((k) => opts[k] !== 1).length };

  // ---- actions --------------------------------------------------------------------------------------------------------
  const pick = (st: ZoneStatus): void => {
    if (st.zone.id === z.id) return;
    sfx(st.unlocked ? 'tab' : 'click');
    store.select({ zone: st.zone.id });
  };
  const back = (): void => {
    sfx('back');
    store.go('heroSelect');
  };
  const can = meta.canStart(z.id, difficulty);
  const cantText = (reason: string): string =>
    reason === 'zoneLocked' ? t('zone.cant.zoneLocked', { req: reqText(cur) ?? t('common.locked') }) : reason === 'hardLocked' ? t('zone.cant.hardLocked') : t('zone.cant.unknownZone');
  const start = (): void => {
    const c = meta.canStart(z.id, difficulty);
    if (!c.ok) {
      sfx('error');
      pushToast(cantText(c.reason), 'bad');
      return;
    }
    store.select({ zone: z.id, difficulty });
    store.startRun();
  };
  const setDifficulty = (d: Difficulty): void => {
    if (d === 'hard' && !hardOk) {
      sfx('error');
      pushToast(t('zone.hardLockedToast', { zone: tl(z.name) }), 'bad');
      return;
    }
    store.select({ difficulty: d });
  };
  const setOption = (k: (typeof OPT_KEYS)[number], v: number): void => {
    store.select({ runOptions: { ...opts, [k]: v } });
  };
  const cycle = (dir: 1 | -1): void => {
    const i = statuses.findIndex((s) => s.zone.id === z.id);
    const to = statuses[i + dir];
    if (!to) return sfx('error');
    pick(to);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-zone="${to.zone.id}"]`)?.focus({ preventScroll: true }));
  };

  useKeys((a) => {
    const active = document.activeElement;
    const inScope = active instanceof HTMLElement && rootRef.current?.contains(active) === true && active.hasAttribute('data-nav');
    switch (a.kind) {
      case 'cancel':
        back();
        return true;
      case 'confirm':
        if (inScope) return false;
        if (!a.repeat) start();
        return true;
      case 'left':
      case 'right':
        if (active instanceof HTMLElement && active.dataset.zone !== undefined) {
          if (!a.repeat) cycle(a.kind === 'left' ? -1 : 1);
          return true;
        }
        return false;
      default:
        return false;
    }
  }, sheet === null);

  // H toggles Hard (the engine input has no such action)
  useEffect(() => {
    if (sheet !== null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'KeyH' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      setDifficulty(hard ? 'normal' : 'hard');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- view data ------------------------------------------------------------------------------------------------------
  const zs = save.stats.zones[z.id]?.[difficulty];
  const hasRecord = (zs?.bestTime ?? 0) > 0 || (zs?.bestScore ?? 0) > 0;
  const gear = content.balance.hard;
  const finalBoss = enemyName(z.final.boss);
  const art = zoneArtUrl(z);
  const rewardMul = info.total > 1.001 ? t('zone.rewardMul', { n: fixed2(info.total) }) : null;
  // two spellings of the same line: the long sentence, and a short one for the narrow plate of the phone-landscape footer (CSS shows one of them)
  const enterSub = can.ok ? (
    <>
      <span class="ms-zs-sub-long">{[t('zone.awaits', { boss: finalBoss, time: fmtTime(z.final.at) }), rewardMul].filter(Boolean).join(' · ')}</span>
      {/* the short line has no room for the reward multiplier (the plate is ~74 px wide with the side insets: four lines); the long line and the Custom run sheet carry it */}
      <span class="ms-zs-sub-short">{t('zone.awaitsShort', { boss: finalBoss, time: fmtTime(z.final.at) })}</span>
    </>
  ) : (
    <>
      <span class="ms-zs-sub-long">{cantText(can.reason)}</span>
      <span class="ms-zs-sub-short">{t('common.locked')}</span>
    </>
  );
  const mods: { key: string; icon: JSX.Element; short: string; label: string; value: number }[] = [
    { key: 'hp', icon: <UiGlyph name="heart" tone="crimson" flat />, short: t('zone.modShort.hp'), label: t('zone.mod.hp'), value: gear.hp },
    { key: 'damage', icon: <UiGlyph name="flame" tone="bronze" flat />, short: t('zone.modShort.damage'), label: t('zone.mod.damage'), value: gear.damage },
    { key: 'count', icon: <UiGlyph name="skull" tone="ivory" flat />, short: t('zone.modShort.count'), label: t('zone.mod.count'), value: gear.count },
    { key: 'reward', icon: <Glyph name="coin" />, short: t('zone.modShort.reward'), label: t('zone.mod.reward'), value: gear.reward },
  ];

  return (
    <div class={`ms-screen ms-zs ${hard ? 'is-hard' : ''}`} ref={(el) => { rootRef.current = el; scope(el); }}>
      <div class="ms-backdrop ms-zs-bd">
        {art && <img key={z.id} class="ms-zs-bd-art" src={art} alt="" draggable={false} />}
      </div>
      <div class="ms-zs-veil" />
      <EmberField count={10} />

      <Kit contents>
        <header class="ms-zs-head">
          <Button variant="wood" size="small" sound="back" onClick={back} class="ms-zs-back">
            ← {t('common.back')} <KeyHint k="Esc" />
          </Button>
          <div class="ms-zs-title">
            <span class="ms-eyebrow">{t('zone.step', { n: 2, total: 2 })}</span>
            <h1 class="ms-title">{t('zone.title')}</h1>
          </div>
          <span class="ms-zs-head-spacer" />
        </header>

        <ScrollFade class="ms-zs-mainwrap" viewClass="ms-zs-main" cue={false} size="2.4rem">
          <ZoneAtlas statuses={statuses} current={z.id} onPick={pick} onProceed={start} />

          <Panel variant="board" ornate title={t('zone.dossier')} class="ms-zs-dossier" key={z.id}>
            <ScrollFade class="ms-zs-dscroll" viewClass="ms-zs-dbody" size="var(--zs-fade, 2.4rem)" cue={false}>
              <div class="ms-zs-hero" data-zone={z.id}>
                <Painted url={art} class="ms-zs-hero-art" />
                <span class="ms-zs-hero-shade" />
                <div class="ms-zs-hero-body">
                  <span class="ms-eyebrow">{t('zone.chapter', { n: roman(z.order) })}</span>
                  <h2 class="ms-zs-name">{tl(z.name)}</h2>
                  <p class="ms-zs-sub">{tl(z.subtitle)}</p>
                </div>
                <div class="ms-zs-hero-meta">
                  <span class="ms-zs-metarow">
                    <Chip class="ms-zs-chip" icon={<UiGlyph name="star" tone="gold" flat />}>
                      <span {...tipProps(() => <div>{t('zone.levelsTip')}</div>)}>{t('zone.levels', { a: z.levelRange[0], b: z.levelRange[1] })}</span>
                    </Chip>
                    <Chip class="ms-zs-chip ms-zs-chip--gear" icon={<Glyph name="helmet" />}>
                      <span {...tipProps(() => <div>{t('zone.gearTip', { n: z.gearTier })}</div>)}>
                        <span class="ms-zs-gear-long">{t('zone.gear', { n: z.gearTier })}</span>
                        <span class="ms-zs-gear-short">{t('zone.gearShort', { n: z.gearTier })}</span>
                      </span>
                    </Chip>
                    {cur.cleared.normal && (
                      <Chip class="ms-zs-chip ms-zs-chip--done" icon={<UiGlyph name="check" tone="gold" flat />}>
                        {t('zone.cleared')}
                      </Chip>
                    )}
                    {cur.cleared.hard && (
                      <Chip tone="red" class="ms-zs-chip" icon={<UiGlyph name="skull" tone="ivory" flat />}>
                        {t('zone.clearedHard')}
                      </Chip>
                    )}
                  </span>
                  <span class="ms-zs-danger" {...tipProps(() => <div>{t('zone.dangerTip')}</div>)}>
                    <span class="ms-zs-danger-label">{t('zone.danger')}</span>
                    <DangerSkulls n={dangerOf(z)} />
                  </span>
                </div>
                {hard && <HardSeal class="ms-zs-hero-seal" />}
              </div>

              {!cur.unlocked ? (
                <div class="ms-zs-lockbar ms-sunken">
                  <span class="ms-zs-lockbar-seal">
                    <UiGlyph name="lock" tone="pewter" />
                  </span>
                  <div>
                    <b>{t('zone.lockedTitle')}</b>
                    <span>{reqText(cur)}</span>
                  </div>
                </div>
              ) : (
                <div class={`ms-zs-rec ms-sunken ${hasRecord ? '' : 'is-empty'}`} role="group" aria-label={t('zone.records', { mode: t(hard ? 'zone.hard' : 'zone.normal') })}>
                  <span class="ms-zs-rec-title">{t('zone.records', { mode: t(hard ? 'zone.hard' : 'zone.normal') })}</span>
                  <span class="ms-zs-rec-wells" {...(hasRecord ? {} : tipProps(() => <div>{t('zone.noRecord')}</div>))}>
                    <StatWell layout="row" size="sm" label={t('zone.bestTime')} value={hasRecord && zs && zs.bestTime > 0 ? fmtTime(zs.bestTime) : '—'} />
                    <StatWell layout="row" size="sm" label={t('zone.bestScore')} value={hasRecord && zs ? fmtInt(zs.bestScore) : '—'} tone={hasRecord ? 'gold' : 'neutral'} />
                    <StatWell layout="row" size="sm" label={t('zone.bestLevel')} value={hasRecord && zs ? fmtInt(zs.bestLevel) : '—'} />
                  </span>
                </div>
              )}

              <Section title={t('zone.timeline')} class="ms-zs-sec-tl">
                <Timeline zone={z} />
              </Section>

              <Section title={t('zone.metins')}>
                <Metins zone={z} />
              </Section>

              <div class="ms-zs-two">
                <Section title={t('zone.chronicle')} class="ms-zs-two-story">
                  <Chronicle zone={z} onOpen={() => setSheet('story')} />
                </Section>
                <Section title={t('zone.roster')} class="ms-zs-two-foes">
                  <Roster zone={z} />
                </Section>
              </div>
            </ScrollFade>

            <footer class="ms-zs-dfoot">
              <div class="ms-zs-diff">
                <div class="ms-zs-diffbox">
                  <span class="ms-zs-label">{t('zone.difficulty')}</span>
                  <DiffSeg
                    value={difficulty}
                    onChange={setDifficulty}
                    hardOk={hardOk}
                    hardTip={() => <TipBody title={t('zone.hard')} body={hardOk ? t('zone.hardTip') : hardReq()} rows={hardOk ? mods.map((m) => ({ label: m.label, value: `×${fmtDec(m.value, 2)}` })) : []} />}
                  />
                </div>
                <div class={`ms-zs-mods ${hard ? 'is-on' : 'is-preview'}`} role="group" aria-label={t('zone.hardMods')}>
                  {mods.map((m) => (
                    <span key={m.key} class="ms-zs-mod" {...tipProps(() => <TipBody title={m.label} body={t('zone.hardModTip', { n: fmtDec(m.value, 2) })} />)}>
                      <StatWell layout="stack" size="sm" label={m.short} icon={m.icon} value={`×${fmtDec(m.value, 2)}`} tone={hard ? 'bad' : 'neutral'} />
                    </span>
                  ))}
                </div>
                <Button variant="wood" size="small" class="ms-zs-optbtn" active={info.modified > 0} title={t('zone.opt.title')} onClick={() => setSheet('opts')}>
                  <span class="ms-zs-optrow">
                    <UiGlyph name="gear" tone={info.modified > 0 ? 'gold' : 'pewter'} flat /> <span class="ms-zs-optlabel">{t('zone.opt.title')}</span>
                  </span>
                  <span class="ms-zs-optbadge ms-num">{info.modified > 0 ? `×${fixed2(info.total)}` : t('zone.opt.standard')}</span>
                </Button>
              </div>
              <div class="ms-zs-enter">
                <div class={`ms-zs-cta ms-plate ${hard ? 'is-hard' : ''} ${can.ok ? '' : 'is-off'}`}>
                  <i class="ms-zs-rivet is-tl" aria-hidden="true" />
                  <i class="ms-zs-rivet is-tr" aria-hidden="true" />
                  <i class="ms-zs-rivet is-bl" aria-hidden="true" />
                  <i class="ms-zs-rivet is-br" aria-hidden="true" />
                  <Button size="big" danger={hard} disabled={!can.ok} onClick={start} sound="confirm" sub={enterSub}>
                    <span class="ms-zs-ent-long">{t('zone.enter', { zone: tl(z.name) })}</span>
                    <span class="ms-zs-ent-short">{t('zone.enterShort')}</span> <KeyHint k="Enter" />
                  </Button>
                </div>
              </div>
            </footer>
          </Panel>
        </ScrollFade>

        <div class="ms-zs-hint">
          <span>
            <KeyHint k="←" />
            <KeyHint k="→" /> {t('zone.hint.zone')}
          </span>
          <span>
            <KeyHint k="H" /> {t('zone.hint.hard')}
          </span>
        </div>
        <div class="ms-zs-hint ms-zs-hint--touch">{t('zone.hint.touch')}</div>

        {sheet === 'opts' && (
          <RunOptionsSheet
            info={info}
            hard={hard}
            onChange={setOption}
            onReset={() => {
              sfx('click');
              store.select({ runOptions: { ...NO_OPTIONS } });
            }}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'story' && <ChronicleSheet zone={z} onClose={() => setSheet(null)} />}
      </Kit>
    </div>
  );
}
