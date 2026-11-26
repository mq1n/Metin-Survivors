Metin Survivors UI fonts (self-hosted woff2, SIL Open Font License 1.1)

Family               Files                                           Use
Cinzel (variable)    cinzel-vf-{latin,latin-ext}.woff2               titles + headings (--f-title / --f-head), small caps, timer (wght 400-900)
Alegreya Sans        alegreya-sans-{400,500,700,400i}-{latin,latin-ext}  body text (400i = lore italics), lining figures
Barlow Condensed     barlow-condensed-{600,700}-{latin,latin-ext}    dense numerals (HUD, tables)

Retired 2026-10-13 (UI core C1): the decorative display family, files cinzel-decorative-{700,900}-*. No @font-face loads
them any more (swash capitals fused at title size); they stay here, unused, until the C15 sweep removes them with their
licence file.

Each family ships as a latin + latin-ext pair (the pair together covers Turkish: g-breve, dotted/dotless I, s-cedilla, c-cedilla, o/u-umlaut).
Licenses: LICENSE-<family>.txt (OFL 1.1, copyright holders in the headers). Source: Fontsource builds of the Google Fonts releases.
