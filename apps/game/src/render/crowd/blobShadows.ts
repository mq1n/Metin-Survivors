// One instanced batch of soft ground shadows for every enemy (+ hero/metin when real shadows are off).
// Immediate mode: begin() → add()* → end() once per frame.
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Scene,
} from 'three';

function makeBlobTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.78)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

export class BlobShadows {
  private mesh: InstancedMesh;
  private capacity: number;
  private matrices: Float32Array;
  private alphaAttr: InstancedBufferAttribute;
  private alphas: Float32Array;
  private n = 0;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private readonly texture: CanvasTexture;

  constructor(
    private readonly scene: Scene,
    capacity = 256,
  ) {
    this.texture = makeBlobTexture();
    this.geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({
      map: this.texture,
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // Per-instance strength multiplies the alpha (death fade, distance, hero vs crowd).
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'attribute float aStrength;\nvarying float vStrength;\nvoid main() {\n  vStrength = aStrength;',
      );
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vStrength;\nvoid main() {')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= vStrength;\n#include <opaque_fragment>');
    };
    this.material.customProgramCacheKey = () => 'blob-shadow-v1';
    this.capacity = capacity;
    this.matrices = new Float32Array(capacity * 16);
    this.alphas = new Float32Array(capacity);
    this.alphaAttr = new InstancedBufferAttribute(this.alphas, 1);
    this.mesh = this.build();
    scene.add(this.mesh);
  }

  private build(): InstancedMesh {
    const geo = this.geometry.clone();
    this.alphaAttr = new InstancedBufferAttribute(this.alphas, 1);
    this.alphaAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('aStrength', this.alphaAttr);
    const mesh = new InstancedMesh(geo, this.material, this.capacity);
    (mesh.instanceMatrix as InstancedBufferAttribute).array = this.matrices;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.count = 0;
    return mesh;
  }

  private grow(min: number): void {
    let cap = this.capacity;
    while (cap < min) cap *= 2;
    const matrices = new Float32Array(cap * 16);
    matrices.set(this.matrices.subarray(0, this.n * 16));
    const alphas = new Float32Array(cap);
    alphas.set(this.alphas.subarray(0, this.n));
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.capacity = cap;
    this.matrices = matrices;
    this.alphas = alphas;
    this.mesh = this.build();
    this.scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  /** Flat blob centred at (x,y,z) with `radius` (metres, shadow disc radius) and `strength` 0..1. */
  add(x: number, y: number, z: number, radius: number, strength: number): void {
    if (this.n >= this.capacity) this.grow(this.n + 1);
    const i = this.n++;
    const d = radius * 2;
    const m = this.matrices;
    const o = i * 16;
    m[o] = d;
    m[o + 1] = 0;
    m[o + 2] = 0;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 1;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = 0;
    m[o + 9] = 0;
    m[o + 10] = d;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y + 0.04;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.alphas[i] = strength;
  }

  end(): void {
    const mesh = this.mesh;
    mesh.count = this.n;
    mesh.visible = this.n > 0;
    if (this.n === 0) return;
    const im = mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, this.n * 16);
    im.needsUpdate = true;
    this.alphaAttr.clearUpdateRanges();
    this.alphaAttr.addUpdateRange(0, this.n);
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

