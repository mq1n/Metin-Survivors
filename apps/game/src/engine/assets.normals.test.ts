import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Texture, TextureLoader } from 'three';
import { Assets } from './assets';

const manifest = (assets: Assets): void => {
  assets.manifest.textures['tex_plain'] = { id: 'tex_plain', url: 'assets/textures/plain.webp', srgb: true, tiling: false, bytes: 1 } as never;
  for (const id of ['tex_rock', 'tex_bark']) {
    assets.manifest.textures[id] = { id, url: `assets/textures/${id}.webp`, normalUrl: `assets/textures/${id}_n.webp`, srgb: true, tiling: true, bytes: 1 } as never;
  }
};

/** fetch() answers every normal map file with a blob; the texture loader turns each into a Texture carrying its own image */
function stubNetwork(): { fetched: string[]; loaded: Array<{ image: object }> } {
  const fetched: string[] = [];
  const loaded: Array<{ image: object }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      return { ok: true, status: 200, blob: async () => new Blob([url]) };
    }),
  );
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const t = new Texture();
    t.image = { real: loaded.length };
    loaded.push({ image: t.image as object });
    return t as never;
  });
  return { fetched, loaded };
}

// A normal map is shared like every other manifest texture: one decode and one GPU upload for the page, not one per zone scene
// of every run (nobody owned the uncached copies to dispose them).
describe('Assets.loadNormalMap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads each normal map once and hands every caller the same texture', async () => {
    const { fetched } = stubNetwork();
    const assets = new Assets('/');
    manifest(assets);
    const [a, b] = await Promise.all([assets.loadNormalMap('tex_rock'), assets.loadNormalMap('tex_rock')]);
    const c = await assets.loadNormalMap('tex_rock');
    expect(a).toBeInstanceOf(Texture);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetched).toEqual(['/assets/textures/tex_rock_n.webp']);
    expect(TextureLoader.prototype.loadAsync).toHaveBeenCalledTimes(1);
    expect(a?.colorSpace).toBe(''); // normal data stays linear
  });

  it('is null for a texture without a normal map, and retries after a failed load', async () => {
    stubNetwork();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const assets = new Assets('/');
    manifest(assets);
    expect(await assets.loadNormalMap('tex_plain')).toBeNull();
    expect(await assets.loadNormalMap('tex_missing')).toBeNull();
    await expect(assets.loadNormalMap('tex_rock')).rejects.toThrow('offline');
    expect(await assets.loadNormalMap('tex_rock')).toBeInstanceOf(Texture);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a file is downloaded once however many consumers ask: the texture loader and the ground fade share it', async () => {
    const { fetched } = stubNetwork();
    const assets = new Assets('/');
    manifest(assets);
    const [file, file2, tex] = await Promise.all([assets.normalFile('tex_rock'), assets.normalFile('tex_rock'), assets.loadNormalMapNow('tex_rock')]);
    expect(file2).toBe(file);
    expect(tex).toBeInstanceOf(Texture);
    expect(fetched).toEqual(['/assets/textures/tex_rock_n.webp']);
    await expect(assets.normalFile('tex_plain')).rejects.toThrow('missing texture asset');
  });
});

describe('Assets.holdNormalMaps (payload policy)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('answers with a flat stand-in, downloads nothing until the gate opens, then swaps the real image into the same texture', async () => {
    const { fetched, loaded } = stubNetwork();
    const assets = new Assets('/');
    manifest(assets);
    let open: () => void = () => undefined;
    assets.holdNormalMaps(new Promise<void>((r) => (open = r)));

    const stand = (await assets.loadNormalMap('tex_rock')) as Texture;
    expect(stand).toBeInstanceOf(Texture);
    expect(stand.colorSpace).toBe(''); // configured like the real map
    expect(stand.wrapS).toBe(1000); // RepeatWrapping (the manifest says tiling)
    expect(await assets.loadNormalMap('tex_rock')).toBe(stand); // every caller shares it
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetched).toEqual([]); // the gate is shut

    const v0 = stand.version;
    open();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetched).toEqual(['/assets/textures/tex_rock_n.webp']); // downloaded at once, swapped after the pacing gap
    expect(stand.image).not.toBe(loaded[0]?.image);
    await vi.advanceTimersByTimeAsync(200);
    expect(stand.image).toBe(loaded[0]?.image); // same Texture object, real pixels now
    expect(stand.version).toBeGreaterThan(v0); // re-uploaded
    expect(await assets.loadNormalMap('tex_rock')).toBe(stand); // later callers get the finished map
  });

  it('swaps one map at a time, a gap apart', async () => {
    const { loaded } = stubNetwork();
    const assets = new Assets('/');
    manifest(assets);
    let open: () => void = () => undefined;
    assets.holdNormalMaps(new Promise<void>((r) => (open = r)));
    const rock = (await assets.loadNormalMap('tex_rock')) as Texture;
    const bark = (await assets.loadNormalMap('tex_bark')) as Texture;
    const v = [rock.version, bark.version];
    open();
    await vi.advanceTimersByTimeAsync(160);
    const done = [rock.version > v[0]!, bark.version > v[1]!];
    expect(done.filter(Boolean)).toHaveLength(1); // only the first swap has happened
    expect(loaded).toHaveLength(2); // (both downloads were already in)
    await vi.advanceTimersByTimeAsync(200);
    expect(rock.version).toBeGreaterThan(v[0]!);
    expect(bark.version).toBeGreaterThan(v[1]!);
  });

  it('loadNormalMapNow (the ground) gets the real map during the hold, without a second download', async () => {
    const { fetched } = stubNetwork();
    const assets = new Assets('/');
    manifest(assets);
    assets.holdNormalMaps(new Promise<void>(() => undefined)); // never opens
    const stand = (await assets.loadNormalMap('tex_rock')) as Texture;
    const now = assets.loadNormalMapNow('tex_rock');
    await vi.advanceTimersByTimeAsync(200);
    expect(await now).toBe(stand); // the stand-in, with its image in place
    expect(fetched).toEqual(['/assets/textures/tex_rock_n.webp']);
  });

  it('never holds back a map that is already loaded, nor a texture without a normal map', async () => {
    stubNetwork();
    const assets = new Assets('/');
    manifest(assets);
    const real = await assets.loadNormalMapNow('tex_rock');
    assets.holdNormalMaps(new Promise<void>(() => undefined));
    expect(await assets.loadNormalMap('tex_rock')).toBe(real);
    expect(await assets.loadNormalMap('tex_plain')).toBeNull();
  });

  it('a failed download leaves the flat stand-in in place, and the next request for the map tries again', async () => {
    stubNetwork();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const assets = new Assets('/');
    manifest(assets);
    let open: () => void = () => undefined;
    assets.holdNormalMaps(new Promise<void>((r) => (open = r)));
    const stand = (await assets.loadNormalMap('tex_rock')) as Texture;
    const v0 = stand.version;
    open();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stand.version).toBe(v0); // the zone looks as it did before the map arrived
    expect(await assets.loadNormalMap('tex_rock')).toBe(stand); // e.g. the next zone scene asking again: a retry starts
    await vi.advanceTimersByTimeAsync(300);
    expect(stand.version).toBeGreaterThan(v0);
    expect(await assets.loadNormalMap('tex_rock')).toBe(stand);
  });
});
