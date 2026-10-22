import * as THREE from 'three';
import { popupTexture, scorchTexture, sparkTexture } from './textures';

const MAX_SPARKS = 320;
const MAX_MARKS = 80;

/**
 * Hit feedback that lives in the scene: sparks, score popups, and bullet
 * marks parented to whatever was hit, so they ride along with moving ducks.
 */
export class Effects {
  readonly group = new THREE.Group();

  // Sparks: one Points cloud, simulated on the CPU.
  private pos = new Float32Array(MAX_SPARKS * 3);
  private col = new Float32Array(MAX_SPARKS * 3);
  private vel = new Float32Array(MAX_SPARKS * 3);
  private life = new Float32Array(MAX_SPARKS);
  private tint = new Float32Array(MAX_SPARKS * 3);
  private next = 0;
  private sparks: THREE.Points;

  private popups: { s: THREE.Sprite; age: number }[] = [];
  private popupTex = new Map<string, THREE.Texture>();

  private marks: THREE.Mesh[] = [];
  private markGeo = new THREE.PlaneGeometry(1, 1);
  private markMat: THREE.MeshStandardMaterial;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.0035, map: sparkTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    this.markMat = new THREE.MeshStandardMaterial({
      map: scorchTexture(), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }

  /** A burst of sparks off a surface. `hot` for metal, otherwise wood chips. */
  burst(at: THREE.Vector3, normal: THREE.Vector3, hot: boolean, n = hot ? 22 : 12): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_SPARKS;
      const v = new THREE.Vector3().randomDirection().addScaledVector(normal, 1.3).normalize()
        .multiplyScalar((hot ? 0.25 : 0.12) * (0.4 + Math.random()));
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      this.life[i] = (hot ? 0.35 : 0.5) * (0.6 + Math.random() * 0.6);
      if (hot) this.tint.set([1.4, 0.95 + Math.random() * 0.2, 0.45], i * 3);
      else this.tint.set([0.55, 0.36, 0.18], i * 3);
    }
  }

  /** "+50" rising from the hit. */
  popup(at: THREE.Vector3, text: string): void {
    let tex = this.popupTex.get(text);
    if (!tex) { tex = popupTexture(text); this.popupTex.set(text, tex); }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(0.024, 0.012, 1);
    s.position.copy(at);
    s.renderOrder = 20;
    this.group.add(s);
    this.popups.push({ s, age: 0 });
  }

  /** A scorch mark glued to `obj` at a world-space hit. */
  mark(obj: THREE.Object3D, at: THREE.Vector3, normal: THREE.Vector3, size = 0.005): void {
    const m = new THREE.Mesh(this.markGeo, this.markMat);
    m.position.copy(at).addScaledVector(normal, 0.0003);
    m.lookAt(m.position.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    m.receiveShadow = true;
    obj.attach(m);
    this.marks.push(m);
    if (this.marks.length > MAX_MARKS) this.marks.shift()!.removeFromParent();
  }

  clearMarks(): void {
    for (const m of this.marks) m.removeFromParent();
    this.marks = [];
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_SPARKS; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) { this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      this.life[i] -= dt;
      this.vel[j + 1] -= 1.2 * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[j + a] *= 1 - 2.5 * dt;
        this.pos[j + a] += this.vel[j + a] * dt;
      }
      const f = Math.max(0, Math.min(1, this.life[i] * 3));
      this.col[j] = this.tint[j] * f; this.col[j + 1] = this.tint[j + 1] * f; this.col[j + 2] = this.tint[j + 2] * f;
    }
    const g = this.sparks.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;

    for (let k = this.popups.length - 1; k >= 0; k--) {
      const p = this.popups[k];
      p.age += dt;
      p.s.position.y += dt * 0.03;
      (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, (1.1 - p.age) * 3);
      if (p.age > 1.1) {
        p.s.removeFromParent();
        p.s.material.dispose();
        this.popups.splice(k, 1);
      }
    }
  }
}
