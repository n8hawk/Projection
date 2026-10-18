import * as THREE from 'three';
import type { MeshWarp, Quad, Vec2 } from '../model/types';

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

/** Point at (s, t) inside a corner-pinned quad, s right and t down, both 0..1, with perspective. */
export function quadPoint(c: Quad, s: number, t: number): Vec2 {
  // Square-to-quad homography (Heckbert).
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = c;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    a = x1 - x0; b = x2 - x1; d = y1 - y0; e = y2 - y1;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3;
    const w = g * s + h * t + 1;
    return [(a * s + b * t + x0) / w, (d * s + e * t + y0) / w];
  }
  return [x0 + a * s + b * t, y0 + d * s + e * t];
}

/** Turns a corner pin into a warp grid that starts out looking identical. */
export function quadToMesh(c: Quad, cols: number, rows: number): MeshWarp {
  const points: Vec2[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) points.push(quadPoint(c, i / cols, j / rows));
  return { cols, rows, points };
}

export function meshCorners(m: MeshWarp): Quad {
  const at = (i: number, j: number) => m.points[j * (m.cols + 1) + i];
  return [at(0, 0), at(m.cols, 0), at(m.cols, m.rows), at(0, m.rows)];
}

/** The mesh's outline, clockwise from the top-left, for drawing and hit tests. */
export function meshOutline(m: MeshWarp): Vec2[] {
  const at = (i: number, j: number) => m.points[j * (m.cols + 1) + i];
  const out: Vec2[] = [];
  for (let i = 0; i <= m.cols; i++) out.push(at(i, 0));
  for (let j = 1; j <= m.rows; j++) out.push(at(m.cols, j));
  for (let i = m.cols - 1; i >= 0; i--) out.push(at(i, m.rows));
  for (let j = m.rows - 1; j > 0; j--) out.push(at(0, j));
  return out;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Smooth point on the warp grid; gs in 0..cols, gt in 0..rows. */
export function meshPoint(m: MeshWarp, gs: number, gt: number): Vec2 {
  const at = (i: number, j: number) => {
    // Extrapolate past the edges so border cells stay straight.
    const ci = Math.max(0, Math.min(m.cols, i));
    const cj = Math.max(0, Math.min(m.rows, j));
    const p = m.points[cj * (m.cols + 1) + ci];
    if (ci === i && cj === j) return p;
    const qi = Math.max(0, Math.min(m.cols, ci - (i - ci)));
    const qj = Math.max(0, Math.min(m.rows, cj - (j - cj)));
    const q = m.points[qj * (m.cols + 1) + qi];
    return [2 * p[0] - q[0], 2 * p[1] - q[1]] as Vec2;
  };
  const i = Math.min(m.cols - 1, Math.floor(gs));
  const j = Math.min(m.rows - 1, Math.floor(gt));
  const fs = gs - i, ft = gt - j;
  const row = (jj: number): Vec2 => {
    const a = at(i - 1, jj), b = at(i, jj), c = at(i + 1, jj), d = at(i + 2, jj);
    return [catmull(a[0], b[0], c[0], d[0], fs), catmull(a[1], b[1], c[1], d[1], fs)];
  };
  const r0 = row(j - 1), r1 = row(j), r2 = row(j + 1), r3 = row(j + 2);
  return [catmull(r0[0], r1[0], r2[0], r3[0], ft), catmull(r0[1], r1[1], r2[1], r3[1], ft)];
}

const SUB = 12; // drawn triangles per grid cell, each way

export function makeMeshGeometry(m: MeshWarp): THREE.BufferGeometry {
  const nx = m.cols * SUB, ny = m.rows * SUB;
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uvq = new Float32Array((nx + 1) * (ny + 1) * 3);
  let k = 0;
  for (let y = 0; y <= ny; y++) {
    for (let x = 0; x <= nx; x++) {
      const [px, py] = meshPoint(m, x / SUB, y / SUB);
      pos[k] = px * 2 - 1; pos[k + 1] = 1 - py * 2; pos[k + 2] = 0;
      uvq[k] = x / nx; uvq[k + 1] = 1 - y / ny; uvq[k + 2] = 1;
      k += 3;
    }
  }
  const idx: number[] = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const a = y * (nx + 1) + x, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uvq', new THREE.BufferAttribute(uvq, 3));
  g.setIndex(idx);
  return g;
}

/** Filled polygon in output space (for masks). */
export function makePolygonGeometry(points: Vec2[]): THREE.BufferGeometry {
  const contour = points.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = new Float32Array(points.length * 3);
  points.forEach(([x, y], i) => { pos[i * 3] = x * 2 - 1; pos[i * 3 + 1] = 1 - y * 2; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(tris.flat());
  return g;
}
