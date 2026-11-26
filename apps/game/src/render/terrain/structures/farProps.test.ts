// Far props (payload policy, ARCHITECTURE §11): a prop id none of whose placements is within FAR_PROP_M of the hero's start
// streams in behind the HUD instead of being part of the zone load.
import { describe, expect, it } from 'vitest';
import { FAR_PROP_AFTER_S, FAR_PROP_M, splitFarProps } from './index';

const at = (x: number, z: number): { x: number; z: number } => ({ x, z });

describe('structures far props', () => {
  it('a prop with any placement inside the radius is near, however many of its placements are far', () => {
    const m = new Map([
      ['lantern', [at(150, 0), at(20, 5)]],
      ['pagoda', [at(0, -125)]],
    ]);
    expect(splitFarProps(m, at(0, 0), 100)).toEqual({ near: ['lantern'], far: ['pagoda'] });
  });

  it('measures from the given start (Seori starts at z = 12), at the radius itself a prop is far', () => {
    const m = new Map([['gate', [at(0, 112)]]]);
    expect(splitFarProps(m, at(0, 12), 100).far).toEqual(['gate']);
    expect(splitFarProps(m, at(0, 13), 100).near).toEqual(['gate']);
  });

  it('lists the far props nearest first, so what a fast hero reaches first arrives first', () => {
    const m = new Map([
      ['c', [at(140, 0)]],
      ['a', [at(0, 105)]],
      ['b', [at(-120, 0)]],
    ]);
    expect(splitFarProps(m, at(0, 0), 100).far).toEqual(['a', 'b', 'c']);
  });

  it('Infinity turns the streaming off, an empty layout is empty', () => {
    const m = new Map([['x', [at(900, 900)]]]);
    expect(splitFarProps(m, at(0, 0), Infinity)).toEqual({ near: ['x'], far: [] });
    expect(splitFarProps(new Map(), at(0, 0), FAR_PROP_M)).toEqual({ near: [], far: [] });
  });

  it('is far enough that the hero is not there when the stream starts, and the stream starts behind the 6 s payload window', () => {
    const fastestHero = 6.2; // m/s, classes.json
    expect(FAR_PROP_M - fastestHero * FAR_PROP_AFTER_S).toBeGreaterThan(35); // the camera sees ~35 m past the hero on the ground
    expect(FAR_PROP_AFTER_S).toBeGreaterThan(6);
  });
});
