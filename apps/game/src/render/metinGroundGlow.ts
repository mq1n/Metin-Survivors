// r9 M9b (r8 judge MF5, r8 M8b critic: "at breakGlow 0.45 the break glow sprite still draws faint depth-clipped red sheets, and yeonmu lost its heat
// spill on the grass"): the soft ground glow of a breaking stone whose extras carry `breakHeat`. Instead of the additive billboard (a camera-facing sheet
// the pile's pieces cut into red cellophane planes), the break's heat lies ON the ground under and round the pile: a small grid disc that follows the
// terrain (lifted a few cm, polygon offset), additive, depth-tested against the pieces, so it shows only where the ground is seen between and round them.
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Mesh, MeshBasicMaterial, SRGBColorSpace, type Object3D, type Texture } from 'three';

/** grid cells per side of the glow disc (N + 1 vertices per side) */
export const GROUND_GLOW_N = 8;
/** m the disc floats over the terrain (with the polygon offset: no z-fight, no visible gap) */
export const GROUND_GLOW_LIFT = 0.05;

/**
 * the heat spill's own falloff: a broad flat core (the pile covers the middle; what shows is the ground between and round the pieces) easing out to
 * nothing at the rim, no hot centre spot (the sprite texture's 0.5 centre / 0.1 at 62 % read as nothing outside a 4 m pile)
 */
export function heatTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.3)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.09)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * r10 M10b (r9 judge MF6c, r9 M9b critic: "breakHeat on cold stones: on seori it reads as a blue-grey stain on the snow, and suryeon shows none;
 * define a cold-stone treatment ... a brief bright rim flash"): a ring falloff for the cold stones' break flash. Nothing in the middle (the pile
 * covers it), a bright band at 70-86 % of the radius, gone at the rim: the disc it lies on expands, so it reads as a frost shock ring that passes.
 */
export function ringTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.9, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** r10 M10b: seconds the cold stones' break ring takes to sweep out (it is gone with the break flash, before the pieces settle) */
export const COLD_RING_S = 0.45;

/** what a breaking stone's ground light does this frame: opacity, the share of hot orange (lava) or of white (cold) in the rune colour, radius / scale */
export interface MetinBreakHeat { alpha: number; warm: number; white: number; radius: number }

/**
 * r9 M9b / r10 M10b: the ground light of a breaking stone with extras.breakHeat (`heatK`) at shatter time `phaseT`, its `flash` (1 -> 0 over 0.45 s)
 * and its breakEmber (`ember`). Without `cold` this is the r9 law exactly: a lava stone (ember > 0) spills hot orange that cools with its veins, a stone
 * without ember its own rune light, gone by 1.5 s. With `cold` (extras.breakCold: a frost / lightning stone that keeps its crack glow through
 * breakEmber) it is a brief bright ring of whitened rune light that sweeps out from 1.2 to 2.7 x the stone's scale and is gone with the flash: no
 * lingering disc (the stain on the snow), no orange.
 */
export function metinBreakHeat(phaseT: number, flash: number, heatK: number, ember: number, cold: boolean): MetinBreakHeat {
  const ss = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  if (cold) {
    const u = ss(0, COLD_RING_S, phaseT);
    const alpha = phaseT >= COLD_RING_S ? 0 : heatK * Math.pow(Math.max(0, flash), 0.8) * (0.35 + 0.65 * ss(0, 0.06, phaseT));
    return { alpha, warm: 0, white: 0.55, radius: 1.2 + 1.5 * u };
  }
  const lava = ember > 0;
  const alpha = heatK * Math.max(0.75 * flash, (lava ? 0.45 : 0.3) * (1 - ss(lava ? 0.6 : 0.4, lava ? 2.1 : 1.5, phaseT)));
  const warm = lava ? 0.85 + 0.15 * flash : 0.3 * flash;
  return { alpha, warm, white: 0, radius: 2.1 + 0.6 * ss(0, 0.6, phaseT) };
}

export class MetinGroundGlow {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  constructor(tex: Texture) {
    const n = GROUND_GLOW_N, v = (n + 1) * (n + 1);
    const g = new BufferGeometry();
    this.pos = new Float32Array(v * 3);
    const uv = new Float32Array(v * 2), idx: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { uv[(j * (n + 1) + i) * 2] = i / n; uv[(j * (n + 1) + i) * 2 + 1] = j / n; }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = new MeshBasicMaterial({ map: tex, color: new Color(1, 0.4, 0.1), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    // after the ground decals and rings (renderOrder < 0) and the stone's own sprites (5): additive light on what is already drawn
    this.mesh.renderOrder = 7;
    this.mesh.name = 'metinGroundGlow';
  }

  /** the disc at (x, z) with `radius` (m) on the terrain, in `color`, at `opacity` (0 hides it) */
  set(x: number, z: number, radius: number, heightAt: (x: number, z: number) => number, color: Color, opacity: number): void {
    const m = this.mesh, mat = m.material as MeshBasicMaterial;
    mat.opacity = Math.min(1, Math.max(0, opacity));
    m.visible = mat.opacity > 0.002;
    if (!m.visible) return;
    mat.color.copy(color);
    const n = GROUND_GLOW_N;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const px = x + (i / n - 0.5) * 2 * radius, pz = z + (j / n - 0.5) * 2 * radius, o = (j * (n + 1) + i) * 3;
      this.pos[o] = px; this.pos[o + 1] = heightAt(px, pz) + GROUND_GLOW_LIFT; this.pos[o + 2] = pz;
    }
    (m.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  hide(): void { this.mesh.visible = false; }

  addTo(parent: Object3D): void { parent.add(this.mesh); }

  /** geometry only: the material goes through the owner's retire path (its program is shared) */
  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
