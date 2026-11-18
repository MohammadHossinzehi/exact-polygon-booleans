// Randomized differential testing against independent oracles.
//
//   membership  For sample points, "inside the result" must equal the
//               predicate applied to "inside each operand", where operand
//               membership comes from a separate winding number routine
//               (classifyPoint) that never touches the overlay code.
//   area        Exact inclusion exclusion identities must hold to the last bit.
//   validity    Output rings never cross, overlap or touch except at shared
//               vertices (checked pairwise by validate()).
//   invariance  Rotating input rings or permuting operands of a symmetric
//               operation never changes the output.
//
// Grid polygons on a 7x7 lattice are the nastiest input there is: collinear
// overlaps, T junctions, repeated vertices and self intersections everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/rational.js';
import {
  union, intersection, difference, xor, simplify, coverage, classifyPoint,
} from '../src/index.js';
import { rng, randInt, gridShape, floatStar, validate, exactArea } from './helpers.js';

const OPS = {
  union: { fn: union, pred: (a, b) => a || b },
  intersection: { fn: intersection, pred: (a, b) => a && b },
  difference: { fn: difference, pred: (a, b) => a && !b },
  xor: { fn: xor, pred: (a, b) => a !== b },
};
const RULES = ['evenodd', 'nonzero', 'positive'];

function samplePoints(r, count, lo, hi) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    // Denominators coprime to everything the grid produces most of the time.
    const den = 101n;
    const x = Q.rat(BigInt(randInt(r, lo * 101, hi * 101)), den);
    const y = Q.rat(BigInt(randInt(r, lo * 101, hi * 101)) * 7n + 3n, den * 7n);
    pts.push([Q.toString(x), Q.toString(y)]);
  }
  return pts;
}

function checkMembership(result, a, b, rule, pred, pts) {
  let checked = 0;
  for (const p of pts) {
    const ca = classifyPoint(a, p, rule);
    const cb = classifyPoint(b, p, rule);
    const cr = classifyPoint(result, p, 'nonzero');
    if (ca === 'boundary' || cb === 'boundary' || cr === 'boundary') continue;
    const want = pred(ca === 'inside', cb === 'inside');
    assert.equal(cr === 'inside', want, `point ${p}`);
    // Output is clean: even odd and nonzero must agree on it.
    assert.equal(classifyPoint(result, p, 'evenodd'), cr, `fill-rule disagreement at ${p}`);
    checked++;
  }
  return checked;
}

test('membership oracle on degenerate grid polygons (all ops, all fill rules)', () => {
  const r = rng(20261118);
  let checked = 0;
  for (let iter = 0; iter < 120; iter++) {
    const a = gridShape(r);
    const b = gridShape(r);
    const rule = RULES[iter % RULES.length];
    const pts = samplePoints(r, 40, -1, 7);
    for (const [name, { fn, pred }] of Object.entries(OPS)) {
      const res = fn(a, b, { fillRule: rule, exact: true });
      assert.deepEqual(validate(res), [], `${name} iter ${iter} produced invalid geometry`);
      checked += checkMembership(res, a, b, rule, pred, pts);
    }
  }
  assert.ok(checked > 10000, `only ${checked} points checked`);
});

test('exact area identities hold to the last bit', () => {
  const r = rng(7);
  for (let iter = 0; iter < 80; iter++) {
    const opts = { fillRule: RULES[iter % 3], exact: true };
    const a = gridShape(r);
    const b = gridShape(r);
    const A = exactArea(simplify(a, opts));
    const B = exactArea(simplify(b, opts));
    const U = exactArea(union(a, b, opts));
    const I = exactArea(intersection(a, b, opts));
    const D = exactArea(difference(a, b, opts));
    const X = exactArea(xor(a, b, opts));
    assert.deepEqual(Q.add(U, I), Q.add(A, B), 'U + I = A + B');
    assert.deepEqual(Q.add(D, I), A, 'D + I = A');
    assert.deepEqual(Q.add(X, I), U, 'X + I = U');
    assert.ok(Q.sign(I) >= 0 && Q.sign(D) >= 0 && Q.sign(X) >= 0);
  }
});

test('float polygons: membership and validity with real-world coordinates', () => {
  const r = rng(99);
  for (let iter = 0; iter < 40; iter++) {
    const a = [floatStar(r, 0.5, 0.5, 0.45, randInt(r, 5, 25)), floatStar(r, 0.3, 0.6, 0.2, 7)];
    const b = floatStar(r, 0.5 + (r() - 0.5) * 0.4, 0.5 + (r() - 0.5) * 0.4, 0.4, randInt(r, 5, 25));
    for (const [name, { fn, pred }] of Object.entries(OPS)) {
      const res = fn(a, b, { exact: true });
      assert.deepEqual(validate(res), [], `${name} float iter ${iter}`);
      const pts = Array.from({ length: 25 }, () => [r(), r()]);
      checkMembership(res, a, b, 'evenodd', pred, pts);
    }
  }
});

test('output is invariant under ring rotation and operand order', () => {
  const r = rng(4242);
  const rotate = (ring, k) => ring.slice(k).concat(ring.slice(0, k));
  for (let iter = 0; iter < 60; iter++) {
    const a = gridShape(r);
    const b = gridShape(r);
    const a2 = a.map((ring) => rotate(ring, randInt(r, 0, ring.length - 1)));
    const b2 = b.map((ring) => rotate(ring, randInt(r, 0, ring.length - 1))).reverse();
    for (const fn of [union, intersection, xor]) {
      const ref = fn(a, b, { exact: true });
      assert.deepEqual(fn(a2, b2, { exact: true }), ref);
      assert.deepEqual(fn(b, a, { exact: true }), ref);
    }
    // Under even odd, reversing ring orientation cannot matter either.
    const rev = a.map((ring) => ring.slice().reverse());
    assert.deepEqual(simplify(rev, { exact: true }), simplify(a, { exact: true }));
  }
});

test('idempotence: simplifying a result changes nothing', () => {
  const r = rng(31337);
  for (let iter = 0; iter < 60; iter++) {
    const res = xor(gridShape(r), gridShape(r), { exact: true });
    assert.deepEqual(simplify(res, { exact: true, fillRule: 'nonzero' }), res);
    assert.deepEqual(simplify(res, { exact: true }), res);
    assert.deepEqual(union(res, res, { exact: true }), res);
  }
});

test('k-coverage agrees with a brute-force count of operand memberships', () => {
  const r = rng(555);
  for (let iter = 0; iter < 25; iter++) {
    const shapes = Array.from({ length: randInt(r, 3, 5) }, () => gridShape(r));
    const k = randInt(r, 1, shapes.length);
    const res = coverage(k, shapes, { exact: true });
    assert.deepEqual(validate(res), []);
    for (const p of samplePoints(r, 40, -1, 7)) {
      const cs = shapes.map((s) => classifyPoint(s, p));
      const cr = classifyPoint(res, p, 'nonzero');
      if (cs.includes('boundary') || cr === 'boundary') continue;
      assert.equal(cr === 'inside', cs.filter((c) => c === 'inside').length >= k);
    }
  }
});
