// Guards the shape of the hostile-projectile GLSL that Chrome / ANGLE on D3D11 (FXC) is picky about (prod4 I4): a divergent early
// `return` before the swirl / ember loops makes FXC log "warning X3595: gradient instruction used in a loop with varying iteration" for
// every program that carries hostileOrb (orb, talisman, bolt). The look itself is measured in a real browser

import { describe, expect, it } from 'vitest';
import { GLSL_HOSTILE_ARROW, GLSL_HOSTILE_BLADE, GLSL_HOSTILE_COMMON, GLSL_HOSTILE_GROUND, GLSL_HOSTILE_ORB } from './projectileLooks';

/** text of the GLSL function that starts with `signature` (up to its closing brace at column 0) */
function fnBody(src: string, signature: string): string {
  const a = src.indexOf(signature);
  expect(a, `${signature} exists`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', a);
  expect(end, `${signature} is closed`).toBeGreaterThan(a);
  return src.slice(a, end + 3);
}
const returns = (body: string): number => (body.match(/\breturn\b/g) ?? []).length;

describe('hostileOrb: no divergent early return in front of the gradient (atlas) reads', () => {
  const body = fnBody(GLSL_HOSTILE_ORB, 'vec4 hostileOrbBody(');
  const wrapper = fnBody(GLSL_HOSTILE_ORB, 'vec4 hostileOrb(');

  it('the look has one return, the last statement', () => {
    expect(returns(body)).toBe(1);
    expect(body.trimEnd().endsWith('return res * fade;\n}')).toBe(true);
    expect(body).not.toMatch(/return vec4\(0\.0\)/);
  });

  it('the quad corners are skipped by a conditional call, not by a return', () => {
    expect(returns(wrapper)).toBe(1);
    expect(wrapper).toMatch(/if \(!\(length\(p\) > 1\.6 && !\(tailOn && p\.x < 0\.3 && abs\(p\.y\) < 2\.2\)\)\) r = hostileOrbBody\(/);
    expect(wrapper.trimEnd().endsWith('return r;\n}')).toBe(true);
  });

  it('the atlas sampler still reads with an implicit derivative (the look is unchanged)', () => {
    expect(GLSL_HOSTILE_COMMON).toContain('texture2D(tArt,');
    expect(GLSL_HOSTILE_COMMON).not.toContain('textureLod');
  });
});

describe('the other hostile looks stay single-exit before their texture reads', () => {
  it('arrow, blade and ground end in exactly one return', () => {
    expect(returns(fnBody(GLSL_HOSTILE_ARROW, 'vec4 hostileArrow('))).toBe(1);
    expect(returns(fnBody(GLSL_HOSTILE_BLADE, 'vec4 hostileBlade('))).toBe(1);
    expect(returns(fnBody(GLSL_HOSTILE_GROUND, 'vec4 hostileGround('))).toBe(1);
  });
});
