// Hand checked cases, chosen for the degeneracies that break float clippers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  union, intersection, difference, xor, simplify, coverage, area, classifyPoint,
} from '../src/index.js';
import { validate } from './helpers.js';

const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const A = sq(0, 0, 2);
const B = sq(1, 1, 2);
const ex = { exact: true };

test('overlapping squares: the four classic operations', () => {
  assert.deepEqual(union(A, B), [[[[0, 0], [2, 0], [2, 1], [3, 1], [3, 3], [1, 3], [1, 2], [0, 2]]]]);
  assert.deepEqual(intersection(A, B), [[[[1, 1], [2, 1], [2, 2], [1, 2]]]]);
  assert.deepEqual(difference(A, B), [[[[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]]]);
  assert.equal(xor(A, B).length, 2);
  assert.equal(area(xor(A, B)).value, 6);
});

test('identical operands', () => {
  assert.deepEqual(union(A, A), [[A]]);
  assert.deepEqual(intersection(A, A), [[A]]);
  assert.deepEqual(difference(A, A), []);
  assert.deepEqual(xor(A, A), []);
});

test('shared edge merges into one ring with no leftover vertices', () => {
  assert.deepEqual(union(A, sq(2, 0, 2)), [[[[0, 0], [4, 0], [4, 2], [0, 2]]]]);
  assert.deepEqual(intersection(A, sq(2, 0, 2)), []);
});

test('partial collinear overlap of edges', () => {
  const C = [[2, 1], [5, 1], [5, 3], [2, 3]]; // left edge overlaps half of A's right edge
  const u = union(A, C, ex);
  assert.deepEqual(validate(u), []);
  assert.equal(area(u).exact, '10');
  assert.deepEqual(intersection(A, C), []);
});

test('touching at a single vertex yields two polygons, not a figure eight', () => {
  const u = union(A, sq(2, 2, 2));
  assert.equal(u.length, 2);
  assert.deepEqual(validate(u), []);
});

test('containment creates a hole with clockwise orientation', () => {
  const outer = sq(0, 0, 10);
  const inner = sq(2, 2, 2);
  const d = difference(outer, inner);
  assert.equal(d.length, 1);
  assert.equal(d[0].length, 2);
  assert.deepEqual(d[0][1], [[2, 2], [2, 4], [4, 4], [4, 2]]);
  assert.equal(area(d).value, 96);
  assert.deepEqual(intersection(outer, inner), [[inner]]);
  assert.deepEqual(union(outer, inner), [[outer]]);
});

test('hole touching the outer boundary at one vertex stays a hole', () => {
  const outer = sq(0, 0, 4);
  const notch = [[0, 0], [2, 1], [1, 2]];
  const d = difference(outer, notch, ex);
  assert.deepEqual(validate(d), []);
  // One polygon with a separate hole ring, not a single pinched "keyhole" ring.
  assert.equal(d.length, 1);
  assert.deepEqual(d[0][1], [['0', '0'], ['1', '2'], ['2', '1']]);
  assert.equal(area(d).exact, '29/2');
});

test('nested islands: polygon in hole in polygon', () => {
  const shape = [sq(0, 0, 10), sq(2, 2, 6), sq(4, 4, 2)];
  const s = simplify(shape); // even odd: ring, hole, island
  assert.equal(s.length, 2);
  assert.equal(area(s).value, 100 - 36 + 4);
  const s2 = simplify(shape, { fillRule: 'nonzero' });
  assert.deepEqual(s2, [[sq(0, 0, 10)]]); // all CCW: everything filled
});

test('pentagram: even-odd vs nonzero', () => {
  const star = [[0, 0], [2, 6], [4, 0], [-1, 4], [5, 4]];
  const eo = simplify(star, ex);
  const nz = simplify(star, { fillRule: 'nonzero', exact: true });
  assert.equal(eo.length, 5); // five points, hollow pentagon
  assert.equal(nz.length, 1); // filled star outline (10 vertices)
  assert.equal(nz[0][0].length, 10);
  assert.deepEqual(validate(eo), []);
  assert.deepEqual(validate(nz), []);
  // The pentagon area is exactly the difference.
  const pent = simplify(star, { fillRule: 'nonzero', exact: true });
  assert.ok(area(pent).rational.n > 0n);
});

test('positive / negative fill rules distinguish orientation', () => {
  const ccw = sq(0, 0, 2);
  const cw = sq(5, 0, 2).reverse();
  assert.deepEqual(simplify([ccw, cw], { fillRule: 'positive' }), [[ccw]]);
  assert.equal(simplify([ccw, cw], { fillRule: 'negative' }).length, 1);
  assert.equal(simplify([ccw, cw], { fillRule: 'negative' })[0][0][0][0], 5);
});

test('bow tie self-intersection is resolved into two triangles', () => {
  const bow = [[0, 0], [2, 2], [2, 0], [0, 2]];
  const s = simplify(bow, ex);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((p) => p[0].length), [3, 3]);
  assert.equal(area(s).exact, '2');
});

test('coverage: regions covered by at least k of n shapes', () => {
  const shapes = [sq(0, 0, 4), sq(2, 0, 4), sq(1, 2, 4)];
  assert.equal(area(coverage(1, shapes)).value, area(union(...shapes)).value);
  assert.equal(area(coverage(3, shapes)).value, area(intersection(...shapes)).value);
  // pairwise overlaps 8 + 6 + 6, minus twice the triple overlap 4
  assert.equal(area(coverage(2, shapes, ex)).exact, '12');
});

test('n-ary difference subtracts every later shape', () => {
  const d = difference(sq(0, 0, 10), sq(0, 0, 5), sq(5, 5, 5));
  assert.equal(area(d).value, 50);
});

test('empty and degenerate operands', () => {
  assert.deepEqual(union([], []), []);
  assert.deepEqual(union(A, []), [[A]]);
  assert.deepEqual(intersection(A, []), []);
  assert.deepEqual(simplify([[0, 0], [1, 1], [2, 2]]), []); // zero area ring
  assert.deepEqual(simplify([[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]]), [[[[0, 0], [1, 0], [1, 1]]]]);
});

test('GeoJSON input, closed rings and string coordinates', () => {
  const geo = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } };
  const strs = [['1/2', '1/2'], ['5/2', '1/2'], ['5/2', '5/2'], ['1/2', '5/2']];
  const i = intersection(geo, strs, ex);
  assert.deepEqual(i, [[[['1/2', '1/2'], ['2', '1/2'], ['2', '2'], ['1/2', '2']]]]);
});

test('floating point near-degeneracy: 0.1 + 0.2 really is not 0.3', () => {
  // Two rectangles whose shared edge is "the same" in decimal but not in binary:
  // 0.1 + 0.2 = 0.30000000000000004 > 0.3, so they do NOT touch.
  const L = [[0, 0], [0.3, 0], [0.3, 1], [0, 1]];
  const R = [[0.1 + 0.2, 0], [1, 0], [1, 1], [0.1 + 0.2, 1]];
  const u = union(L, R, ex);
  assert.equal(u.length, 2); // a float clipper with an epsilon would weld these
  assert.deepEqual(validate(u), []);
  assert.deepEqual(intersection(L, R, ex), []);
  const gap = difference([[0, 0], [1, 0], [1, 1], [0, 1]], L, R, ex);
  assert.equal(gap.length, 1); // a sliver of width 2^-54 survives, exactly
  assert.equal(area(gap).exact, '1/18014398509481984');
});

test('classifyPoint reports inside, outside and boundary exactly', () => {
  const star = [[0, 0], [2, 6], [4, 0], [-1, 4], [5, 4]];
  assert.equal(classifyPoint(star, [2, 3]), 'outside');
  assert.equal(classifyPoint(star, [2, 3], 'nonzero'), 'inside');
  assert.equal(classifyPoint(star, [2, 4]), 'boundary');
  assert.equal(classifyPoint(star, ['4/3', 4]), 'boundary');
  assert.equal(classifyPoint(star, [10, 10]), 'outside');
});

test('rejects an unbounded predicate and bad fill rules', () => {
  assert.throws(() => difference(A, B, { fillRule: 'odd' }), /unknown fill rule/);
});
