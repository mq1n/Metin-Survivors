// Light art of a reward card (owner B6, round 2). The card icons themselves are the icon pipeline's tiles (skills / passives:
// the icons lane; Restoration and Treasure: icon_card_heal / icon_card_yeop, our own stencils through the same tile kit), so
// the card adds what the flat tiles lack: COLOURED LIGHT that grows with the rank band (n 1-3 / m M1-M2 / g G1-G2 / p P):
//   n  a warm bloom only
//   m  a short steel-blue ray collar + one twinkle
//   g  a 12-ray golden crown that turns slowly + two twinkles
//   p  a 16-ray violet-gold crown, a counter-turning tick ring, a light column through the slot + three twinkles
// Everything is inline SVG in our own geometry (tapered rays, 4-point glints); the bloom on the icon itself is CSS (card.css,
// a blurred copy of the tile screened over it). Also here: the lit floor disc of the level-up stage (T14 ring).
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export type Band = 'n' | 'm' | 'g' | 'p';

const TAU = Math.PI * 2;

/** One tapered ray from radius r0 to r1 around angle a (rad), half-width w0 (rad) at the root. */
function ray(a: number, r0: number, r1: number, w0: number): string {
  const p = (r: number, ang: number): string => `${(Math.cos(ang) * r).toFixed(1)} ${(Math.sin(ang) * r).toFixed(1)}`;
  return `M${p(r0, a - w0)}L${p(r1, a - w0 * 0.12)}L${p(r1, a + w0 * 0.12)}L${p(r0, a + w0)}Z`;
}

function crown(n: number, long: number, short: number, w0: number, phase = 0): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(ray(phase + (i / n) * TAU, 46, i % 2 === 0 ? long : short, i % 2 === 0 ? w0 : w0 * 0.72));
  return parts.join('');
}

const CROWN_M = crown(8, 86, 66, 0.1, TAU / 16);
const CROWN_G = crown(12, 98, 72, 0.085);
const CROWN_P1 = crown(16, 98, 76, 0.07);
const CROWN_P2 = crown(16, 84, 60, 0.05, TAU / 32);
const TICKS_P = (() => {
  const parts: string[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    const r1 = i % 4 === 0 ? 51 : 49.4;
    parts.push(`M${(Math.cos(a) * 46.6).toFixed(1)} ${(Math.sin(a) * 46.6).toFixed(1)}L${(Math.cos(a) * r1).toFixed(1)} ${(Math.sin(a) * r1).toFixed(1)}`);
  }
  return parts.join('');
})();

/** The light behind the icon slot: nothing for band n (the bloom is CSS), a ray collar / crown for m, g, p. */
export function RankAura({ band }: { band: Band }): JSX.Element | null {
  if (band === 'n') return null;
  return (
    <span class={`ms-card-aura is-${band}`} aria-hidden="true">
      <svg viewBox="-100 -100 200 200" focusable="false">
        {band === 'm' && <path class="ms-aura-rays" d={CROWN_M} />}
        {band === 'g' && <path class="ms-aura-rays" d={CROWN_G} />}
        {band === 'p' && (
          <>
            <path class="ms-aura-rays" d={CROWN_P1} />
            <g class="ms-aura-back">
              <path class="ms-aura-rays is-b" d={CROWN_P2} />
              <path class="ms-aura-ticks" d={TICKS_P} />
            </g>
          </>
        )}
        <circle class="ms-aura-ring" r="47.5" />
      </svg>
    </span>
  );
}

const STAR = 'M0 -12 C1.2 -3 3 -1.2 12 0 C3 1.2 1.2 3 0 12 C-1.2 3 -3 1.2 -12 0 C-3 -1.2 -1.2 -3 0 -12Z';

/** 4-point glints over the corners of the slot (m: 1, g: 2, p: 3). */
export function RankSparks({ band }: { band: Band }): JSX.Element | null {
  if (band === 'n') return null;
  const n = band === 'm' ? 1 : band === 'g' ? 2 : 3;
  return (
    <span class={`ms-card-sparks is-${band}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <svg key={i} class={`ms-card-spark is-${i}`} viewBox="-14 -14 28 28" focusable="false">
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

/** The lit floor of the level-up stage: a ring disc seen from above (card.css squashes it to an ellipse): facets, two rings. */
const FLOOR_FACETS = (() => {
  const parts: string[] = [];
  const n = 28;
  for (let i = 0; i < n; i += 2) {
    const a0 = ((i + 0.08) / n) * TAU;
    const a1 = ((i + 0.92) / n) * TAU;
    const p = (r: number, a: number): string => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
    parts.push(`M${p(70, a0)}L${p(262, a0 + 0.01)}L${p(262, a1 - 0.01)}L${p(70, a1)}Z`);
  }
  return parts.join('');
})();

/** The floor disc: the painted uk_levelup_ring sprite (a luminance mask over a gold gradient, card.css) when the manifest lists it, else the drawn one. */
export function FloorDisc({ src }: { src?: string | null }): JSX.Element {
  if (src) return <span class="ms-lu-floor ms-lu-floor--img" style={{ '--ring-img': `url("${src}")` } as JSX.CSSProperties} aria-hidden="true" />;
  return (
    <span class="ms-lu-floor" aria-hidden="true">
      <svg viewBox="-300 -300 600 600" focusable="false">
        <path class="ms-floor-facets" d={FLOOR_FACETS} />
        <circle class="ms-floor-ring is-a" r="272" />
        <circle class="ms-floor-ring is-b" r="236" />
        <circle class="ms-floor-core" r="64" />
      </svg>
    </span>
  );
}

// ---- the relief: the icon tiles carry their glyph as a flat cream stencil. This SVG filter keys the glyph out of the tile (its
// luminance), lights it as an embossed relief (diffuse + specular from the upper left, plus one wide soft gradient across the
// glyph) and tints it per rank band: n ivory, m steel, g gold, p pearl-violet. The tile around it is untouched. Sizes are in
// object-bounding-box units, so the same filter fits a 60 px and a 140 px slot. Only img.ms-icon--tile uses it (card.css).
const RELIEF_TINT: Record<Band, { m: string; spec: string }> = {
  n: { m: '1 0 0 0 0  0 0.94 0 0 0  0 0 0.84 0 0  0 0 0 1 0', spec: '#fff3d8' },
  m: { m: '0.8 0 0 0 0  0 0.9 0 0 0  0 0 1.06 0 0  0 0 0 1 0', spec: '#eef8ff' },
  g: { m: '1.08 0 0 0 0  0 0.86 0 0 0  0 0 0.46 0 0  0 0 0 1 0', spec: '#fff0b0' },
  p: { m: '0.9 0 0 0 0  0 0.84 0 0 0  0 0 1.1 0 0  0 0 0 1 0', spec: '#f6ecff' },
};

/** Hidden SVG that defines the relief filter `id` for one rank band (one per card; the id is unique per card). */
export function ReliefDefs({ band, id }: { band: Band; id: string }): JSX.Element {
  const tint = RELIEF_TINT[band];
  return (
    <svg class="ms-card-relief" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id={id} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.4 4.72 0.88 0 -5.28" result="key" />
        <feGaussianBlur in="key" stdDeviation="0.012" result="kb" />
        <feGaussianBlur in="key" stdDeviation="0.07" result="kl" />
        <feDiffuseLighting in="kb" surfaceScale="3" diffuseConstant="1.15" lighting-color="#fff" result="dif">
          <feDistantLight azimuth="235" elevation="58" />
        </feDiffuseLighting>
        <feDiffuseLighting in="kl" surfaceScale="6" diffuseConstant="1.15" lighting-color="#fff" result="dlf">
          <feDistantLight azimuth="235" elevation="50" />
        </feDiffuseLighting>
        <feComposite in="dif" in2="dlf" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="shade" />
        <feColorMatrix in="SourceGraphic" type="matrix" values={tint.m} result="tsrc" />
        <feComposite in="shade" in2="tsrc" operator="arithmetic" k1="1.1" k2="0" k3="0" k4="0" result="lit" />
        <feSpecularLighting in="kb" surfaceScale="3" specularConstant="1" specularExponent="26" lighting-color={tint.spec} result="spec">
          <feDistantLight azimuth="235" elevation="52" />
        </feSpecularLighting>
        <feComposite in="lit" in2="spec" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="0" result="lit2" />
        <feComposite in="lit2" in2="key" operator="in" result="glyph" />
        <feComposite in="glyph" in2="SourceGraphic" operator="over" />
      </filter>
    </svg>
  );
}

// ---- the standing column of light of the level-up stage (T14). Painted once into two canvases with our own routine: a lit

// inside it, faded out towards the top. Gradients only, no hairlines, so there is no stripe pattern; two canvases with
// different seeds drift against each other (card.css) so the beams slide over one another like volumetric light.
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintShaft(c: HTMLCanvasElement, seed: number, shell: boolean): void {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const W = c.width;
  const H = c.height;
  const r = rng(seed);
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  if (shell) {
    // the walls of the cylinder: bright at the rim, dim in the middle, soft outside
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(255,226,150,0)');
    g.addColorStop(0.1, 'rgba(255,226,150,0.2)');
    g.addColorStop(0.2, 'rgba(255,238,184,0.85)');
    g.addColorStop(0.3, 'rgba(255,224,146,0.34)');
    g.addColorStop(0.5, 'rgba(255,214,120,0.2)');
    g.addColorStop(0.7, 'rgba(255,224,146,0.34)');
    g.addColorStop(0.8, 'rgba(255,238,184,0.85)');
    g.addColorStop(0.9, 'rgba(255,226,150,0.2)');
    g.addColorStop(1, 'rgba(255,226,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // soft beams: each a smooth bell across the width (5 stops), uneven in width and strength
  const n = shell ? 7 : 9;
  for (let i = 0; i < n; i++) {
    const cx = (0.16 + r() * 0.68) * W;
    const hw = (0.035 + r() * r() * 0.12) * W;
    const a = 0.12 + r() * 0.24;
    const g = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
    g.addColorStop(0, 'rgba(255,214,128,0)');
    g.addColorStop(0.28, `rgba(255,222,140,${(a * 0.3).toFixed(3)})`);
    g.addColorStop(0.5, `rgba(255,240,196,${a.toFixed(3)})`);
    g.addColorStop(0.72, `rgba(255,222,140,${(a * 0.3).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,214,128,0)');
    ctx.fillStyle = g;
    // a beam does not span the whole height: it starts somewhere in the lower two thirds and thins out upwards
    const top = H * (0.05 + r() * 0.4);
    ctx.fillRect(cx - hw, top, hw * 2, H - top);
  }
  // fade: nothing at the very top, full strength towards the foot
  ctx.globalCompositeOperation = 'destination-in';
  const v = ctx.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.1, 'rgba(0,0,0,0.5)');
  v.addColorStop(0.45, 'rgba(0,0,0,0.9)');
  v.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  // the foot: a warm bloom where the column meets the floor
  ctx.globalCompositeOperation = 'lighter';
  const f = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, W * 0.62);
  f.addColorStop(0, 'rgba(255,248,214,0.7)');
  f.addColorStop(0.35, 'rgba(255,214,120,0.3)');
  f.addColorStop(1, 'rgba(255,190,80,0)');
  ctx.fillStyle = f;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
}

/** The standing light column behind the card row (painted in code, additive; `height` is how far up it reaches from its foot). */
export function PillarShaft({ height }: { height: string }): JSX.Element {
  const a = useRef<HTMLCanvasElement>(null);
  const b = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (a.current) paintShaft(a.current, 7, true);
    if (b.current) paintShaft(b.current, 29, false);
  }, []);
  return (
    <span class="ms-lu-shaft" style={{ '--pil-h': height } as JSX.CSSProperties} aria-hidden="true">
      <canvas ref={a} class="ms-lu-shaft-a" width={192} height={512} />
      <canvas ref={b} class="ms-lu-shaft-b" width={192} height={512} />
    </span>
  );
}
