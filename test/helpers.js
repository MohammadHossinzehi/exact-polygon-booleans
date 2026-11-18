// Shared test utilities: a seeded PRNG, random polygon generators and an
// independent validity checker for output geometry.

import * as Q from '../src/rational.js';
import { PointPool, splitPoints } from '../src/geometry.js';

/** mulberry32: small, fast, deterministic. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

/** Random (usually self intersecting) ring on a small integer grid: maximal degeneracy. */
export function gridRing(r, n, size) {
  const ring = [];
  for (let i = 0; i < n; i++) ring.push([randInt(r, 0, size), randInt(r, 0, size)]);
  return ring;
}

/** Random shape made of 1-3 grid rings. */
export function gridShape(r, size = 6) {
  const k = randInt(r, 1, 3);
  const rings = [];
  for (let i = 0; i < k; i++) rings.push(gridRing(r, randInt(r, 3, 7), size));
  return rings;
}

/** Random star shaped polygon with float coordinates (simple, no self crossing). */
export function floatStar(r, cx, cy, rad, n) {
  const angles = Array.from({ length: n }, () => r() * Math.PI * 2).sort((a, b) => a - b);
  return angles.map((t) => {
    const rr = rad * (0.3 + 0.7 * r());
    return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)];
  });
}

/**
 * Independent structural check of an exact result:
 *  - every ring has >= 3 distinct consecutive vertices and nonzero area
 *  - no two edges (from any rings) cross, overlap, or touch except at shared
 *    vertices
 * Returns a list of problems (empty when valid).
 */
export function validate(multi) {
  const problems = [];
  const pool = new PointPool();
  const edges = [];
  multi.forEach((poly, pi) => poly.forEach((ring, ri) => {
    if (ring.length < 3) problems.push(`ring ${pi}.${ri} has ${ring.length} vertices`);
    const pts = ring.map(([x, y]) => pool.get(Q.toRat(x), Q.toRat(y)));
    if (new Set(pts).size !== pts.length) problems.push(`ring ${pi}.${ri} visits a vertex twice`);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a === b) problems.push(`ring ${pi}.${ri} repeats a vertex consecutively`);
      edges.push([a, b, `${pi}.${ri}.${i}`]);
    }
  }));
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b, ia] = edges[i];
      const [c, d, ib] = edges[j];
      const { onP, onQ } = splitPoints(pool, a, b, c, d);
      if (onP.length || onQ.length) problems.push(`edges ${ia} and ${ib} intersect improperly`);
      if ((a === c && b === d) || (a === d && b === c)) problems.push(`edges ${ia} and ${ib} coincide`);
    }
  }
  return problems;
}

/** Exact area as a rational of an exact string result. */
export function exactArea(multi) {
  let s = Q.ZERO;
  for (const poly of multi) {
    for (const ring of poly) {
      const pts = ring.map(([x, y]) => [Q.toRat(x), Q.toRat(y)]);
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        s = Q.add(s, Q.sub(Q.mul(ax, by), Q.mul(bx, ay)));
      }
    }
  }
  return Q.mul(s, Q.HALF);
}
