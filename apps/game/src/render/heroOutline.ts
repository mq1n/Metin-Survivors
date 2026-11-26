// Hero readability overlay: every hero mesh gets two extra draws that share its geometry (and skeleton):
//  • rim     — additive cool-white fresnel rim where the hero is visible; drawn after the VFX batches (renderOrder
//              980), so impact bursts and skill sprites can't swallow the silhouette;
//  • x-ray   — where the hero is hidden behind props or enemies (depthFunc GREATER), a flat translucent silhouette
//              with the same rim, so the player is always findable. The hero's own materials write stencil 1
//              (`markHeroStencil`) and the x-ray skips those pixels, so the model's self-overlap (armour shells, arms
//              in front of the torso) is never tinted — only pixels where something else covers the hero.
// Front faces only: the x-ray pass would otherwise light the model's own back faces.
import {
  AddEquation,
  Color,
  CustomBlending,
  FrontSide,
  GreaterDepth,
  KeepStencilOp,
  LessEqualDepth,
  AlwaysStencilFunc,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  type Material,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SkinnedMesh,
  type Object3D,
} from 'three';

/** Cool white-cyan reserved for the local hero (ring, rim, x-ray). */
export const HERO_RIM_COLOR = '#bfe8ff';

const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = transformedNormal;
  vV = -mvPosition.xyz;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFill;
uniform float uRim;
uniform float uPower;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = clamp(uFill + pow(f, uPower) * uRim, 0.0, 1.0);
  gl_FragColor = vec4(uColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function overlayMaterial(xray: boolean): ShaderMaterial {
  const m = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(xray ? '#cfe4f0' : HERO_RIM_COLOR) },
      uFill: { value: xray ? 0.08 : 0 },
      // visible pass stays invisible (0) at rest so models have no artificial translucent border/halo;
      // hero.ts applyRimFlash raises uRim temporarily on hit-flash. X-ray activates gently only when occluded.
      uRim: { value: xray ? 0.14 : 0 },
      uPower: { value: xray ? 2.6 : 4.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: xray ? GreaterDepth : LessEqualDepth,
    side: FrontSide,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    // premultiplied: additive rim on visible pixels, "over" for the x-ray silhouette
    blendDst: xray ? OneMinusSrcAlphaFactor : OneFactor,
  });
  if (xray) {
    m.stencilWrite = true; // enables the stencil test; ops keep the buffer untouched
    m.stencilRef = HERO_STENCIL;
    m.stencilFunc = NotEqualStencilFunc;
    m.stencilFail = KeepStencilOp;
    m.stencilZFail = KeepStencilOp;
    m.stencilZPass = KeepStencilOp;
  }
  m.name = xray ? 'heroXray' : 'heroRim';
  return m;
}

/** Shared by every hero (two programs for the whole game). */
let shared: { rim: ShaderMaterial; xray: ShaderMaterial } | null = null;
function materials(): { rim: ShaderMaterial; xray: ShaderMaterial } {
  shared ??= { rim: overlayMaterial(false), xray: overlayMaterial(true) };
  return shared;
}

const HERO_STENCIL = 1;

/** Makes a hero material write stencil 1 wherever it is drawn (visible), the mask the x-ray pass excludes. */
export function markHeroStencil(m: Material): void {
  m.stencilWrite = true;
  m.stencilRef = HERO_STENCIL;
  m.stencilFunc = AlwaysStencilFunc;
  m.stencilZPass = ReplaceStencilOp;
}

/** Overlay draws after every VFX batch (≤ 44) and before damage numbers (1000). */
const RIM_ORDER = 980;
const XRAY_ORDER = 981;

/**
 * Adds the rim + x-ray overlays as siblings of `mesh` (same local transform, same skeleton/bind). Returns the overlay
 * objects so the caller can remove them with the model.
 */
export function addHeroOverlays(mesh: Mesh): Object3D[] {
  const parent = mesh.parent;
  if (!parent) return [];
  const { rim, xray } = materials();
  const out: Object3D[] = [];
  for (const [mat, order] of [
    [rim, RIM_ORDER],
    [xray, XRAY_ORDER],
  ] as const) {
    let o: Mesh;
    if ((mesh as SkinnedMesh).isSkinnedMesh) {
      const sm = mesh as SkinnedMesh;
      const s = new SkinnedMesh(sm.geometry, mat);
      s.bind(sm.skeleton, sm.bindMatrix);
      s.bindMode = sm.bindMode;
      o = s;
    } else {
      o = new Mesh(mesh.geometry, mat);
    }
    o.name = `${mesh.name}:${mat.name}`;
    o.position.copy(mesh.position);
    o.quaternion.copy(mesh.quaternion);
    o.scale.copy(mesh.scale);
    o.renderOrder = order;
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = false;
    parent.add(o);
    out.push(o);
  }
  return out;
}
