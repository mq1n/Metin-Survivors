// Job-spec + post-processing types for the imagegen runner.
// A job spec is one JSON object per line (jobs/*.jsonl) or an array in a .json file.

export type TextureKind =
  | 'terrain'
  | 'foliage'
  | 'bark'
  | 'rock'
  | 'vfx'
  | 'rune'
  | 'ui'
  | 'portrait'
  | 'illustration';

/** Manifest section/kind for a job. `icon` goes to icons.json, everything else to textures.json. */
export type JobKind = TextureKind | 'icon';

export type Aspect = 'square' | 'landscape' | 'portrait' | 'wide';

/** Background contract of a generated image: sets a prompt clause and the default post chain.
 *  black = additive sprite on pure #000 (no alpha) · transparent = real alpha from image_gen · opaque = full-frame image. */
export type Background = 'black' | 'transparent' | 'opaque';

/** Role of an attached reference image (the "Image n = …" line of the codex prompt). */
export type RefRole = 'texture' | 'context' | 'style';

export interface RefSpec {
  
  path: string;
  /** default 'texture'; any other string is used verbatim as the role sentence after "Image n = " */
  role?: RefRole | string;
}

/** Structured prompt, mirrors the codex imagegen skill's shared prompt schema. */
export interface StructuredPrompt {
  /** skill taxonomy slug, e.g. stylized-concept | illustration-story | logo-brand | ui-mockup */
  useCase: string;
  /** where the asset is consumed */
  assetType: string;
  /** main subject */
  subject: string;
  style?: string;
  composition?: string;
  lighting?: string;
  palette?: string;
  materials?: string;
  /** exact text to render (verbatim) */
  text?: string;
  constraints?: string;
  avoid?: string;
}

export type PostOp =
  /** resize to w×h (h defaults to w). cover = scale+center-crop (default), contain = pad, exact = stretch. */
  | { op: 'resize'; w: number; h?: number; mode?: 'cover' | 'contain' | 'exact' | 'fit'; focus?: [number, number] }
  /** crop in fractions of the current image: x,y,w,h in 0..1 */
  | { op: 'crop'; x: number; y: number; w: number; h: number }
  /** make seamlessly tileable: measures the wrap seam and, when visible, heals both axes by overlap-and-cut
   *  (shrinks by `overlap`; follow with a resize). Put `flatten` BEFORE `tile`, `resize` AFTER it. */
  | { op: 'tile'; heal?: 'auto' | 'force' | 'off'; feather?: number; maxRatio?: number; overlap?: number }
  /** divide out low-frequency luminance so tiles do not show a repeat blotch pattern (0..1) */
  | { op: 'flatten'; strength?: number; sigma?: number; wrap?: boolean }
  /** colour grade: saturation/contrast/gamma/brightness multipliers, optional tint blend */
  | { op: 'grade'; saturation?: number; contrast?: number; gamma?: number; brightness?: number; tint?: string; tintAmount?: number }
  /** chroma key → alpha. key '#rrggbb' or 'auto' (median of the border). onlyIfOpaque: keep a real alpha channel
   *  from the generator and key only when the raw came back opaque (background 'transparent' jobs). */
  | { op: 'alpha'; key?: string; t0?: number; t1?: number; erode?: number; feather?: number; despill?: number; minIsland?: number; onlyIfOpaque?: boolean }
  /** crop to the content bounding box (alpha > thresh, or luminance > thresh for images without alpha) + pad px
   *  (or padFrac × the box side), optionally squared and centred on a transparent/black canvas */
  | { op: 'trim'; pad?: number; padFrac?: number; square?: boolean; thresh?: number; center?: boolean }
  /** copy colour into transparent texels so bilinear/mip filtering does not bleed the key colour
   *  (source texels: alpha > solid, default 0.5; use ~0.15 for soft VFX sprites) */
  | { op: 'bleed'; solid?: number }
  /** desaturate to luminance (VFX sprites are tinted at runtime); amount 1 = fully neutral grey */
  | { op: 'neutral'; amount?: number }
  /** crush the background to true black: subtract the floor (auto = measured on the border ring) through a soft knee,
   *  hue preserved; normalize scales the 99.9th percentile up to `white` (never darkens, gain ≤ 4) */
  | { op: 'blackpoint'; level?: number | 'auto'; knee?: number; normalize?: boolean; white?: number }
  


  | { op: 'gain'; rgb?: number; alpha?: number; ground?: number }
  




  | { op: 'tonefit'; q: number[]; ground?: number; cap?: number; mode?: 'max' | 'luma'; eps?: number; ramp?: number; smooth?: number }
  /** gaussian blur (sigma = fraction of the shorter side) of colour and alpha: softens crisp detail */
  | { op: 'blur'; sigma?: number }
  /** fade the outer `width` (fraction of each side, default 0.03) to exactly 0 — RGB without alpha (additive), alpha otherwise */
  | { op: 'edgefade'; width?: number }
  /** vfx: soft body around thin detail, out = in + amount * gaussian(in, sigma * shorter side), peak renormalised, then pow(gamma) (< 1 lifts the body).
   *  Hairline strands gain a broad brush-stroke band while the streaks stay readable. Before resize. */
  | { op: 'glow'; sigma?: number; amount?: number; gamma?: number; normalize?: boolean; round?: number }
  /** vfx: rotational motion blur around (cx, cy) (fractions, default the centre): mean of the image turned through ±angle/2 deg in `steps`
   *  steps, the long-exposure smear of a sprite spun very fast. Before resize. */
  | { op: 'spinblur'; angle?: number; steps?: number; cx?: number; cy?: number }
  /** derive a tangent-space (OpenGL, +Y up) normal map from luminance → secondary output `_n` */
  | { op: 'normal'; strength?: number; blur?: number; detail?: number; size?: number }
  /** darken the borders towards a colour (icons) */
  | { op: 'vignette'; strength?: number; color?: string; inner?: number }
  /** unsharp mask */
  | { op: 'sharpen'; amount?: number; radius?: number }
  /** mirror the top-left quadrant to all four corners (perfectly symmetric frames) */
  | { op: 'symmetrize'; axis?: 'xy' | 'x' | 'y' }
  /** icon v2 (py/iconkit.py): white-on-black stencil (or real-alpha raw) -> clean glyph mask */
  | { op: 'glyph'; lo?: number; hi?: number; minIsland?: number; invert?: 'auto' | 'yes' | 'no'; close?: number }
  /** icon v2: compose the octagon skill tile from the glyph mask; bands after the first become <id>__<band> outputs */
  | { op: 'octile'; family?: 'warm' | 'cool' | 'guild' | 'bright'; size?: number; fill?: number; chamfer?: number; bands?: ('n' | 'm' | 'g' | 'p')[]; seed?: string; centre?: [number, number]; grid?: number }
  /** icon v2: harden a generated alpha (drop haze, steepen the edge, remove specks) */
  | { op: 'matte'; lo?: number; hi?: number; minIsland?: number }
  /** icon v2: trim to the alpha box, long side = fill x size on a square canvas, inside the margin (+ offset fractions) */
  | { op: 'fit'; size?: number; fill?: number; margin?: number; offset?: [number, number]; thresh?: number }
  /** icon v2: dark contour around the alpha silhouette (px at the current size) */
  | { op: 'outline'; width?: number; color?: string; opacity?: number }
  /** icon v2: soft drop shadow down-right (fractions of the size) */
  | { op: 'shadow'; dx?: number; dy?: number; blur?: number; opacity?: number; color?: string }
  /** final encode settings (defaults per kind). lossless 'auto': lossy at `quality` unless the decoded image bands
   *  in dim smooth gradients (p99 error > maxBand/255) or lossless costs ≤ 1.25 × the lossy bytes */
  | { op: 'webp'; quality?: number; lossless?: boolean | 'auto'; maxBand?: number; normalQuality?: number };

export interface JobSpec {
  /** lowercase snake_case, unique — also the manifest id */
  id: string;
  /** terrain | foliage | bark | metin | ui | icons | portraits ... (batching + contact sheets) */
  group: string;
  /** manifest kind */
  kind: JobKind;
  /** structured or plain image prompt; optional when `goal` is given */
  prompt?: StructuredPrompt | string;
  /** goal + expectation: what the asset is for and what a good result looks like. With `refs` this is all the
   *  text needed — the reference image itself carries the look (no written description of the reference). */
  goal?: string;
  /** reference images attached to the codex session (`codex exec -i`, Image 1..n in this order). A job with refs
   *  runs alone in its session. A plain string = { path, role: 'texture' }. */
  refs?: (string | RefSpec)[];
  /** background contract (prompt clause + default post chain). The older `transparent` flag (flat chroma key) is
   *  separate; a job sets one or the other. */
  background?: Background;
  /** vfx: keep the generated colours instead of neutral white/grey */
  keepColor?: boolean;
  aspect?: Aspect;
  /** final pixel size: number (square) or {w,h}. Informational for the manifest; resize ops decide the real output. */
  size: number | { w: number; h: number };
  transparent?: boolean;
  /** chroma key used for transparent jobs (default #ff00ff) */
  key?: string;
  /** seamless tileable output */
  tiling?: boolean;
  post: PostOp[];
  /** srgb colour data (default true) */
  srgb?: boolean;
  /** output subdir under public/assets (default textures/<group> | icons | ui) */
  outDir?: string;
  note?: string;
  /** build the raw by assembling the raws of other jobs into a grid (nothing is generated for this job itself) */
  compose?: { cols: number; rows: number; cell: number; parts: string[] };
  /** generated (raw only) to feed a `compose` job; never built or shipped on its own */
  partOnly?: boolean;
}

export interface LogEntry {
  ts: string;
  event: 'job' | 'session' | 'fail' | 'gen' | 'pick';
  id?: string;
  /** gen/pick: variant number */
  k?: number;
  group?: string;
  attempt?: number;
  sessionId?: string;
  prompt?: string;
  codexPath?: string;
  raw?: string;
  ok?: boolean;
  err?: string;
  ms?: number;
  jobs?: string[];
  got?: string[];
  concurrency?: number;
  /** how the raw file was matched to the job: the model's printed JSON map, or call order */
  mapped?: 'json' | 'order';
}

export interface BuildReport {
  id: string;
  w: number;
  h: number;
  alpha: boolean;
  tile?: { before: { h: number; v: number }; after: { h: number; v: number }; final?: { h: number; v: number }; healed: boolean };
  main: string;
  normal?: string;
  bytes: number;
  /** the main output was encoded lossless (explicitly or by the 'auto' banding check) */
  lossless?: boolean;
  normalBytes?: number;
  /** icon v2 tiles: rank-band variants written next to the main output (<id>__<band>.webp) */
  variants?: Record<string, { path: string; bytes: number }>;
  /** icon v2 tiles: the glyph mask (build-only, read by the gates) */
  glyph?: string;
  /** icon v2: 'tile' (octile ran) | 'cutout' (fit ran) */
  form?: 'tile' | 'cutout';
  notes: string[];
}
