// Dust colour by zone floor (common VFX target `ambient`; owner: the ambient builder). The foot dust spec gets its tint through SpawnOpts.color (dustFeed.ts); the
// legacy enemy.charge / enemy.leap presets have no zone in their context, so FootDustFeed (which runs every frame with the world in hand) publishes the zone's dust
// pair here and the presets read it when they fire. Alpha-blended dust only reads where it differs from the floor in luma or hue: a pale powder on snow vanishes, a

// r2: the dust sprite (vfx_ambient_dust_body_sheet) is a NEUTRAL light grey puff, so the colour of a puff is exactly hi / lo / body: no warm sprite x cool tint mixing (the r1 olive on snow).

export interface DustPair {
  /** the lit body of the puff */
  readonly hi: number;
  /** the slightly shaded lit tone (alternates with hi so a plume is not one flat colour) / grit */
  readonly lo: number;
  /** the soft shadow underlay: a larger, fainter, cooler / darker copy of the puff drawn under it (r3: the lit powder carries the read, the shadow gives it an edge on a pale floor) */
  readonly shade: number;
  /** alpha of the shadow underlay (0 = none) */
  readonly shadeA: number;
}


export const DUST_DEFAULT: DustPair = { hi: 0xdfe3c6, lo: 0xc4c9ab, shade: 0x80866f, shadeA: 0.2 };

/**
 * the colour keys authored in the sk.gen.dust spec (SpawnOpts.color multiplies them, so a gallery spawn without a tint shows this near-white; the game passes the zone body colour).
 * r3: near white on purpose (r2: 0xe6e8d4): a tint can only take a key channel DOWN, and the lit white-blue powder of the snow zone needs blue >= green >= red at ~0xf8.
 */
export const DUST_AUTHORED = 0xfdfef8;

const ZONE_DUST: Readonly<Record<string, DustPair>> = {
  yeonmu: DUST_DEFAULT,
  /** sand and a tan platform: a cream-sand lighter than the floor */
  suryeon: { hi: 0xeee0bc, lo: 0xd6c298, shade: 0x8c7a56, shadeA: 0.2 },
  /**
   * snow: the floor is near white-grey (luma ~0.78 at the game camera). r2 drew a shaded grey-blue body DARKER than the floor and the critic read soot ("a dark hollow donut"). r3: LIT white-blue
   * powder (it is the brightest thing on the floor) with a soft cool blue-grey shadow underlay that gives the veil its edge; no body below the floor luma.
   */
  seori: { hi: 0xf4f8ff, lo: 0xdce6f8, shade: 0x56699a, shadeA: 0.9 },
  /** dark volcanic cobble: ash grey with a warm cast */
  daeryeol: { hi: 0xcfc4b4, lo: 0xa89c8c, shade: 0x5e544a, shadeA: 0.2 },
};

/** the tint (SpawnOpts.color of sk.gen.dust) that turns the authored near-white colour into `body`, per channel */
function tintTo(body: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round((((body >> s) & 255) / (((DUST_AUTHORED >> s) & 255) || 1)) * 255)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** the body colour of the foot-dust puff by zone (what the player sees at the peak of sk.gen.dust): the zone's lit tone */
const ZONE_BODY: Readonly<Record<string, number>> = {
  yeonmu: 0xdadec0,
  suryeon: 0xeadcb6,
  seori: 0xf0f5ff,
  daeryeol: 0xb8ae9e,
};

/** SpawnOpts.color for sk.gen.dust per zone id (dustFeed.ts) */
export const ZONE_DUST_TINT: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(ZONE_BODY).map(([z, b]) => [z, tintTo(b)]));

/**
 * The published pair lives on globalThis: the dev server can hand the same file out under two URLs (a `?t=` HMR stamp on one importer), and two module
 * instances would each keep their own copy, so the preset would never see what FootDustFeed published. One shared object cannot split.
 */
interface DustState {
  pair: DustPair;
  zone: string;
}
const KEY = '__msAmbientDust';
function state(): DustState {
  const g = globalThis as unknown as Record<string, DustState | undefined>;
  return (g[KEY] ??= { pair: DUST_DEFAULT, zone: '' });
}

/** FootDustFeed.update calls this every frame (a string compare when nothing changed) */
export function setDustZone(zoneId: string | undefined): void {
  const z = zoneId ?? '';
  const st = state();
  if (z === st.zone) return;
  st.zone = z;
  st.pair = ZONE_DUST[z] ?? DUST_DEFAULT;
}

/** the dust pair of the zone being played (DUST_DEFAULT until a zone is published) */
export function dustPair(): DustPair {
  return state().pair;
}
