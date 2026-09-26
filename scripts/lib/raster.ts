/** Minimal triangle rasterizer and mask utilities used to derive panel maps from UVs. */

export type Vec2 = [number, number];

/** Calls `plot(x, y)` for every pixel whose center lies inside (or on) the triangle. */
export function rasterizeTriangle(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  width: number,
  height: number,
  plot: (x: number, y: number) => void,
): void {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-12) return;
  const eps = 1e-9;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -eps && w1 >= -eps && w2 >= -eps) plot(x, y);
    }
  }
}

/** Plots pixels along a segment so that sliver triangles still leave a trace. */
export function rasterizeSegment(
  a: Vec2,
  b: Vec2,
  width: number,
  height: number,
  plot: (x: number, y: number) => void,
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a[0] + (b[0] - a[0]) * t);
    const y = Math.floor(a[1] + (b[1] - a[1]) * t);
    if (x >= 0 && y >= 0 && x < width && y < height) plot(x, y);
  }
}

/** Grows labelled regions into unlabelled (0) pixels by `radius` pixels (8-connected). */
export function dilateLabels(labels: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let cur = labels;
  for (let r = 0; r < radius; r++) {
    const next = cur.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (cur[i] !== 0) continue;
        let found = 0;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const v = cur[yy * width + xx];
            if (v !== 0) {
              found = v;
              break;
            }
          }
        }
        if (found) next[i] = found;
      }
    }
    cur = next;
  }
  return cur;
}

/** 8-connected component labelling of a boolean mask. Returns component id per pixel (0 = none). */
export function connectedComponents(mask: Uint8Array, width: number, height: number): { ids: Int32Array; count: number } {
  const ids = new Int32Array(width * height);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || ids[start]) continue;
    count++;
    ids[start] = count;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] && !ids[j]) {
            ids[j] = count;
            stack.push(j);
          }
        }
      }
    }
  }
  return { ids, count };
}
