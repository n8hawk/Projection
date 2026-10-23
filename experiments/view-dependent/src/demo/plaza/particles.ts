import * as THREE from 'three';

/**
 * A CPU-simulated particle pool drawn as one Points cloud, with per-particle
 * size (in metres, so it shrinks with distance), colour and fade. One pool
 * per blend mode: additive for fire, sparks and plasma; normal for smoke and
 * dust.
 */
export interface Emit {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  /** Size at the end of life (defaults to `size`). */
  size1?: number;
  color: THREE.Color;
  /** Colour at the end of life (defaults to `color`). */
  color1?: THREE.Color;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aColor.a > 0.0 ? clamp(aSize * uScale / max(0.001, -mv.z), 1.0, 512.0) : 0.0;
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
uniform float uSoft;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = mix(1.0 - r, exp(-r * 4.0), uSoft);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

export class Particles {
  readonly points: THREE.Points;
  private n: number;
  private next = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private age: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private mat: THREE.ShaderMaterial;

  constructor(capacity: number, additive: boolean) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.c0 = new Float32Array(capacity * 3);
    this.c1 = new Float32Array(capacity * 3);
    this.a0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uScale: { value: 500 }, uSoft: { value: additive ? 1 : 0.4 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  /** Pixels per metre at one metre away; call each frame before rendering. */
  setScale(pxPerMetreAtOne: number): void { this.mat.uniforms.uScale.value = pxPerMetreAtOne; }

  emit(e: Emit): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([e.pos.x, e.pos.y, e.pos.z], i * 3);
    const v = e.vel ?? new THREE.Vector3();
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = e.life;
    this.age[i] = 0;
    this.s0[i] = e.size;
    this.s1[i] = e.size1 ?? e.size;
    const c1 = e.color1 ?? e.color;
    this.c0.set([e.color.r, e.color.g, e.color.b], i * 3);
    this.c1.set([c1.r, c1.g, c1.b], i * 3);
    this.a0[i] = e.alpha ?? 1;
    this.grav[i] = e.gravity ?? 0;
    this.drag[i] = e.drag ?? 0;
  }

  clear(): void { this.life.fill(0); this.col.fill(0); }

  /** @param floorY particles don't sink below this (they skid along it). */
  update(dt: number, floorY: number): void {
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, k = i * 4;
      if (this.life[i] <= 0) { this.col[k + 3] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.life[i] = 0; this.col[k + 3] = 0; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j + 1] -= this.grav[i] * dt;
      for (let a = 0; a < 3; a++) { this.vel[j + a] *= d; this.pos[j + a] += this.vel[j + a] * dt; }
      if (this.pos[j + 1] < floorY) { this.pos[j + 1] = floorY; this.vel[j + 1] *= -0.3; this.vel[j] *= 0.6; this.vel[j + 2] *= 0.6; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let a = 0; a < 3; a++) this.col[k + a] = this.c0[j + a] + (this.c1[j + a] - this.c0[j + a]) * t;
      // Quick fade in, long fade out.
      this.col[k + 3] = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

/**
 * Chunks of concrete and metal knocked loose: instanced boxes that tumble,
 * bounce and settle, then sink away.
 */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private next = 0;
  private p: THREE.Vector3[] = [];
  private v: THREE.Vector3[] = [];
  private q: THREE.Quaternion[] = [];
  private w: THREE.Vector3[] = [];
  private s: number[] = [];
  private life: number[] = [];
  private m = new THREE.Matrix4();
  private tq = new THREE.Quaternion();
  private te = new THREE.Euler();
  private one = new THREE.Vector3();

  constructor(capacity: number) {
    this.n = capacity;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.1, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.p.push(new THREE.Vector3()); this.v.push(new THREE.Vector3());
      this.q.push(new THREE.Quaternion()); this.w.push(new THREE.Vector3());
      this.s.push(0); this.life.push(0);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, new THREE.Color('#444'));
    }
  }

  spawn(at: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.Color, life = 4): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p[i].copy(at); this.v[i].copy(vel);
    this.q[i].setFromEuler(this.te.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    this.w[i].set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
    this.s[i] = size * (0.6 + Math.random() * 0.8);
    this.life[i] = life * (0.7 + Math.random() * 0.6);
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void { this.life.fill(0); }

  update(dt: number, floorY: number, gravity: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      this.life[i] -= dt;
      const p = this.p[i], v = this.v[i], s = this.s[i];
      v.y -= gravity * dt;
      p.addScaledVector(v, dt);
      const floor = floorY + s * 0.35;
      if (p.y < floor) {
        p.y = floor;
        v.y = Math.abs(v.y) > gravity * 0.05 ? -v.y * 0.35 : 0;
        v.x *= 0.55; v.z *= 0.55; this.w[i].multiplyScalar(0.5);
      }
      const w = this.w[i];
      this.tq.setFromEuler(this.te.set(w.x * dt, w.y * dt, w.z * dt));
      this.q[i].multiply(this.tq);
      // Sink into the ground at the end instead of popping out.
      const sink = Math.min(1, this.life[i] / 0.6);
      this.mesh.setMatrixAt(i, this.m.compose(p, this.q[i], this.one.setScalar(s * sink)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
