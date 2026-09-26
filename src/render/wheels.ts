import * as THREE from 'three';
import type { WheelSpec } from '../core/vehicles.ts';

/** Builds a simple tyre + multi-spoke rim with its axle along X; `outward` is +1 or -1 (X direction of the outer face). */
export function createWheel(spec: WheelSpec, outward: number): THREE.Group {
  const { tireRadius: R, tireWidth: W, rimRadius: r } = spec;
  const group = new THREE.Group();

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.32, metalness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.6, metalness: 0.3 });

  // Tyre cross-section revolved around the axle: rounded shoulders, flat tread.
  const half = W / 2;
  const s = W * 0.2;
  const profile: THREE.Vector2[] = [new THREE.Vector2(r, -half * 0.9)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    profile.push(new THREE.Vector2(R - s + Math.cos(a) * s, -half + s + Math.sin(a) * s));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    profile.push(new THREE.Vector2(R - s + Math.cos(a) * s, half - s + Math.sin(a) * s));
  }
  profile.push(new THREE.Vector2(r, half * 0.9));
  const tireGeo = new THREE.LatheGeometry(profile, 72);
  tireGeo.rotateZ(Math.PI / 2);
  tireMat.side = THREE.DoubleSide;
  group.add(new THREE.Mesh(tireGeo, tireMat));

  // Inner barrel, visible through the spokes.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, W * 0.85, 48, 1, true), darkMat);
  barrel.material.side = THREE.DoubleSide;
  barrel.rotation.z = Math.PI / 2;
  group.add(barrel);
  const back = new THREE.Mesh(new THREE.CircleGeometry(r, 48), darkMat);
  back.rotation.y = outward > 0 ? Math.PI / 2 : -Math.PI / 2;
  back.position.x = -outward * W * 0.2;
  group.add(back);

  // Outer face: rim lip, 10 spokes, hub cap.
  const face = new THREE.Group();
  face.position.x = outward * W * 0.4;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, r * 0.05, 8, 64), rimMat);
  lip.rotation.y = Math.PI / 2;
  face.add(lip);
  const spokeGeo = new THREE.BoxGeometry(W * 0.08, r * 0.82, r * 0.12);
  for (let i = 0; i < 10; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    const a = (i / 10) * Math.PI * 2 + (i % 2 ? 0.1 : -0.1);
    spoke.position.set(0, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
    spoke.rotation.x = a;
    face.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.22, W * 0.12, 32), rimMat);
  hub.rotation.z = Math.PI / 2;
  face.add(hub);
  group.add(face);
  return group;
}
