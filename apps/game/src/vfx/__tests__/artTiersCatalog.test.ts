// RenderCatalog.vfxTiers (app/simFeed.buildCatalog): the run's art scope split by when a spec is first needed, only where content
// is streamed (production, `?payload=1`, render/payloadPolicy.ts). The dev server and the QA captures get no tiers and so await
// every sprite before the run starts.
import { describe, expect, it, vi } from 'vitest';
import { buildCatalog, zoneAmbientLoops } from '../../app/simFeed';
import { content } from '../../data/loader';
import { createWorld } from '../../sim/world';
import '../presets';
import { AMBIENT_CARRIER_PREFIX, ambientCarrierIds } from '../spec/artScope';

const policy = vi.hoisted(() => ({ lazy: true }));
vi.mock('../../render/payloadPolicy', () => ({ lazyContent: () => policy.lazy }));

function catalogOf(classId: string, doctrine: string, zone = 'yeonmu', coop: { classId: string; doctrine: string }[] = []): ReturnType<typeof buildCatalog> {
  const w = createWorld(
    {
      zone,
      difficulty: 'normal',
      classId: classId as 'warrior',
      doctrine: doctrine as 'a',
      sex: 'm',
      empire: 'saehwa',
      seed: 3,
      meta: { stats: {} },
      coop: coop.map((c) => ({ classId: c.classId as 'warrior', doctrine: c.doctrine as 'a', sex: 'f', empire: 'saehwa', meta: { stats: {} } })),
    } as Parameters<typeof createWorld>[0],
    content,
  );
  return buildCatalog(w);
}

describe('RenderCatalog.vfxTiers', () => {
  it('production: the three tiers split vfxSpecs, the hero starts are in the first one', () => {
    policy.lazy = true;
    const cat = catalogOf('shaman', 'a');
    const t = cat.vfxTiers;
    expect(t).toBeDefined();
    if (!t || !cat.vfxSpecs) return;
    const all = [...t.now, ...t.soon, ...t.late];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...cat.vfxSpecs].sort());
    const d = content.classes.find((c) => c.id === 'shaman')?.doctrines.find((x) => x.id === 'a');
    expect(d).toBeDefined();
    for (const id of [d?.basic, d?.starter]) {
      const spec = content.skills.find((s) => s.id === id)?.vfx;
      if (spec && cat.vfxSpecs.includes(spec)) expect(t.now, `${id} -> ${spec}`).toContain(spec);
    }
    // the element hit of the shaman's holy start skills joins them; nobody's boss / metin effects do
    expect(t.now).toContain('hit.holy');
    expect(t.now.some((id) => id.startsWith('boss.') || id.startsWith('sk.gen.metin_'))).toBe(false);
    expect(t.late).toContain('sk.gen.metin_crash');
  });

  it('co-op: every hero\'s start skills are NOW', () => {
    policy.lazy = true;
    const cat = catalogOf('warrior', 'a', 'yeonmu', [{ classId: 'yacha', doctrine: 'b' }]);
    const yacha = content.classes.find((c) => c.id === 'yacha')?.doctrines.find((x) => x.id === 'b');
    const t = cat.vfxTiers;
    for (const id of [yacha?.basic, yacha?.starter]) {
      const spec = content.skills.find((s) => s.id === id)?.vfx;
      if (spec && cat.vfxSpecs?.includes(spec)) expect(t?.now, `${id} -> ${spec}`).toContain(spec);
    }
  });

  it('the own ambient sprites of the zone are NOW where its look has ambient particles at frame 1 (RunSession.load); a zone without an ambient loop carries none at all', () => {
    policy.lazy = true;
    let loops = 0;
    for (const z of content.zones) {
      const t = catalogOf('warrior', 'a', z.id).vfxTiers;
      // the zone's first loop (biome.particles) is on screen at frame 1; the look's extra loops (Daeryeol's smoke, DY-04) are SOON
      const [first = '', ...rest] = ambientCarrierIds(zoneAmbientLoops(z.id, z.biome));
      const carried = [...(t?.now ?? []), ...(t?.soon ?? []), ...(t?.late ?? [])].filter((id) => id.startsWith(AMBIENT_CARRIER_PREFIX));
      expect([...carried].sort(), `${z.id} ambient carriers`).toEqual((first === '' ? [] : [first, ...rest]).sort());
      if (first !== '') {
        loops++;
        expect(t?.now, `${z.id} ambient NOW`).toContain(first);
        for (const extra of rest) expect(t?.soon, `${z.id} ambient SOON`).toContain(extra);
      }
    }
    expect(loops).toBeGreaterThanOrEqual(1);
  });

  it('the first time band decides which enemy projectile effects are NOW (a ranged fire caster in suryeon, none in yeonmu)', () => {
    policy.lazy = true;
    const yeonmu = catalogOf('warrior', 'a', 'yeonmu').vfxTiers;
    const suryeon = catalogOf('warrior', 'a', 'suryeon').vfxTiers;
    expect(yeonmu?.now.some((id) => id.startsWith('sk.gen.ep_'))).toBe(false);
    expect(yeonmu?.soon).toContain('sk.gen.ep_making_fire');
    expect(suryeon?.now).toEqual(expect.arrayContaining(['sk.gen.ep_making_fire', 'sk.gen.ep_release_fire', 'sk.gen.ep_blow_fire']));
    expect(suryeon?.now).not.toContain('sk.gen.ep_making_ice');
  });

  it('a first band with packs that have a leader brings the arrival and death puffs of the leader into NOW (yeonmu, suryeon), a band without does not (seori, daeryeol)', () => {
    policy.lazy = true;
    for (const z of content.zones) {
      const first = [...z.bands].sort((a, b) => a.from - b.from)[0];
      const leads = first?.spawns.some((s) => s.group?.leader !== undefined) === true;
      const t = catalogOf('warrior', 'a', z.id).vfxTiers;
      expect(t?.now.includes('spawn.elite'), `${z.id} spawn.elite NOW`).toBe(leads);
      expect(t?.now.includes('death.boss'), `${z.id} death.boss NOW`).toBe(leads);
      expect(t?.late.includes('spawn.elite'), `${z.id} spawn.elite LATE`).toBe(!leads);
      // the elites of later bands, corrupt metin swarms and summons stay late either way
      expect(t?.now).not.toContain('death.elite');
      expect(t?.now).not.toContain('spawn.corrupt');
    }
    expect(catalogOf('warrior', 'a', 'yeonmu').vfxTiers?.now).toContain('spawn.elite');
    expect(catalogOf('warrior', 'a', 'seori').vfxTiers?.late).toContain('spawn.elite');
  });

  it('the hit the hero takes is NOW in every zone', () => {
    policy.lazy = true;
    for (const z of content.zones) expect(catalogOf('ninja', 'b', z.id).vfxTiers?.now, z.id).toContain('hit.player');
  });

  it('a start skill that burns brings the fire status effects into NOW (yacha: scorch_palm)', () => {
    policy.lazy = true;
    const t = catalogOf('yacha', 'a').vfxTiers;
    expect(t?.now).toEqual(expect.arrayContaining(['hit.fire', 'sk.gen.fire_loop', 'hit.dot.burn']));
    expect(t?.soon).toContain('sk.gen.poison_loop');
  });

  it('the dev server awaits everything: no tiers', () => {
    policy.lazy = false;
    const cat = catalogOf('warrior', 'a');
    expect(cat.vfxTiers).toBeUndefined();
    expect(cat.vfxSpecs?.length).toBeGreaterThan(50);
    policy.lazy = true;
  });
});
