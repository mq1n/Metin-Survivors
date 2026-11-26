
// back against the walking direction. Render-side only (reads interpolated player positions; no sim state).
import type { World } from '../../../sim/world';
import type { SpawnOpts, Vfx } from '../../types';
import { setDustZone, ZONE_DUST_TINT } from '../../common/ambient/dustTint';

const GAP = 2.5;
/** a jump longer than this in one frame is a teleport / respawn, not a step */
const TELEPORT = 3;
const MAX_PLAYERS = 4;

export class FootDustFeed {
  private readonly opts: SpawnOpts = {};
  private readonly lx = new Float32Array(MAX_PLAYERS);
  private readonly lz = new Float32Array(MAX_PLAYERS);
  private readonly acc = new Float32Array(MAX_PLAYERS);
  private readonly seen = new Uint8Array(MAX_PLAYERS);

  reset(): void {
    this.seen.fill(0);
    this.acc.fill(0);
  }

  update(world: World, vfx: Vfx, alpha: number, heightAt: (x: number, z: number) => number): void {
    const n = Math.min(MAX_PLAYERS, world.players.length);
    const tint = ZONE_DUST_TINT[world.zone.id];
    // the enemy charge / leap presets read the same zone's dust pair (they have no zone in their context)
    setDustZone(world.zone.id);
    for (let i = 0; i < n; i++) {
      const p = world.players[i];
      if (!p || !p.alive) {
        this.seen[i] = 0;
        continue;
      }
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      if (this.seen[i] === 0) {
        this.seen[i] = 1;
        this.lx[i] = x;
        this.lz[i] = z;
        this.acc[i] = 0;
        continue;
      }
      const dx = x - (this.lx[i] as number);
      const dz = z - (this.lz[i] as number);
      const d = Math.hypot(dx, dz);
      this.lx[i] = x;
      this.lz[i] = z;
      // dashes draw their own trail (sk.phantom_gallop et al.), teleports are not steps
      if (d > TELEPORT || p.dashT > 0) {
        this.acc[i] = 0;
        continue;
      }
      const a = (this.acc[i] as number) + d;
      if (a < GAP) {
        this.acc[i] = a;
        continue;
      }
      this.acc[i] = a - GAP;
      const o = this.opts;
      o.x = x;
      o.z = z;
      o.y = heightAt(x, z);
      o.dirX = dx / d;
      o.dirZ = dz / d;
      o.scale = 1;
      o.duration = 0;
      o.color = tint;
      vfx.spawn('sk.gen.dust', o);
    }
  }
}
