"""Maps the offenders of a tools/qa/probes fontsize run to the CSS files that declare their font-size.

Usage:  python tools/uikit/fontsize_by_file.py <probes.json> [--out <file.json>]
The probes file comes from  bun tools/qa/probes/run.ts --probes fontsize --screens all --vp 1920x1080,844x390@2t --out <probes.json>.
Output: per CSS file (relative to apps/game/src/ui) the offending selectors, their computed px, viewport and count; the
list is what the owning builder works through (C7 hand-off). Selectors whose class has no font-size rule are listed as
`unmapped` (inherited sizes: look at the parent).
"""
import collections
import glob
import json
import os
import re
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = sys.argv[1]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.splitext(src)[0] + '_by_file.json'
    root = os.path.join('apps', 'game', 'src', 'ui')
    d = json.load(open(src, encoding='utf-8'))
    rules = {}
    for f in glob.glob(os.path.join(root, '**', '*.css'), recursive=True):
        rel = f.replace(os.sep, '/').split('apps/game/src/ui/')[-1]
        txt = open(f, encoding='utf-8').read()
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', txt):
            sel, body = m.group(1), m.group(2)
            if 'font-size' not in body:
                continue
            for c in re.findall(r'\.([A-Za-z0-9_-]+)', sel):
                rules.setdefault(c, set()).add(rel)
    by_file = collections.defaultdict(collections.Counter)
    unmapped = collections.Counter()
    for vp, scr in d['results'].items():
        for _s, probes in scr.items():
            for o in probes.get('fontsize', {}).get('offenders', []):
                classes = re.findall(r'\.([A-Za-z0-9_-]+)', o['el'])
                files = set()
                for c in classes:
                    files |= rules.get(c, set())
                if not files:
                    unmapped[(vp, o['el'])] += 1
                for f in files:
                    by_file[f][(vp, o['el'], o['px'])] += 1
    res = {f: [{'viewport': k[0], 'el': k[1], 'px': k[2], 'count': v} for k, v in c.most_common(80)] for f, c in by_file.items()}
    json.dump(
        {
            'floor': '12 px at 1080p desktop, 10.5 px on phones',
            'byFile': res,
            'unmapped': [{'viewport': k[0], 'el': k[1], 'count': v} for k, v in unmapped.most_common(60)],
        },
        open(out, 'w', encoding='utf-8'),
        indent=1,
    )
    tot = {f: sum(x['count'] for x in v) for f, v in res.items()}
    for f, n in sorted(tot.items(), key=lambda x: -x[1])[:40]:
        print(n, f)
    print('wrote', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
