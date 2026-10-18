import * as THREE from 'three';
import type { BoxDef, FaceName, ProjectorDef, Quad, Surface, Vec3 } from '../model/types';

export const OUTPUT_W = 1280;
export const OUTPUT_H = 720;
export const OUTPUT_ASPECT = OUTPUT_W / OUTPUT_H;

/** Vertical field of view in degrees for a throw ratio (distance / image width). */
export function throwToFov(throwRatio: number, aspect = OUTPUT_ASPECT): number {
  const halfH = Math.atan(0.5 / throwRatio);
  const halfV = Math.atan(Math.tan(halfH) / aspect);
  return THREE.MathUtils.radToDeg(halfV * 2);
}

export function makeProjectorCamera(def: ProjectorDef, cam = new THREE.PerspectiveCamera()): THREE.PerspectiveCamera {
  cam.fov = throwToFov(def.throwRatio);
  cam.aspect = OUTPUT_ASPECT;
  cam.near = 0.1;
  cam.far = 60;
  cam.position.set(...def.pos);
  cam.lookAt(new THREE.Vector3(...def.target));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

type BoxFace = Exclude<FaceName, 'side'>;

const FACES: Record<BoxFace, { n: Vec3; c: (w: number, h: number, d: number) => Vec3[] }> = {
  front: { n: [0, 0, 1], c: (w, h, d) => [[-w, h, d], [w, h, d], [w, 0, d], [-w, 0, d]] },
  back: { n: [0, 0, -1], c: (w, h, d) => [[w, h, -d], [-w, h, -d], [-w, 0, -d], [w, 0, -d]] },
  right: { n: [1, 0, 0], c: (w, h, d) => [[w, h, d], [w, h, -d], [w, 0, -d], [w, 0, d]] },
  left: { n: [-1, 0, 0], c: (w, h, d) => [[-w, h, -d], [-w, h, d], [-w, 0, d], [-w, 0, -d]] },
  top: { n: [0, 1, 0], c: (w, h, d) => [[-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d]] },
};

export function boxMatrix(b: BoxDef): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(...b.pos),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(b.rotY)),
    new THREE.Vector3(1, 1, 1),
  );
  return m;
}

function projectToOutput(p: THREE.Vector3, cam: THREE.PerspectiveCamera): [number, number] | null {
  const v = p.clone().project(cam);
  if (v.z < -1 || v.z > 1) return null;
  return [(v.x + 1) / 2, (1 - v.y) / 2];
}

function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * "Shape detection" for the rehearsal stage: finds every box face the projector
 * can see and returns a surface pinned to where that face lands in the output.
 */
export function detectFaces(boxes: BoxDef[], projector: ProjectorDef): Surface[] {
  const cam = makeProjectorCamera(projector);
  const projPos = new THREE.Vector3(...projector.pos);
  const out: Surface[] = [];
  for (const box of boxes) {
    const m = boxMatrix(box);
    const rot = new THREE.Matrix3().setFromMatrix4(m);
    const [w, h, d] = box.size;
    if (box.shape === 'cylinder') {
      const side = detectCylinderSide(box, cam, projPos);
      if (side) out.push(side);
      const top = detectCylinderTop(box, cam, projPos);
      if (top) out.push(top);
      continue;
    }
    for (const face of Object.keys(FACES) as BoxFace[]) {
      const f = FACES[face];
      const pts = f.c(w / 2, h, d / 2).map((p) => new THREE.Vector3(...p).applyMatrix4(m));
      const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(0.25);
      const normal = new THREE.Vector3(...f.n).applyMatrix3(rot).normalize();
      const toProj = projPos.clone().sub(center).normalize();
      if (normal.dot(toProj) < 0.08) continue;
      const corners = pts.map((p) => projectToOutput(p, cam));
      if (corners.some((c) => c === null)) continue;
      const quad = corners as Quad;
      if (Math.abs(quadArea(quad)) < 0.0008) continue;
      out.push({ id: `auto_${box.id}_${face}`, name: `${box.name} · ${face}`, corners: quad, bind: { boxId: box.id, face } });
    }
  }
  return out;
}

/**
 * The curved side of a cylinder can't be a flat quad, so it becomes a warp
 * grid: points around the half the projector can see, projected into the output.
 */
function detectCylinderSide(box: BoxDef, cam: THREE.PerspectiveCamera, projPos: THREE.Vector3): Surface | null {
  const r = box.size[0] / 2;
  const h = box.size[1];
  const center = new THREE.Vector3(box.pos[0], 0, box.pos[2]);
  const toProj = new THREE.Vector2(projPos.x - center.x, projPos.z - center.z);
  const dist = toProj.length();
  if (dist <= r) return null;
  // Edge of what the projector can see, shaved a little so the sides don't graze.
  const half = Math.acos(r / dist) * 0.94;
  const mid = Math.atan2(toProj.y, toProj.x);
  const cols = 6, rows = 2;
  const points: [number, number][] = [];
  for (let j = 0; j <= rows; j++) {
    const y = h * (1 - j / rows);
    for (let i = 0; i <= cols; i++) {
      const a = mid + half - (2 * half * i) / cols; // left to right as seen from the projector
      const p = projectToOutput(new THREE.Vector3(center.x + Math.cos(a) * r, y, center.z + Math.sin(a) * r), cam);
      if (!p) return null;
      points.push(p);
    }
  }
  const at = (i: number, j: number) => points[j * (cols + 1) + i];
  const corners: Quad = [at(0, 0), at(cols, 0), at(cols, rows), at(0, rows)];
  return { id: `auto_${box.id}_side`, name: `${box.name} · side`, corners, mesh: { cols, rows, points }, bind: { boxId: box.id, face: 'side' } };
}

function detectCylinderTop(box: BoxDef, cam: THREE.PerspectiveCamera, projPos: THREE.Vector3): Surface | null {
  const r = box.size[0] / 2;
  const h = box.size[1];
  if (projPos.y <= h + 0.05) return null;
  // Square that fits inside the circular top, edges facing the projector.
  const s = r * Math.SQRT1_2;
  const yaw = Math.atan2(projPos.x - box.pos[0], projPos.z - box.pos[2]);
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(box.pos[0], h, box.pos[2]);
  const pts: [number, number, number][] = [[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s]];
  const corners = pts.map((p) => projectToOutput(new THREE.Vector3(...p).applyMatrix4(m), cam));
  if (corners.some((c) => !c)) return null;
  const quad = corners as Quad;
  if (Math.abs(quadArea(quad)) < 0.0008) return null;
  return { id: `auto_${box.id}_top`, name: `${box.name} · top`, corners: quad, bind: { boxId: box.id, face: 'top' } };
}

export function faceCorners(box: BoxDef, face: BoxFace): THREE.Vector3[] {
  const m = boxMatrix(box);
  const [w, h, d] = box.size;
  return FACES[face].c(w / 2, h, d / 2).map((p) => new THREE.Vector3(...p).applyMatrix4(m));
}
