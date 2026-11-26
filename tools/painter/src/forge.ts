// Glue to the forge CLI: build a model (fresh layoutHash), and re-build with --ship after painting so the cached texture ships.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.ts';

export interface ForgeRun {
  ok: boolean;
  log: string;
  glb: string;
  stale: boolean;
}

export async function forgeBuild(id: string, opts: { ship?: boolean; tex?: number } = {}, log: (s: string) => void = console.log): Promise<ForgeRun> {
  const args = ['tools/forge/src/cli.ts', 'build', id];
  if (opts.ship) args.push('--ship');
  if (opts.tex !== undefined) args.push(`--tex=${opts.tex}`);
  log(`$ bun ${args.join(' ')}`);
  const proc = Bun.spawn(['bun', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  const text = `${out}\n${err}`;
  const glb = join(ROOT, '.research', 'forge', 'tmp', `${id}.glb`);
  return { ok: code === 0 && existsSync(glb), log: text, glb, stale: /STALE/.test(text) };
}

export interface RosterEntry {
  id: string;
  kind: string;
  archetype: string;
  description: string;
  heightM?: number;
}

export function rosterEntry(id: string): RosterEntry | undefined {
  const p = join(ROOT, 'content', 'model_roster.json');
  if (!existsSync(p)) return undefined;
  const j = JSON.parse(readFileSync(p, 'utf8')) as { models: RosterEntry[] };
  return j.models.find((m) => m.id === id);
}

/** material hint for the repaint prompt from a roster entry (overridable with --material) */
export function guessMaterial(e: RosterEntry | undefined): string {
  if (!e) return 'fur';
  const a = `${e.archetype} ${e.kind}`.toLowerCase();
  if (/metin|stone|golem|structure|monolith|obelisk/.test(a)) return 'stone';
  if (/weapon|pickup/.test(a)) return 'metal';
  if (/spirit/.test(a)) return 'spirit';
  if (/humanoid_beast/.test(a)) return 'fur+cloth';
  if (/prop|tree/.test(a)) return 'wood';
  if (/dragon|reptile|scale|arthro|insect|fish|serpent|spider|scorpion|snake/.test(a)) return 'scale';
  if (/humanoid|hero|orc|ogre|demon|shaman|ninja|skeleton|undead|ghost/.test(a)) return 'cloth+skin';
  return 'fur';
}
