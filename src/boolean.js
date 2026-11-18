// The boolean engine: overlay N polygons exactly, classify every piece of
// boundary by the winding numbers on either side, keep the pieces where the
// result changes, and stitch them back into rings.
//
//   1. Edges      collect every edge of every operand, tagged with its owner
//   2. Split      find all pairwise contacts (sort and sweep broad phase,
//                 exact narrow phase) and cut edges at them
//   3. Merge      coincident pieces collapse into one segment carrying a
//                 per operand multiplicity vector
//   4. Classify   one exact ray cast per segment gives the winding vector on
//                 one side; the other side differs by the multiplicity vector
//   5. Select     keep a segment iff the predicate differs across it, oriented
//                 with the result on its left
//   6. Stitch     at each vertex follow the outgoing edge with the sharpest
//                 clockwise turn, which yields minimal, non crossing rings
//   7. Assemble   drop redundant collinear vertices, nest holes in their
//                 smallest enclosing outer ring
//
// Every predicate in steps 2 to 7 returns the exact answer: floats are only a
// filter that falls back to rational arithmetic when a case is too close to call.

import * as Q from './rational.js';
import {
  cmpCoord,
  cmpPoint,
  cross,
  dot,
  midpoint,
  orient,
  ringAreaSign,
  splitPoints,
  vec,
  windingOfRing,
} from './geometry.js';

export const FILL_RULES = Object.freeze({
  evenodd: (w) => (w & 1) !== 0,
  nonzero: (w) => w !== 0,
  positive: (w) => w > 0,
  negative: (w) => w < 0,
});

function fillFn(rule) {
  const f = FILL_RULES[rule];
  if (!f) throw new RangeError(`unknown fill rule "${rule}" (use ${Object.keys(FILL_RULES).join(', ')})`);
  return f;
}

// Conservative padding for float bounding boxes. Rational -> double conversion
// is off by at most one ulp, so a relative pad of 1e-12 is far more than enough.
const pad = (v) => Math.abs(v) * 1e-12 + 1e-300;

/** Step 1: directed input edges become canonical (a < b) edges with a sign. */
function collectEdges(operands) {
  const edges = [];
  operands.forEach((rings, owner) => {
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % n];
        if (p === q) continue; // zero length edge (duplicate or closing point)
        const c = cmpPoint(p, q);
        edges.push(
          c < 0
            ? { a: p, b: q, owner, dir: 1, cuts: [] }
            : { a: q, b: p, owner, dir: -1, cuts: [] },
        );
      }
    }
  });
  for (const e of edges) {
    e.x0 = e.a.fx - pad(e.a.fx);
    e.x1 = e.b.fx + pad(e.b.fx);
    e.y0 = Math.min(e.a.fy, e.b.fy);
    e.y1 = Math.max(e.a.fy, e.b.fy);
    e.y0 -= pad(e.y0);
    e.y1 += pad(e.y1);
  }
  return edges;
}

/** Step 2: sort and sweep over x; exact contact computation for survivors. */
function splitEdges(pool, edges, stats) {
  const order = edges.slice().sort((e, f) => e.x0 - f.x0);
  let active = [];
  for (const e of order) {
    const stillActive = [];
    for (const f of active) {
      if (f.x1 < e.x0) continue;
      stillActive.push(f);
      if (f.y1 < e.y0 || e.y1 < f.y0) continue;
      stats.pairTests++;
      const { onP, onQ } = splitPoints(pool, e.a, e.b, f.a, f.b);
      for (const p of onP) e.cuts.push(p);
      for (const p of onQ) f.cuts.push(p);
    }
    stillActive.push(e);
    active = stillActive;
  }
}

/** Steps 2b and 3: cut edges into pieces and merge coincident pieces. */
function buildSegments(edges, nOperands) {
  const segs = new Map();
  for (const e of edges) {
    const pts = [e.a, ...e.cuts, e.b];
    pts.sort(cmpPoint); // collinear, so lexicographic order is order along e
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a === b) continue; // duplicate cut point
      const k = `${a.k}|${b.k}`;
      let s = segs.get(k);
      if (!s) {
        s = { a, b, mult: new Array(nOperands).fill(0) };
        segs.set(k, s);
      }
      s.mult[e.owner] += e.dir;
    }
  }
  // Pieces that cancel exactly for every operand (e.g. an edge traversed back
  // and forth) carry no boundary and are dropped.
  return [...segs.values()].filter((s) => s.mult.some((m) => m !== 0));
}

/**
 * Step 4: winding vector at the midpoint m of s, counting every segment
 * EXCEPT s (so it is continuous across s). The ray is cast from m nudged by
 * an infinitesimal: from (m.x, m.y + eps) towards +x for non vertical s, from
 * (m.x + eps, m.y) towards +y for vertical s. The half open comparisons below
 * implement the nudge symbolically; no epsilon value ever appears.
 */
function probeWinding(s, m, segments, n) {
  const w = new Array(n).fill(0);
  const vertical = Q.eq(s.a.x, s.b.x);
  if (!vertical) {
    // Ray from (m.x, m.y + eps) towards +x.
    const my = m.fy;
    for (const t of segments) {
      if (t === s || t.y1 < my - pad(my) || t.y0 > my + pad(my)) continue;
      const aBelow = cmpCoord(t.a.y, t.a.fy, m.y, m.fy) <= 0;
      const bBelow = cmpCoord(t.b.y, t.b.fy, m.y, m.fy) <= 0;
      if (aBelow === bBelow) continue;
      const lo = aBelow ? t.a : t.b;
      const hi = aBelow ? t.b : t.a;
      if (orient(lo, hi, m) <= 0) continue; // crossing is left of m
      const sgn = aBelow ? 1 : -1; // canonical direction a->b is upward?
      for (let i = 0; i < n; i++) w[i] += sgn * t.mult[i];
    }
  } else {
    // Ray from (m.x + eps, m.y) towards +y. Since a.x <= b.x, a crossing
    // segment always runs left to right in canonical direction, i.e. it is
    // traversed clockwise relative to the probe: contributes -mult.
    const mx = m.fx;
    for (const t of segments) {
      if (t === s || t.x1 < mx - pad(mx) || t.x0 > mx + pad(mx)) continue;
      const aLeft = cmpCoord(t.a.x, t.a.fx, m.x, m.fx) <= 0;
      const bLeft = cmpCoord(t.b.x, t.b.fx, m.x, m.fx) <= 0;
      if (aLeft === bLeft) continue;
      if (orient(t.a, t.b, m) >= 0) continue; // crossing is below m
      for (let i = 0; i < n; i++) w[i] -= t.mult[i];
    }
  }
  return { w, vertical };
}

/** Steps 4 and 5. Returns the kept directed edges as [from, to] pairs. */
function classify(pool, segments, nOperands, insideFns, predicate) {
  for (const s of segments) {
    s.x0 = s.a.fx - pad(s.a.fx);
    s.x1 = s.b.fx + pad(s.b.fx);
    s.y0 = Math.min(s.a.fy, s.b.fy);
    s.y1 = Math.max(s.a.fy, s.b.fy);
    s.y0 -= pad(s.y0);
    s.y1 += pad(s.y1);
  }
  const kept = [];
  for (const s of segments) {
    const m = midpoint(pool, s.a, s.b);
    const { w, vertical } = probeWinding(s, m, segments, nOperands);
    // w excludes s itself. Crossing s from its right side to its left side
    // adds mult, so we only need to know which side w already describes:
    //  - vertical s: the probe is right of s and its +y ray never meets s,
    //    so w is the right side;
    //  - rising s: the probe (above m) is on the left and its +x ray WOULD
    //    cross s, so w is the right side's winding (left = w + mult);
    //  - falling or horizontal s: the probe's ray misses s, w is the left side.
    const wIsRight = vertical || Q.cmp(s.b.y, s.a.y) > 0;
    const left = wIsRight ? w.map((v, i) => v + s.mult[i]) : w;
    const right = wIsRight ? w : w.map((v, i) => v - s.mult[i]);
    const inLeft = predicate(left.map((v, i) => insideFns[i](v)));
    const inRight = predicate(right.map((v, i) => insideFns[i](v)));
    if (inLeft === inRight) continue;
    kept.push(inLeft ? [s.a, s.b] : [s.b, s.a]);
  }
  return kept;
}

/** ccw angle half plane of d relative to r: 0 for [0, pi), 1 for [pi, 2pi). */
function half(r, d) {
  const c = Q.sign(cross(r, d));
  return c > 0 || (c === 0 && Q.sign(dot(r, d)) > 0) ? 0 : 1;
}

/** Step 6: link directed edges into closed rings. */
function stitch(kept) {
  const out = new Map(); // point key -> outgoing edges
  for (const e of kept) {
    const list = out.get(e[0].k);
    if (list) list.push(e);
    else out.set(e[0].k, [e]);
  }
  const next = new Map();
  for (const e of kept) {
    const v = e[1];
    const candidates = out.get(v.k);
    if (!candidates) throw new Error('internal: dangling edge (please report)');
    let best = candidates[0];
    if (candidates.length > 1) {
      // Successor = outgoing edge with the LARGEST ccw angle from the back
      // direction (v -> previous vertex), i.e. the sharpest clockwise turn.
      const r = vec(v, e[0]);
      let bestDir = vec(v, best[1]);
      let bestHalf = half(r, bestDir);
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const d = vec(v, c[1]);
        const h = half(r, d);
        if (h > bestHalf || (h === bestHalf && Q.sign(cross(bestDir, d)) > 0)) {
          best = c;
          bestDir = d;
          bestHalf = h;
        }
      }
    }
    next.set(e, best);
  }
  const degree = new Map();
  for (const [k, list] of out) degree.set(k, list.length);

  const used = new Set();
  const rings = [];
  for (const start of kept) {
    if (used.has(start)) continue;
    const ring = [];
    let e = start;
    while (!used.has(e)) {
      used.add(e);
      ring.push(e[0]);
      e = next.get(e);
    }
    if (e !== start) throw new Error('internal: ring did not close (please report)');
    for (const loop of splitPinches(ring)) rings.push(simplifyRing(loop, degree));
  }
  return rings;
}

/**
 * A face boundary may pass through the same vertex twice, e.g. the region
 * between a square and a triangular hole that touches it at one corner is
 * bounded by a single "keyhole" walk. OGC/GeoJSON consumers expect that as an
 * outer ring plus a hole ring, so cut every closed walk into loops that each
 * visit a vertex at most once. Each loop is then a simple ring whose
 * orientation says whether it is an outer boundary or a hole.
 */
function splitPinches(walk) {
  const loops = [];
  const path = [];
  const pos = new Map();
  for (const v of walk) {
    const at = pos.get(v.k);
    if (at !== undefined) {
      const loop = path.splice(at);
      for (const p of loop) pos.delete(p.k);
      loops.push(loop);
    }
    pos.set(v.k, path.length);
    path.push(v);
  }
  if (path.length) loops.push(path);
  return loops;
}

/** Remove vertices that are collinear pass throughs touched by nothing else. */
function simplifyRing(ring, degree) {
  let pts = ring;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const res = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = res.length ? res[res.length - 1] : pts[n - 1];
      const cur = pts[i];
      const nxt = pts[(i + 1) % n];
      if (degree.get(cur.k) === 1 && orient(prev, cur, nxt) === 0) {
        changed = true;
        continue;
      }
      res.push(cur);
    }
    pts = res;
  }
  // Canonical rotation: the lexicographically smallest rotation of the vertex
  // sequence. (A ring can pass through its smallest vertex twice when it
  // pinches, so "start at the smallest vertex" alone is not enough.) The
  // output is then independent of input order and starting points.
  const n = pts.length;
  let best = 0;
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = cmpPoint(pts[(i + j) % n], pts[(best + j) % n]);
      if (c < 0) best = i;
      if (c !== 0) break;
    }
  }
  return pts.slice(best).concat(pts.slice(0, best));
}

/** Lexicographic comparison of two canonical rings. */
function cmpRing(p, q) {
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    const c = cmpPoint(p[i], q[i]);
    if (c !== 0) return c;
  }
  return p.length - q.length;
}

/** Step 7: group rings into polygons (outer ring + holes). */
function assemble(pool, rings) {
  const outers = [];
  const holes = [];
  for (const ring of rings) {
    (ringAreaSign(ring) > 0 ? outers : holes).push({ ring, holes: [] });
  }
  // A hole belongs to the innermost outer ring around it. Output rings never
  // cross, so the outer rings containing a given point form a nested chain,
  // and ring X lies inside ring Y iff the midpoint of any edge of X does (an
  // edge midpoint lies on no other output segment, so the test is strict).
  for (const h of holes) {
    // The midpoint of a hole edge lies on no other output segment.
    const probe = midpoint(pool, h.ring[0], h.ring[1]);
    let owner = null;
    for (const o of outers) {
      if (windingOfRing(o.ring, probe) === 0) continue;
      if (!owner) owner = o;
      else {
        o.mid ??= midpoint(pool, o.ring[0], o.ring[1]);
        if (windingOfRing(owner.ring, o.mid) !== 0) owner = o; // o nested in owner
      }
    }
    if (!owner) throw new Error('internal: orphan hole (please report)');
    owner.holes.push(h.ring);
  }
  // Deterministic polygon and hole order.
  outers.sort((p, q) => cmpRing(p.ring, q.ring));
  return outers.map((o) => {
    o.holes.sort(cmpRing);
    return [o.ring, ...o.holes];
  });
}

/**
 * Run the full pipeline.
 * @param {PointPool} pool
 * @param {Point[][][]} operands   per operand, a list of rings of interned points
 * @param {string[]} fillRules     per operand fill rule
 * @param {(inside: boolean[]) => boolean} predicate
 */
export function overlay(pool, operands, fillRules, predicate) {
  const stats = { edges: 0, pairTests: 0, segments: 0, kept: 0, rings: 0 };
  const n = operands.length;
  const insideFns = fillRules.map(fillFn);
  if (predicate(new Array(n).fill(false))) {
    throw new RangeError('predicate is true outside every operand: the result would be unbounded');
  }
  const edges = collectEdges(operands);
  stats.edges = edges.length;
  splitEdges(pool, edges, stats);
  const segments = buildSegments(edges, n);
  stats.segments = segments.length;
  const kept = classify(pool, segments, n, insideFns, predicate);
  stats.kept = kept.length;
  const rings = stitch(kept);
  stats.rings = rings.length;
  return { polygons: assemble(pool, rings), stats };
}
