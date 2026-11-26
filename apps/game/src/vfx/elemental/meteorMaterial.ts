// Ported from threejs-vfx src/materials/MeteorMaterial.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// Burning rock — the meteor and the chunks it breaks into. A MeshStandardMaterial (the rock is solid, so it takes the scene's
// lights) with the stylisation injected on top:
//   - lava seams: the zero crossing of an fbm field, sampled in LOCAL space so the cracks are welded to the rock and tumble with
//     it; a finer octave adds the twigs. The seam is a cross-section (open gap, charred lip, white-hot core), not a painted worm.
//   - soot: charred halo either side of every seam, which is what keeps the glow from looking painted on.
//   - charge: `uCharge` 0 → 1 as the meteor bears down; it widens and brightens the seams (the rock visibly heats up).
//   - leading-face heat: facets pointing along the direction of travel take the compression heat and go white.
//   - per-instance cooling: `aLife` (instanced) runs 0 → 1; heat = 1 − life·uCool, so thrown chunks dim as they land.
// Per-instance inputs are the instanced attributes `aSeed` and `aLife`: use on an InstancedMesh.
import { Color, MeshStandardMaterial, Vector3, type WebGLProgramParametersWithUniforms } from 'three';
import { putHex } from './color';
import { frame } from './frame';
import { noiseGLSL } from './glsl/noise';
import { patchOnBeforeCompile, replaceChunk } from './shaderPatch';

/** Shading controls (defaults = the sandbox's `meteor` block). Read on every `sync`. */
export interface MeteorLook {
  /** seams per unit radius */
  crackScale: number;
  /** how wide a seam opens (doubled at full charge) */
  crackWidth: number;
  /** strength of the finer seams splitting off */
  crackBranches: number;
  crackGlow: number;
  /** how much the magma brightness crawls, and how fast */
  crackFlow: number;
  crackFlowSpeed: number;
  /** mottling of the rock between the seams */
  rockScale: number;
  /** per-facet value break-up */
  facetTint: number;
  /** darkening down in the craters and the cut faces */
  cavity: number;
  /** charring either side of a seam */
  soot: number;
  /** heat sheath around the silhouette */
  rimHeat: number;
  /** compression heat on the leading facets, and how tightly it hugs the nose */
  leadGlow: number;
  leadSharp: number;
  /** overall emissive gain */
  glow: number;
}

export function meteorLook(): MeteorLook {
  return {
    crackScale: 0.95, crackWidth: 0.045, crackBranches: 0.5, crackGlow: 2.2, crackFlow: 0.7, crackFlowSpeed: 0.9,
    rockScale: 3.4, facetTint: 0.5, cavity: 0.25, soot: 0.6, rimHeat: 0.7, leadGlow: 0.9, leadSharp: 2.6, glow: 0.75,
  };
}

/** Uniform boxes of one MeteorMaterial (`uTime` is the shared frame clock). */
export interface MeteorUniforms {
  uTime: { value: number };
  uColorRock: { value: Color };
  uColorChar: { value: Color };
  uColorCrack: { value: Color };
  uColorHot: { value: Color };
  uCrackScale: { value: number };
  uCrackWidth: { value: number };
  uCrackBranches: { value: number };
  uCrackGlow: { value: number };
  uFlow: { value: number };
  uFlowSpeed: { value: number };
  uRockScale: { value: number };
  uFacetTint: { value: number };
  uCavity: { value: number };
  uSoot: { value: number };
  uRimHeat: { value: number };
  uLead: { value: number };
  uLeadSharp: { value: number };
  /** unit heading of the meteor, world space — drives the leading-face heat */
  uHeading: { value: Vector3 };
  uCharge: { value: number };
  uGlow: { value: number };
  /** heat = 1 − aLife · uCool */
  uCool: { value: number };
}

function makeUniforms(): MeteorUniforms {
  return {
    uTime: frame.uTime,
    uColorRock: { value: new Color(0.43, 0.4, 0.37) },
    uColorChar: { value: new Color(0.09, 0.075, 0.06) },
    uColorCrack: { value: new Color(1, 0.42, 0.07) },
    uColorHot: { value: new Color(1, 0.95, 0.82) },
    uCrackScale: { value: 0.95 },
    uCrackWidth: { value: 0.045 },
    uCrackBranches: { value: 0.5 },
    uCrackGlow: { value: 2.2 },
    uFlow: { value: 0.7 },
    uFlowSpeed: { value: 0.9 },
    uRockScale: { value: 3.4 },
    uFacetTint: { value: 0.5 },
    uCavity: { value: 0.25 },
    uSoot: { value: 0.6 },
    uRimHeat: { value: 0.7 },
    uLead: { value: 0.9 },
    uLeadSharp: { value: 2.6 },
    uHeading: { value: new Vector3(0, 0, 1) },
    uCharge: { value: 0 },
    uGlow: { value: 0.75 },
    uCool: { value: 1 },
  };
}

const VERTEX_DECL = /* glsl */ `#include <common>
  attribute float aSeed;
  attribute float aLife;
  uniform float uCool;
  varying vec3  vRockLocal;
  varying vec3  vRockNormalW;
  varying float vRockSeed;
  varying float vRockHeat;`;

// `objectNormal` is declared by <beginnormal_vertex>, which runs before this chunk; three only ever takes it into *view* space,
// and the leading-face term needs it in world space.
const VERTEX_BODY = /* glsl */ `#include <begin_vertex>
  vRockLocal = transformed;
  vRockSeed = aSeed;
  vRockHeat = 1.0 - clamp(aLife * uCool, 0.0, 1.0);
  #ifdef USE_INSTANCING
    vRockNormalW = normalize(mat3(modelMatrix) * (instanceMatrix * vec4(objectNormal, 0.0)).xyz);
  #else
    vRockNormalW = normalize(mat3(modelMatrix) * objectNormal);
  #endif`;

const FRAGMENT_DECL = /* glsl */ `#include <common>
  uniform float uTime;
  uniform vec3  uColorRock;
  uniform vec3  uColorChar;
  uniform vec3  uColorCrack;
  uniform vec3  uColorHot;
  uniform float uCrackScale;
  uniform float uCrackWidth;
  uniform float uCrackBranches;
  uniform float uCrackGlow;
  uniform float uFlow;
  uniform float uFlowSpeed;
  uniform float uRockScale;
  uniform float uFacetTint;
  uniform float uCavity;
  uniform float uSoot;
  uniform float uRimHeat;
  uniform float uLead;
  uniform float uLeadSharp;
  uniform vec3  uHeading;
  uniform float uCharge;
  uniform float uGlow;
  varying vec3  vRockLocal;
  varying vec3  vRockNormalW;
  varying float vRockSeed;
  varying float vRockHeat;
  ${noiseGLSL}`;

// Injected once the normal is resolved: with flatShading there is no vNormal varying, so the view-dependent terms read the face
// normal <normal_fragment_begin> derives from screen-space derivatives.
const FRAGMENT_BODY = /* glsl */ `#include <emissivemap_fragment>
  {
    vec3  N   = normalize(normal);
    float ndv = clamp(dot(N, normalize(vViewPosition)), 0.0, 1.0);
    float rim = pow(1.0 - ndv, 2.2);

    // The seam, as a cross-section rather than as a line. "distance" is how far this fragment is from the nearest zero crossing
    // of the crack field, and the three bands cut out of it make the crack read as a split in stone:
    //   fissure — the open gap: no rock here, only the magma below shows.
    //   lip     — a much wider charred band either side. A crack is a shadow first and a light second.
    //   core    — the middle of the gap, the only part hot enough to run white.
    vec3  p  = vRockLocal * uCrackScale + vRockSeed * 19.0;
    float f1 = fbm3(p);
    float f2 = fbm3(p * 2.7 + 11.3);

    // The charge prises the seams open as the meteor heats up.
    float width = max(0.004, uCrackWidth * (1.0 + uCharge * 0.8));
    float seam = min(abs(f1), abs(f2) / max(uCrackBranches, 0.05));

    float fissure = 1.0 - smoothstep(width * 0.35, width, seam);
    float lip     = 1.0 - smoothstep(width, width * 2.0, seam);
    float core    = 1.0 - smoothstep(0.0, width * 0.45, seam);

    // Magma is not static: brightness crawls along the inside of a seam.
    float pulse = snoise(vRockLocal * 4.0 + vec3(0.0, uTime * uFlowSpeed, 0.0) + vRockSeed * 7.0);
    float flow  = mix(1.0, 0.45 + 0.75 * (pulse * 0.5 + 0.5), uFlow);

    /* --- the rock itself --- */
    float mottle = fbm3(vRockLocal * uRockScale + vRockSeed * 31.0) * 0.5 + 0.5;
    vec3  rock   = mix(uColorRock, uColorChar, smoothstep(0.3, 0.85, mottle));

    // Per-facet value break-up: the geometric normal in object space is constant across a triangle, so hashing it gives every
    // flat face its own shade — the thing that separates cut stone from a noise-painted ball.
    vec3  faceN = cross(dFdx(vRockLocal), dFdy(vRockLocal));
    faceN = faceN / max(length(faceN), 1e-6);
    float facet = hash13(faceN * 37.0 + vRockSeed + 0.5);
    rock *= 1.0 + (facet - 0.5) * uFacetTint;

    // Cheap curvature occlusion: craters and cut faces sit closer to the centre than the lumps do.
    float cavity = smoothstep(0.55, 1.0, length(vRockLocal));
    rock *= mix(1.0 - uCavity, 1.0, cavity);

    // Charred around every seam, and gone entirely inside one.
    rock = mix(rock, uColorChar, lip * uSoot);
    rock *= 1.0 - fissure * 0.92;

    // Hard lighting contrast across the facets, so the silhouette reads as a bundle of planes.
    rock *= mix(0.55, 1.15, ndv);
    diffuseColor.rgb *= rock;

    /* --- what is burning --- */
    // The gap is the only thing that emits, and only its middle runs white. Everything else is rock.
    float heat = fissure * flow * vRockHeat;
    vec3  glow = mix(uColorCrack, uColorHot, core * core) * heat * uCrackGlow;

    // A sheath of heat around the silhouette, and the compression heat on the leading facets. Both are squared against the
    // charge: at launch this is a cold rock with lit cracks, and only on the way down does the whole thing start to burn.
    float charge2 = uCharge * uCharge;
    glow += uColorCrack * rim * uRimHeat * vRockHeat * charge2;

    float lead = pow(clamp(dot(normalize(vRockNormalW), uHeading), 0.0, 1.0), uLeadSharp);
    glow += uColorHot * lead * uLead * vRockHeat * charge2;

    glow *= uGlow;

    // Soft ceiling: these terms are independent and stack, and without it a seam crossing the rim sums past 10 and the bloom
    // pass smears the whole rock into a white blob.
    glow /= 1.0 + glow * 0.22;

    totalEmissiveRadiance += glow;
  }`;

export class MeteorMaterial extends MeshStandardMaterial {
  readonly u: MeteorUniforms = makeUniforms();
  readonly look: MeteorLook = meteorLook();

  constructor() {
    super({ color: 0xffffff, roughness: 0.94, metalness: 0, flatShading: true });
    const u = this.u;
    patchOnBeforeCompile(this, (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = replaceChunk(shader.vertexShader, '#include <common>', VERTEX_DECL);
      shader.vertexShader = replaceChunk(shader.vertexShader, '#include <begin_vertex>', VERTEX_BODY);
      shader.fragmentShader = replaceChunk(shader.fragmentShader, '#include <common>', FRAGMENT_DECL);
      shader.fragmentShader = replaceChunk(shader.fragmentShader, '#include <emissivemap_fragment>', FRAGMENT_BODY);
    });
    this.sync();
  }

  /** Palette, 0xRRGGBB sRGB each: rock body, char (soot / cavities), crack glow, white-hot core. */
  setPalette(rock: number, char: number, crack: number, hot: number): void {
    putHex(this.u.uColorRock.value, rock);
    putHex(this.u.uColorChar.value, char);
    putHex(this.u.uColorCrack.value, crack);
    putHex(this.u.uColorHot.value, hot);
  }

  /** Pushes `look` into the uniforms, plus the run-up state: `charge` 0..1 and the unit `heading` of travel. */
  sync(charge = 0, hx = 0, hy = -1, hz = 0): void {
    const l = this.look;
    const u = this.u;
    u.uCrackScale.value = l.crackScale;
    u.uCrackWidth.value = l.crackWidth;
    u.uCrackBranches.value = l.crackBranches;
    u.uCrackGlow.value = l.crackGlow;
    u.uFlow.value = l.crackFlow;
    u.uFlowSpeed.value = l.crackFlowSpeed;
    u.uRockScale.value = l.rockScale;
    u.uFacetTint.value = l.facetTint;
    u.uCavity.value = l.cavity;
    u.uSoot.value = l.soot;
    u.uRimHeat.value = l.rimHeat;
    u.uLead.value = l.leadGlow;
    u.uLeadSharp.value = l.leadSharp;
    u.uGlow.value = l.glow;
    u.uCharge.value = charge;
    u.uHeading.value.set(hx, hy, hz);
  }
}
