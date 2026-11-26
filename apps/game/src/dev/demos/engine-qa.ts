// DEV QA scene: hero (all actions on keys), a ring of crowd creatures showing every clip, metin phase cycle.
// ?demo=engine-qa[&zoom=16][&quality=high][&metin=sorrow]. Keys: 1-9 hero actions, M restart metin cycle, Z/X zoom.
import { createHarness } from '../harness';
import { RenderWorld } from '../../render/world';
import { CLIP_NAMES, type EnemyFeed, type MetinView, type PlayerFeed, type RenderCatalog } from '../../render/feed';
import type { HeroAction } from '../../render/hero';
import type { QualityTier } from '../../render/quality';
import { StressEnemies } from '../stressDriver';

export default async function run(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const tier = (q.get('quality') ?? 'high') as QualityTier;
  const h = await createHarness({ quality: tier, fixedQuality: true });
  const ids = ['bench_quadruped', 'bench_humanoid', 'bench_brute', 'bench_boss'];
  const catalog: RenderCatalog = {
    enemyTypes: ids.map((id, i) => ({ key: id, modelId: id, radius: i === 3 ? 1.6 : 0.6 })),
    projectileStyles: [],
    metinTypes: [{ key: 'metin_lament', modelId: 'metin_lament', rune: '#5aa8ff' }],
  };
  const world = new RenderWorld(h.core);
  await world.load(catalog, [{ modelId: 'hero_warrior_m_t1', weaponId: 'weapon_sword' }]);
  h.core.rig.setZoom(Number(q.get('zoom') ?? 18));

  // enemy ring: type × clip
  const enemies = new StressEnemies(64);
  const clips = [...CLIP_NAMES];
  let n = 0;
  for (let t = 0; t < ids.length; t++) {
    for (let c = 0; c < clips.length; c++) {
      const i = enemies.count++;
      const a = (n++ / (ids.length * clips.length)) * Math.PI * 2;
      const r = 8 + t * 2.6;
      enemies.x[i] = enemies.px[i] = Math.cos(a) * r;
      enemies.z[i] = enemies.pz[i] = Math.sin(a) * r - 2;
      enemies.rot[i] = Math.PI / 2 - a + Math.PI;
      enemies.scale[i] = t === 3 ? 1 : 1;
      enemies.type[i] = t;
      enemies.animClip[i] = c;
      enemies.eliteTier[i] = c === 8 ? 1 : c === 9 ? 2 : c === 10 ? 3 : 0;
      enemies.corrupted[i] = c === 4 ? 1 : 0;
      enemies.status[i] = c === 2 ? 4 : c === 1 ? 16 : c === 0 ? 2 : 0;
      enemies.flash[i] = c === 5 ? 1 : 0;
      enemies.id[i] = i + 1;
    }
  }
  const player: PlayerFeed & { rot: number; clip?: string } = { x: 0, z: 0, px: 0, pz: 0, rot: 0, speed: 0, dead: false, flash: 0, corrupted: 0 };
  const mutPlayer = player as { -readonly [K in keyof PlayerFeed]: PlayerFeed[K] };
  const metin: { -readonly [K in keyof MetinView]: MetinView[K] } = {
    id: 1, type: 0, x: -10, z: -6, phase: 0, phaseT: 0, hpFrac: 1, scale: 1.4, great: false, auraRadius: 6, warnLeft: 2.5,
  };
  let mt = 0;
  const feeds = { enemies: enemies as EnemyFeed, players: [player], metins: [metin] as readonly MetinView[] };

  const actions: HeroAction[] = ['attack', 'attack2', 'cast', 'dash', 'hit', 'victory', 'special1', 'special2', 'special3'];
  window.addEventListener('keydown', (e) => {
    const k = Number(e.key);
    if (k >= 1 && k <= 9) world.heroes.views[0]?.trigger(actions[k - 1] as HeroAction);
    if (e.key === 'm') mt = 0;
    if (e.key === 'z') h.core.rig.setZoom(h.core.rig.zoom - 2);
    if (e.key === 'x') h.core.rig.setZoom(h.core.rig.zoom + 2);
    if (e.key === 'd') mutPlayer.dead = !mutPlayer.dead;
    if (e.key === 'r') mutPlayer.speed = mutPlayer.speed > 0 ? 0 : 5;
  });
  world.perf.setVisible(true);
  (window as unknown as { __qa: unknown }).__qa = { core: h.core, world, metin, player: mutPlayer, setMt: (v: number) => (mt = v) };
  const anim = { t: 0 };
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    anim.t += dt;
    for (let i = 0; i < enemies.count; i++) enemies.animT[i] = (enemies.animT[i] as number) + dt;
    // loop one-shots so each type keeps showing its clip
    for (let i = 0; i < enemies.count; i++) {
      const c = enemies.animClip[i] as number;
      if ([3, 4, 5, 6, 7, 8, 9, 10].includes(c) && (enemies.animT[i] as number) > 2.2) enemies.animT[i] = 0;
    }
    mt += dt;
    // falling 0..2.5, alive 2.5..9 (drop clip first), awakened 9..14, breaking 14..17, then restart
    const cyc = mt % 17;
    if (cyc < 2.5) {
      metin.phase = 0;
      metin.phaseT = cyc;
      metin.warnLeft = 2.5 - cyc;
    } else if (cyc < 9) {
      metin.phase = 1;
      metin.phaseT = cyc - 2.5;
      metin.hpFrac = 1;
    } else if (cyc < 14) {
      metin.phase = 2;
      metin.phaseT = cyc - 9;
    } else {
      metin.phase = 3;
      metin.phaseT = cyc - 14;
    }
    world.frame(feeds, dt, 1);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
