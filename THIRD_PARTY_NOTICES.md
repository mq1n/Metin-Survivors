# Third-Party Notices

Metin Survivors is an independent, original roguelite game. All shipped artwork, 3D models, icons, audio, lore, and game code are original or used under the open-source licenses listed below.

---

## Runtime Libraries

### three (`0.186.1`)
- **License:** MIT
- **Homepage:** https://threejs.org/
- **Copyright:** Copyright © 2010–2026 three.js authors

### Preact (`10.29.8`) & @preact/signals (`2.11.3`)
- **License:** MIT
- **Homepage:** https://preactjs.com/
- **Copyright:** Copyright © 2015–present Jason Miller and Preact contributors

### Hono (`4.13.13`)
- **License:** MIT
- **Homepage:** https://hono.dev/
- **Copyright:** Copyright © 2021–present Yusuke Wada and Hono contributors

---

## Ported Procedural VFX Code

### Elemental Sandbox / threejs-vfx
- **Location:** `apps/game/src/vfx/elemental/`
- **License:** MIT (full license text preserved in `apps/game/src/vfx/elemental/LICENSE` and provenance in `apps/game/src/vfx/elemental/NOTICE.md`)
- **Source:** https://github.com/majidmanzarpour/threejs-vfx
- **Copyright:** Copyright © 2026 mohamedachrefelouafi
- **Scope:** Techniques, procedural shader code, and geometry generators ported to strict TypeScript. No HDR probes, FBX files, or character assets from that repository are included.

---

## Shipped Typefaces (`apps/game/public/fonts/`)

All shipped web fonts are licensed under the **SIL Open Font License 1.1 (OFL-1.1)**:

- **Cinzel** — Natanael Gama
- **Alegreya Sans** — Juan Pablo del Peral
- **Barlow Condensed** — Jeremy Tribby

---

## Original Asset Provenance

- **2D artwork, textures, and icons:** Original paintings and UI plates created with generative image models and custom post-processing scripts.
- **3D models and animations:** Original procedural and image-to-3D meshes, rigs, and animation clips authored with in-repo tooling (`@ms/forge`, `@ms/painter`).
- **Audio & music:** Original synthesized sound effects and musical tracks generated with in-repo audio synthesis tools (`tools/audiogen`).
- **Writing & localisation:** Original lore, codex entries, and Turkish / English localisation.
