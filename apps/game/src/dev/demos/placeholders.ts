// DEV demo `?demo=placeholders`: contact sheet of every procedural placeholder model, each cycling through its clips.
// Free orbit camera (drag / wheel / WASD+QE), `G` = real game camera. Hotkeys are listed in the on-screen HUD.
// Scripting hook for screenshots: `window.__ph` (goto, setClip, scrub, freeze, cam, stats).
import {
  AnimationMixer,
  Box3,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type Object3D,
} from 'three';
import type { ModelKind } from '../../data/assetManifest';
import type { LoadedModel, ModelInstance } from '../../engine/assets';
import type { RenderSystem } from '../../render/core';
import { WEAPON_ATTACH } from '../placeholders/weapons';
import { createHarness } from '../harness';

interface StationDef {
  id: string;
  hint: ModelKind;
  x: number;
  z: number;
  weapon?: string;
  /** manual y offset (floating pickups) */
  y?: number;
  /** static spin (rad/s) for pickups */
  spin?: number;
}

interface SectionDef {
  key: string;
  name: string;
  /** camera distance for a close inspection */
  dist: number;
  /** camera target height (m) */
  y: number;
  pitch?: number;
  stations: StationDef[];
}

const SP = 2.6;
function row(ids: string[], hint: ModelKind, z: number, spacing = SP, extra: Partial<StationDef> = {}): StationDef[] {
  const x0 = -((ids.length - 1) * spacing) / 2;
  return ids.map((id, i) => ({ id, hint, x: x0 + i * spacing, z, ...extra }));
}

function buildSections(): SectionDef[] {
  return [
    { key: '1', name: 'quadrupeds', dist: 7.5, y: 0.45, stations: row(['wolf_a', 'boar_a', 'bear_a', 'tiger_a', 'wolf_b'], 'creature', 0, 2.1) },
    { key: '2', name: 'humanoids', dist: 8, y: 0.95, stations: row(['orc_a', 'orc_b', 'bandit_c', 'ninja_d'], 'creature', 0, 2.2) },
    { key: '3', name: 'brutes', dist: 10.5, y: 1.05, stations: row(['golem_a', 'yeti_b', 'brute_c'], 'creature', 0, 3.2) },
    { key: '4', name: 'bosses', dist: 21, y: 2.4, stations: row(['boss_oni', 'boss_tiger'], 'boss', 0, 8) },
    {
      key: '5',
      name: 'heroes',
      dist: 9.5,
      y: 0.95,
      stations: [
        ...row(['hero_warrior_m_t1', 'hero_ninja_f_t1', 'hero_yacha_m_t1', 'hero_shaman_f_t1', 'hero_wolfman_m_t1'], 'hero', 0, 2.4).map((s, i) => ({
          ...s,
          weapon: ['weapon_sword', 'weapon_dagger', 'weapon_blade_yacha', 'weapon_bell', 'weapon_claw'][i],
        })),
      ],
    },
    {
      key: '6',
      name: 'pickups',
      dist: 3.4,
      y: 0.2,
      pitch: 0.5,
      stations: [
        ...row(['xp_gem', 'yeop_coin', 'potion_hp'], 'pickup', 0, 0.55, { y: 0, spin: 0.7 }),
        ...row(['chest_wood', 'chest_gold', 'chest_boss'], 'pickup', 1.4, 1.5),
      ],
    },
    { key: '7', name: 'metin', dist: 14, y: 1.7, stations: row(['metin_lament', 'metin_ember', 'metin_frost'], 'metin', 0, 4) },
    { key: '8', name: 'props', dist: 22, y: 1.5, stations: row(['rock_a', 'boulder_b', 'pine_a', 'oak_a', 'bush_a', 'lantern_a', 'gravestone_a'], 'prop', 0, 4.6) },
    {
      key: '9',
      name: 'weapons',
      dist: 5.2,
      y: 0.65,
      stations: row(['weapon_sword', 'weapon_dagger', 'weapon_blade_yacha', 'weapon_bow', 'weapon_staff', 'weapon_fan', 'weapon_bell', 'weapon_claw'], 'weapon', 0, 0.75, { spin: 0.5 }),
    },
  ];
}

interface Station {
  def: StationDef;
  section: number;
  model: LoadedModel;
  inst: ModelInstance;
  mixer: AnimationMixer | null;
  actions: AnimationAction[];
  order: string[];
  idx: number;
  t: number;
  holdUntil: number;
  label: HTMLDivElement;
  top: Vector3;
  /** world center */
  pos: Vector3;
  current: string;
}

const CYCLE_ORDER = ['spawn', 'idle', 'walk', 'run', 'attack', 'attack2', 'hit', 'special1', 'special2', 'special3', 'cast', 'dash', 'victory', 'death', 'drop', 'pulse', 'shatter'];

export default async function run(): Promise<void> {
  const h = await createHarness({ quality: 'high', fixedQuality: true, groundSize: 700, groundColor: '#566243' });
  const { core, assets } = h;
  core.rig.setZoom(22);

  const sections = buildSections();
  const SECTION_GAP = 40;
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:12px/1.35 monospace;text-shadow:0 1px 2px #000;pointer-events:none;white-space:pre;z-index:5';
  const labelsHost = document.createElement('div');
  labelsHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:4';
  document.body.append(hud, labelsHost);

  const stations: Station[] = [];
  const errors: string[] = [];
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si] as SectionDef;
    for (const def of sec.stations) {
      const placed = { ...def, x: def.x + si * SECTION_GAP };
      try {
        const model = await assets.loadModel(def.id, def.hint);
        const inst = assets.instantiate(def.id);
        inst.root.position.set(placed.x, def.y ?? 0, placed.z);
        inst.root.traverse((o: Object3D) => {
          o.castShadow = true;
          o.receiveShadow = true;
        });
        core.scene.add(inst.root);
        if (def.weapon) {
          await assets.loadModel(def.weapon, 'weapon');
          const w = assets.instantiate(def.weapon);
          const socketBone = model.asset.sockets?.hand_r;
          const bone = socketBone ? inst.bones.get(socketBone) : undefined;
          if (bone) {
            w.root.position.set(...WEAPON_ATTACH.pos);
            w.root.rotation.set(...WEAPON_ATTACH.rot);
            bone.add(w.root);
            w.root.traverse((o: Object3D) => {
              o.castShadow = true;
            });
          }
        }
        const mixer = inst.clips.length ? new AnimationMixer(inst.root) : null;
        const actions = inst.clips.map((c) => (mixer as AnimationMixer).clipAction(c));
        const names = inst.clips.map((c) => c.name);
        const order = CYCLE_ORDER.filter((n) => names.includes(n));
        for (const n of names) if (!order.includes(n)) order.push(n);
        const label = document.createElement('div');
        label.style.cssText = 'position:absolute;transform:translate(-50%,-100%);color:#fff;font:11px/1.25 monospace;text-shadow:0 1px 2px #000,0 0 4px #000;text-align:center;white-space:pre';
        labelsHost.append(label);
        const box = new Box3().setFromObject(inst.root);
        const pos = new Vector3(placed.x, 0, placed.z);
        stations.push({
          def: placed,
          section: si,
          model,
          inst,
          mixer,
          actions,
          order,
          idx: -1,
          t: 0,
          holdUntil: 0,
          label,
          top: new Vector3(placed.x, Math.max(box.max.y, model.asset.height || 1) + 0.25, placed.z),
          pos,
          current: '',
        });
      } catch (e) {
        errors.push(`${def.id}: ${e instanceof Error ? e.message : String(e)}`);
        console.error(e);
      }
    }
  }

  // ---- animation cycling
  let forced: string | null = null;
  let frozen = false;
  let paused = false;
  let showLabels = true;

  const play = (st: Station, name: string): void => {
    if (!st.mixer) return;
    const action = st.actions.find((a) => a.getClip().name === name);
    if (!action) return;
    st.mixer.stopAllAction();
    action.reset();
    const info = st.model.asset.clips[name];
    action.setLoop(info?.loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    st.t = 0;
    st.current = name;
    const dur = action.getClip().duration;
    st.holdUntil = info?.loop ? Math.max(dur * 2, 2.2) : dur + 0.45;
  };
  const nextClip = (st: Station): void => {
    if (st.order.length === 0) return;
    st.idx = (st.idx + 1) % st.order.length;
    play(st, st.order[st.idx] as string);
  };
  const applyForced = (name: string | null): void => {
    forced = name;
    frozen = false;
    for (const st of stations) {
      if (name === null) nextClip(st);
      else play(st, name);
    }
  };
  stations.forEach((st, i) => {
    st.idx = i % Math.max(1, st.order.length);
    nextClip(st);
  });

  // ---- camera
  const cam = { target: new Vector3(0, 0.8, 0), yaw: 0, pitch: 0.42, dist: 8, game: false, section: 0 };
  const gotoSection = (i: number): void => {
    const n = sections.length;
    cam.section = ((i % n) + n) % n;
    const sec = sections[cam.section] as SectionDef;
    const xs = stations.filter((s) => s.section === cam.section).map((s) => s.pos);
    const c = new Vector3();
    for (const p of xs) c.add(p);
    if (xs.length) c.multiplyScalar(1 / xs.length);
    cam.target.set(c.x, sec.y, c.z);
    cam.dist = sec.dist;
    cam.pitch = sec.pitch ?? 0.3;
    core.rig.setTarget(c.x, 0, c.z);
    core.rig.snap();
  };
  gotoSection(0);

  const system: RenderSystem = {
    name: 'placeholders-orbit',
    update(dt) {
      if (!paused && !frozen) {
        for (const st of stations) {
          if (!st.mixer) {
            if (st.def.spin) st.inst.root.rotation.y += st.def.spin * dt;
            continue;
          }
          if (forced === null) {
            st.t += dt;
            if (st.t > st.holdUntil) nextClip(st);
          } else {
            st.t += dt;
            const info = st.model.asset.clips[forced];
            const dur = info?.duration ?? 1;
            if (!info?.loop && st.t > dur + 0.5) play(st, forced);
          }
          st.mixer.update(dt);
        }
      }
      if (!cam.game) {
        const c = core.camera;
        const cp = Math.cos(cam.pitch);
        c.position.set(cam.target.x + Math.sin(cam.yaw) * cp * cam.dist, cam.target.y + Math.sin(cam.pitch) * cam.dist, cam.target.z + Math.cos(cam.yaw) * cp * cam.dist);
        c.lookAt(cam.target);
        c.updateMatrixWorld(true);
      }
      // labels
      const w = window.innerWidth;
      const hh = window.innerHeight;
      const v = new Vector3();
      for (const st of stations) {
        const near = st.section === cam.section || cam.game;
        if (!showLabels || !near) {
          st.label.style.display = 'none';
          continue;
        }
        v.copy(st.top).project(core.camera);
        if (v.z > 1) {
          st.label.style.display = 'none';
          continue;
        }
        st.label.style.display = 'block';
        st.label.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
        st.label.style.top = `${(-v.y * 0.5 + 0.5) * hh}px`;
        const a = st.model.asset;
        st.label.textContent = `${a.id}\n${a.tris} tris${a.bones ? ` · ${a.bones} bones` : ''}${st.current ? `\n▶ ${st.current}` : ''}`;
      }
    },
  };
  core.addSystem(system);

  // ---- input
  let drag: { x: number; y: number } | null = null;
  h.canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    h.canvas.setPointerCapture(e.pointerId);
  });
  h.canvas.addEventListener('pointerup', () => (drag = null));
  h.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw -= (e.clientX - drag.x) * 0.006;
    cam.pitch = Math.max(-0.1, Math.min(1.5, cam.pitch + (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
  });
  h.canvas.addEventListener(
    'wheel',
    (e) => {
      cam.dist = Math.max(1.2, Math.min(60, cam.dist * Math.exp(e.deltaY * 0.001)));
      e.preventDefault();
    },
    { passive: false },
  );
  const allClips = (): string[] => {
    const set = new Set<string>();
    for (const st of stations) for (const n of st.order) set.add(n);
    return CYCLE_ORDER.filter((n) => set.has(n));
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const si = sections.findIndex((s) => s.key === k);
    if (si >= 0) gotoSection(si);
    else if (k === 'g') {
      cam.game = !cam.game;
      if (cam.game) {
        core.rig.setZoom(22);
        core.rig.snap();
      }
    } else if (k === ' ') paused = !paused;
    else if (k === 'l') showLabels = !showLabels;
    else if (k === 'a') cam.target.x -= 0.4;
    else if (k === 'd') cam.target.x += 0.4;
    else if (k === 'w') cam.target.z -= 0.4;
    else if (k === 's') cam.target.z += 0.4;
    else if (k === 'q') cam.target.y -= 0.2;
    else if (k === 'e') cam.target.y += 0.2;
    else if (k === 'tab') {
      e.preventDefault();
      gotoSection(cam.section + 1);
    } else if (k === '[' || k === ']') {
      const list = allClips();
      const i = forced ? list.indexOf(forced) : -1;
      applyForced(list[(i + (k === ']' ? 1 : -1) + list.length) % list.length] ?? null);
    } else if (k === '0') applyForced(null);
  });

  // ---- scripting hook
  const api = {
    sections: sections.map((s) => ({ key: s.key, name: s.name, ids: s.stations.map((x) => x.id) })),
    errors,
    goto: (i: number) => gotoSection(i),
    setClip: (name: string | null) => applyForced(name),
    /** freeze every station at `clip` normalised time `u` (0..1) */
    scrub(clip: string, u: number): void {
      frozen = true;
      forced = clip;
      for (const st of stations) {
        if (!st.mixer) continue;
        const action = st.actions.find((a) => a.getClip().name === clip);
        if (!action) continue;
        st.mixer.stopAllAction();
        action.reset();
        action.setLoop(LoopRepeat, Infinity);
        action.play();
        st.mixer.setTime(0);
        // stay just below the end: a repeating action wraps u = 1 back to the first frame
        const clip01 = Math.min(u, 0.9995);
        st.mixer.update(clip01 * action.getClip().duration);
        st.current = `${clip} ${u.toFixed(2)}`;
      }
    },
    freeze: (b: boolean) => {
      paused = b;
    },
    labels: (b: boolean) => {
      showLabels = b;
    },
    cam: (c: Partial<{ yaw: number; pitch: number; dist: number; x: number; y: number; z: number; game: boolean }>) => {
      if (c.yaw !== undefined) cam.yaw = c.yaw;
      if (c.pitch !== undefined) cam.pitch = c.pitch;
      if (c.dist !== undefined) cam.dist = c.dist;
      if (c.x !== undefined) cam.target.x = c.x;
      if (c.y !== undefined) cam.target.y = c.y;
      if (c.z !== undefined) cam.target.z = c.z;
      if (c.game !== undefined) cam.game = c.game;
    },
    /** focus the camera on station index within the current section */
    focus(i: number, dist?: number): void {
      const list = stations.filter((s) => s.section === cam.section);
      const st = list[i];
      if (!st) return;
      cam.target.set(st.pos.x, Math.max(0.4, (st.model.asset.height || 1) * 0.5), st.pos.z);
      if (dist) cam.dist = dist;
    },
    stats() {
      const r = core.renderer.info.render;
      return { calls: r.calls, triangles: r.triangles, stations: stations.length, fps: fps.value };
    },
  };
  Object.assign(window, { __ph: api });

  // ---- loop
  const fps = { value: 0 };
  let acc = 0;
  let frames = 0;
  h.start((dt) => {
    acc += dt;
    frames++;
    if (acc >= 0.5) {
      fps.value = frames / acc;
      acc = 0;
      frames = 0;
      const r = core.renderer.info.render;
      hud.textContent = [
        `placeholders · section ${cam.section + 1}/${sections.length}: ${(sections[cam.section] as SectionDef).name}`,
        `${fps.value.toFixed(0)} fps · ${r.calls} calls · ${(r.triangles / 1000).toFixed(1)}k tris · ${stations.length} models${errors.length ? ` · ${errors.length} ERR` : ''}`,
        `1-9 section · Tab next · [ ] force clip · 0 auto · Space pause · G game cam · L labels · drag/wheel/WASDQE`,
        forced ? `forced clip: ${forced}` : 'auto-cycling clips',
      ].join('\n');
    }
  });
}
