"""Write .research/audio/IDS.md: catalogue of every manifest id (grouped) for other agents."""
from __future__ import annotations

import json

from .build import MANIFEST, WORK, load_sfx
from . import sfx_lib


def main():
    reg = load_sfx()
    m = json.loads(MANIFEST.read_text())
    groups: dict[str, list] = {}
    for d in reg.values():
        groups.setdefault(d.group, []).append(d)
    L = ["# Audio ids (manifest part: apps/game/public/assets/manifest/audio.json)\n",
         "SFX group ids (no suffix) carry `variants[]` (pick one at random); the numbered ids `<id>_01..` are the individual files "
         "(`sfx_xp_pickup_01..08` is the ascending pitch ladder G5..B6, use them in order with the pickup combo). `gain` is the playback "
         "gain that equalises perceived loudness (multiply into your GainNode). Loops: `loop:true,loopStart,loopEnd` (kind `ambience`/`music`).\n"]
    for g in sorted(groups):
        L.append(f"\n## {g}\n")
        for d in sorted(groups[g], key=lambda d: d.id):
            tag = f"{d.variants} variants" if d.variants > 1 else "1 file"
            if d.loop:
                tag += ", LOOP"
            e = m.get(d.id) or m.get(sfx_lib.file_ids(d)[0], {})
            L.append(f"- `{d.id}` ({tag}; {e.get('duration', 0):.2f}s; gain {e.get('gain', 1)})")
    L.append("\n## music\n")
    for k, v in sorted(m.items()):
        if k.startswith("mus_"):
            L.append(f"- `{k}` ({v['kind']}; {v['duration']:.1f}s; loop={v.get('loop', False)}; {v['bytes']/1024:.0f} KB)")
    (WORK / "IDS.md").write_text("\n".join(L), encoding="utf-8")
    print("wrote IDS.md")


if __name__ == "__main__":
    main()
