// Icon job generator: reads apps/game/src/data/content/*.json and emits one icon job per `icon` id.
// The lead triggers it once CONTENT lands:  bun tools/imagegen/src/cli.ts icons   (then `run --group icons`).
// Per-icon subject overrides live in tools/imagegen/icon_hints.json ({ "icon_id": "subject text" }).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, JOBS_DIR, TOOL } from './paths';
import type { JobSpec } from './types';

interface L10nLike {
  tr?: string;
  en?: string;
}

interface Def {
  id: string;
  icon?: string;
  name?: L10nLike;
  desc?: L10nLike;
  element?: string;
  classId?: string;
  doctrine?: string;
  kind?: string;
  slot?: string;
  tier?: number;
  effect?: string;
  maxLevel?: number;
  maxRank?: number;
  behavior?: string;
  classes?: string[];
}

export const ELEMENT_COLORS: Record<string, { name: string; hex: string }> = {
  physical: { name: 'bright steel-white with a gold edge', hex: '#e8dcb0' },
  fire: { name: 'molten orange-red fire', hex: '#ff6a2a' },
  ice: { name: 'glacial cyan-blue', hex: '#6fd6ff' },
  lightning: { name: 'electric blue with gold sparks', hex: '#7ab4ff' },
  dark: { name: 'deep violet shadow with crimson accents', hex: '#9a5cff' },
  poison: { name: 'toxic acid green', hex: '#8be03c' },
  holy: { name: 'radiant warm gold', hex: '#ffd36a' },
  wind: { name: 'pale jade-teal', hex: '#8fe3c0' },
};

const CLASS_ACCENT: Record<string, string> = {
  warrior: 'gold and white steel',
  ninja: 'jade green and dusk purple',
  yacha: 'black-violet and ember orange',
  shaman: 'storm blue and gold dragon motifs',
  wolfman: 'crimson and indigo wolf motifs',
};

const CLASS_HEX: Record<string, string> = { warrior: '#e8c36a', ninja: '#6fcf8a', yacha: '#b07cff', shaman: '#5aa0ff', wolfman: '#e8503a' };

const COLLECTIONS = ['skills', 'passives', 'stones', 'trinkets', 'gear', 'talents'] as const;
type Collection = (typeof COLLECTIONS)[number];
const DEFAULT_COLLECTIONS: Collection[] = [...COLLECTIONS];

const TIER_MATERIAL = ['plain iron and dark leather', 'polished steel with bronze trim', 'lacquered red-and-gold plates with jade inlay', 'ornate dragon-gilded gold with glowing gems'];

function clean(s: string | undefined): string {
  return (s ?? '').replace(/\{[a-zA-Z]+\}/g, '').replace(/\s+/g, ' ').trim();
}

function readCollection(name: Collection): Def[] {
  const p = join(CONTENT_DIR, `${name}.json`);
  if (!existsSync(p)) return [];
  const data: unknown = JSON.parse(readFileSync(p, 'utf8'));
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && 'items' in data && Array.isArray(data.items) ? data.items : [];
  if (name === 'talents') {
    // talent trees → one def per node
    return (list as { id: string; classId: string; nodes?: Def[] }[]).flatMap((t) => (t.nodes ?? []).map((n) => ({ ...n, classId: t.classId })));
  }
  return list as Def[];
}

/** What each skill behaviour looks like when frozen into one icon. */
const BEHAVIOR_VISUAL: Record<string, string> = {
  meleeArc: 'a broad glowing crescent slash arc sweeping through the air with a trailing afterimage',
  spinAura: 'a whirling ring of blades or energy spinning around a centre point',
  persistentAura: 'a radiant ring-shaped aura pulsing outward from a bright centre',
  dash: 'a streaking forward rush with long speed lines and a sharp motion trail',
  projectile: 'a fast projectile bolt flying diagonally with a bright core and a long trailing wake',
  homingProjectile: 'a curving homing projectile with a bright core arcing in a spiral trail',
  skyStrike: 'a column of energy crashing down from the top of the canvas onto a glowing impact ring',
  chain: 'a chain of linked energy arcs leaping between three glowing nodes',
  groundZone: 'a glowing ritual sigil circle on the ground with energy rising from it',
  orbit: 'several glowing orbs circling a centre point on a luminous orbit ring',
  cone: 'a wide cone-shaped burst of force fanning outward from a point',
  shockwave: 'a ring-shaped shockwave expanding outward with cracked ground and debris',
  selfBuff: 'a surge of power gathering around a clenched fist or weapon, radiating light',
  summon: 'a spectral guardian spirit or creature materialising out of swirling energy',
  leap: 'a powerful arcing leap ending in a downward impact with a burst of force',
  beam: 'a piercing lance-like beam of energy shooting diagonally across the canvas',
};

const GEAR_FORM: Record<string, string> = {
  weapon: 'the weapon only, shown at a dramatic diagonal angle',
  armor: 'a chest armour piece shown on its own, front view',
  helmet: 'a helmet shown on its own, three-quarter view',
  shield: 'a shield shown on its own, front view',
  shoes: 'a pair of boots shown on their own, side view',
  bracelet: 'a bracelet / bangle shown on its own',
  necklace: 'a pendant necklace shown on its own',
  earrings: 'a pair of ornate earrings shown on their own',
};

function subjectFor(c: Collection, d: Def): { subject: string; accent: string } {
  const name = clean(d.name?.en) || d.id;
  const desc = clean(d.desc?.en);
  const el = d.element ? (ELEMENT_COLORS[d.element] ?? ELEMENT_COLORS.physical!) : undefined;
  const cls = d.classId && d.classId !== 'common' ? CLASS_ACCENT[d.classId] : undefined;
  switch (c) {
    case 'skills': {
      const visual = BEHAVIOR_VISUAL[d.behavior ?? ''] ?? 'the technique\'s effect as a dramatic frozen moment of energy';
      const grand = d.kind === 'ultimate' ? ' as a grand, more elaborate and ornate legendary version with extra layers of light and a dragon or spirit motif' : '';
      return {
        subject:
          `the martial/magical technique "${name}": ${visual}${grand}; rendered in ${el?.name ?? 'steel-white'} light${cls ? ` with ${cls} accents` : ''}; ` +
          'the effect itself is the subject, no character faces, no full body',
        accent: el?.hex ?? '#e8dcb0',
      };
    }
    case 'passives':
      return {
        subject: `a carved East-Asian talisman or emblem symbolising "${name}"${desc ? ` (${desc})` : ''}: an ornate medallion or relic object with gold filigree and a lacquered core, its central motif clearly expressing the name`,
        accent: '#ffcf6a',
      };
    case 'stones':
      return {
        subject: `a faceted Metin spirit stone gem that represents "${name}"${desc ? ` (${desc})` : ''}: a luminous cut stone with internal glowing runic veins, floating, in a small ornamental gold claw setting, with a small motif hinting at its meaning`,
        accent: d.slot === 'armor' ? '#5fd0a0' : '#7ee0ff',
      };
    case 'trinkets': {
      const piece = d.slot === 'bracelet' ? 'a jade-and-gold bracelet' : d.slot === 'necklace' ? 'a pendant necklace' : 'a pair of drop earrings';
      return { subject: `${piece} named "${name}"${desc ? ` (${desc})` : ''}, East-Asian jewelry with a glowing gemstone and a tassel charm, its gemstone colour matching the name`, accent: '#ffb347' };
    }
    case 'gear': {
      const tier = TIER_MATERIAL[Math.max(0, Math.min(3, (d.tier ?? 1) - 1))]!;
      const solo = d.classes && d.classes.length === 1 ? CLASS_ACCENT[d.classes[0]!] : undefined;
      return {
        subject: `the equipment item "${name}": ${GEAR_FORM[d.slot ?? ''] ?? 'the item only'}, in a ${tier} style${solo ? `, with ${solo} design cues` : ''}; the item must clearly read as "${name}"; one single hero object`,
        accent: '#e8c36a',
      };
    }
    case 'talents':
      return {
        subject: `an abstract martial-arts talent emblem for "${name}"${desc ? ` (${desc})` : ''}: a round carved medallion sigil with one simple strong symbol that expresses the name`,
        accent: CLASS_HEX[d.classId ?? ''] ?? '#e8dcb0',
      };
  }
}

export function iconJob(c: Collection, d: Def, hints: Record<string, string>): JobSpec | null {
  const iconId = d.icon;
  if (!iconId || !/^[a-z0-9_]+$/.test(iconId)) return null;
  const { subject, accent } = subjectFor(c, d);
  const finalSubject = hints[iconId] ?? subject;
  return {
    id: iconId,
    group: c === 'talents' ? 'icons_talent' : 'icons',
    kind: 'icon',
    aspect: 'square',
    size: 128,
    post: [
      { op: 'resize', w: 128, mode: 'cover' },
      { op: 'vignette', strength: 0.35, inner: 0.7, color: '#0b0806' },
      { op: 'sharpen', amount: 0.35, radius: 0.8 },
      { op: 'webp', quality: 90 },
    ],
    prompt: {
      useCase: 'stylized-concept',
      assetType: 'square RPG game icon (shown at 48-128 px, rarity frame is added separately in the UI)',
      subject: finalSubject,
      style:
        'polished hand-painted digital painting in the manner of premium Korean MMORPG item icons: confident brushwork, crisp specular highlights, rich saturated colour, ' +
        'painterly East-Asian high-fantasy (lacquer, jade, gold filigree, dragons, lanterns)',
      composition: 'a single subject, perfectly centred, filling about 70% of the canvas, strong readable central silhouette, slight three-quarter view, generous dark margin',
      lighting: `dramatic key light from the upper left, soft ${accent} rim glow around the subject edges`,
      palette: `near-black warm brown background (#0d0a08) with a faint colour haze matching ${accent}; subject colours dominated by ${accent} with gold highlights`,
      constraints: 'no frame, no border, no card, no text, no letters, no numbers, no watermark, no UI elements, no hands or characters unless the subject requires it',
      avoid: 'busy background, multiple separate objects, photorealism, flat vector look, 3D render plastic look, cropped subject',
    },
  };
}

/** LEGACY (pre-v2) 128 px opaque icon jobs of every collection, exactly as jobs/icons.jsonl was written. The v2 pipeline
 *  lives in iconjobs.ts (`cli icons --collection <c>`); this path is kept only behind `--legacy` / ICON_PIPELINE=legacy. */
function legacyJobs(collections: Collection[]): JobSpec[] {
  const hintsPath = join(TOOL, 'icon_hints.json');
  const hints: Record<string, string> = existsSync(hintsPath) ? (JSON.parse(readFileSync(hintsPath, 'utf8')) as Record<string, string>) : {};
  const jobs = new Map<string, JobSpec>();
  for (const c of collections) {
    for (const d of readCollection(c)) {
      const j = iconJob(c, d, hints);
      if (j && !jobs.has(j.id)) jobs.set(j.id, j);
    }
  }
  return [...jobs.values()];
}

/** The text `emitIconJobs` writes (for the byte-identity check of `icons --legacy --dry`). */
export function legacyIconJobsText(collections: Collection[] = DEFAULT_COLLECTIONS): string {
  return legacyJobs(collections).map((j) => JSON.stringify(j)).join('\n') + '\n';
}

export function emitIconJobs(dry: boolean, collections: Collection[] = DEFAULT_COLLECTIONS): number {
  const jobs = legacyJobs(collections);
  if (!dry) writeFileSync(join(JOBS_DIR, 'icons.jsonl'), legacyIconJobsText(collections));
  return jobs.length;
}
