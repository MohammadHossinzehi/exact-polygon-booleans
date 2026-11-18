import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (...args) => execFileSync('node', ['bin/polybool.js', ...args], { cwd: root, encoding: 'utf8' });

test('cli: intersection with exact output', () => {
  const out = JSON.parse(run('intersection', 'examples/square.json', 'examples/diamond.json', '--exact'));
  assert.equal(out.length, 1);
  assert.equal(out[0][0].length, 8); // octagon
});

test('cli: exact areas', () => {
  assert.equal(run('xor', 'examples/square.json', 'examples/diamond.json', '--area', '--exact').trim(), '6');
  assert.equal(run('simplify', 'examples/pentagram.json', '--fill', 'nonzero', '--area', '--exact').trim(), '3488/285');
  assert.equal(run('coverage', '2', 'examples/square.json', 'examples/diamond.json', 'examples/frame.geojson', '--area').trim(), '18');
});

test('cli: GeoJSON output closes rings and SVG is written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polybool-'));
  const svg = join(dir, 'out.svg');
  const out = JSON.parse(run('union', 'examples/frame.geojson', 'examples/diamond.json', '--geojson', '--svg', svg));
  assert.equal(out.type, 'MultiPolygon');
  for (const ring of out.coordinates[0]) assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.equal(out.coordinates[0].length, 5); // frame + four corner holes
  assert.match(readFileSync(svg, 'utf8'), /^<svg/);
});

test('cli: stdin input and errors', () => {
  const r = spawnSync('node', ['bin/polybool.js', 'simplify', '-', '--area'], {
    cwd: root, input: '[[0,0],[2,2],[2,0],[0,2]]', encoding: 'utf8',
  });
  assert.equal(r.stdout.trim(), '2');
  const bad = spawnSync('node', ['bin/polybool.js', 'frobnicate', 'x'], { cwd: root, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown operation/);
});
