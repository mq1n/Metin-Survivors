// Sprites of the run-event visuals (EV-03b): the shrine, its channel ring, the champion ring and the rain marker. Every id is a SHIPPED sprite of the
// asset manifest (kind `vfx`) that another target already draws; nothing here is new art (payload 0 B). A missing sprite draws the `fallback` role
// (spec/README.md "Art roles").
import type { ArtTex } from '../../spec/types';
import { ART_CROWN, ART_GLOW, ART_PILLAR_CREAM as ART_PILLAR, ART_RING_GLOW_BAND as ART_RING } from '../levelup-heal/art';
import { ART_RING_HAIR as ART_HAIRLINE } from '../status/art';

// the sprites the level-up / status targets already draw come from their owners (one object in the bundle); the two below are this target's own
export { ART_CROWN, ART_GLOW, ART_HAIRLINE, ART_PILLAR, ART_RING };

const art = (id: string, fallback: ArtTex['fallback']): ArtTex => ({ art: id, fallback });

/** a rune circle with a fine ring of spikes (the shrine's ground sigil) */
export const ART_SIGIL: ArtTex = art('vfx_player_feedback_magic_circle', 'ornateRing');
/** soft round pip (rising motes) */
export const ART_PIP: ArtTex = art('vfx_glow_pip_soft_a', 'glow');
/** every sprite id above (a test pins them to the manifest) */
export const EVENT_ART_IDS: readonly string[] = [
  'vfx_player_feedback_magic_circle',
  'vfx_ring_glow_band_a',
  'vfx_levelup_heal_pillar_cream',
  'vfx_ring_hairline_glow_a',
  'vfx_glow_pip_soft_a',
  'vfx_glow_blob_soft_a',
  'vfx_ring_spiked_crown_a',
];
