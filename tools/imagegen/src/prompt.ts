import type { Aspect, Background, JobKind, JobSpec, RefRole, StructuredPrompt } from './types';

export const DEFAULT_KEY = '#ff00ff';

const CANVAS: Record<Aspect, string> = {
  square: 'Square 1:1 canvas.',
  landscape: 'Landscape 3:2 canvas.',
  portrait: 'Portrait 2:3 canvas.',
  wide: 'Wide cinematic 16:9 canvas.',
};

const KEY_NAMES: Record<string, string> = {
  '#ff00ff': 'pure magenta #FF00FF',
  '#00ffff': 'pure cyan #00FFFF',
  '#0000ff': 'pure blue #0000FF',
  '#00ff00': 'pure green #00FF00',
};

/** The "Image n = …" sentence per reference role (codex prompt of a job with refs). */
export const REF_ROLES: Record<RefRole, string> = {
  texture:
    "the original game's texture for this element: match its shape language and feel closely, but paint a new original image, not a pixel copy",
  context:
    'a screenshot of the original game showing this element in use, for context only: do not paint the scene, characters or UI from it',
  style: 'a style reference from our own game: match its rendering style, finish and level of detail',
};

/** Role sentence for a reference: a known role name, or a custom sentence used verbatim. */
export function refRoleSentence(role: string | undefined): string {
  const r = (role ?? 'texture').trim();
  return REF_ROLES[r as RefRole] ?? r.replace(/[.\s]+$/, '');
}

/** Asset-type line for jobs that have a goal but no structured prompt. */
export const KIND_ASSET: Record<JobKind, string> = {
  vfx: 'VFX sprite texture for a real-time 3D browser action game, drawn on a flat quad',
  terrain: 'seamless tileable ground texture for a 3D action game seen by a 55 degree top-down camera',
  rock: 'seamless tileable rock surface texture for a 3D action game',
  bark: 'seamless tileable tree bark texture for a 3D action game',
  foliage: 'foliage card texture mapped on flat quads in a 3D action game',
  rune: 'emissive rune texture for a 3D action game',
  ui: 'game UI art element',
  portrait: 'painted character portrait for a game UI',
  illustration: 'painted game illustration',
  icon: 'square RPG game icon (shown at 48-128 px, the frame is added by the UI)',
};

/** Background contract clauses (`background` field). 'opaque' only adds a clause for vfx (full-frame textures). */
export const BACKGROUND_CLAUSE: Record<Background, string> = {
  black:
    'Background: pure black (#000000) everywhere outside the subject — flat, no gradient, no vignette, no haze or glow reaching the image border — so it works with additive blending; the subject is centred with a clear black margin and nothing touches the image border',
  transparent:
    'Background: genuinely transparent (a real alpha channel; never paint a checkerboard or any background colour); soft edges fade into transparency; the subject is centred with a clear margin and nothing touches the image border',
  opaque: 'The texture fills the whole canvas edge to edge (no empty background)',
};

export const VFX_NEUTRAL =
  'Colour: neutral white and light grey only, no hue (the engine tints it at runtime); brightness carries the shape';

export const NO_EXTRAS = 'no text, no letters, no numbers, no frame, no border, no watermark, no other objects';

const TILEABLE_SHORT = 'perfectly seamless tileable texture whose content continues across all four edges, even lighting, no vignette';

/** Compose the labelled prompt text for one job (this exact text is logged and sent to image_gen).
 *  Jobs without the newer fields (goal, background, refs, keepColor, kind 'vfx') compose exactly as before. */
export function composePrompt(job: JobSpec): string {
  const base: StructuredPrompt | null =
    job.prompt === undefined
      ? null
      : typeof job.prompt === 'string'
        ? { useCase: 'stylized-concept', assetType: job.goal ? KIND_ASSET[job.kind] : 'game asset', subject: job.prompt }
        : { ...job.prompt };
  const constraints: string[] = [];
  if (base?.constraints) constraints.push(base.constraints);
  if (job.transparent) {
    const key = (job.key ?? DEFAULT_KEY).toLowerCase();
    const name = KEY_NAMES[key] ?? key;
    constraints.push(
      `Background: one perfectly flat, solid, uniform ${name} fill covering the entire canvas edge to edge, ` +
        'with no gradient, no vignette, no floor, no cast shadow, no glow, no reflections and no noise on the background; ' +
        `the subject itself must contain no ${name.replace(/^pure /, '').split(' ')[0]} hues so it can be keyed out cleanly; ` +
        'crisp clean subject edges with a little empty margin around the subject',
    );
  }
  if (job.tiling && !base) constraints.push(TILEABLE_SHORT);
  if (job.background && (job.background !== 'opaque' || job.kind === 'vfx')) constraints.push(BACKGROUND_CLAUSE[job.background]);
  if (job.kind === 'vfx' && !job.keepColor) constraints.push(VFX_NEUTRAL);
  if (!base) constraints.push(NO_EXTRAS);

  const lines: string[] = [];
  if (job.goal) lines.push(`Goal: ${job.goal.trim()}`);
  if (base) {
    lines.push(`Use case: ${base.useCase}`);
    lines.push(`Asset type: ${base.assetType}`);
    lines.push(`Primary request: ${base.subject}`);
    if (base.style) lines.push(`Style/medium: ${base.style}`);
  } else {
    lines.push(`Asset type: ${KIND_ASSET[job.kind]}`);
  }
  const comp = [base?.composition, CANVAS[job.aspect ?? 'square']].filter(Boolean).join(' ');
  lines.push(`Composition/framing: ${comp}`);
  if (base?.lighting) lines.push(`Lighting/mood: ${base.lighting}`);
  if (base?.palette) lines.push(`Color palette: ${base.palette}`);
  if (base?.materials) lines.push(`Materials/textures: ${base.materials}`);
  if (base?.text) lines.push(`Text (verbatim): "${base.text}"`);
  if (constraints.length) lines.push(`Constraints: ${constraints.join('; ')}`);
  if (base?.avoid) lines.push(`Avoid: ${base.avoid}`);
  return lines.join('\n');
}

/** A job runs alone in its codex session when it attaches images or needs a real-alpha tool call. */
export function needsSoloSession(job: Pick<JobSpec, 'refs' | 'background'>): boolean {
  return (job.refs?.length ?? 0) > 0 || job.background === 'transparent';
}
