// Minimal SVG rendering for inspecting inputs and results.

import { toRings } from './index.js';

function bounds(allRings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of allRings) {
    for (const [x, y] of ring) {
      const fx = Number(x), fy = Number(y);
      x0 = Math.min(x0, fx); y0 = Math.min(y0, fy);
      x1 = Math.max(x1, fx); y1 = Math.max(y1, fy);
    }
  }
  if (!Number.isFinite(x0)) return [0, 0, 1, 1];
  return [x0, y0, x1, y1];
}

const num = (v) => {
  if (typeof v === 'string' && v.includes('/')) {
    const [n, d] = v.split('/');
    return Number(n) / Number(d);
  }
  return Number(v);
};

function pathData(rings, scale, ox, oy, height) {
  return rings
    .map((ring) =>
      'M' + ring.map(([x, y]) =>
        `${((num(x) - ox) * scale).toFixed(3)} ${(height - (num(y) - oy) * scale).toFixed(3)}`,
      ).join('L') + 'Z',
    )
    .join(' ');
}

/**
 * layers: [{ shape, fill, stroke, opacity, fillRule }]
 * Coordinates are flipped so +y points up, matching the math convention.
 */
export function renderSVG(layers, { size = 480, margin = 16 } = {}) {
  const ringsPerLayer = layers.map((l) => toRings(l.shape).map((r) => r.map(([x, y]) => [num(x), num(y)])));
  const [x0, y0, x1, y1] = bounds(ringsPerLayer.flat());
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const scale = (size - 2 * margin) / span;
  const w = (x1 - x0) * scale + 2 * margin;
  const h = (y1 - y0) * scale + 2 * margin;
  const paths = layers.map((l, i) => {
    const d = pathData(ringsPerLayer[i], scale, x0, y0, h - 2 * margin);
    return `<path d="${d}" transform="translate(${margin} ${margin})" fill="${l.fill ?? 'none'}" ` +
      `fill-opacity="${l.opacity ?? 1}" stroke="${l.stroke ?? 'none'}" stroke-width="${l.strokeWidth ?? 1.5}" ` +
      `fill-rule="${l.fillRule ?? 'evenodd'}" stroke-linejoin="round"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" ` +
    `viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}"><rect width="100%" height="100%" fill="#fff"/>${paths.join('')}</svg>\n`;
}
