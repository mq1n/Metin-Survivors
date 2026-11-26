// Worked example for the hard-surface module: a stone lantern built from lathe + bevelled extrusions + a swept ring.

import { HardMesh, bevelBox, extrude, lathe, sweep } from '../core/hard/hardmesh.ts';
import { hardToModel } from '../core/hard/model.ts';
import { circleShape, roundCorners } from '../core/hard/shape2d.ts';
import { m4translation } from '../core/math.ts';
import type { ModelData } from '../core/model.ts';
import type { Vec2 } from '../core/hard/shape2d.ts';

export function stoneLantern(): ModelData {
  const m = new HardMesh();
  // 0 stone, 1 lit paper, 2 dark iron
  m.group = 0;
  lathe(roundCorners([[0, 0], [0.34, 0], [0.34, 0.05], [0.27, 0.09], [0.27, 0.14], [0, 0.14]], 0.02, 3, false), { segments: 28 }).appendTo(m);
  lathe(roundCorners([[0.1, 0.14], [0.13, 0.14], [0.11, 0.55], [0.1, 0.55]], 0.01, 2, false), { segments: 20 }).appendTo(m);
  lathe(roundCorners([[0, 0.55], [0.26, 0.55], [0.22, 0.62], [0.2, 0.64], [0, 0.64]], 0.015, 3, false), { segments: 24 }).appendTo(m);
  // firebox: four posts + lit panels
  const post = bevelBox([0.045, 0.3, 0.045], 0.008, [0, 0, 0]);
  for (const [x, z] of [[-0.14, -0.14], [0.14, -0.14], [0.14, 0.14], [-0.14, 0.14]] as [number, number][]) post.appendTo(m, m4translation([x, 0.79, z]));
  m.group = 1;
  bevelBox([0.23, 0.26, 0.23], 0.01, [0, 0.79, 0]).appendTo(m);
  m.group = 0;
  // roof: stepped octagon pyramid with bevelled eaves
  const oct: Vec2[] = circleShape(0.42, 8).map(([x, y]) => [x * Math.cos(0.3927) - y * Math.sin(0.3927), x * Math.sin(0.3927) + y * Math.cos(0.3927)] as Vec2);
  extrude(oct, 0.05, { axis: 'y', z0: 0.94, bevel: { size: 0.015, segments: 2 } }).appendTo(m);
  extrude(oct, 0.12, { axis: 'y', z0: 0.99, taper: 0.45, bevel: { size: 0.012, segments: 2 } }).appendTo(m);
  lathe(roundCorners([[0, 1.11], [0.07, 1.11], [0.09, 1.16], [0.05, 1.21], [0, 1.24]], 0.01, 2, false), { segments: 16 }).appendTo(m);
  // iron hanging ring swept along a circle
  m.group = 2;
  const ring = Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * Math.PI * 2) * 0.1, 1.36 + Math.sin((i / 24) * Math.PI * 2) * 0.1, 0] as [number, number, number]);
  sweep(circleShape(0.012, 8), ring, { closed: true }).appendTo(m);
  return hardToModel(m.finish({ crease: 38 }), {
    id: 'stone_lantern',
    kind: 'prop',
    groupColors: [[0.34, 0.33, 0.31], [0.95, 0.62, 0.22], [0.05, 0.05, 0.055]],
  });
}
