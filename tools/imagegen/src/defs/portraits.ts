import type { JobSpec } from '../types';
import { PAINTERLY } from './style';

interface PortraitDef {
  id: string;
  who: string;
  accent: string;
}

const DEFS: PortraitDef[] = [
  {
    id: 'portrait_warrior_m',
    who: 'a stern middle-aged male warrior with a topknot and trimmed beard, scarred cheek, wearing lacquered red-and-gold plate pauldrons with dragon-scroll engraving over dark quilted armour, a greatsword hilt rising behind his shoulder',
    accent: 'gold and white steel, lacquer red',
  },
  {
    id: 'portrait_warrior_f',
    who: 'a determined young woman warrior with a high ponytail tied with a red cord, a fierce steady gaze, wearing lacquered red-and-gold plate pauldrons with dragon-scroll engraving over dark quilted armour, a sword hilt rising behind her shoulder',
    accent: 'gold and white steel, lacquer red',
  },
  {
    id: 'portrait_ninja_m',
    who: 'a lean young male assassin with sharp watchful eyes, a hooded dark-green light leather armour, a cloth half-mask pulled down under the chin, twin curved daggers crossed in front of his chest',
    accent: 'jade green and dusk purple',
  },
  {
    id: 'portrait_ninja_f',
    who: 'a lithe young woman assassin-archer with sharp watchful eyes, her hair in a long braid, a hooded jade-green light leather armour with a cloth half-mask, a short bow and quiver visible behind her shoulder',
    accent: 'jade green and dusk purple',
  },
  {
    id: 'portrait_yacha_m',
    who: 'a pale male dark swordsman-mage with long black hair, glowing violet eyes, black-and-violet layered robes with silver clasps, glowing ember-orange rune lines running along his forearm, a wisp of dark ghostly flame beside him',
    accent: 'black-violet and ember orange',
  },
  {
    id: 'portrait_yacha_f',
    who: 'a pale woman dark sorceress-swordswoman with long black hair, glowing violet eyes, black-and-violet layered robes with silver ornaments, glowing ember-orange rune lines along her forearm, a wisp of dark ghostly flame beside her',
    accent: 'black-violet and ember orange',
  },
  {
    id: 'portrait_shaman_m',
    who: 'a wise male shaman with a short grey-streaked beard and a gold circlet, flowing blue-and-gold robes embroidered with dragons, paper talisman strips hanging from his belt, a small golden dragon spirit coiling around his shoulder',
    accent: 'storm blue and gold dragon',
  },
  {
    id: 'portrait_shaman_f',
    who: 'a serene young woman shaman with long hair held by jade hairpins, flowing blue-and-gold robes embroidered with dragons, holding a feathered ritual fan, faint blue lightning in the air behind her',
    accent: 'storm blue and gold dragon',
  },
  {
    id: 'portrait_wolfman_m',
    who: 'a powerful wolf-human warrior (wolfman) with grey-and-rust fur, golden eyes, a fanged snarl, a thick fur mantle with bone-and-iron shoulder guards, clawed hand raised near the chest',
    accent: 'crimson and indigo',
  },
];

export const portraitJobs: JobSpec[] = DEFS.map((d) => ({
  id: d.id,
  group: 'portraits',
  kind: 'portrait',
  aspect: 'portrait',
  size: { w: 512, h: 768 },
  post: [{ op: 'resize', w: 512, h: 768, mode: 'cover', focus: [0.5, 0.35] }, { op: 'webp', quality: 86 }],
  prompt: {
    useCase: 'illustration-story',
    assetType: 'playable class portrait for a character-select screen in an East-Asian fantasy action roguelite',
    subject: d.who,
    style: PAINTERLY + '; painterly character portrait with expressive face and clear shapes, polished game-splash quality',
    composition: 'three-quarter bust portrait, head and shoulders, face in the upper third, the character slightly turned, centred, generous dark margin at the bottom',
    lighting: `strong rim light from behind in ${d.accent}, soft warm key light on the face`,
    palette: `${d.accent} on a dark warm vignette background (#0d0a08) with a faint coloured haze`,
    constraints: 'one character only, no text, no logo, no frame, no border, no watermark, tasteful and non-sexualised',
    avoid: 'full body, busy background, photorealism, 3D render look, extra limbs, deformed hands, text',
  },
}));
