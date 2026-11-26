// Gallery-local HDR + bloom + ACES composite, mirroring the game's post pipeline closely enough to judge VFX.
import {
  AddEquation,
  CustomBlending,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { displayLayer } from '../spec/display';

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy*2.0, 0.0, 1.0); }`;

const PRE = /* glsl */ `
uniform sampler2D tex; uniform float thr; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tex, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float k = clamp((br - thr + 0.5)/1.0, 0.0, 1.0); k = k*k*0.5;
  float w = max(br - thr, k) / max(br, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;
const DOWN = /* glsl */ `
uniform sampler2D tex; uniform vec2 px; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tex, vUv).rgb*4.0;
  s += texture2D(tex, vUv + px*vec2(-1.0,-1.0)).rgb;
  s += texture2D(tex, vUv + px*vec2( 1.0,-1.0)).rgb;
  s += texture2D(tex, vUv + px*vec2(-1.0, 1.0)).rgb;
  s += texture2D(tex, vUv + px*vec2( 1.0, 1.0)).rgb;
  gl_FragColor = vec4(s/8.0, 1.0);
}`;
const UP = /* glsl */ `
uniform sampler2D tex; uniform vec2 px; uniform float k; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tex, vUv + px*vec2(-1.0, 0.0)).rgb;
  s += texture2D(tex, vUv + px*vec2( 1.0, 0.0)).rgb;
  s += texture2D(tex, vUv + px*vec2( 0.0,-1.0)).rgb;
  s += texture2D(tex, vUv + px*vec2( 0.0, 1.0)).rgb;
  s += texture2D(tex, vUv + px*vec2(-1.0,-1.0)).rgb*0.5;
  s += texture2D(tex, vUv + px*vec2( 1.0,-1.0)).rgb*0.5;
  s += texture2D(tex, vUv + px*vec2(-1.0, 1.0)).rgb*0.5;
  s += texture2D(tex, vUv + px*vec2( 1.0, 1.0)).rgb*0.5;
  gl_FragColor = vec4(s/6.0*k, 1.0);
}`;
const COMP = /* glsl */ `
uniform sampler2D scene; uniform sampler2D bloom; uniform float strength; uniform float exposure; varying vec2 vUv;
vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
void main(){
  vec3 c = texture2D(scene, vUv).rgb + texture2D(bloom, vUv).rgb * strength;
  c = aces(c*exposure);
  vec2 d = vUv - 0.5; float v = 1.0 - dot(d,d)*0.55;
  c *= v;
  c = pow(c, vec3(1.0/2.2));
  gl_FragColor = vec4(c, 1.0);
}`;

export class HdrPost {
  readonly sceneRT: WebGLRenderTarget;
  private readonly mips: WebGLRenderTarget[] = [];
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scn = new Scene();
  private readonly quad: Mesh;
  private readonly pre: ShaderMaterial;
  private readonly down: ShaderMaterial;
  private readonly up: ShaderMaterial;
  private readonly comp: ShaderMaterial;
  strength = 0.55;
  exposure = 1.0;
  private w = 0;
  private h = 0;

  constructor(private readonly renderer: WebGLRenderer, w: number, h: number, private readonly levels = 5) {
    const mk = (tx: string, uniforms: Record<string, { value: unknown }>, fs: string, add = false): ShaderMaterial =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: fs,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: add ? CustomBlending : NoBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneFactor,
      });
    this.pre = mk('tex', { tex: { value: null }, thr: { value: 1.0 } }, PRE);
    this.down = mk('tex', { tex: { value: null }, px: { value: { x: 0, y: 0 } } }, DOWN);
    this.up = mk('tex', { tex: { value: null }, px: { value: { x: 0, y: 0 } }, k: { value: 1 } }, UP, true);
    this.comp = mk('scene', { scene: { value: null }, bloom: { value: null }, strength: { value: 0.55 }, exposure: { value: 1 } }, COMP);
    this.quad = new Mesh(new PlaneGeometry(1, 1), this.pre);
    this.quad.frustumCulled = false;
    this.scn.add(this.quad);
    this.sceneRT = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      samples: 4,
      depthTexture: new DepthTexture(w, h, UnsignedIntType),
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    this.setSize(w, h);
  }

  get depth(): Texture {
    return this.sceneRT.depthTexture as Texture;
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.sceneRT.setSize(w, h);
    for (const m of this.mips) m.dispose();
    this.mips.length = 0;
    let mw = w >> 1;
    let mh = h >> 1;
    for (let i = 0; i < this.levels; i++) {
      this.mips.push(
        new WebGLRenderTarget(Math.max(2, mw), Math.max(2, mh), { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false }),
      );
      mw >>= 1;
      mh >>= 1;
    }
  }

  private run(mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scn, this.cam);
  }

  render(scene: Scene, camera: Camera): void {
    const r = this.renderer;
    // spec elements blended in display space (spec/display.ts) skip the HDR scene pass: they are drawn after the composite
    const layer = displayLayer();
    layer?.beginScene();
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    const mips = this.mips;
    const m0 = mips[0] as WebGLRenderTarget;
    this.pre.uniforms.tex!.value = this.sceneRT.texture;
    this.run(this.pre, m0);
    for (let i = 1; i < mips.length; i++) {
      const src = mips[i - 1] as WebGLRenderTarget;
      this.down.uniforms.tex!.value = src.texture;
      const px = this.down.uniforms.px!.value as { x: number; y: number };
      px.x = 1 / src.width;
      px.y = 1 / src.height;
      this.run(this.down, mips[i] as WebGLRenderTarget);
    }
    for (let i = mips.length - 1; i > 0; i--) {
      const src = mips[i] as WebGLRenderTarget;
      this.up.uniforms.tex!.value = src.texture;
      const px = this.up.uniforms.px!.value as { x: number; y: number };
      px.x = 1 / src.width;
      px.y = 1 / src.height;
      this.up.uniforms.k!.value = 1;
      this.run(this.up, mips[i - 1] as WebGLRenderTarget);
    }
    this.comp.uniforms.scene!.value = this.sceneRT.texture;
    this.comp.uniforms.bloom!.value = m0.texture;
    this.comp.uniforms.strength!.value = this.strength;
    this.comp.uniforms.exposure!.value = this.exposure;
    this.run(this.comp, null);
    layer?.drawOverlay(r, camera, this.sceneRT.depthTexture, this.sceneRT.width, this.sceneRT.height);
  }

  dispose(): void {
    this.sceneRT.dispose();
    for (const m of this.mips) m.dispose();
  }

  get size(): [number, number] {
    return [this.w, this.h];
  }
}
