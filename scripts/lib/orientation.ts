/**
 * Derives how a panel's wrap-PNG axes map onto the car, from the UV→3D Jacobian of its triangles.
 * Car frame of the source model: front = -Z, up = +Y, driver's left = -X.
 */
import type { CarDirection, PanelOrientation } from '../../src/core/panels.ts';
import type { Vec2 } from './raster.ts';

export type Vec3 = [number, number, number];

const AXES: [CarDirection, Vec3][] = [
  ['front', [0, 0, -1]],
  ['rear', [0, 0, 1]],
  ['up', [0, 1, 0]],
  ['down', [0, -1, 0]],
  ['left', [-1, 0, 0]],
  ['right', [1, 0, 0]],
];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function directionName(v: Vec3): CarDirection {
  let best = AXES[0];
  for (const axis of AXES) if (dot(v, axis[1]) > dot(v, best[1])) best = axis;
  return best[0];
}

export interface OrientedTriangle {
  /** Pixel coordinates in the wrap PNG (y down). */
  uv: [Vec2, Vec2, Vec2];
  pos: [Vec3, Vec3, Vec3];
  normal: Vec3;
}

export function panelOrientation(tris: OrientedTriangle[]): PanelOrientation {
  const ju: Vec3 = [0, 0, 0];
  const jv: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 0];
  for (const t of tris) {
    const e1 = sub(t.pos[1], t.pos[0]);
    const e2 = sub(t.pos[2], t.pos[0]);
    const d1 = [t.uv[1][0] - t.uv[0][0], t.uv[1][1] - t.uv[0][1]];
    const d2 = [t.uv[2][0] - t.uv[0][0], t.uv[2][1] - t.uv[0][1]];
    const det = d1[0] * d2[1] - d2[0] * d1[1];
    if (Math.abs(det) < 1e-9) continue;
    // Columns of J = [e1 e2]·inv([d1 d2]): 3D change per pixel along image x and image y.
    // Weighting by |det| makes each triangle count by its UV area.
    const w = Math.abs(det) / det;
    for (let k = 0; k < 3; k++) {
      ju[k] += (e1[k] * d2[1] - e2[k] * d1[1]) * w;
      jv[k] += (-e1[k] * d2[0] + e2[k] * d1[0]) * w;
    }
    const area = Math.hypot(...cross(e1, e2));
    const tn = norm(t.normal);
    for (let k = 0; k < 3; k++) n[k] += tn[k] * area;
  }
  const right = norm(ju);
  const up = norm([-jv[0], -jv[1], -jv[2]]);
  const outward = norm(n);
  return {
    imageRight: directionName(right),
    imageUp: directionName(up),
    facing: directionName(outward),
    // Viewed from outside the car, artwork reads correctly when image right × image up points outward.
    mirrored: dot(cross(right, up), outward) < 0,
  };
}
