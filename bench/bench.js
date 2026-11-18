// Rough throughput numbers. Run: npm run bench
import { union, intersection, xor } from '../src/index.js';

function star(seed, n, cx, cy, r) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const rr = r * (0.5 + 0.5 * rand());
    return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)];
  });
}

const grid = (n, step, off) => {
  const rings = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * step + off, y = j * step + off;
    rings.push([[x, y], [x + step * 0.7, y], [x + step * 0.7, y + step * 0.7], [x, y + step * 0.7]]);
  }
  return rings;
};

const cases = [
  ['two 50-gons (float)', star(1, 50, 0, 0, 1), star(2, 50, 0.3, 0.1, 1)],
  ['two 200-gons (float)', star(3, 200, 0, 0, 1), star(4, 200, 0.3, 0.1, 1)],
  ['two 1000-gons (float)', star(5, 1000, 0, 0, 1), star(6, 1000, 0.3, 0.1, 1)],
  ['10x10 vs 10x10 squares (integer grid)', grid(10, 10, 0), grid(10, 10, 5)],
];

for (const [name, a, b] of cases) {
  for (const fn of [union, intersection, xor]) {
    const t0 = performance.now();
    const { stats } = fn(a, b, { stats: true });
    const ms = performance.now() - t0;
    console.log(`${name.padEnd(40)} ${fn.name.padEnd(13)} ${ms.toFixed(1).padStart(8)} ms   ` +
      `edges=${stats.edges} segments=${stats.segments} pairTests=${stats.pairTests} rings=${stats.rings}`);
  }
}
