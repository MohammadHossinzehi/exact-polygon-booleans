// The float filter in orient()/cmpCoord() must never change an answer. Hammer
// it with nearly collinear triples where naive float evaluation is wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/rational.js';
import { PointPool, orient, cmpPoint, splitPoints } from '../src/geometry.js';
import { rng } from './helpers.js';

function orientReference(a, b, c) {
  const l = Q.mul(Q.sub(b.x, a.x), Q.sub(c.y, a.y));
  const r = Q.mul(Q.sub(b.y, a.y), Q.sub(c.x, a.x));
  return Q.cmp(l, r);
}

test('filtered orient agrees with exact arithmetic on near-degenerate input', () => {
  const pool = new PointPool();
  const P = (x, y) => pool.get(Q.fromNumber(x), Q.fromNumber(y));
  const r = rng(1);
  let naiveWrong = 0;
  for (let i = 0; i < 20000; i++) {
    // Points on (or within a few ulps of) the line y = 0.7x + 0.1.
    const xs = [r() * 10, r() * 10, r() * 10];
    const [a, b, c] = xs.map((x) => {
      let y = 0.7 * x + 0.1;
      const k = Math.floor(r() * 5) - 2;
      for (let j = 0; j < Math.abs(k); j++) y = k > 0 ? y + Number.EPSILON * y : y - Number.EPSILON * y;
      return P(x, y);
    });
    const exact = orientReference(a, b, c);
    assert.equal(orient(a, b, c), exact);
    const naive = Math.sign((b.fx - a.fx) * (c.fy - a.fy) - (b.fy - a.fy) * (c.fx - a.fx));
    if (naive !== exact) naiveWrong++;
  }
  // Sanity: this input really does defeat plain floating point.
  assert.ok(naiveWrong > 100, `naive float was wrong only ${naiveWrong} times`);
});

test('orient on constructed intersection points stays exact', () => {
  const pool = new PointPool();
  const P = (x, y) => pool.get(Q.fromNumber(x), Q.fromNumber(y));
  const r = rng(2);
  for (let i = 0; i < 2000; i++) {
    const p1 = P(r(), r()), p2 = P(r() + 1, r() + 1);
    const q1 = P(r() + 0.5, r() - 1), q2 = P(r(), r() + 2);
    const { onP } = splitPoints(pool, p1, p2, q1, q2);
    for (const x of onP) {
      // The constructed crossing lies exactly on both lines.
      assert.equal(orient(p1, p2, x), 0);
      assert.equal(orient(q1, q2, x), 0);
      assert.equal(orientReference(p1, p2, x), 0);
    }
  }
});

test('cmpPoint is exact for coordinates one ulp apart', () => {
  const pool = new PointPool();
  const a = pool.get(Q.fromNumber(1), Q.fromNumber(0));
  const b = pool.get(Q.fromNumber(1 + Number.EPSILON), Q.fromNumber(0));
  const c = pool.get(Q.add(Q.fromNumber(1), Q.rat(1n, 10n ** 40n)), Q.fromNumber(0));
  assert.equal(cmpPoint(a, b), -1);
  assert.equal(cmpPoint(a, c), -1); // differs by 1e-40: invisible to doubles
  assert.equal(cmpPoint(c, b), -1);
  assert.equal(c.fx, 1); // its float shadow is exactly 1, yet ordering is right
});
