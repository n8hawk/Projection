import * as THREE from 'three';
import type { Quad } from '../model/types';

/**
 * Perspective-correct corner pin. Each corner gets uv * q and q, where q comes
 * from where the quad's diagonals cross; dividing in the fragment shader undoes
 * the affine warp a plain two-triangle quad would show.
 */
export function quadUvq(c: Quad): number[] {
  const [p0, p1, p2, p3] = c;
  // Intersection of diagonals p0-p2 and p1-p3.
  const x1 = p0[0], y1 = p0[1], x2 = p2[0], y2 = p2[1];
  const x3 = p1[0], y3 = p1[1], x4 = p3[0], y4 = p3[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const uvs: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
  if (Math.abs(den) < 1e-9) return uvs.flatMap(([u, v]) => [u, v, 1]);
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const ix = x1 + t * (x2 - x1);
  const iy = y1 + t * (y2 - y1);
  const d = c.map((p) => Math.hypot(p[0] - ix, p[1] - iy));
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const opp = d[(i + 2) % 4];
    const q = opp > 1e-9 ? (d[i] + opp) / opp : 1;
    out.push(uvs[i][0] * q, uvs[i][1] * q, q);
  }
  return out;
}

export function makeQuadGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('uvq', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 3, 1, 1, 3, 2]);
  return g;
}

export function updateQuadGeometry(g: THREE.BufferGeometry, c: Quad): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uvq = g.getAttribute('uvq') as THREE.BufferAttribute;
  for (let i = 0; i < 4; i++) pos.setXYZ(i, c[i][0] * 2 - 1, 1 - c[i][1] * 2, 0);
  const q = quadUvq(c);
  for (let i = 0; i < 4; i++) uvq.setXYZ(i, q[i * 3], q[i * 3 + 1], q[i * 3 + 2]);
  pos.needsUpdate = true;
  uvq.needsUpdate = true;
}
