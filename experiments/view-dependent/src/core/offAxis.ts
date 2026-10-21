import * as THREE from 'three';
import type { Vec3 } from './types';

/** A planar rectangle in world space that we look "through": lower-left,
 *  lower-right and upper-left corners (Kooima's pa, pb, pc). */
export interface WindowRect {
  pa: THREE.Vector3;
  pb: THREE.Vector3;
  pc: THREE.Vector3;
}

const vr = new THREE.Vector3();
const vu = new THREE.Vector3();
const vn = new THREE.Vector3();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const basis = new THREE.Matrix4();

/**
 * Generalized perspective projection (Robert Kooima, 2008).
 * Places `camera` at the eye and gives it an asymmetric frustum whose edges
 * pass exactly through the corners of `rect`, so the rectangle behaves like a
 * window into the scene. Works for any rectangle orientation, which is what
 * projector surfaces will need later.
 */
export function applyOffAxis(camera: THREE.PerspectiveCamera, rect: WindowRect, eye: Vec3, near = 0.01, far = 100): void {
  vr.subVectors(rect.pb, rect.pa).normalize();
  vu.subVectors(rect.pc, rect.pa).normalize();
  vn.crossVectors(vr, vu).normalize();

  const pe = camera.position.set(eye.x, eye.y, eye.z);
  va.subVectors(rect.pa, pe);
  vb.subVectors(rect.pb, pe);
  vc.subVectors(rect.pc, pe);

  // Distance from the eye to the window plane; keep it positive so the
  // frustum never flips if the eye crosses the glass.
  const d = Math.max(1e-4, -va.dot(vn));
  const k = near / d;
  const l = vr.dot(va) * k;
  const r = vr.dot(vb) * k;
  const b = vu.dot(va) * k;
  const t = vu.dot(vc) * k;

  camera.projectionMatrix.makePerspective(l, r, t, b, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  basis.makeBasis(vr, vu, vn);
  camera.quaternion.setFromRotationMatrix(basis);
  camera.updateMatrixWorld(true);
}
