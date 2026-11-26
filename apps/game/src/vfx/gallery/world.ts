// Dev-only terrain-like backdrop for the gallery: rolling dark grassland, a hero stand-in and an instanced crowd of
// creature stand-ins so effects are judged at the game's scale and camera.
import {
  BufferAttribute,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** gentle rolling terrain so ground decals have to follow slopes */
export function heightAt(x: number, z: number): number {
  return 0.55 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05) + 0.25 * Math.sin(x * 0.11 + z * 0.09) + 0.08 * Math.sin(x * 0.4) * Math.sin(z * 0.37);
}

function groundTexture(): CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#34421f';
  g.fillRect(0, 0, S, S);
  let seed = 1234567;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 140; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dirt = rnd() < 0.3;
    const col = dirt ? '82,66,38' : rnd() < 0.5 ? '40,56,24' : '58,74,30';
    grd.addColorStop(0, `rgba(${col},0.55)`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.save();
      g.translate(ox, oy);
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.restore();
    }
  }
  g.lineWidth = 1;
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * S, y = rnd() * S;
    const l = 4 + rnd() * 9;
    g.strokeStyle = `rgba(${90 + rnd() * 50},${110 + rnd() * 50},${40 + rnd() * 30},${0.15 + rnd() * 0.3})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 4, y - l);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(36, 36);
  return t;
}

export interface GalleryWorld {
  scene: Scene;
  hero: Mesh;
  crowd: InstancedMesh | null;
  setCrowd(n: number, radius: number): void;
  updateCrowd(dt: number): void;
  crowdPos: Float32Array;
  crowdCount: number;
}

function creatureGeometry() {
  const body = new CapsuleGeometry(0.42, 0.7, 4, 10);
  body.translate(0, 0.75, 0);
  const head = new SphereGeometry(0.3, 10, 8);
  head.translate(0, 1.55, 0.18);
  const merged = mergeGeometries([body, head], false);
  const n = merged.attributes.position!.count;
  const col = new Float32Array(n * 3);
  const pos = merged.attributes.position!;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const k = 0.35 + 0.65 * Math.min(1, y / 1.8);
    col[i * 3] = 0.42 * k;
    col[i * 3 + 1] = 0.3 * k;
    col[i * 3 + 2] = 0.24 * k;
  }
  merged.setAttribute('color', new BufferAttribute(col, 3));
  return merged;
}

/** stand-in creature scale (the game's enemies are ~1 m tall) */
const CROWD_SCALE = 0.78;


export function createWorld(opts: { flat?: boolean } = {}): GalleryWorld {
  const scene = new Scene();
  scene.background = new Color('#0b0d10');
  scene.fog = new Fog('#10151a', 70, 190);
  const hemi = new HemisphereLight('#a8c0ff', '#3a2e1c', 0.85);
  scene.add(hemi);
  const sun = new DirectionalLight('#fff0d4', 2.2);
  sun.position.set(-30, 50, 25);
  scene.add(sun);

  const size = 260;
  const geo = new PlaneGeometry(size, size, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as BufferAttribute;
  if (!opts.flat) for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const uv = geo.attributes.uv as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i));
  const ground = new Mesh(geo, new MeshStandardMaterial({ map: groundTexture(), roughness: 1, metalness: 0 }));
  scene.add(ground);

  const hero = new Mesh(
    new CapsuleGeometry(0.34, 0.8, 4, 10).translate(0, 0.8, 0),
    new MeshStandardMaterial({ color: '#b8c4d8', roughness: 0.6, metalness: 0.2, emissive: '#102030', emissiveIntensity: 0.4 }),
  );
  scene.add(hero);

  const cgeo = creatureGeometry();
  const cmat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, color: '#6f625c' });
  const MAXC = 700;
  const crowd = new InstancedMesh(cgeo, cmat, MAXC);
  crowd.count = 0;
  crowd.frustumCulled = false;
  scene.add(crowd);
  const crowdPos = new Float32Array(MAXC * 4); // x z vx vz
  const crowdPol = new Float32Array(MAXC * 4); // angle, radius, angular speed, radial phase
  const m = new Matrix4();
  const w: GalleryWorld = {
    scene,
    hero,
    crowd,
    crowdPos,
    crowdCount: 0,
    setCrowd(n: number, radius: number): void {
      w.crowdCount = Math.min(n, MAXC);
      crowd.count = w.crowdCount;
      for (let i = 0; i < w.crowdCount; i++) {
        // a swarm that circles the hero: dense near the player, thinning outwards
        crowdPol[i * 4] = Math.random() * Math.PI * 2;
        crowdPol[i * 4 + 1] = 2.4 + Math.pow(Math.random(), 0.8) * radius;
        crowdPol[i * 4 + 2] = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.22);
        crowdPol[i * 4 + 3] = Math.random() * 6.283;
      }
      w.updateCrowd(0);
    },
    updateCrowd(dt: number): void {
      for (let i = 0; i < w.crowdCount; i++) {
        const a = (crowdPol[i * 4] as number) + (crowdPol[i * 4 + 2] as number) * dt;
        const ph = (crowdPol[i * 4 + 3] as number) + dt * 0.7;
        crowdPol[i * 4] = a;
        crowdPol[i * 4 + 3] = ph;
        const r = (crowdPol[i * 4 + 1] as number) + Math.sin(ph) * 0.35;
        const x = Math.cos(a) * r * 1.35;
        const z = Math.sin(a) * r;
        crowdPos[i * 4] = x;
        crowdPos[i * 4 + 1] = z;
        // face the hero (origin) like a chasing enemy
        m.makeRotationY(Math.atan2(-x, -z));
        const e = m.elements;
        for (let k = 0; k < 11; k++) if (k !== 3 && k !== 7) e[k] = (e[k] as number) * CROWD_SCALE;
        m.setPosition(x, heightAt(x, z), z);
        crowd.setMatrixAt(i, m);
      }
      crowd.instanceMatrix.needsUpdate = true;
    },
  };
  return w;
}
