// Ported from threejs-vfx src/vfx/Shell.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// One draw call per shell. A `(t, a)` surface grid (`createBeamTubeGeometry`) is turned into a silhouette by the vertex shader:
// DOME = a hemisphere standing on the floor with a bright seal where it meets it; PRESSURE = a near-invisible fresnel lens that
// reads as displaced air (squash it flat and it is the front of a ground slam). The sandbox's settings contract, cone / ring-train /
// sun-disc modes and editor schema are dropped; the shell is driven by a normalised life `t`, never by a captured radius.
import { AdditiveBlending, Color, DoubleSide, Mesh, ShaderMaterial, Vector3 } from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { commonGLSL } from './glsl/common';
import { noiseGLSL } from './glsl/noise';
import { createBeamTubeGeometry } from './geometry';
import { saturate } from './math';

export const ShellMode = { DOME: 0, PRESSURE: 1 } as const;
export type ShellModeId = (typeof ShellMode)[keyof typeof ShellMode];

/** The shell's live look. Defaults per mode are the sandbox's; callers overwrite fields before `sync`. */
export interface ShellLook {
  /** radius at t = 0 and t = 1, metres */
  radius: number;
  radiusEnd: number;
  /** easing exponent: 1 − (1−t)^expand; > 1 = fast then easing out */
  expand: number;
  /** axial extent × radius (squash a dome, stretch a sphere) */
  height: number;
  /** hover above the origin along the axis, metres */
  lift: number;
  /** billow along the normal × radius */
  displace: number;
  noiseScale: number;
  /** Hz the billow crawls at */
  noiseSpeed: number;
  /** body the shell keeps; 0 = rim only */
  fill: number;
  rim: number;
  rimPower: number;
  /** DOME: brightness where the dome meets the floor, and how wide that band is (fraction of the sweep) */
  seal: number;
  sealWidth: number;
  /** how hard the age dissolve bites; 0 = fade evenly */
  dissolve: number;
  opacity: number;
  /** emissive gain into bloom */
  glow: number;
  /** metres of depth fade against the opaque scene (inert while the host binds no depth) */
  softFade: number;
}

const DEFAULTS: Record<ShellModeId, ShellLook> = {
  [ShellMode.DOME]: {
    radius: 0.6, radiusEnd: 4, expand: 5, height: 1, lift: 0.04, displace: 0.22, noiseScale: 1.8, noiseSpeed: 0.6,
    fill: 0.25, rim: 1, rimPower: 2.2, seal: 1.4, sealWidth: 0.12, dissolve: 0.9, opacity: 1, glow: 1.8, softFade: 0.6,
  },
  [ShellMode.PRESSURE]: {
    radius: 0.6, radiusEnd: 4, expand: 5, height: 1, lift: 0.04, displace: 0.06, noiseScale: 1.8, noiseSpeed: 0.6,
    fill: 0.02, rim: 1.6, rimPower: 3.4, seal: 1.4, sealWidth: 0.12, dissolve: 1.2, opacity: 1, glow: 1.2, softFade: 0.6,
  },
};

const SHELL_UNIFORMS = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586
  #define MODE_DOME     0
  #define MODE_PRESSURE 1

  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uAxis;
  uniform vec3  uSide;
  uniform float uSeed;
  uniform float uAge;
  uniform float uFade;
  uniform float uRadius;
  uniform float uHeight;
  uniform float uLift;
  uniform float uDisplace;
  uniform float uNoiseScale;
  uniform float uNoiseSpeed;
  uniform float uFill;
  uniform float uRim;
  uniform float uRimPower;
  uniform float uSeal;
  uniform float uSealWidth;
  uniform float uDissolve;
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uSoftFade;
  uniform vec3  uColorBody;
  uniform vec3  uColorRim;
  uniform vec3  uColorEdge;
`;

const SHELL_VARYINGS = /* glsl */ `
  varying float vT;
  varying float vViewZ;
  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vDisp;
`;

const SHELL_VERTEX = /* glsl */ `
  ${SHELL_UNIFORMS}
  ${SHELL_VARYINGS}
  ${noiseGLSL}

  /** The shell's local frame: its axis and two vectors spanning across it. */
  void shellFrame(out vec3 ax, out vec3 e1, out vec3 e2) {
    ax = normalize(uAxis);
    vec3 lateral = uSide - ax * dot(uSide, ax);
    e1 = length(lateral) > 1e-4 ? normalize(lateral) : normalize(cross(ax, vec3(0.0, 0.0, 1.0)));
    e2 = normalize(cross(ax, e1));
  }

  void main() {
    vec3 ax, e1, e2;
    shellFrame(ax, e1, e2);

    // One (t, a) grid, two silhouettes: a quarter turn of polar angle is a dome standing on the floor, a half turn a ball.
    #if SHELL_MODE == MODE_DOME
      float polar = position.x * (PI * 0.5);
    #else
      float polar = position.x * PI;
    #endif
    float ang = position.y * TAU;
    vec3 rad = e1 * cos(ang) + e2 * sin(ang);
    vec3 n = ax * cos(polar) + rad * sin(polar);

    // Billowing surface, scrolling as the shell expands. Sampled on the undisplaced direction so the grain stays welded to the
    // shell rather than swimming through it.
    float d = fbm4(n * uNoiseScale * (1.0 + uAge) + vec3(uSeed * 13.0) - vec3(0.0, uTime * uNoiseSpeed, 0.0));
    vDisp = d;

    vec3 shape = ax * (cos(polar) * uHeight) + rad * sin(polar);
    vec3 here = uOrigin + ax * uLift + (shape + n * d * uDisplace) * uRadius;
    vNormalW = normalize(n);
    vT = position.x;
    // the sandbox left this varying unwritten (undefined → NaN rim on some drivers); the view vector is explicit here
    vViewDir = cameraPosition - here;

    vec4 mv = viewMatrix * vec4(here, 1.0);
    vViewZ = mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  ${SHELL_UNIFORMS}
  ${SHELL_VARYINGS}

  uniform float uGlobalGlow;
  uniform float uShaderIntensity;
  uniform vec2  uResolution;
  uniform sampler2D uSceneDepth;
  uniform float uCameraNear;
  uniform float uCameraFar;

  ${noiseGLSL}
  ${commonGLSL}

  void main() {
    float fres = fresnelTerm(vViewDir, vNormalW, max(uRimPower, 0.1), 1.0) * uRim;
    float heat = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);
    // Dissolve the shell away over its life, torn by the same billow the vertex stage already computed. The sandbox cut this
    // out with a hard step (polygonal holes); a soft threshold keeps the torn edge billowing, with a hot lip on it.
    float cut = uAge * (0.6 + uDissolve * 0.75) - 0.15;
    float body = smoothstep(cut, cut + 0.32, heat);
    float lip = body * (1.0 - smoothstep(cut + 0.32, cut + 0.65, heat));

    vec3 color;
    float alpha;
    #if SHELL_MODE == MODE_DOME
      // The seal: a dome that fades out at the floor looks like it is floating. Brightening the last few degrees of the
      // sweep is what plants it.
      float seal = smoothstep(1.0 - max(uSealWidth, 1e-3), 1.0, vT);
      color = mix(uColorBody, uColorRim, clamp(fres, 0.0, 1.0));
      color += uColorEdge * seal * uSeal;
      alpha = (uFill * (0.35 + heat * 0.5) + fres + seal * uSeal * 0.35) * body;
    #else
      // Almost nothing is drawn: a front you read from the way the rim tightens as it passes.
      color = mix(uColorBody, uColorRim, clamp(fres, 0.0, 1.0));
      color += uColorEdge * lip * 0.6;
      alpha = (uFill * 0.15 + fres) * body;
    #endif

    alpha *= uFade * uOpacity;
    if (alpha < 0.004) discard;

    vec2 screenUV = gl_FragCoord.xy / uResolution;
    alpha *= softFade(uSceneDepth, screenUV, vViewZ, uCameraNear, uCameraFar, uSoftFade);
    if (alpha < 0.004) discard;

    color *= uGlow * uGlobalGlow * mix(0.7, 1.0, uShaderIntensity);
    gl_FragColor = vec4(clamp(color, 0.0, 64.0), clamp(alpha, 0.0, 1.0));
  }
`;

const _lat = new Vector3();

function makeUniforms() {
  return sharedUniforms({
    uOrigin: { value: new Vector3() },
    uAxis: { value: new Vector3(0, 1, 0) },
    uSide: { value: new Vector3(1, 0, 0) },
    uSeed: { value: 0 },
    uAge: { value: 0 },
    uFade: { value: 1 },
    uRadius: { value: 1 },
    uHeight: { value: 1 },
    uLift: { value: 0 },
    uDisplace: { value: 0 },
    uNoiseScale: { value: 1 },
    uNoiseSpeed: { value: 0 },
    uFill: { value: 0 },
    uRim: { value: 1 },
    uRimPower: { value: 2 },
    uSeal: { value: 1 },
    uSealWidth: { value: 0.12 },
    uDissolve: { value: 1 },
    uOpacity: { value: 1 },
    uGlow: { value: 1 },
    uSoftFade: { value: 0.6 },
    uColorBody: { value: new Color(0.18, 0.44, 0.6) },
    uColorRim: { value: new Color(0.82, 0.94, 1) },
    uColorEdge: { value: new Color(1, 1, 1) },
  });
}

export class Shell {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly look: ShellLook;
  /** shell frame: origin on the floor, axis away from it, side = reference for the angular seam */
  readonly origin = new Vector3();
  readonly axis = new Vector3(0, 1, 0);
  readonly side = new Vector3(1, 0, 0);
  /** normalised life 0..1 */
  t = 0;
  fade = 1;
  seed = 0;
  /** the radius the rim stands on right now, metres */
  radius = 0;

  private readonly u = makeUniforms();

  constructor(readonly mode: ShellModeId, nodes = 40, sides = 40, renderOrder = 12) {
    this.look = { ...DEFAULTS[mode] };
    this.material = new ShaderMaterial({
      defines: { SHELL_MODE: mode },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
      uniforms: { ...this.u },
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
    });
    this.mesh = new Mesh(createBeamTubeGeometry(nodes, sides), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  /** body / rim / hottest-mark colours as 0xRRGGBB (sRGB) */
  setColors(body: number, rim: number, edge: number): void {
    putHex(this.u.uColorBody.value, body);
    putHex(this.u.uColorRim.value, rim);
    putHex(this.u.uColorEdge.value, edge);
  }

  /** Re-resolves the live radius from `t` and pushes look + state into the material. */
  sync(): void {
    const u = this.u;
    const l = this.look;
    const t = saturate(this.t);
    this.axis.normalize();
    // the seam reference has to be off-axis or the frame degenerates
    _lat.copy(this.side).addScaledVector(this.axis, -this.side.dot(this.axis));
    if (_lat.lengthSq() < 1e-8) {
      this.side.set(0, 0, 1).cross(this.axis);
      if (this.side.lengthSq() < 1e-8) this.side.set(1, 0, 0);
      this.side.normalize();
    }
    const eased = 1 - Math.pow(1 - t, Math.max(l.expand, 0.05));
    this.radius = Math.max(l.radius + (l.radiusEnd - l.radius) * eased, 1e-4);

    u.uOrigin.value.copy(this.origin);
    u.uAxis.value.copy(this.axis);
    u.uSide.value.copy(this.side);
    u.uSeed.value = this.seed;
    u.uAge.value = t;
    u.uFade.value = this.fade;
    u.uRadius.value = this.radius;
    u.uHeight.value = l.height;
    u.uLift.value = l.lift;
    u.uDisplace.value = l.displace;
    u.uNoiseScale.value = l.noiseScale;
    u.uNoiseSpeed.value = l.noiseSpeed;
    u.uFill.value = l.fill;
    u.uRim.value = l.rim;
    u.uRimPower.value = l.rimPower;
    u.uSeal.value = l.seal;
    u.uSealWidth.value = l.sealWidth;
    u.uDissolve.value = l.dissolve;
    u.uOpacity.value = l.opacity;
    u.uGlow.value = l.glow;
    u.uSoftFade.value = l.softFade;
    this.mesh.visible = this.fade > 0.004;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
