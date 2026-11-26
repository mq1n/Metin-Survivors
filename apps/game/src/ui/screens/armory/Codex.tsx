// Armory · Codex: the chronicle of everything the player has met — Bestiary (enemies + bosses by zone), Metin lore (stones
// with rune-coloured glow) and the Story (prologue, zone chapters, lore entries on parchment). Locked entries show the
// condition that unlocks them. With awakening pacts on (balance.pacts, R1) a fourth page, Pacts, lists which passive awakens which
// skill of the viewed hero (CX-01): the plan of a build outside the moment of choice. All four pages live in the shared armoryCodexSub signal.
import { signal } from '@preact/signals';
import type { JSX, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BehaviorKind, BossDef, ClassId, ContentDB, EnemyDef, EnemyRank, PassiveDef, Rarity, RaceTag, SkillDef, ZoneDef, Element, MetinDef, MetinModifier } from '../../../data/schema';
import { fmtDec, fmtInt, fmtPct, fmtTime, t, tl } from '../../../i18n/i18n';
import { codexEntries, isZoneUnlocked, type CodexCondition, type CodexEntryView, type SaveData } from '../../../meta';
import { iconUrl, metinArtUrl } from '../../assets';
import { pactNeedRank, pactRules } from '../../cardModel';
import { sfx } from '../../audio';
import { Tabs } from '../../components/Button';
import { Glyph, type GlyphName } from '../../components/glyphs';
import { useScrollFade } from '../../components/ScrollFade';
import { Bar, IconSlot } from '../../components/Slot';
import { StatWell } from '../../components/StatWell';
import { UiGlyph } from '../../components/StatIcon';
import { TipBody, tipProps } from '../../components/Tooltip';
import { className, enemyName, indexOf, metinName, skillDescription, statModRows, zoneName } from '../../content';
import { deps } from '../../env';
import { buildTip, gearRarity } from '../../itemTips';
import { layout } from '../../layout';
import { metaSave } from '../../view';
import { showDrops } from './Collection';
import { armoryClass, armoryCodexSub, type CodexSub } from './state';
import { BeastFace, DataStrip, Plate, type FaceSize } from './Art';
import { Win } from './Win';
import './armory-cdx.css';

/**
 * The detail sheet of a codex tab: the scroller is ONE element for the whole tab (useScrollFade keeps hold of it, so a `key` on the scroller itself
 * would leave every later selection without its edge fade); the content inside is keyed per selection, replays its fade-in and starts at the top.
 */
function useDetailScroll(selId: string): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useScrollFade(ref);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [selId]);
  return ref;
}

const RACE_GLYPH: Record<RaceTag, GlyphName> = {
  animal: 'wolf',
  orc: 'fist',
  esoteric: 'talisman',
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
const RACE_ELEMENT: Record<RaceTag, Element> = {
  animal: 'physical',
  orc: 'fire',
  esoteric: 'dark',
  undead: 'poison',
  devil: 'fire',
  insect: 'poison',
  desert: 'holy',
  ice: 'ice',
  fire: 'fire',
  dragon: 'fire',
  human: 'physical',
  metin: 'lightning',
};
const RANK_RARITY: Record<EnemyRank, Rarity> = { pawn: 'common', pawnElite: 'uncommon', knight: 'rare', knightElite: 'epic', boss: 'legendary', king: 'legendary' };

/** Creature silhouette glyph: keyword match on the id first (bear → claw, archer → bow …), then the primary race. */
const BEAST_KEYWORDS: readonly [RegExp, GlyphName][] = [
  [/archer|bow|hunter/, 'bow'],
  [/bear|grizzly|tiger|claw|panther|lion/, 'claw'],
  [/wolf|dog|fox|nine_tail/, 'wolf'],
  [/boar|pig|bull|ox/, 'fist'],
  [/ghost|skeleton|dead|corpse|zombie|undead|wraith|ghoul/, 'skull'],
  [/golem|stone|rock|statue/, 'stone'],
  [/dragon|drake|serpent|snake/, 'dragon'],
  [/shaman|mystic|sorcer|priest|wizard|witch|mage/, 'talisman'],
  [/fire|flame|ember|lava|inferno/, 'flame'],
  [/\bice|frost|snow|yeti/, 'frost'],
  [/scorpion|spider|bug|insect|ant|bee/, 'drop'],
  [/soldier|swordsman|warrior|general|commander|knight|captain|guard/, 'sword'],
];

function beastGlyph(def: EnemyDef): GlyphName {
  for (const [re, glyph] of BEAST_KEYWORDS) if (re.test(def.id)) return glyph;
  return RACE_GLYPH[def.race[0] ?? 'animal'];
}

/** Creature portrait: the shipped `icon_enemy_<id>` card (every enemy and boss has one), else the painted ring with the creature glyph. */
function Portrait({ def, size, rarity, locked }: { def: EnemyDef; size: FaceSize; rarity?: Rarity; locked?: boolean }): JSX.Element {
  // a locked entry shows the shipped card back (`icon_enemy_unknown`), never the dimmed face of the real monster
  const cardId = locked === true && iconUrl('icon_enemy_unknown') !== null ? 'icon_enemy_unknown' : `icon_enemy_${def.id}`;
  if (iconUrl(cardId) !== null) {
    const race = def.race[0] ?? 'animal';
    return (
      <IconSlot
        size={size === 'sm' ? 'sm' : size === 'md' ? 'md' : size === 'lg' ? 'lg' : 'xl'}
        icon={cardId}
        kind="misc"
        glyph={beastGlyph(def)}
        element={RACE_ELEMENT[race]}
        {...(rarity && !locked ? { rarity } : {})}
        locked={locked === true && cardId !== 'icon_enemy_unknown'}
      />
    );
  }
  return <BeastFace size={size} {...(rarity && !locked ? { rarity } : {})} locked={locked === true} fallback={<Glyph name={beastGlyph(def)} />} />;
}

/** Human sentence for the unlock rule of a locked codex entry. */
function unlockHint(cond: CodexCondition): string {
  switch (cond.kind) {
    case 'always':
      return t('armory.codex.hint.always');
    case 'enter':
      return t('armory.codex.hint.enter', { zone: zoneName(cond.zone) });
    case 'clear':
      return t(cond.difficulty === 'hard' ? 'armory.codex.hint.clearHard' : 'armory.codex.hint.clear', { zone: zoneName(cond.zone) });
    case 'boss':
      return t('armory.codex.hint.boss', { name: enemyName(cond.boss) });
    case 'metin':
      return t('armory.codex.hint.metin', { name: metinName(cond.metin) });
    case 'class':
      return t('armory.codex.hint.class', { name: className(cond.classId) });
    case 'level':
      return t('armory.codex.hint.level', { n: fmtInt(cond.n) });
    case 'wins':
      return t('armory.codex.hint.wins', { n: fmtInt(cond.n) });
    case 'runs':
      return t('armory.codex.hint.runs', { n: fmtInt(cond.n) });
    case 'kills':
      return t('armory.codex.hint.kills', { n: fmtInt(cond.n) });
    case 'unknown':
      return t('armory.codex.hint.unknown');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bestiary

interface ZoneRoster {
  zone: ZoneDef;
  bosses: BossDef[];
  enemies: EnemyDef[];
}

function buildRoster(content: ContentDB): ZoneRoster[] {
  const ix = indexOf(content);
  const placed = new Set<string>();
  return ix.zonesOrdered.map((zone) => {
    const ids: string[] = [];
    const add = (id: string | undefined): void => {
      if (id && !placed.has(id) && ix.enemies.has(id)) {
        placed.add(id);
        ids.push(id);
      }
    };
    for (const band of zone.bands) {
      for (const sp of band.spawns) {
        add(sp.enemy);
        add(sp.group?.leader);
        sp.group?.members.forEach(add);
      }
      band.elites?.pool.forEach(add);
    }
    const bossIds = [...zone.bosses].sort((a, b) => a.at - b.at).map((b) => b.boss);
    if (!bossIds.includes(zone.final.boss)) bossIds.push(zone.final.boss);
    const bosses = bossIds.map((id) => ix.bosses.get(id)).filter((b): b is BossDef => b !== undefined);
    const enemies = ids.map((id) => ix.enemies.get(id)).filter((e): e is EnemyDef => e !== undefined).sort((a, b) => a.level - b.level || a.hp - b.hp);
    return { zone, bosses, enemies };
  });
}

interface BeastRef {
  kind: 'enemy' | 'boss';
  id: string;
}

function BeastTile({ def, boss, seen, active, onPick }: { def: EnemyDef; boss: boolean; seen: boolean; active: boolean; onPick: () => void }): JSX.Element {
  const rarity = RANK_RARITY[def.rank];
  const race = def.race[0] ?? 'animal';
  return (
    <button
      type="button"
      class={`ms-cdx-tile ms-plate ms-r-${rarity} ${seen ? 'is-seen' : 'is-locked'} ${active ? 'is-active' : ''} ${boss ? 'is-boss' : ''}`}
      data-nav=""
      aria-pressed={active}
      onClick={onPick}
      {...tipProps(() => (seen ? <TipBody title={enemyName(def.id)} sub={`${t(`armory.rank.${def.rank}`)} · ${t('common.level', { n: def.level })}`} /> : <TipBody title={t('armory.codex.unknown')} body={t('armory.codex.unseen')} />), seen ? { rarity } : {})}
    >
      <Portrait def={def} size={boss ? 'md' : 'sm'} rarity={rarity} locked={!seen} />
      <span class="ms-cdx-tile-text">
        <b class={seen ? 'ms-rc' : ''}>{seen ? enemyName(def.id) : t('armory.codex.unknown')}</b>
        <small>{seen ? `${t('common.level', { n: def.level })} · ${t(`race.${race}`)}` : t('armory.codex.unseenShort')}</small>
      </span>
      {boss && seen && <UiGlyph name="crown" tone="gold" flat class="ms-cdx-tile-crown" />}
    </button>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }): JSX.Element {
  return <StatWell layout="row" size="sm" label={label} value={value} {...(tone === 'good' ? { tone: 'good' as const } : tone === 'bad' ? { tone: 'bad' as const } : {})} class="ms-cdx-kv" />;
}

function LoreBox({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div class="ms-cdx-lore ms-tray">
      <i class="ms-cdx-lore-sw is-tl" aria-hidden="true" />
      <i class="ms-cdx-lore-sw is-br" aria-hidden="true" />
      <h4 class="ms-cdx-lore-title">{title}</h4>
      <i class="ms-cdx-lore-rule" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

function BeastDetail({ def, boss, view, kills, classId }: { def: EnemyDef; boss: BossDef | undefined; view: CodexEntryView | undefined; kills: number; classId: ClassId }): JSX.Element {
  const { content } = deps();
  const save = metaSave().value;
  const seen = view?.unlocked ?? true;
  const rarity = RANK_RARITY[def.rank];
  const race = def.race[0] ?? 'animal';
  const zone = content.zones.find((z) => z.bosses.some((b) => b.boss === def.id) || z.final.boss === def.id || z.bands.some((b) => b.spawns.some((s) => s.enemy === def.id || s.group?.members.includes(def.id) || s.group?.leader === def.id) || b.elites?.pool.includes(def.id)));

  if (!seen) {
    return (
      <div class="ms-cdx-detail-locked">
        <Portrait def={def} size="xl" locked />
        <h3 class="ms-head">{t('armory.codex.unknown')}</h3>
        <p class="ms-muted">{t('armory.codex.unseen')}</p>
        {view && (
          <p class="ms-cdx-hint">
            <UiGlyph name="lock" tone="pewter" flat /> {unlockHint(view.condition)}
          </p>
        )}
      </div>
    );
  }
  const drops = boss ? content.gear.filter((g) => g.source.boss === boss.id && g.classes.includes(classId)) : [];
  const owned = new Set(save.classes[classId].collection);
  return (
    <div class="ms-cdx-detail-body">
      <header class="ms-cdx-detail-head">
        <Portrait def={def} size="xl" rarity={rarity} />
        <div class="ms-cdx-detail-id">
          <h3 class="ms-title">{enemyName(def.id)}</h3>
          {boss && <p class="ms-cdx-boss-title">{tl(boss.title)}</p>}
          <DataStrip
            class="ms-cdx-strip"
            items={[
              { key: 'rank', text: t(`armory.rank.${def.rank}`), cls: `ms-r-${rarity} ms-rc` },
              { key: 'lv', text: t('common.level', { n: def.level }), num: true },
              ...def.race.map((r) => ({ key: r, icon: <Glyph name={RACE_GLYPH[r]} />, text: t(`race.${r}`) })),
            ]}
          />
          <DataStrip
            class="ms-cdx-strip"
            items={[
              ...(zone ? [{ key: 'zone', text: tl(zone.name), tone: 'gold' as const }] : []),
              ...(boss ? [{ key: 'kills', icon: <UiGlyph name="skull" tone={kills > 0 ? 'gold' : 'pewter'} flat />, text: kills > 0 ? t('armory.drops.defeated', { n: fmtInt(kills) }) : t('armory.drops.notDefeated'), tone: kills > 0 ? ('gold' as const) : ('dim' as const) }] : []),
            ]}
          />
        </div>
      </header>

      {boss && <p class="ms-cdx-intro ms-lore">“{tl(boss.intro)}”</p>}

      <div class="ms-cdx-statgrid">
        <KV label={t('stat.hp')} value={fmtInt(def.hp)} />
        <KV label={t('stat.damage')} value={fmtDec(def.damage, 1)} />
        <KV label={t('stat.moveSpeed')} value={`${fmtDec(def.speed, 1)} ${t('stat.speedUnit')}`} />
        <KV label={t('armory.codex.xp')} value={fmtInt(def.xp)} />
        <KV label={t('hud.yeop')} value={`${fmtInt(def.yeop[0])}–${fmtInt(def.yeop[1])}`} />
        <KV label={t('armory.codex.ai')} value={t(`armory.ai.${def.ai}`)} />
      </div>

      {def.resist && Object.keys(def.resist).length > 0 && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('armory.codex.resists')}</div>
          <DataStrip
            items={Object.entries(def.resist).flatMap(([el, v]) => (v ? [{ key: el, text: `${t(`element.${el}`)} ${v > 0 ? '+' : '−'}${fmtPct(Math.abs(v), 0)}`, tone: v > 0 ? ('neutral' as const) : ('red' as const), num: true }] : []))}
          />
        </section>
      )}

      {view && <LoreBox title={tl(view.entry.title)} text={tl(view.entry.text)} />}

      {def.attacks.length > 0 && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('armory.codex.attacks')}</div>
          <ul class="ms-cdx-list">
            {def.attacks.map((a, i) => (
              <li key={i}>
                <b>{t(`armory.atk.${a.kind}`)}</b>
                <span class="ms-muted">
                  {fmtDec(a.range, 1)} m · {t('armory.codex.every', { s: fmtDec(a.cooldown, 1) })}
                  {a.windup > 0 ? ` · ${t('armory.codex.windup', { s: fmtDec(a.windup, 1) })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {boss && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('armory.codex.phases')}</div>
          <ul class="ms-cdx-list">
            {boss.phases.map((ph, i) => (
              <li key={i}>
                <b>{t('hud.boss.phase', { n: i + 1 })}</b>
                <span class="ms-muted">
                  {i === 0 ? t('armory.codex.phaseStart') : t('armory.codex.phaseAt', { pct: fmtPct(ph.hpPct, 0) })} ·{' '}
                  {[...new Set(ph.patterns.map((id) => boss.patterns.find((p) => p.id === id)?.kind).filter((k): k is NonNullable<typeof k> => k !== undefined))].map((k) => t(`armory.pat.${k}`)).join(', ')}
                </span>
              </li>
            ))}
            <li>
              <b>{t('hud.boss.enraged')}</b>
              <span class="ms-muted">{t('armory.codex.enrageAfter', { time: fmtTime(boss.enrageAfter) })}</span>
            </li>
          </ul>
          {boss.escorts && boss.escorts.length > 0 && (
            <p class="ms-cdx-escorts ms-muted">
              {t('armory.codex.escorts')}: {[...new Set(boss.escorts)].map((id) => enemyName(id)).join(', ')}
            </p>
          )}
        </section>
      )}

      {drops.length > 0 && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('armory.codex.drops', { name: className(classId) })}</div>
          <div class="ms-cdx-drops">
            {drops.map((g) => {
              const have = owned.has(g.id);
              const r = gearRarity(g.tier);
              return (
                <IconSlot
                  key={g.id}
                  size="md"
                  icon={g.icon}
                  kind="gear"
                  slot={g.slot}
                  {...(have ? { rarity: r } : {})}
                  locked={!have}
                  class="ms-col-tile"
                  onClick={() => showDrops(g.source.zone)}
                  {...tipProps(() => buildTip({ type: 'gear', id: g.id }), { rarity: r })}
                />
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}

function Bestiary(): JSX.Element {
  const { content } = deps();
  const save = metaSave().value;
  const classId = armoryClass.value;
  const roster = useMemo(() => buildRoster(content), [content]);
  const views = useMemo(() => new Map(codexEntries(save, content).map((v) => [v.entry.id, v])), [save, content]);
  const [filter, setFilter] = useState<string>('all');
  const first = roster[0]?.bosses[0];
  const [sel, setSel] = useState<BeastRef | null>(first ? { kind: 'boss', id: first.id } : null);
  const detailRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  const ix = indexOf();

  const zones = filter === 'all' ? roster : roster.filter((r) => r.zone.id === filter);
  const total = roster.reduce((n, r) => n + r.bosses.length + r.enemies.length, 0);
  const seenCount = roster.reduce((n, r) => n + r.bosses.filter((b) => views.get(`codex_boss_${b.id}`)?.unlocked ?? true).length + r.enemies.filter((e) => views.get(`codex_enemy_${e.id}`)?.unlocked ?? true).length, 0);
  const detailScroll = useDetailScroll(sel?.id ?? 'none');
  const selDef = sel ? (sel.kind === 'boss' ? ix.bosses.get(sel.id) : ix.enemies.get(sel.id)) : undefined;
  const selBoss = sel?.kind === 'boss' ? ix.bosses.get(sel.id) : undefined;
  const pick = (ref: BeastRef): void => {
    sfx('click');
    setSel(ref);
    if (layout.value.portrait || layout.value.compact) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div class="ms-cdx-split">
      <section class="ms-cdx-listpanel ms-sunken ms-sunken--plain">
        <div class="ms-cdx-listhead">
          <div class="ms-cdx-filter ms-edgefade ms-edgefade--x" role="radiogroup" aria-label={t('armory.codex.filter')}>
            {[{ key: 'all', label: t('common.all') }, ...roster.map((r) => ({ key: r.zone.id, label: tl(r.zone.name) }))].map((o) => (
              <Plate key={o.key} on={filter === o.key} onClick={() => setFilter(o.key)}>
                {o.label}
              </Plate>
            ))}
          </div>
          <StatWell size="sm" value={t('armory.codex.seen', { n: fmtInt(seenCount), total: fmtInt(total) })} class="ms-cdx-count" />
        </div>
        <div class="ms-cdx-list-scroll ms-scroll" ref={listRef}>
          {zones.map((r) => (
            <div class="ms-cdx-zone" key={r.zone.id}>
              <h3 class="ms-cdx-zone-title ms-head">{tl(r.zone.name)}</h3>
              <div class="ms-cdx-grid">
                {r.bosses.map((b, i) => (
                  <div class="ms-cdx-cell" style={{ '--i': i } as JSX.CSSProperties} key={b.id}>
                    <BeastTile def={b} boss seen={views.get(`codex_boss_${b.id}`)?.unlocked ?? true} active={sel?.id === b.id} onPick={() => pick({ kind: 'boss', id: b.id })} />
                  </div>
                ))}
              </div>
              <div class="ms-cdx-grid">
                {r.enemies.map((e, i) => (
                  <div class="ms-cdx-cell" style={{ '--i': Math.min(i, 14) + 4 } as JSX.CSSProperties} key={e.id}>
                    <BeastTile def={e} boss={false} seen={views.get(`codex_enemy_${e.id}`)?.unlocked ?? true} active={sel?.id === e.id} onPick={() => pick({ kind: 'enemy', id: e.id })} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section class="ms-cdx-detail ms-sunken ms-sunken--framed" ref={detailRef}>
        <div class="ms-cdx-detail-scroll ms-scroll" ref={detailScroll}>
          <div class="ms-cdx-detail-in" key={sel?.id ?? 'none'}>
            {selDef ? <BeastDetail def={selDef} boss={selBoss} view={views.get(`${sel?.kind === 'boss' ? 'codex_boss_' : 'codex_enemy_'}${selDef.id}`)} kills={selBoss ? (save.stats.bossKills[selBoss.id] ?? 0) : 0} classId={classId} /> : <p class="ms-muted ms-cdx-pickme">{t('armory.codex.pick')}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Metin lore

/** [hue°, saturation 0..1, lightness 0..1] of a #rrggbb colour. */
function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

/** The painted Metin stone, hue-shifted from its native orange glow to the rune colour. */
function MetinStone({ def, locked, class: cls }: { def: MetinDef; locked?: boolean; class?: string }): JSX.Element {
  const url = metinArtUrl(def.id);
  const [h, s, l] = hsl(def.rune);
  const filter = `hue-rotate(${Math.round(h - 28)}deg) saturate(${Math.max(0.35, Math.min(1.3, s / 0.85)).toFixed(2)}) brightness(${l > 0.7 ? 1.25 : 1}) drop-shadow(0 0 0.7rem ${def.rune})`;
  return (
    <span class={`ms-cdx-stone ${locked ? 'is-locked' : ''} ${cls ?? ''}`} style={{ '--rune': def.rune } as JSX.CSSProperties}>
      <i class="ms-cdx-stone-glow" />
      {url ? <img src={url} alt="" draggable={false} style={locked ? undefined : { filter }} /> : <Glyph name="stone" style={{ color: def.rune }} />}
    </span>
  );
}

const MOD_PARAMS: Record<MetinModifier, string[]> = {
  slowAura: ['radius', 'slow'],
  extraSwarm: ['radius', 'swarmMul'],
  summonElite: ['radius', 'every'],
  yeopRain: ['radius', 'every', 'value'],
  darkness: ['radius', 'strength'],
  flicker: ['radius', 'period'],
  fireRing: ['ringRadius', 'damage', 'radius'],
  poisonField: ['patches', 'damage', 'radius'],
  damageAura: ['radius', 'dps'],
};

function modifierText(def: MetinDef): string {
  const p = def.modParams;
  const params: Record<string, string> = {};
  for (const k of MOD_PARAMS[def.modifier]) {
    const v = p[k] ?? 0;
    params[k] = k === 'slow' || k === 'strength' ? fmtPct(v, 0) : fmtDec(v, 1);
  }
  return t(`armory.mod.${def.modifier}`, params);
}

function MetinDetail({ def, broken, view }: { def: MetinDef; broken: number; view: CodexEntryView | undefined }): JSX.Element {
  const locked = broken === 0 && !(view?.unlocked ?? false);
  const rw = def.rewards;
  if (locked) {
    return (
      <div class="ms-cdx-detail-locked">
        <MetinStone def={def} locked class="is-xl" />
        <h3 class="ms-head">{t('armory.codex.unknown')}</h3>
        <p class="ms-muted">{t('armory.codex.metinLocked')}</p>
        {view && (
          <p class="ms-cdx-hint">
            <UiGlyph name="lock" tone="pewter" flat /> {unlockHint(view.condition)}
          </p>
        )}
      </div>
    );
  }
  return (
    <div class="ms-cdx-detail-body">
      <header class="ms-cdx-detail-head ms-cdx-detail-head--metin">
        <MetinStone def={def} class="is-xl" />
        <div class="ms-cdx-detail-id">
          <h3 class="ms-title" style={{ color: def.rune }}>
            {tl(def.name)}
          </h3>
          <DataStrip
            class="ms-cdx-strip"
            items={[
              ...(def.great ? [{ key: 'great', icon: <UiGlyph name="crown" tone="gold" flat />, text: t('armory.codex.great'), tone: 'gold' as const }] : []),
              { key: 'rune', icon: <i class="ms-cdx-rune-dot" style={{ background: def.rune }} />, text: t('armory.codex.rune') },
              { key: 'broken', text: t('armory.codex.broken', { n: fmtInt(broken) }), tone: broken > 0 ? ('gold' as const) : ('dim' as const), num: true },
            ]}
          />
        </div>
      </header>
      <p class="ms-cdx-intro ms-lore">“{tl(def.lore)}”</p>
      <section class="ms-cdx-sec">
        <div class="ms-eyebrow">{t('armory.codex.aura')}</div>
        <p class="ms-cdx-mod">{modifierText(def)}</p>
      </section>
      <div class="ms-cdx-statgrid">
        <KV label={t('stat.hp')} value={fmtInt(def.hp)} />
        <KV label={t('armory.codex.awakens')} value={def.great ? t('armory.codex.never') : fmtTime(def.awakenAfter)} />
        <KV label={t('armory.codex.essence')} value={fmtInt(rw.essence)} />
        <KV label={t('hud.yeop')} value={`${fmtInt(rw.yeop[0])}–${fmtInt(rw.yeop[1])}`} />
        <KV label={t('hud.shards')} value={fmtInt(rw.shards)} />
        <KV label={t('armory.codex.chest')} value={fmtPct(rw.chestChance, 0)} />
      </div>
      <section class="ms-cdx-sec">
        <div class="ms-eyebrow">{t('armory.codex.swarm')}</div>
        <p class="ms-muted">
          {t('armory.codex.swarmText', { count: fmtInt(def.swarm.count), every: fmtDec(def.swarm.every, 0) })} {[...new Set(def.swarm.enemies)].map((id) => enemyName(id)).join(', ')}
        </p>
      </section>
      {view && view.unlocked && <LoreBox title={tl(view.entry.title)} text={tl(view.entry.text)} />}
    </div>
  );
}

function MetinLore(): JSX.Element {
  const { content } = deps();
  const save = metaSave().value;
  const views = useMemo(() => new Map(codexEntries(save, content).map((v) => [v.entry.id, v])), [save, content]);
  const list = [...content.metins].sort((a, b) => Number(a.great === true) - Number(b.great === true) || a.hp - b.hp);
  const [sel, setSel] = useState<string>(list[0]?.id ?? '');
  const detailRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  const detailScroll = useDetailScroll(sel);
  const def = list.find((m) => m.id === sel);
  const brokenOf = (id: string): number => save.stats.metinKinds[id] ?? 0;
  const known = list.filter((m) => brokenOf(m.id) > 0).length;
  return (
    <div class="ms-cdx-split">
      <section class="ms-cdx-listpanel ms-sunken ms-sunken--plain">
        <div class="ms-cdx-listhead">
          <span class="ms-eyebrow">{t('armory.codex.metinsTitle')}</span>
          <StatWell size="sm" value={t('armory.codex.seen', { n: fmtInt(known), total: fmtInt(list.length) })} class="ms-cdx-count" />
        </div>
        <div class="ms-cdx-list-scroll ms-scroll" ref={listRef}>
          <div class="ms-cdx-metins">
            {list.map((m, i) => {
              const n = brokenOf(m.id);
              const seen = n > 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  class={`ms-cdx-metin ms-plate ${m.id === sel ? 'is-active' : ''} ${seen ? '' : 'is-locked'} ${m.great ? 'is-great' : ''}`}
                  style={{ '--i': i, '--rune': m.rune } as JSX.CSSProperties}
                  data-nav=""
                  aria-pressed={m.id === sel}
                  onClick={() => {
                    sfx('click');
                    setSel(m.id);
                    if (layout.value.portrait || layout.value.compact) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                  }}
                  {...tipProps(() => (seen ? <TipBody title={tl(m.name)} sub={m.great ? t('armory.codex.great') : undefined} body={modifierText(m)} rows={[{ label: t('armory.codex.brokenLabel'), value: fmtInt(n) }]} /> : <TipBody title={t('armory.codex.unknown')} body={t('armory.codex.metinLocked')} />))}
                >
                  <MetinStone def={m} locked={!seen} />
                  <b class="ms-cdx-metin-name">{seen ? tl(m.name) : t('armory.codex.unknown')}</b>
                  <small class="ms-num">{seen ? t('armory.codex.broken', { n: fmtInt(n) }) : t('armory.codex.unseenShort')}</small>
                  {m.great && seen && <UiGlyph name="crown" tone="gold" flat class="ms-cdx-tile-crown" />}
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <section class="ms-cdx-detail ms-sunken ms-sunken--framed" ref={detailRef}>
        <div class="ms-cdx-detail-scroll ms-scroll" ref={detailScroll}>
          <div class="ms-cdx-detail-in" key={sel}>
            {def ? <MetinDetail def={def} broken={brokenOf(def.id)} view={views.get(`codex_metin_${def.id}`)} /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Story

interface StoryItem {
  id: string;
  group: 'chronicle' | 'lore';
  title: string;
  unlocked: boolean;
  hint: string;
  body: string[];
}

function buildStory(content: ContentDB, save: SaveData): StoryItem[] {
  const items: StoryItem[] = [
    { id: 'prologue', group: 'chronicle', title: t('armory.story.prologue'), unlocked: true, hint: '', body: content.story.prologue.map((p) => tl(p)) },
  ];
  content.story.chapters.forEach((ch, i) => {
    const open = isZoneUnlocked(save, content, ch.zone);
    items.push({ id: `chapter_${ch.zone}`, group: 'chronicle', title: `${t('armory.story.chapter', { n: i + 1 })} · ${tl(ch.title)}`, unlocked: open, hint: t('armory.codex.hint.reachZone', { zone: zoneName(ch.zone) }), body: ch.text.map((p) => tl(p)) });
  });
  for (const v of codexEntries(save, content)) {
    if (!v.entry.id.startsWith('codex_lore_')) continue;
    items.push({ id: v.entry.id, group: 'lore', title: tl(v.entry.title), unlocked: v.unlocked, hint: unlockHint(v.condition), body: [tl(v.entry.text)] });
  }
  return items;
}

function StoryTab(): JSX.Element {
  const { content } = deps();
  const save = metaSave().value;
  const items = useMemo(() => buildStory(content, save), [content, save]);
  const [sel, setSel] = useState<string>('prologue');
  const detailRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  const cur = items.find((i) => i.id === sel) ?? items[0];
  const detailScroll = useDetailScroll(cur?.id ?? 'none');
  const open = items.filter((i) => i.unlocked).length;
  const all = codexEntries(save, content);
  const allOpen = all.filter((v) => v.unlocked).length;
  const groups: { id: StoryItem['group']; title: string }[] = [
    { id: 'chronicle', title: t('armory.story.chronicle') },
    { id: 'lore', title: t('armory.story.lore') },
  ];
  return (
    <div class="ms-cdx-split ms-cdx-split--story">
      <section class="ms-cdx-listpanel ms-sunken ms-sunken--plain">
        <div class="ms-cdx-listhead">
          <span class="ms-eyebrow">{t('armory.story.title')}</span>
          <StatWell size="sm" value={t('armory.codex.seen', { n: fmtInt(open), total: fmtInt(items.length) })} class="ms-cdx-count" />
        </div>
        <div class="ms-cdx-list-scroll ms-scroll" ref={listRef}>
          {groups.map((g) => (
            <div class="ms-cdx-zone" key={g.id}>
              <h3 class="ms-cdx-zone-title ms-head">{g.title}</h3>
              <div class="ms-cdx-story-list">
                {items
                  .filter((i) => i.group === g.id)
                  .map((i, n) => (
                    <button
                      key={i.id}
                      type="button"
                      class={`ms-cdx-story ms-plate ${i.id === cur?.id ? 'is-active' : ''} ${i.unlocked ? '' : 'is-locked'}`}
                      style={{ '--i': Math.min(n, 14) } as JSX.CSSProperties}
                      data-nav=""
                      aria-pressed={i.id === cur?.id}
                      onClick={() => {
                        sfx('click');
                        setSel(i.id);
                        if (layout.value.portrait || layout.value.compact) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                      }}
                      {...tipProps(() => (i.unlocked ? <TipBody title={i.title} /> : <TipBody title={t('armory.codex.unknown')} body={i.hint} />))}
                    >
                      <UiGlyph name={i.unlocked ? (g.id === 'chronicle' ? 'book' : 'star') : 'lock'} tone={i.unlocked ? 'gold' : 'pewter'} flat />
                      <span>{i.unlocked ? i.title : t('armory.codex.unknown')}</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <div class="ms-cdx-listfoot">
          <Bar thin value={all.length > 0 ? allOpen / all.length : 0} variant="xp" />
          <small class="ms-muted ms-num">{t('armory.story.totalEntries', { n: fmtInt(allOpen), total: fmtInt(all.length) })}</small>
        </div>
      </section>
      <section class="ms-cdx-detail ms-cdx-reading" ref={detailRef}>
        <div class="ms-cdx-detail-scroll ms-scroll" ref={detailScroll}>
          <div class="ms-cdx-detail-in" key={cur?.id ?? 'none'}>
            {cur && cur.unlocked ? (
              <article class="ms-cdx-article">
                <h2 class="ms-cdx-article-title">{cur.title}</h2>
                <div class="ms-cdx-rule" />
                {cur.body.map((p, i) => (
                  <p key={i} style={{ '--i': i } as JSX.CSSProperties}>
                    {p}
                  </p>
                ))}
              </article>
            ) : (
              <div class="ms-cdx-detail-locked ms-cdx-detail-locked--paper">
                <UiGlyph name="lock" tone="pewter" />
                <h3 class="ms-head">{t('armory.codex.unknown')}</h3>
                <p class="ms-cdx-hint">{cur?.hint}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Pacts (R1, CX-01): the awakening pacts of balance.pacts as a planning reference. A skill awakens (rank P) only while the passive
// balance.pacts.byBehavior[its behaviour] is held at least at the pact rank (capped at that passive's own max rank). The rule is the sim's
// (sim/cards.ts pactNeed); its one display twin is ui/cardModel.ts pactRules / pactNeedRank, which this page reads. The rest of the passives
// are free. This page lists, for the hero the Armory is looking at, which passive awakens which skill (skill entries) and which skills a
// passive awakens (passive entries). A run holds ONE doctrine (sim/cards.ts collectPools: the doctrine's skills plus the shared ones), so a
// sheet names only skills that can meet the one it shows. Pacts off (rank 0 / absent) = no Pacts page.

/** the doctrine a skill belongs to ('a' | 'b'), or 'common' for the skills every hero can be offered */
export type PactGroup = 'a' | 'b' | 'common';

/** one skill of the viewed class and the pact passive it waits for */
export interface PactSkill {
  def: SkillDef;
  group: PactGroup;
  /** balance.pacts.byBehavior[def.behavior]; null = that behaviour has no pact (the skill awakens on its own) */
  passive: PassiveDef | null;
  /** the rank that passive must be held at: the pact rank capped at the passive's own max rank (0 when there is no pact) */
  need: number;
}

/** one passive and what it awakens */
export interface PactPassive {
  def: PassiveDef;
  /** the pact rank capped at this passive's own max rank (0 for a free passive: it has no pact) */
  need: number;
  /** the behaviours this passive is the pact of, in balance.pacts order (empty = a free passive) */
  behaviors: BehaviorKind[];
  /** the skills of the viewed class (both doctrines and the shared skills) that follow one of those behaviours, in list order */
  skills: PactSkill[];
}

export interface PactTable {
  /** balance.pacts.rank */
  rank: number;
  /** every skill the viewed class can be offered: doctrine a, doctrine b, then the shared ones; basic attack, skills, milestone skills in each */
  skills: PactSkill[];
  /** the passives that are the pact of at least one behaviour: the ones that awaken a skill of the viewed class first, then the ones that awaken none (content order in each) */
  pacts: PactPassive[];
  /** the passives no behaviour maps to (content order) */
  free: PactPassive[];
}

const PACT_KIND_ORDER: Record<SkillDef['kind'], number> = { basic: 0, active: 1, ultimate: 2 };
const PACT_KINDS: readonly SkillDef['kind'][] = ['basic', 'active', 'ultimate'];
const PACT_GROUP_ORDER: Record<PactGroup, number> = { a: 0, b: 1, common: 2 };
const PACT_GROUPS: readonly PactGroup[] = ['a', 'b', 'common'];

/** Whether this content has awakening pacts (balance.pacts.rank > 0): the Pacts page exists only then. */
export function pactsOn(content: ContentDB): boolean {
  return pactRules(content) !== null;
}

/** The skills a hero can be offered: his own (both doctrines, the basic attacks, the milestone skills) and the shared skills the sim deals to every hero (sim/content.ts commonSkills: classId 'common' AND kind 'active'). */
function offeredTo(def: SkillDef, classId: ClassId): boolean {
  return def.classId === classId || (def.classId === 'common' && def.kind === 'active');
}

/** The pact table of `classId` read from `content.balance.pacts`; null while pacts are off. */
export function pactTable(content: ContentDB, classId: ClassId): PactTable | null {
  const rules = pactRules(content);
  if (rules === null) return null;
  const ix = indexOf(content);
  const cls = ix.classes.get(classId);
  const groupOf = (s: SkillDef): PactGroup => {
    if (s.classId === 'common') return 'common';
    if (s.doctrine !== undefined) return s.doctrine;
    const b = cls?.doctrines[1];
    return b !== undefined && (b.basic === s.id || b.starter === s.id || b.skills.includes(s.id)) ? 'b' : 'a';
  };
  const skills: PactSkill[] = content.skills
    .map((def, i) => ({ def, i }))
    .filter(({ def }) => offeredTo(def, classId))
    .map(({ def, i }) => {
      const passive = ix.passives.get(rules.by[def.behavior] ?? '') ?? null;
      return { row: { def, group: groupOf(def), passive, need: passive ? pactNeedRank(rules, passive) : 0 } satisfies PactSkill, i };
    })
    .sort((a, b) => PACT_GROUP_ORDER[a.row.group] - PACT_GROUP_ORDER[b.row.group] || PACT_KIND_ORDER[a.row.def.kind] - PACT_KIND_ORDER[b.row.def.kind] || a.i - b.i)
    .map(({ row }) => row);
  const passiveRow = (def: PassiveDef): PactPassive => {
    const behaviors = (Object.keys(rules.by) as BehaviorKind[]).filter((b) => rules.by[b] === def.id);
    return { def, need: behaviors.length > 0 ? pactNeedRank(rules, def) : 0, behaviors, skills: skills.filter((s) => s.passive?.id === def.id) };
  };
  const rows = content.passives.map(passiveRow);
  const pacts = rows.filter((p) => p.behaviors.length > 0);
  return { rank: rules.rank, skills, pacts: [...pacts.filter((p) => p.skills.length > 0), ...pacts.filter((p) => p.skills.length === 0)], free: rows.filter((p) => p.behaviors.length === 0) };
}

/** Whether two skills can be in the same run: a run holds one doctrine, so the skills of the two doctrines never meet; the shared skills meet both. */
export function sharesRun(a: PactGroup, b: PactGroup): boolean {
  return a === b || a === 'common' || b === 'common';
}

/** The other skills awakened by the same pact passive that can be in a run with `row`: its doctrine and the shared skills (a shared skill: both doctrines). */
export function pactSiblings(table: PactTable, row: PactSkill): PactSkill[] {
  const id = row.passive?.id;
  if (id === undefined) return [];
  return table.skills.filter((s) => s.def.id !== row.def.id && s.passive?.id === id && sharesRun(row.group, s.group));
}

/** The skills a passive awakens, by doctrine (doctrine a, doctrine b, shared); a doctrine with none is left out. The groups cover exactly `skills`. */
export function pactSkillGroups(skills: readonly PactSkill[]): { group: PactGroup; skills: PactSkill[] }[] {
  return PACT_GROUPS.map((group) => ({ group, skills: skills.filter((s) => s.group === group) })).filter((g) => g.skills.length > 0);
}

/** One doctrine group of the skills list cut by kind (basic attack, skills, milestone skills); `head` = the group mixes kinds, so each run gets its heading. */
export function pactKindRuns(rows: readonly PactSkill[]): { kind: SkillDef['kind']; rows: PactSkill[]; head: boolean }[] {
  const runs = PACT_KINDS.map((kind) => ({ kind, rows: rows.filter((s) => s.def.kind === kind) })).filter((r) => r.rows.length > 0);
  return runs.map((r) => ({ ...r, head: runs.length > 1 }));
}

/** The name a group goes by on this page: the doctrine of that hero, or "Shared skills". */
export function pactGroupName(classId: ClassId, g: PactGroup, content?: ContentDB): string {
  if (g === 'common') return t('codex.pact.group.shared');
  const d = indexOf(content).classes.get(classId)?.doctrines[g === 'a' ? 0 : 1];
  return d ? tl(d.name) : '';
}

/** The rank a passive tile's tooltip shows: the pact rank, or rank 1 for a free passive (it has no pact; "Per rank" on its sheet is one rank). */
export function pactTipRank(p: PactPassive): number {
  return p.need > 0 ? p.need : 1;
}

/** "Awakens with <Passive> (rank N)": the pact line of a skill entry */
export function skillPactLine(s: PactSkill): string {
  return s.passive ? t('codex.pact.awakensWith', { name: tl(s.passive.name), rank: s.need }) : t('codex.pact.awakensFree');
}

/** How many skill names a list row spells out before it says "and N more" (the detail sheet lists them all) */
const PACT_ROW_NAMES = 3;

/** "Pact: awakens <skills of the class>": the pact line of a passive entry; `limit` caps the names (Infinity = all of them) */
export function passivePactLine(p: PactPassive, classLabel: string, limit = PACT_ROW_NAMES): string {
  if (p.behaviors.length === 0) return t('codex.pact.free');
  if (p.skills.length === 0) return t('codex.pact.awakensNone', { name: classLabel });
  const names = p.skills
    .slice(0, limit)
    .map((s) => tl(s.def.name))
    .join(', ');
  return p.skills.length > limit ? t('codex.pact.awakensMore', { names, n: p.skills.length - limit }) : t('codex.pact.awakens', { names });
}

type PactMode = 'skills' | 'passives';

// the Pacts page is a page of the shared `armoryCodexSub` (state.ts), so the Armory remembers it through a tab round trip like the other three;
// the open view and the picked entries are signals so the gallery can open them
const pactMode = signal<PactMode>('skills');
const pactSkillSel = signal('');
const pactPassiveSel = signal('');

/** Opens the Pacts page of the Codex (gallery / links); `id` selects that skill or passive of `mode`. */
export function showCodexPacts(opts: { mode?: PactMode; id?: string } = {}): void {
  const mode = opts.mode ?? 'skills';
  armoryCodexSub.value = 'pacts';
  pactMode.value = mode;
  if (opts.id !== undefined) (mode === 'skills' ? pactSkillSel : pactPassiveSel).value = opts.id;
}

/** Four interlocked links (the chain of the build board, drawn in CSS). */
function PactChain(): JSX.Element {
  return (
    <span class="ms-cdx-chain" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function PactSkillTile({ row, active, onPick, sub }: { row: PactSkill; active: boolean; onPick: () => void; sub?: string }): JSX.Element {
  const { def, passive } = row;
  return (
    <button type="button" class={`ms-cdx-tile ms-cdx-ptile ms-plate ${active ? 'is-active' : ''}`} data-nav="" aria-pressed={active} onClick={onPick} {...tipProps(() => buildTip({ type: 'skill', id: def.id }))}>
      <IconSlot size="sm" icon={def.icon} kind="skill" element={def.element} />
      <span class="ms-cdx-tile-text">
        <b>{tl(def.name)}</b>
        <small class={sub === undefined && passive ? 'ms-cdx-pactline' : ''}>{sub ?? skillPactLine(row)}</small>
      </span>
      {sub === undefined && passive && <IconSlot size="xs" icon={passive.icon} kind="passive" class="ms-cdx-ptile-end" />}
    </button>
  );
}

function PactPassiveTile({ row, classLabel, active, onPick }: { row: PactPassive; classLabel: string; active: boolean; onPick: () => void }): JSX.Element {
  const { def } = row;
  const free = row.behaviors.length === 0;
  return (
    <button type="button" class={`ms-cdx-tile ms-cdx-ptile ms-plate ${active ? 'is-active' : ''} ${free ? 'is-free' : ''}`} data-nav="" aria-pressed={active} onClick={onPick} {...tipProps(() => buildTip({ type: 'passive', id: def.id, rank: pactTipRank(row) }))}>
      <IconSlot size="sm" icon={def.icon} kind="passive" />
      <span class="ms-cdx-tile-text">
        <b>{tl(def.name)}</b>
        <small class={free ? '' : 'ms-cdx-pactline'}>{passivePactLine(row, classLabel)}</small>
      </span>
    </button>
  );
}

function PactSkillDetail({ table, row, classId, onSkill, onPassive }: { table: PactTable; row: PactSkill; classId: ClassId; onSkill: (id: string) => void; onPassive: (id: string) => void }): JSX.Element {
  const { def, passive, need } = row;
  const group = pactGroupName(classId, row.group);
  const same = pactSiblings(table, row);
  return (
    <div class="ms-cdx-detail-body">
      <header class="ms-cdx-detail-head">
        <IconSlot size="xl" icon={def.icon} kind="skill" element={def.element} />
        <div class="ms-cdx-detail-id">
          <h3 class="ms-title">{tl(def.name)}</h3>
          <DataStrip
            class="ms-cdx-strip"
            items={[
              { key: 'kind', text: t(`codex.pact.kind.${def.kind}`), tone: 'gold' },
              { key: 'element', text: t(`element.${def.element}`) },
              { key: 'behavior', text: t(`hero.behavior.${def.behavior}`) },
              ...(group ? [{ key: 'group', text: group, tone: 'dim' as const }] : []),
            ]}
          />
        </div>
      </header>
      <p class="ms-cdx-mod">{skillDescription(def)}</p>

      <section class="ms-cdx-sec">
        <div class="ms-eyebrow">{t('codex.pact.sec.pact')}</div>
        {passive ? (
          <div class="ms-cdx-plink">
            <div class="ms-cdx-plink-icons">
              <IconSlot size="md" icon={def.icon} kind="skill" element={def.element} />
              <PactChain />
              <IconSlot size="md" icon={passive.icon} kind="passive" alt={tl(passive.name)} onClick={() => onPassive(passive.id)} {...tipProps(() => buildTip({ type: 'passive', id: passive.id, rank: need }))} />
            </div>
            <p class="ms-cdx-plink-text">
              <b>{skillPactLine(row)}</b>
              <span>{t('codex.pact.without', { name: tl(passive.name), rank: need })}</span>
            </p>
          </div>
        ) : (
          <p class="ms-cdx-mod">{t('codex.pact.awakensFree')}</p>
        )}
      </section>

      <section class="ms-cdx-sec">
        <div class="ms-eyebrow">{t('codex.pact.sec.awakening')}</div>
        <p class="ms-cdx-mod">{tl(def.awaken.desc)}</p>
      </section>

      {same.length > 0 && passive && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('codex.pact.sec.same')}</div>
          <div class="ms-cdx-pchips">
            {same.map((s) => (
              // a skill of another group than the sheet's (the shared skills on a doctrine skill's sheet, both doctrines on a shared skill's) carries its group
              <PactSkillTile key={s.def.id} row={s} active={false} sub={s.group === row.group ? t(`codex.pact.kind.${s.def.kind}`) : `${pactGroupName(classId, s.group)} · ${t(`codex.pact.kind.${s.def.kind}`)}`} onPick={() => onSkill(s.def.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PactPassiveDetail({ row, classId, onSkill }: { row: PactPassive; classId: ClassId; onSkill: (id: string) => void }): JSX.Element {
  const { def } = row;
  const free = row.behaviors.length === 0;
  const label = className(classId);
  const perRank = statModRows(def.perRank, 1);
  return (
    <div class="ms-cdx-detail-body">
      <header class="ms-cdx-detail-head">
        <IconSlot size="xl" icon={def.icon} kind="passive" />
        <div class="ms-cdx-detail-id">
          <h3 class="ms-title">{tl(def.name)}</h3>
          <DataStrip
            class="ms-cdx-strip"
            items={[
              ...(free ? [{ key: 'free', text: t('codex.pact.group.free'), tone: 'dim' as const }] : [{ key: 'pact', text: t('codex.pact.pactRank', { rank: row.need }), tone: 'gold' as const, num: true }]),
              { key: 'max', text: t('codex.pact.maxRank', { n: def.maxRank }), num: true },
            ]}
          />
        </div>
      </header>
      <p class="ms-cdx-mod">{tl(def.desc)}</p>

      <section class="ms-cdx-sec">
        <div class="ms-eyebrow">{t('codex.pact.sec.pact')}</div>
        {free ? <p class="ms-cdx-mod">{t('codex.pact.freeLong')}</p> : <p class="ms-cdx-mod ms-cdx-pactfull">{passivePactLine(row, label, Infinity)}</p>}
      </section>

      {!free && row.skills.length > 0 && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('codex.pact.sec.skills', { name: label })}</div>
          {/* a run holds one doctrine: the skills stand under the doctrine they belong to (shared skills last) */}
          {pactSkillGroups(row.skills).map(({ group, skills }) => (
            <div class="ms-cdx-pgroup" key={group}>
              <h4 class="ms-cdx-pgroup-name">{pactGroupName(classId, group)}</h4>
              <div class="ms-cdx-pchips">
                {skills.map((s) => (
                  <PactSkillTile key={s.def.id} row={s} active={false} sub={t(`codex.pact.kind.${s.def.kind}`)} onPick={() => onSkill(s.def.id)} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {!free && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('codex.pact.sec.behaviours')}</div>
          <DataStrip items={row.behaviors.map((b) => ({ key: b, text: t(`hero.behavior.${b}`) }))} />
          {row.skills.length === 0 && <p class="ms-cdx-escorts ms-muted">{t('codex.pact.noneOfClass', { name: label })}</p>}
        </section>
      )}

      {perRank.length > 0 && (
        <section class="ms-cdx-sec">
          <div class="ms-eyebrow">{t('codex.pact.sec.rank')}</div>
          <div class="ms-cdx-statgrid">
            {perRank.map((r) => (
              <KV key={r.label} label={r.label} value={r.value} tone={r.positive ? 'good' : 'bad'} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PactsPage(): JSX.Element {
  const { content } = deps();
  const classId = armoryClass.value;
  const mode = pactMode.value;
  const table = useMemo(() => pactTable(content, classId), [content, classId]);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef);
  const skillId = pactSkillSel.value;
  const passiveId = pactPassiveSel.value;
  const cur = table ? (mode === 'skills' ? (table.skills.find((s) => s.def.id === skillId) ?? table.skills[0])?.def.id : ([...table.pacts, ...table.free].find((p) => p.def.id === passiveId) ?? table.pacts[0] ?? table.free[0])?.def.id) : undefined;
  const detailScroll = useDetailScroll(`${mode}:${classId}:${cur ?? 'none'}`);
  if (!table) {
    return (
      <div class="ms-cdx-split">
        <p class="ms-muted ms-cdx-pickme">{t('codex.pact.off')}</p>
      </div>
    );
  }
  const label = className(classId);
  const reveal = (): void => {
    if (layout.value.portrait || layout.value.compact) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const pickSkill = (id: string): void => {
    sfx('click');
    pactSkillSel.value = id;
    pactMode.value = 'skills';
    reveal();
  };
  const pickPassive = (id: string): void => {
    sfx('click');
    pactPassiveSel.value = id;
    pactMode.value = 'passives';
    reveal();
  };
  const skillGroups = PACT_GROUPS.map((g) => ({ g, rows: table.skills.filter((s) => s.group === g) })).filter((x) => x.rows.length > 0);
  const selSkill = table.skills.find((s) => s.def.id === cur);
  const selPassive = [...table.pacts, ...table.free].find((p) => p.def.id === cur);

  return (
    <div class="ms-cdx-split">
      <section class="ms-cdx-listpanel ms-sunken ms-sunken--plain">
        <div class="ms-cdx-listhead">
          <div class="ms-cdx-filter ms-edgefade ms-edgefade--x" role="radiogroup" aria-label={t('codex.pact.view')}>
            <Plate on={mode === 'skills'} onClick={() => (pactMode.value = 'skills')}>
              {t('codex.pact.viewSkills')}
            </Plate>
            <Plate on={mode === 'passives'} onClick={() => (pactMode.value = 'passives')}>
              {t('codex.pact.viewPassives')}
            </Plate>
          </div>
          <StatWell size="sm" value={label} class="ms-cdx-count" />
        </div>
        <div class="ms-cdx-list-scroll ms-scroll" ref={listRef}>
          <p class="ms-cdx-pactnote">{t('codex.pact.intro')}</p>
          {mode === 'skills'
            ? skillGroups.map(({ g, rows }) => (
                <div class="ms-cdx-zone" key={g}>
                  <h3 class="ms-cdx-zone-title ms-head">{pactGroupName(classId, g)}</h3>
                  {/* the basic attack and the milestone skills of a doctrine stand apart from its level-up skills: a milestone skill is there once its talent points are spent and has a slot of its own */}
                  {pactKindRuns(rows).map((run) => (
                    <div class="ms-cdx-kindrun" key={run.kind}>
                      {run.head && <h4 class="ms-cdx-kindtitle">{t(`codex.pact.kinds.${run.kind}`)}</h4>}
                      <div class="ms-cdx-grid ms-cdx-pgrid">
                        {run.rows.map((s, i) => (
                          <div class="ms-cdx-cell" style={{ '--i': Math.min(i, 14) } as JSX.CSSProperties} key={s.def.id}>
                            <PactSkillTile row={s} active={s.def.id === cur} onPick={() => pickSkill(s.def.id)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            : [
                { id: 'pact', title: t('codex.pact.group.pact'), rows: table.pacts },
                { id: 'free', title: t('codex.pact.group.free'), rows: table.free },
              ]
                .filter((grp) => grp.rows.length > 0)
                .map((grp) => (
                  <div class="ms-cdx-zone" key={grp.id}>
                    <h3 class="ms-cdx-zone-title ms-head">{grp.title}</h3>
                    <div class="ms-cdx-grid ms-cdx-pgrid">
                      {grp.rows.map((p, i) => (
                        <div class="ms-cdx-cell" style={{ '--i': Math.min(i, 14) } as JSX.CSSProperties} key={p.def.id}>
                          <PactPassiveTile row={p} classLabel={label} active={p.def.id === cur} onPick={() => pickPassive(p.def.id)} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
        </div>
      </section>
      <section class="ms-cdx-detail ms-sunken ms-sunken--framed" ref={detailRef}>
        <div class="ms-cdx-detail-scroll ms-scroll" ref={detailScroll}>
          <div class="ms-cdx-detail-in" key={`${mode}:${classId}:${cur ?? 'none'}`}>
            {mode === 'skills' && selSkill ? (
              <PactSkillDetail table={table} row={selSkill} classId={classId} onSkill={pickSkill} onPassive={pickPassive} />
            ) : mode === 'passives' && selPassive ? (
              <PactPassiveDetail row={selPassive} classId={classId} onSkill={pickSkill} />
            ) : (
              <p class="ms-muted ms-cdx-pickme">{t('armory.codex.pick')}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const CODEX_PAGES: readonly CodexSub[] = ['bestiary', 'metin', 'story'];
const CODEX_PAGE_LABEL: Record<CodexSub, string> = { bestiary: 'armory.codex.bestiary', metin: 'armory.codex.metins', story: 'armory.codex.story', pacts: 'codex.pact.tab' };

/** The pages of the Codex for this content, in tab order: the Pacts page only while the awakening pacts are on. */
export function codexPages(content: ContentDB): readonly CodexSub[] {
  return pactsOn(content) ? [...CODEX_PAGES, 'pacts'] : CODEX_PAGES;
}

/** The page the Codex shows for `sub` (the shared Armory signal): a page this content does not have falls back to the bestiary. */
export function codexPage(sub: CodexSub, content: ContentDB): CodexSub {
  return codexPages(content).includes(sub) ? sub : 'bestiary';
}

/** Whether the page shown for `sub` depends on the hero the Armory views (the Pacts page does; the three chronicle pages do not), so phones keep the hero rail beside it. */
export function codexNeedsHero(sub: CodexSub, content: ContentDB): boolean {
  return codexPage(sub, content) === 'pacts';
}

export function CodexTab(): JSX.Element {
  const { content } = deps();
  const pages = codexPages(content);
  const sub = codexPage(armoryCodexSub.value, content);
  return (
    <Win class="ms-cdx" title={t('armory.tab.codex')} bodyClass="ms-cdx-win">
      <div class="ms-cdx-subtabs" role="group" aria-label={t('armory.codex.tabs')}>
        <Tabs
          tabs={pages.map((k) => ({ key: k, label: t(CODEX_PAGE_LABEL[k]) }))}
          value={sub}
          onChange={(k) => (armoryCodexSub.value = k)}
          class={`ms-cdx-tabrow ${pages.length > CODEX_PAGES.length ? 'ms-cdx-tabrow--4' : ''}`}
        />
      </div>
      <div class="ms-cdx-body" key={sub}>
        {sub === 'bestiary' ? <Bestiary /> : sub === 'metin' ? <MetinLore /> : sub === 'pacts' ? <PactsPage /> : <StoryTab />}
      </div>
    </Win>
  );
}
