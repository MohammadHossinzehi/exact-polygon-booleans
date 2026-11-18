#!/usr/bin/env node
// polybool: command line front end.
//
//   polybool union a.json b.json [more.json ...] [options]
//   polybool simplify shape.json --fill nonzero
//   polybool coverage 2 a.json b.json c.json
//
// Input files hold a ring, polygon, multipolygon, or GeoJSON geometry/Feature.
// Use "-" to read one shape from stdin.

import { readFileSync, writeFileSync } from 'node:fs';
import { area, overlayShapes } from '../src/index.js';
import { renderSVG } from '../src/svg.js';

const USAGE = `usage: polybool <op> [k] <shape.json>... [options]

ops:
  union | intersection | difference | xor     two or more shapes
  simplify                                    one shape
  coverage <k>                                points inside at least k shapes

options:
  --fill <rule>     evenodd (default) | nonzero | positive | negative
  --exact           print coordinates as exact rationals ("p/q" strings)
  --geojson         wrap the output as a GeoJSON MultiPolygon geometry
  --area            print the exact area of the result instead of coordinates
  --stats           print pipeline statistics to stderr
  --svg <file>      also render inputs and result to an SVG file
`;

function fail(msg) {
  process.stderr.write(`polybool: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { fillRule: 'evenodd', exact: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fill') opts.fillRule = argv[++i];
    else if (a === '--exact') opts.exact = true;
    else if (a === '--geojson') opts.geojson = true;
    else if (a === '--area') opts.area = true;
    else if (a === '--stats') opts.stats = true;
    else if (a === '--svg') opts.svg = argv[++i];
    else if (a === '-h' || a === '--help') { process.stdout.write(USAGE); process.exit(0); }
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else opts.files.push(a);
  }
  return opts;
}

function load(file) {
  const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${file}: invalid JSON (${e.message})`);
  }
}

const OPS = {
  union: (xs) => xs.some(Boolean),
  intersection: (xs) => xs.every(Boolean),
  difference: (xs) => xs[0] && !xs.slice(1).some(Boolean),
  xor: (xs) => xs.filter(Boolean).length % 2 === 1,
  simplify: (xs) => xs[0],
};

function main() {
  const [op, ...rest] = process.argv.slice(2);
  if (!op || op === '-h' || op === '--help') { process.stdout.write(USAGE); return; }
  const opts = parseArgs(rest);
  let predicate = OPS[op];
  if (op === 'coverage') {
    const k = Number(opts.files.shift());
    if (!Number.isInteger(k) || k < 1) fail('coverage needs a positive integer k');
    predicate = (xs) => xs.filter(Boolean).length >= k;
  } else if (!predicate) {
    fail(`unknown operation "${op}"`);
  }
  if (opts.files.length === 0) fail('no input shapes');
  if (op === 'simplify' && opts.files.length !== 1) fail('simplify takes exactly one shape');

  const shapes = opts.files.map(load);
  const t0 = process.hrtime.bigint();
  const { result, stats } = overlayShapes(shapes, predicate, {
    fillRule: opts.fillRule, exact: opts.exact, stats: true,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (opts.stats) process.stderr.write(`${JSON.stringify({ ...stats, ms: +ms.toFixed(2) })}\n`);

  if (opts.svg) {
    const palette = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c'];
    const layers = shapes.map((s, i) => ({
      shape: s, stroke: palette[i % palette.length], dash: '4 3', strokeWidth: 1, fillRule: opts.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    }));
    layers.push({ shape: result, fill: '#0f172a', opacity: 0.25, stroke: '#0f172a', strokeWidth: 2, fillRule: 'nonzero' });
    writeFileSync(opts.svg, renderSVG(layers));
  }

  if (opts.area) {
    const a = area(result);
    process.stdout.write(`${opts.exact ? a.exact : a.value}\n`);
    return;
  }
  const out = opts.geojson ? { type: 'MultiPolygon', coordinates: closeRings(result) } : result;
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

/** GeoJSON wants closed rings (first vertex repeated). */
function closeRings(multi) {
  return multi.map((poly) => poly.map((ring) => [...ring, ring[0]]));
}

try {
  main();
} catch (e) {
  process.stderr.write(`polybool: ${e.message}\n`);
  process.exit(1);
}
