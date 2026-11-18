# exact-polygon-booleans

Polygon union, intersection, difference, xor and "covered by at least k shapes" in plain JavaScript, computed in **exact rational arithmetic** so that degenerate input cannot break it. Zero dependencies, about 1000 lines of source, Node 18+ or any modern browser.

```
$ node bin/polybool.js simplify examples/pentagram.json --fill nonzero --exact
[[[["-1","4"],["16/19","48/19"],["0","0"],["2","8/5"],["4","0"],["60/19","48/19"],["5","4"],["8/3","4"],["2","6"],["4/3","4"]]]]
```

That is the outline of a self intersecting pentagram, with every crossing point given as an exact fraction rather than a rounded float.

## Why this exists

Polygon clipping is one of those problems that looks done until you feed it real data. Map layers share edges, CAD shapes touch at a single vertex, a cutter shares half an edge with the thing it cuts, two coordinates differ in the 17th significant digit. Classic clippers (Weiler Atherton, Greiner Hormann, Vatti, Martinez) all work in floating point, and almost every bug report against a clipping library is the same story: a predicate like "which side of this line is that point on" returned the wrong sign for a nearly degenerate case, the algorithm took a branch that is impossible in exact geometry, and the output has a missing piece, a spike, or an exception.

This library takes a different route. Every coordinate is converted to the rational number it *exactly* represents (a double like `0.1` becomes `3602879701896397/36028797018963968`), intersection points are constructed exactly, and every decision the algorithm makes is evaluated exactly. There is no epsilon anywhere in the geometry. To keep that affordable, predicates run in floating point first with a rigorous error bound and only fall back to BigInt arithmetic when the float answer is too close to call.

The other design choice is to avoid special cases altogether. Instead of tracing boundaries and patching up coincident edges, the engine overlays all operands, measures the **winding number of every operand on both sides of every edge piece**, and keeps the pieces where the answer to "is this point in the result" changes. Coincident edges, T junctions, shared vertices, holes touching outer rings and self intersecting input are all just ordinary cases of that rule.

## Quick start

No install step. Clone and run:

```
git clone https://github.com/MohammadHossinzehi/exact-polygon-booleans
cd exact-polygon-booleans
npm test                      # 36 tests, about 20 seconds (mostly the randomized oracles)
node bin/polybool.js intersection examples/square.json examples/diamond.json --exact
```

### As a library

```js
import { union, intersection, difference, xor, coverage, simplify, area, classifyPoint } from './src/index.js';

const A = [[0, 0], [2, 0], [2, 2], [0, 2]];
const B = [[1, 1], [3, 1], [3, 3], [1, 3]];

union(A, B);
// [[[[0,0],[2,0],[2,1],[3,1],[3,3],[1,3],[1,2],[0,2]]]]

difference([[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [4, 2], [4, 4], [2, 4]]);
// one polygon: CCW outer ring plus a CW hole ring

xor(A, B, { exact: true });           // coordinates as exact "p/q" strings
union(A, B, C, D);                    // every operation is n ary
coverage(2, [A, B, C]);               // points inside at least 2 of the 3 shapes
simplify(selfIntersecting, { fillRule: 'nonzero' });
area(union(A, B)).exact;              // "7"
classifyPoint(A, [2, 1]);             // "boundary"
```

**Input.** A ring (`[[x, y], ...]`), a polygon (`[outer, hole, ...]`), a multipolygon, or a GeoJSON `Polygon`, `MultiPolygon`, `Feature` or `FeatureCollection`. Coordinates may be numbers, BigInts or strings such as `"7/3"` or `"0.1"` (which, unlike the number `0.1`, really is one tenth). Rings may be open or closed, oriented either way, self intersecting, overlapping and full of duplicate points. Each operand is interpreted under a fill rule, so all that matters is its edges.

**Output.** A multipolygon: an array of polygons, each `[outerRing, ...holes]`. Outer rings are counterclockwise, holes clockwise, rings are open (first vertex not repeated), no ring visits a vertex twice, and no two edges anywhere in the output cross, overlap, or touch except at shared vertices. Output is canonical: each ring starts at its lexicographically smallest rotation and polygons are sorted, so equal regions always produce identical arrays regardless of how the input was ordered.

**Options** (last argument):

| Option | Default | Meaning |
| --- | --- | --- |
| `fillRule` | `'evenodd'` | `'evenodd'`, `'nonzero'`, `'positive'` or `'negative'`, or an array with one rule per operand |
| `exact` | `false` | return coordinates as exact rational strings instead of the nearest doubles |
| `stats` | `false` | return `{ result, stats }` with edge, segment and pair test counts |

Even odd is the default because it reads GeoJSON style polygons correctly no matter how their holes are oriented. Use `nonzero` when orientation is meaningful, for example to fill a self overlapping outline.

For anything else there is `overlayShapes(shapes, predicate, options)`, where `predicate` receives one boolean per operand and decides membership. `union` is just `xs => xs.some(Boolean)`.

### Command line

```
polybool <op> [k] <shape.json>... [--fill rule] [--exact] [--geojson] [--area] [--stats] [--svg out.svg]

node bin/polybool.js union a.json b.json c.json --geojson
node bin/polybool.js xor examples/square.json examples/diamond.json --area --exact     # 6
node bin/polybool.js coverage 2 a.json b.json c.json --svg overlap.svg
cat shape.json | node bin/polybool.js simplify - --fill nonzero
```

`--svg` renders the inputs (dashed) and the result (filled) so you can eyeball what happened.

### Interactive demo

`demo/index.html` is a canvas playground: two polygons with draggable vertices, a live result for any operation and fill rule, and the exact area of the result. It imports the library straight from `src/`, so serve the repository root with any static server and open `/demo/`:

```
python3 -m http.server 8000      # then visit http://localhost:8000/demo/
```

## How it works

The pipeline lives in `src/boolean.js` and has seven steps.

1. **Edges.** Every edge of every operand is stored in canonical direction (lexicographically smaller endpoint first) with a sign recording its original direction and the operand it belongs to.
2. **Split.** A sort and sweep over x, filtered by y overlap, proposes candidate pairs; `splitPoints` then computes every contact exactly: proper crossings, T junctions, shared endpoints and collinear overlaps all come out of one function that reasons about four orientation signs.
3. **Merge.** Edges are cut at their contact points. Pieces with identical endpoints collapse into one segment that carries a multiplicity vector, the net number of times each operand runs along it. A piece traversed forwards and backwards by the same operand cancels and disappears.
4. **Classify.** For each segment, a ray is cast from its midpoint, nudged an infinitesimal amount off the segment, and every other segment's multiplicity vector is added up to give the winding number of every operand on one side. The nudge is never a number: it is implemented by half open comparisons (a vertex exactly at the ray's height counts as below it), which is the symbolic perturbation idea from Edelsbrunner and Mücke applied to one predicate. The winding on the other side differs by exactly the segment's own multiplicity vector. One subtlety cost me a debugging session: whether the probe's ray would itself cross the segment depends on the slope, so rising segments and falling segments must be told apart before the two sides can be labelled.
5. **Select.** Apply the fill rule to each winding number and the predicate to the resulting booleans, once per side. Keep the segment iff the answers differ, oriented so the result lies on its left.
6. **Stitch.** At every vertex, follow the outgoing edge that makes the sharpest clockwise turn. Because inside and outside alternate around a vertex, kept edges alternate in and out, so this pairing is a bijection and always closes. It traces minimal faces, which never cross. A face can still pinch (a square with a triangular hole touching one of its corners is bounded by a single "keyhole" walk), so every walk is then cut into loops that visit each vertex once, the form GeoJSON and OGC consumers expect.
7. **Assemble.** Drop collinear vertices that nothing else touches, determine each ring's orientation from the exact sign of its area, and give each hole to the innermost outer ring around it. Outer rings never cross, so the candidates form a nested chain and "innermost" is decided by testing one edge midpoint.

### Exact arithmetic without the usual cost

`src/rational.js` stores normalized BigInt fractions, so equal values are bitwise equal and points can be interned in a hash map and compared with `===`. Normalizing means a gcd per operation, which is the expensive part, and the first profile showed 95% of the time inside `gcd`. Three things fixed that:

* **Filtered predicates.** Every interned point keeps a double shadow within about one ulp of its exact value. `orient` evaluates the cross product in floats together with an a priori bound on its error (derived from the conversion error of each coordinate, the subtraction and the products, then doubled). If the float result clears the bound its sign is certainly right; only near degenerate triples go to BigInt. A test feeds 20,000 triples within a few ulps of a common line, confirms that plain floating point gets hundreds of them wrong, and checks the filtered predicate against the exact one every time.
* **No gcd in predicates.** The exact fallback cross multiplies unnormalized numerators and denominators. All denominators are positive, so the sign of one big integer is the answer.
* **No exact area sums.** Summing a ring's area exactly makes denominators grow towards the least common multiple of every vertex, which is ruinous on rings made of intersection points. Orientation only needs the sign, so that is also computed with a filtered float sum.

Together these took the 200 vertex benchmark from 1.8 s to under 40 ms.

### Performance

`npm run bench` on a laptop class CPU, Node 22:

| Input | union | intersection | xor |
| --- | --- | --- | --- |
| two random 50 gons (floats) | 13 ms | 8 ms | 8 ms |
| two random 200 gons (floats, 644 split segments) | 39 ms | 36 ms | 81 ms |
| two random 1000 gons (floats, 7148 split segments) | 0.8 s | 0.9 s | 1.8 s |
| 100 squares vs 100 squares on an integer grid | 41 ms | 31 ms | 36 ms |

The split phase is output sensitive in practice thanks to the sweep. Classification casts one ray per segment against all segments (float rejected, so cheap per pair), which is quadratic and dominates on the largest case. A y interval tree or classifying by flood fill across the arrangement would make it near linear; for the shape sizes this library targets the simpler code won.

## Testing

`npm test` runs 36 tests on `node:test`. Most of the value is in the randomized differential tests in `test/oracle.test.js`:

* **Membership oracle.** 120 rounds of random shapes on a 7 by 7 integer grid (the nastiest input there is: collinear overlaps, T junctions, repeated vertices and self intersections everywhere), under three fill rules and all four operations. For random rational sample points, "inside the result" must equal the operation applied to "inside A" and "inside B", where operand membership comes from `classifyPoint`, a separate winding number routine that shares none of the overlay code. Over ten thousand points are checked, and the output is also required to give the same answer under even odd and nonzero, which is only true for clean output.
* **Exact area identities.** `area(A ∪ B) + area(A ∩ B) = area(A) + area(B)`, `area(A − B) + area(A ∩ B) = area(A)` and `area(A ⊕ B) + area(A ∩ B) = area(A ∪ B)`, compared as exact rationals, so not one bit may be lost.
* **Validity.** Every result is checked pairwise for crossing, overlapping or touching edges and for rings that revisit a vertex.
* **Invariance.** Rotating input rings, reordering rings, swapping operands of symmetric operations and reversing orientation under even odd must not change the output at all, not even vertex order.
* **Idempotence** of `simplify` and `union(R, R)` on results, and **k coverage** against a brute force count.

The hand written cases in `test/cases.test.js` cover the classics: shared edges, half shared edges, vertex contact, holes touching the outer ring at a point, islands inside holes, bow ties, pentagrams under both fill rules, GeoJSON input and empty operands. My favourite is two rectangles whose shared edge is at `0.3` and at `0.1 + 0.2`. In decimal they touch; in binary there is a gap of exactly 2⁻⁵⁴, and the library reports their union as two polygons and the gap as a sliver whose area is exactly `1/18014398509481984`. A clipper with a snapping epsilon would quietly weld them, which might be what you want for display but is wrong as geometry.

## Layout

| File | Contents |
| --- | --- |
| `src/rational.js` | BigInt rationals, exact conversion from doubles and decimal strings |
| `src/geometry.js` | point interning, filtered `orient` and comparisons, exact segment contact, ring winding |
| `src/boolean.js` | the seven step overlay engine |
| `src/index.js` | public API, input normalization, GeoJSON support |
| `src/svg.js` | small SVG renderer used by the CLI |
| `bin/polybool.js` | command line interface |
| `demo/index.html` | interactive browser demo |
| `test/` | unit, oracle, predicate and CLI tests |
| `bench/bench.js` | benchmark |

## Limitations

Coordinates are exact, but output as numbers rounds each vertex to the nearest double, and rounding can in rare cases make a valid result invalid (two vertices a few ulps apart collapsing). Use `exact: true` if you need to feed results back in losslessly. Curves are not supported, only straight edges. The quadratic classification step means inputs with tens of thousands of edges will be slow.

## References

* H. Edelsbrunner, E. P. Mücke. Simulation of Simplicity. ACM Transactions on Graphics 9(1), 1990.
* J. R. Shewchuk. Adaptive Precision Floating Point Arithmetic and Fast Robust Geometric Predicates. Discrete and Computational Geometry 18, 1997.
* F. Martínez, A. J. Rueda, F. R. Feito. A new algorithm for computing Boolean operations on polygons. Computers and Geosciences 35, 2009.
* M. de Berg, O. Cheong, M. van Kreveld, M. Overmars. Computational Geometry, chapter 2 (overlay of planar subdivisions).

## License

MIT
