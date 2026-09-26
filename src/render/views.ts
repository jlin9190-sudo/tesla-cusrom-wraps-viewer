import * as THREE from 'three';

export interface ViewPreset {
  label: string;
  /** Direction from the car centre towards the camera, in model space (front = -Z, driver's left = -X). */
  dir: [number, number, number];
  up?: [number, number, number];
}

export const VIEWS = {
  front_left: { label: 'Front 3/4 left', dir: [-1, 0.42, -1.05] },
  front: { label: 'Front', dir: [0, 0.22, -1] },
  left: { label: 'Left side', dir: [-1, 0.08, 0] },
  rear_right: { label: 'Rear 3/4 right', dir: [1, 0.42, 1.05] },
  rear: { label: 'Rear', dir: [0, 0.25, 1] },
  right: { label: 'Right side', dir: [1, 0.08, 0] },
  top: { label: 'Top (front up)', dir: [0, 1, 0], up: [0, 0, -1] },
} satisfies Record<string, ViewPreset>;

export type ViewName = keyof typeof VIEWS;
export const VIEW_NAMES = Object.keys(VIEWS) as ViewName[];

export function isViewName(v: string): v is ViewName {
  return v in VIEWS;
}

/**
 * Places `camera` on the preset direction at the smallest distance that keeps the whole
 * box inside the frame with `margin` (fraction of half-frame) to spare.
 */
export function fitCamera(camera: THREE.PerspectiveCamera, box: THREE.Box3, view: ViewPreset, margin = 0.03): THREE.Vector3 {
  const target = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(...view.dir).normalize();
  const up = new THREE.Vector3(...(view.up ?? [0, 1, 0]));
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (1 - margin);
  const tanH = tanV * camera.aspect;
  let dist = 0;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
    const depth = corner.dot(dir);
    dist = Math.max(dist, depth + Math.abs(corner.dot(right)) / tanH, depth + Math.abs(corner.dot(camUp)) / tanV);
  }
  camera.up.copy(camUp);
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);
  camera.near = Math.max(0.01, dist / 100);
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  return target;
}
