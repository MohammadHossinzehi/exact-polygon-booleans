// Exact planar predicates and constructions on rational points.

import * as Q from './rational.js';

/**
 * Point pool. Every point that enters the algorithm is interned, so equal
 * coordinates always map to the same object and can be compared with ===.
 */
export class PointPool {
  constructor() {
    this.map = new Map();
  }

  get(x, y) {
    const k = `${Q.key(x)},${Q.key(y)}`;
    let p = this.map.get(k);
    if (!p) {
      p = Object.freeze({ x, y, k, fx: Q.toNumber(x), fy: Q.toNumber(y) });
      this.map.set(k, p);
    }
    return p;
  }

  get size() {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// Filtered predicates.
//
// Every interned point carries a double approximation (fx, fy) that is within
// one ulp of the exact value. Predicates first evaluate in floating point with
// a rigorous error bound; only when the result is too close to call do they
// fall back to exact BigInt arithmetic. The answer is always the exact one;
// the filter only decides how much work it takes to get there.
// ---------------------------------------------------------------------------

const U = 2 ** -53; // unit roundoff

/** Exact sign of x - y for two rationals, decided in floats when safe. */
export function cmpCoord(x, fx, y, fy) {
  const diff = fx - fy;
  const bound = 3 * U * (Math.abs(fx) + Math.abs(fy)) + 1e-320;
  if (diff > bound) return 1;
  if (diff < -bound) return -1;
  return Q.cmp(x, y);
}

/** Lexicographic (x, then y) order. Along any line this order is monotone. */
export function cmpPoint(a, b) {
  if (a === b) return 0;
  return cmpCoord(a.x, a.fx, b.x, b.fx) || cmpCoord(a.y, a.fy, b.y, b.fy);
}

// Sign of (b - a) x (c - a) without normalizing (no gcd): every intermediate
// denominator is positive, so the sign of one cross multiplied numerator is
// the answer.
function orientExact(a, b, c) {
  const dx1n = b.x.n * a.x.d - a.x.n * b.x.d, dx1d = a.x.d * b.x.d;
  const dy1n = b.y.n * a.y.d - a.y.n * b.y.d, dy1d = a.y.d * b.y.d;
  const dx2n = c.x.n * a.x.d - a.x.n * c.x.d, dx2d = a.x.d * c.x.d;
  const dy2n = c.y.n * a.y.d - a.y.n * c.y.d, dy2d = a.y.d * c.y.d;
  const l = dx1n * dy2n * (dy1d * dx2d);
  const r = dy1n * dx2n * (dx1d * dy2d);
  return l > r ? 1 : l < r ? -1 : 0;
}

/** Exact sign of the cross product (b - a) x (c - a): 1 left turn, -1 right, 0 collinear. */
export function orient(a, b, c) {
  const dx1 = b.fx - a.fx, dy1 = b.fy - a.fy;
  const dx2 = c.fx - a.fx, dy2 = c.fy - a.fy;
  const l = dx1 * dy2;
  const r = dy1 * dx2;
  const det = l - r;
  // Each coordinate is off by about U*|v| (toNumber guarantees < 1.01U), so
  // each float difference is off by <= e = 5U*M: two conversions plus the
  // subtraction's own rounding, with slack. Products then err by at most
  // e(|d1| + |d2|) + e^2 each, and the final operations add 3U(|l| + |r|).
  const M = Math.max(Math.abs(a.fx), Math.abs(a.fy), Math.abs(b.fx), Math.abs(b.fy), Math.abs(c.fx), Math.abs(c.fy));
  const e = 5 * U * M;
  const bound =
    e * (Math.abs(dx1) + Math.abs(dy1) + Math.abs(dx2) + Math.abs(dy2)) + 4 * e * e +
    3 * U * (Math.abs(l) + Math.abs(r));
  // Doubled for safety margin, plus an absolute floor for denormal ranges.
  if (det > 2 * bound + 1e-300) return 1;
  if (det < -2 * bound - 1e-300) return -1;
  return orientExact(a, b, c);
}

/** Cross and dot products of two direction vectors given as {x, y} rationals. */
export function cross(u, v) {
  return Q.sub(Q.mul(u.x, v.y), Q.mul(u.y, v.x));
}

export function dot(u, v) {
  return Q.add(Q.mul(u.x, v.x), Q.mul(u.y, v.y));
}

export function vec(from, to) {
  return { x: Q.sub(to.x, from.x), y: Q.sub(to.y, from.y) };
}

/** True when p lies strictly between a and b, given that a, b, p are collinear. */
export function strictlyBetween(a, b, p) {
  const ab = cmpPoint(a, b);
  const ap = cmpPoint(a, p);
  const pb = cmpPoint(p, b);
  return ab < 0 ? ap < 0 && pb < 0 : ap > 0 && pb > 0;
}

export function midpoint(pool, a, b) {
  return pool.get(Q.mul(Q.add(a.x, b.x), Q.HALF), Q.mul(Q.add(a.y, b.y), Q.HALF));
}

/**
 * Every point at which segment p (p1-p2) must be split because of segment q,
 * and vice versa. Handles proper crossings, T junctions, shared endpoints and
 * collinear overlaps uniformly. Returns { onP: Point[], onQ: Point[] }.
 */
export function splitPoints(pool, p1, p2, q1, q2) {
  const onP = [];
  const onQ = [];
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  if (o1 !== 0 && o1 === o2) return { onP, onQ };
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  if (o3 !== 0 && o3 === o4) return { onP, onQ };

  if (o1 === 0 && o2 === 0) {
    // Collinear: split each segment at the other's endpoints that fall inside it.
    if (strictlyBetween(p1, p2, q1)) onP.push(q1);
    if (strictlyBetween(p1, p2, q2)) onP.push(q2);
    if (strictlyBetween(q1, q2, p1)) onQ.push(p1);
    if (strictlyBetween(q1, q2, p2)) onQ.push(p2);
    return { onP, onQ };
  }

  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) {
    // An endpoint touches the other segment (T junction or shared vertex).
    if (o1 === 0 && strictlyBetween(p1, p2, q1)) onP.push(q1);
    if (o2 === 0 && strictlyBetween(p1, p2, q2)) onP.push(q2);
    if (o3 === 0 && strictlyBetween(q1, q2, p1)) onQ.push(p1);
    if (o4 === 0 && strictlyBetween(q1, q2, p2)) onQ.push(p2);
    return { onP, onQ };
  }

  // Proper crossing: p1 + t (p2 - p1), t = ((q1 - p1) x s) / (r x s).
  const r = vec(p1, p2);
  const s = vec(q1, q2);
  const t = Q.div(cross(vec(p1, q1), s), cross(r, s));
  const x = pool.get(Q.add(p1.x, Q.mul(t, r.x)), Q.add(p1.y, Q.mul(t, r.y)));
  onP.push(x);
  onQ.push(x);
  return { onP, onQ };
}

/** Twice the signed area of a ring of points (positive for counterclockwise). */
export function ringArea2(ring) {
  let s = Q.ZERO;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    s = Q.add(s, Q.sub(Q.mul(a.x, b.y), Q.mul(b.x, a.y)));
  }
  return s;
}

/**
 * Exact sign of a ring's area. Summing exact rationals makes denominators
 * grow towards the LCM of every vertex's denominator, which is very slow for
 * rings full of intersection points, so try a filtered float sum first.
 */
export function ringAreaSign(ring) {
  const n = ring.length;
  let sum = 0;
  let mag = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const l = a.fx * b.fy;
    const r = b.fx * a.fy;
    sum += l - r;
    mag += Math.abs(l) + Math.abs(r);
  }
  // Each product errs by <= ~3U of its magnitude (two inputs, one rounding);
  // the n term summation adds <= nU * mag. Doubled for margin.
  const bound = 2 * (n + 4) * U * mag + 1e-300;
  if (sum > bound) return 1;
  if (sum < -bound) return -1;
  return Q.sign(ringArea2(ring));
}

/**
 * Winding number of a ring around point m, for a point that is NOT on the
 * ring. Uses the half open crossing rule so vertices on the ray are counted
 * exactly once.
 */
export function windingOfRing(ring, m) {
  let w = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const aBelow = cmpCoord(a.y, a.fy, m.y, m.fy) <= 0;
    const bBelow = cmpCoord(b.y, b.fy, m.y, m.fy) <= 0;
    if (aBelow === bBelow) continue;
    if (aBelow) {
      if (orient(a, b, m) > 0) w += 1; // upward edge, m on its left
    } else if (orient(a, b, m) < 0) {
      w -= 1; // downward edge, m on its right
    }
  }
  return w;
}
