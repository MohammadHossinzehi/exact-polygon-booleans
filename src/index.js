// Public API.

import * as Q from './rational.js';
import { PointPool, ringArea2, windingOfRing } from './geometry.js';
import { overlay, FILL_RULES } from './boolean.js';

export { FILL_RULES };
export * as rational from './rational.js';

const isCoord = (v) =>
  typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string' ||
  (v !== null && typeof v === 'object' && typeof v.n === 'bigint');

function depth(v) {
  let d = 0;
  while (Array.isArray(v)) {
    if (v.length === 0) return d + 1;
    v = v[0];
    d++;
  }
  if (!isCoord(v)) throw new TypeError('coordinates must be numbers, bigints, strings or rationals');
  return d;
}

/**
 * Accepts a ring ([[x, y], ...]), a polygon ([ring, ...]), a multipolygon
 * ([polygon, ...]) or a GeoJSON Polygon / MultiPolygon geometry or Feature.
 * Returns a flat list of rings: under a fill rule only the edge soup matters.
 */
export function toRings(shape) {
  if (shape && !Array.isArray(shape) && typeof shape === 'object') {
    if (shape.type === 'Feature') return toRings(shape.geometry);
    if (shape.type === 'FeatureCollection') return shape.features.flatMap((f) => toRings(f));
    if (shape.type === 'Polygon' || shape.type === 'MultiPolygon') return toRings(shape.coordinates);
    throw new TypeError(`unsupported GeoJSON type "${shape.type}"`);
  }
  if (!Array.isArray(shape)) throw new TypeError('shape must be an array of coordinates or GeoJSON');
  switch (depth(shape)) {
    case 1: return []; // empty
    case 2: return [shape];
    case 3: return shape;
    case 4: return shape.flat();
    default: throw new TypeError('could not infer shape nesting (ring, polygon or multipolygon)');
  }
}

function internRings(pool, shape) {
  return toRings(shape)
    .map((ring) => ring.map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2) throw new TypeError('each point must be [x, y]');
      return pool.get(Q.toRat(pt[0]), Q.toRat(pt[1]));
    }))
    .filter((ring) => ring.length >= 2);
}

function exportPoint(p, exact) {
  return exact ? [Q.toString(p.x), Q.toString(p.y)] : [p.fx, p.fy];
}

function exportPolygons(polys, exact) {
  return polys.map((poly) => poly.map((ring) => ring.map((p) => exportPoint(p, exact))));
}

function normalizeRules(fillRule, n) {
  if (Array.isArray(fillRule)) {
    if (fillRule.length !== n) throw new RangeError('fillRule array must have one entry per operand');
    return fillRule;
  }
  return new Array(n).fill(fillRule ?? 'evenodd');
}

/**
 * General N ary overlay. `predicate` receives one boolean per operand
 * ("is this point inside operand i under its fill rule") and decides whether
 * the point is in the result.
 *
 * Options:
 *   fillRule  'evenodd' (default) | 'nonzero' | 'positive' | 'negative',
 *             or an array with one rule per operand
 *   exact     return coordinates as exact rational strings instead of numbers
 *   stats     also return pipeline statistics
 *
 * Returns a MultiPolygon: an array of polygons, each [outerRing, ...holes].
 * Outer rings are counterclockwise, holes clockwise; rings are open (the
 * first vertex is not repeated).
 */
export function overlayShapes(shapes, predicate, options = {}) {
  const pool = new PointPool();
  const operands = shapes.map((s) => internRings(pool, s));
  const rules = normalizeRules(options.fillRule, shapes.length);
  const { polygons, stats } = overlay(pool, operands, rules, predicate);
  const result = exportPolygons(polygons, !!options.exact);
  if (options.stats) return { result, stats: { ...stats, points: pool.size } };
  return result;
}

const any = (xs) => xs.some(Boolean);
const all = (xs) => xs.every(Boolean);

/** Union of one or more shapes. */
export function union(...args) {
  const { shapes, options } = splitArgs(args);
  return overlayShapes(shapes, any, options);
}

/** Intersection of one or more shapes. */
export function intersection(...args) {
  const { shapes, options } = splitArgs(args);
  return overlayShapes(shapes, all, options);
}

/** a minus every following shape. */
export function difference(...args) {
  const { shapes, options } = splitArgs(args);
  return overlayShapes(shapes, (xs) => xs[0] && !xs.slice(1).some(Boolean), options);
}

/** Points covered by an odd number of shapes. */
export function xor(...args) {
  const { shapes, options } = splitArgs(args);
  return overlayShapes(shapes, (xs) => xs.filter(Boolean).length % 2 === 1, options);
}

/** Points covered by at least k of the shapes. */
export function coverage(k, shapes, options = {}) {
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a positive integer');
  return overlayShapes(shapes, (xs) => xs.filter(Boolean).length >= k, options);
}

/**
 * Resolve a (possibly self intersecting, overlapping, badly oriented) shape
 * into clean simple rings under a fill rule.
 */
export function simplify(shape, options = {}) {
  return overlayShapes([shape], (xs) => xs[0], options);
}

function splitArgs(args) {
  const last = args[args.length - 1];
  const hasOptions = args.length > 1 && last && !Array.isArray(last) && last.type === undefined;
  const shapes = hasOptions ? args.slice(0, -1) : args;
  if (shapes.length === 0) throw new RangeError('at least one shape is required');
  return { shapes, options: hasOptions ? last : {} };
}

/**
 * Exact area of a shape *as drawn* (sum of signed ring areas, so a clean
 * output polygon with CW holes gives its true area). Use simplify() first
 * for arbitrary input. Returns { exact: "p/q", value: number }.
 */
export function area(shape) {
  const pool = new PointPool();
  let a2 = Q.ZERO;
  for (const ring of internRings(pool, shape)) a2 = Q.add(a2, ringArea2(ring));
  const a = Q.mul(a2, Q.HALF);
  return { exact: Q.toString(a), value: Q.toNumber(a), rational: a };
}

/**
 * Point membership under a fill rule. Returns 'inside', 'outside' or
 * 'boundary' (exactly on an edge).
 */
export function classifyPoint(shape, point, fillRule = 'evenodd') {
  const pool = new PointPool();
  const rings = internRings(pool, shape);
  const m = pool.get(Q.toRat(point[0]), Q.toRat(point[1]));
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (onSegment(a, b, m)) return 'boundary';
    }
  }
  let w = 0;
  for (const ring of rings) w += windingOfRing(ring, m);
  const fill = FILL_RULES[fillRule];
  if (!fill) throw new RangeError(`unknown fill rule "${fillRule}"`);
  return fill(w) ? 'inside' : 'outside';
}

function onSegment(a, b, p) {
  if (p === a || p === b) return true;
  const ux = Q.sub(b.x, a.x), uy = Q.sub(b.y, a.y);
  const vx = Q.sub(p.x, a.x), vy = Q.sub(p.y, a.y);
  if (!Q.eq(Q.mul(ux, vy), Q.mul(uy, vx))) return false;
  const t = Q.add(Q.mul(ux, vx), Q.mul(uy, vy));
  const len = Q.add(Q.mul(ux, ux), Q.mul(uy, uy));
  return Q.sign(t) >= 0 && Q.cmp(t, len) <= 0;
}
